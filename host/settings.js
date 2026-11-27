// 设置 → 扩展 页。ui 是 T3 原生的 Section / Row / Switch / Button / Input / Select 系列，scope 是当前选中的项目/环境作用域。
// 页面外壳和动作在这里；“已安装”的卡片和设置视图在 settings-installed.js，“浏览”的面板在 settings-browse.js（宿主各文件拼在同一个作用域里）。

const h = React.createElement;
// 整个区块也包一层：宿主自己出错时只显示一行提示，不连累 T3 的设置页。
const HOST_REC = { manifest: { id: "t3x-host" } };

function matchesSearch(rec, q) {
  if (!q) return true;
  const { manifest, source } = rec;
  const fields = [
    manifest.id,
    manifest.name,
    manifest.description,
    manifest.author,
    localized(manifest, "name"),
    localized(manifest, "description"),
    source?.folder,
    source?.file,
    source?.owner,
    source?.repo,
    sourceLabelFor(source?.kind),
  ];
  return fields.some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}

/** 一次性的操作结果用 T3 的 toast：不挤占页面，几秒后自己消失。持续存在的问题（比如数据没读出）才留在页面上。 */
const TOAST_TYPES = { ok: "success", error: "error", info: "info", warning: "warning" };
const notify = (ui, message) => message && ui.toast.add({ type: TOAST_TYPES[message.kind] ?? "info", title: message.text });

function SettingsPage(props) {
  useLang();
  return h(
    Guard,
    { rec: HOST_REC, fallback: h("p", { className: "t3x-error" }, L("扩展设置出错，详见开发者工具控制台", "Extension settings encountered an error. See the developer console for details.")) },
    h(ExtensionsPage, props),
  );
}

const TABS = [
  { id: "installed", label: () => L("已安装", "Installed") },
  { id: "browse", label: () => L("浏览", "Browse") },
];

// 切换顶部作用域时 T3 可能重挂页面组件，记住上次选中的标签页避免跳走。
let lastActiveTab = "installed";

function ExtensionsPage({ ui, scope }) {
  useHostVersion();
  useLang();
  // setEnabledIn 在扩展运行状态未变时不触发 bump()，订阅这两个存储键确保作用域开关和重置即时刷新。
  useStored("t3x:enabled", {});
  useStored("t3x:scoped", {});
  const scopeKeys = t3xScopeKeys(scope);
  const registryUrls = useStored("t3x:registries", []);
  React.useEffect(refreshServerStatus, []); // 后台扩展的加载结果

  const [activeTab, setActiveTabState] = React.useState(lastActiveTab);
  const setActiveTab = React.useCallback((tab) => {
    lastActiveTab = tab;
    setActiveTabState(tab);
  }, []);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [browseSubmit, setBrowseSubmit] = React.useState({ seq: 0, query: "" });
  const [browseRefreshSeq, setBrowseRefreshSeq] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const [settingsId, setSettingsId] = React.useState(null);

  const [markets, setMarkets] = React.useState({});
  const [urlInput, setUrlInput] = React.useState("");
  const [busyKey, setBusyKey] = React.useState(null);
  const setMessage = (message) => notify(ui, message);

  const folderRef = React.useRef(null);
  const zipRef = React.useRef(null);
  const tabRefs = React.useRef({});
  const busy = busyKey !== null;

  const openRequested = React.useCallback(() => {
    const reqId = takeSettingsRequest();
    if (!reqId) return;
    setActiveTab("installed"); // 返回时落在“已安装”
    setSettingsId(reqId);
  }, [setActiveTab]);

  React.useEffect(() => {
    openRequested();
    return subscribeSettingsRequest(openRequested);
  }, [openRequested]);

  const loadRegistry = (u) => {
    setMarkets((all) => ({ ...all, [u]: { loading: true } }));
    fetchRegistry(u)
      .then((m) => setMarkets((all) => ({ ...all, [u]: m })))
      .catch((error) => setMarkets((all) => ({ ...all, [u]: { url: u, error: String(error?.message ?? error) } })));
  };

  React.useEffect(() => {
    if (activeTab !== "browse") return;
    for (const u of registryUrls) {
      if (markets[u]) continue;
      loadRegistry(u);
    }
  }, [activeTab, registryUrls]);

  // 打开的设置视图对应扩展被停用或卸载时自动回到列表；冷启动尚未就绪时等待加载完成。
  const settingsRec = settingsId ? records.get(settingsId) : null;
  const settingsActive = settingsRec && settingsRec.status === "on" && !!settingsRec.settings;
  React.useEffect(() => {
    if (ready && settingsId && !settingsActive) setSettingsId(null);
  }, [ready, settingsId, settingsActive]);

  const run = async (key, task) => {
    setBusyKey(key);
    try {
      const res = await task();
      if (res && typeof res === "object") setMessage(res);
      else if (res) setMessage({ kind: "ok", text: String(res) });
    } catch (error) {
      setMessage({ kind: "error", text: String(error?.message ?? error) });
    } finally {
      setBusyKey(null);
    }
  };

  const installEntry = (entry) =>
    run(`reg:${entry.manifestUrl}`, async () => {
      const item = await fetchExtension(entry.manifestUrl, entry.sha256);
      if (item.manifest.id !== entry.id) {
        throw new Error(L(`注册表写的是 ${entry.id}，下载到的是 ${item.manifest.id}`, `The registry lists ${entry.id}, but the download contains ${item.manifest.id}`));
      }
      if (entry.version && item.manifest.version !== entry.version) {
        throw new Error(L(`注册表写的版本是 ${entry.version}，下载到的是 ${item.manifest.version}`, `The registry lists version ${entry.version}, but the download contains ${item.manifest.version}`));
      }
      if (!(await consent(item))) return { kind: "info", text: L("已取消安装", "Installation canceled") };
      await install(item);
      setActiveTab("installed");
      return { kind: "ok", text: L(`已安装“${localized(item.manifest, "name")}”`, `Installed “${localized(item.manifest, "name")}”`) };
    });

  // 本地文件夹、zip、GitHub 仓库都走同一个“确认 → 安装”流程。
  const installItem = (key, load) =>
    run(key, async () => {
      const item = await load();
      if (!item) return null;
      if (!(await consent(item))) return { kind: "info", text: L("已取消安装", "Installation canceled") };
      await install(item);
      setActiveTab("installed");
      return { kind: "ok", text: L(`已安装“${localized(item.manifest, "name")}”`, `Installed “${localized(item.manifest, "name")}”`) };
    });

  const installGithub = (target, key = `gh:${target.owner}/${target.repo}`) => installItem(key, () => fetchGithubExtension(target));

  const handleAddLocal = () => {
    if (busy || !ready) return;
    if (canPickFolder()) {
      return installItem("local", () => pickLocalFolder());
    }
    folderRef.current?.click();
  };

  const addUrl = (ev) => {
    ev?.preventDefault?.();
    if (busy || !ready || !urlInput.trim()) return;
    const github = t3xParseGithub(urlInput);
    if (github) {
      setUrlInput("");
      return installGithub(github, "url");
    }
    return run("url", async () => {
      const target = httpUrl(urlInput).href;
      const probe = JSON.parse(new TextDecoder().decode(await fetchBytes(target, LIMITS.index)));
      if (Array.isArray(probe?.extensions)) {
        const market = await fetchRegistry(target);
        setMarkets((all) => ({ ...all, [market.url]: market }));
        const latest = store.get("t3x:registries", []);
        if (!latest.includes(market.url)) await store.set("t3x:registries", [...latest, market.url]);
        setUrlInput("");
        return {
          kind: "ok",
          text: L(
            `已添加扩展市场“${market.name}”，共 ${market.extensions.length} 个扩展`,
            `Added marketplace “${market.name}” (${market.extensions.length} ${market.extensions.length === 1 ? "extension" : "extensions"})`,
          ),
        };
      }
      const item = await fetchExtension(target, null);
      if (!(await consent(item))) return { kind: "info", text: L("已取消安装", "Installation canceled") };
      await install(item);
      setUrlInput("");
      setActiveTab("installed");
      return { kind: "ok", text: L(`已安装“${localized(item.manifest, "name")}”`, `Installed “${localized(item.manifest, "name")}”`) };
    });
  };

  const removeMarket = (u) =>
    store.set(
      "t3x:registries",
      registryUrls.filter((x) => x !== u),
    );

  const handleRefreshAll = async () => {
    if (refreshing || !ready) return;
    setRefreshing(true);
    const hostCheck = checkHostUpdate(); // 宿主自己的新版显示在顶部提示条里（self-update.js）
    if (typeof searchCache !== "undefined") searchCache.clear();
    setBrowseRefreshSeq((n) => n + 1);
    if (activeTab === "browse") {
      for (const u of registryUrls) loadRegistry(u);
    }
    try {
      await refreshAllUpdates();
      const checked = [...records.values()].filter((r) => canCheckUpdate(r));
      const results = checked.map((r) => updates.get(r.manifest.id)).filter(Boolean);
      const avail = results.filter((u) => u.state === "available").length;
      const errs = results.filter((u) => u.state === "error");
      if (avail > 0) {
        const found = L(`发现 ${avail} 个可用更新`, `${avail} ${avail === 1 ? "update" : "updates"} available`);
        setMessage(
          errs.length > 0
            ? { kind: "warning", text: L(`${found}；另有 ${errs.length} 个检查失败：${errs[0].error}`, `${found}; ${errs.length} failed to check: ${errs[0].error}`) }
            : { kind: "ok", text: found },
        );
      } else if (errs.length > 0) {
        const firstErr = errs[0].error;
        setMessage({
          kind: "error",
          text:
            errs.length === results.length
              ? L(`检查更新失败：${firstErr}`, `Couldn’t check for updates: ${firstErr}`)
              : L(`部分扩展检查更新失败：${firstErr}`, `Couldn’t check some extensions for updates: ${firstErr}`),
        });
      } else if (checked.length > 0) {
        setMessage({ kind: "ok", text: L("所有扩展均已是最新版本", "All extensions are up to date") });
      }
      const host = await hostCheck;
      if (host.state === "error") setMessage({ kind: "error", text: L(`检查 T3 Code Extensions 的新版失败：${host.error}`, `Couldn’t check for a new T3 Code Extensions: ${host.error}`) });
    } finally {
      setRefreshing(false);
    }
  };

  const handleTabKeyDown = (ev, idx) => {
    let next = idx;
    if (ev.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (ev.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = TABS.length - 1;
    else return;
    ev.preventDefault();
    const tabId = TABS[next].id;
    setActiveTab(tabId);
    tabRefs.current[tabId]?.focus();
  };

  const allRecords = [...records.values()];
  const installedList = allRecords;
  const q = searchQuery.trim().toLowerCase();
  const filteredInstalled = installedList.filter((rec) => matchesSearch(rec, q));

  const tabCounts = {
    installed: ready ? installedList.length : null,
    browse: null,
  };

  const searchPlaceholder =
    activeTab === "browse"
      ? L("搜索社区扩展或已添加的市场…", "Search community extensions or marketplaces…")
      : L("搜索已安装扩展…", "Search installed extensions…");

  const renderCardGrid = (items) =>
    h(
      "div",
      { className: "t3x-grid" },
      items.map((rec) =>
        h(
          Guard,
          { key: rec.manifest.id, rec: HOST_REC, fallback: h(CardFallback, { ui, rec, onMessage: setMessage }) },
          h(ExtensionCard, {
            ui,
            rec,
            scopeKeys,
            onOpenSettings: (id) => setSettingsId(id),
            onMessage: setMessage,
          }),
        ),
      ),
    );

  const loadingBlock = h(
    "div",
    { className: "t3x-loading-wrap", "aria-busy": true, "aria-live": "polite" },
    h("p", { className: "t3x-hint" }, L("正在载入扩展…", "Loading extensions…")),
    h(MarketSkeleton, { ui, count: 4 }),
  );
  const storageAlert = persistent
    ? null
    : h(ui.Alert, { variant: "error" }, h(ui.AlertDescription, null, L("扩展数据没能读出：这次的修改只在内存里，重启后会丢失。", "Couldn’t load extension data. Changes made now will be lost when you restart.")));

  if (settingsActive) {
    return h(
      "div",
      { className: "t3x-page" },
      storageAlert,
      h(ExtensionSettingsView, { ui, rec: settingsRec, onBack: () => setSettingsId(null) }),
    );
  }

  return h(
    "div",
    { className: "t3x-page" },
    // 隐藏文件选择器始终挂载在 DOM 里，确保随时可用（含本地文件夹降级与 ZIP 上传）。
    h("input", {
      ref: folderRef,
      type: "file",
      hidden: true,
      webkitdirectory: "",
      onChange: (ev) => {
        const files = [...(ev.target.files ?? [])];
        ev.target.value = "";
        if (files.length) installItem("folder", () => readFolder(files));
      },
    }),
    h("input", {
      ref: zipRef,
      type: "file",
      hidden: true,
      accept: ".zip,application/zip",
      onChange: (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = "";
        if (file) installItem("zip", () => readZip(file));
      },
    }),

    // 标题行：左标题和宿主版本，右“添加本地扩展”与“刷新”
    h(
      "header",
      { className: "t3x-header" },
      h("div", { className: "t3x-title-group" }, h("h1", { className: "t3x-title" }, L("扩展", "Extensions")), h(HostVersion, { ui })),
      h(
        "div",
        { className: "t3x-header-actions" },
        h(
          ui.Button,
          {
            size: "xs",
            variant: "outline",
            disabled: !ready || busy,
            onClick: handleAddLocal,
          },
          t3xIcon("folder", 13),
          busyKey === "local" || busyKey === "folder" ? L("导入中…", "Adding…") : L("添加本地扩展", "Add local extension"),
        ),
        h(
          ui.Button,
          {
            size: "xs",
            variant: "outline",
            disabled: !ready || refreshing,
            onClick: handleRefreshAll,
          },
          t3xIcon("refresh", 13, refreshing ? "t3x-spin" : ""),
          refreshing ? L("刷新中…", "Refreshing…") : L("刷新", "Refresh"),
        ),
      ),
    ),

    h(HostUpdateBanner, { ui }),
    storageAlert,

    // 全宽搜索框
    h(
      "form",
      {
        className: "t3x-search-form",
        role: "search",
        onSubmit: (ev) => {
          ev.preventDefault();
          if (activeTab === "browse") {
            setBrowseSubmit((s) => ({ seq: s.seq + 1, query: searchQuery }));
          }
        },
      },
      h(
        ui.InputGroup,
        null,
        h(ui.InputGroupAddon, null, t3xIcon("search", 14)),
        h(ui.InputGroupInput, {
          type: "search",
          "aria-label": L("搜索扩展", "Search extensions"),
          placeholder: searchPlaceholder,
          value: searchQuery,
          onChange: (ev) => setSearchQuery(ev.target.value),
        }),
        searchQuery
          ? h(
              ui.InputGroupAddon,
              { align: "inline-end" },
              h(ui.Button, { type: "button", size: "icon-xs", variant: "ghost", "aria-label": L("清除搜索词", "Clear search"), onClick: () => setSearchQuery("") }, t3xIcon("x", 12)),
            )
          : null,
      ),
    ),

    // 分段标签：Installed / Browse
    h(
      "div",
      { className: "t3x-tabs", role: "tablist", "aria-label": L("扩展分类", "Extension tabs") },
      TABS.map((tab, idx) => {
        const selected = activeTab === tab.id;
        const count = tabCounts[tab.id];
        return h(
          "button",
          {
            key: tab.id,
            ref: (el) => {
              tabRefs.current[tab.id] = el;
            },
            id: `t3x-tab-${tab.id}`,
            type: "button",
            role: "tab",
            className: selected ? "t3x-tab t3x-tab-active" : "t3x-tab",
            "aria-selected": selected,
            "aria-controls": `t3x-panel-${tab.id}`,
            tabIndex: selected ? 0 : -1,
            onClick: () => setActiveTab(tab.id),
            onKeyDown: (ev) => handleTabKeyDown(ev, idx),
          },
          h("span", null, tab.label()),
          count !== null ? h(ui.Badge, { variant: "secondary", size: "sm" }, String(count)) : null,
        );
      }),
    ),

    // 标签页内容区
    h(
      "div",
      {
        id: `t3x-panel-${activeTab}`,
        className: "t3x-panel",
        role: "tabpanel",
        "aria-labelledby": `t3x-tab-${activeTab}`,
      },
      !ready
        ? loadingBlock
        : activeTab === "installed"
          ? h(InstalledPanel, {
              ui,
              installedList,
              filteredInstalled,
              searchQuery,
              busy,
              renderCardGrid,
              onBrowse: () => setActiveTab("browse"),
              onUploadZip: () => zipRef.current?.click(),
              onClearSearch: () => setSearchQuery(""),
            })
          : h(BrowsePanel, {
              ui,
              searchQuery,
              q,
              browseSubmit,
              browseRefreshSeq,
              busy,
              busyKey,
              urlInput,
              setUrlInput,
              addUrl,
              onUploadZip: () => zipRef.current?.click(),
              installGithub,
              onClearSearch: () => setSearchQuery(""),
              registryUrls,
              markets,
              loadRegistry,
              removeMarket,
              installEntry,
            }),
    ),
  );
}
