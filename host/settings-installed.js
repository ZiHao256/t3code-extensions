// 设置 → 扩展：“已安装”标签页的卡片、扩展自己的设置视图，以及安装确认、移除（settings.js 的页面也用）。

const sourceLabelFor = (kind) =>
  ({ registry: L("市场", "Marketplace"), url: L("链接", "Link"), local: L("本地", "Local"), zip: "ZIP", github: "GitHub" })[kind] ?? "";

// T3 的确认框按换行拆标题和说明：插进去的名字、版本、来源压成一行。
const oneLine = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const changedWhileConfirming = () => new Error(L("确认期间这个扩展有变化，请重试", "The extension changed while you were confirming. Try again."));

/** 安装确认。确认框是异步的：确认期间同 id 的扩展被换掉的话，作废这次确认。 */
async function consent(item) {
  const { manifest } = item;
  const before = records.get(manifest.id);
  const name = oneLine(localized(manifest, "name"));
  const version = oneLine(manifest.version);
  const old = replacing(item);
  const oldName = old && oneLine(old.name) !== name ? `“${oneLine(old.name)}” ` : "";
  const replace = !old
    ? ""
    : old.sameSource
      ? L(`\n从 ${oneLine(old.version)} 升级到 ${version}。`, `\nUpgrades ${oneLine(old.version)} to ${version}.`)
      : L(`\n替换已安装的 ${oldName}${oneLine(old.version)}（${oneLine(old.from)}），沿用设置。`, `\nReplaces the installed ${oldName}${oneLine(old.version)} (${oneLine(old.from)}) and keeps its settings.`);
  // 能做什么列成一行一项，不写成大段提醒
  const can = [
    L("读会话内容，改 T3 的页面", "Read your threads and change T3’s pages"),
    hasAgent(item) && L("用你的 agent 开会话、发消息（用你的额度，可以开「完全访问」会话）", "Start threads and send messages with your agents (uses your quota; can start Full access threads)"),
    hasServer(item) && L("在 T3 后台以你的用户权限运行程序", "Run programs in the T3 backend with your user permissions"),
    hasT3(item) && L("读 T3 的内部数据", "Read T3’s internal data"),
    hasTray(item) && L("在菜单栏放图标", "Add a menu bar icon"),
    hasSystem(item) && L("发通知、写剪贴板、打开链接", "Show notifications, write to the clipboard and open links"),
  ].filter(Boolean);
  const ok = await showConfirm(
    L(`安装“${name}” ${version}？`, `Install “${name}” ${version}?`) +
      L(`\n来源：${oneLine(sourceText(item.source))}`, `\nSource: ${oneLine(sourceText(item.source))}`) +
      replace +
      L("\n它可以：", "\nIt can:") +
      can.map((line) => `\n· ${line}`).join(""),
  );
  if (ok && records.get(manifest.id) !== before) throw changedWhileConfirming();
  return ok;
}

async function remove(manifest) {
  const before = records.get(manifest.id);
  const name = oneLine(localized(manifest, "name"));
  const ok = await showConfirm(L(`移除“${name}”？\n它的设置和数据会一起删除。`, `Remove “${name}”?\nIts settings and data will be deleted too.`), { variant: "destructive" });
  if (!ok) return false;
  if (records.get(manifest.id) !== before) throw changedWhileConfirming();
  await uninstall(manifest.id);
  return true;
}

const isGithubUrl = (url) => typeof url === "string" && /^https:\/\/github\.com\//i.test(url);

function detailsUrlFor(rec) {
  if (typeof rec.manifest?.repository === "string" && rec.manifest.repository) return rec.manifest.repository;
  if (typeof rec.source?.url === "string" && /^https?:\/\//i.test(rec.source.url)) return rec.source.url;
  return null;
}

/** 卡片渲染失败时的降级展示，保留移除入口。 */
function CardFallback({ ui, rec, onMessage }) {
  return h(
    "article",
    { className: "t3x-card t3x-card-fallback" },
    h("p", { className: "t3x-error" }, L(`${rec.manifest.id}：这张卡片显示不了`, `Couldn’t display the card for ${rec.manifest.id}`)),
    h(ui.Button, { size: "xs", variant: "outline", onClick: () => remove(rec.manifest).catch((error) => onMessage?.({ kind: "error", text: L(`移除失败：${error?.message ?? error}`, `Couldn’t remove the extension: ${error?.message ?? error}`) })) }, L("移除", "Remove")),
  );
}

/** 已安装页的扩展卡片。 */
function ExtensionCard({ ui, rec, scopeKeys, onOpenSettings, onMessage }) {
  const { manifest } = rec;
  const id = manifest.id;
  const name = localized(manifest, "name");
  const summary = localized(manifest, "description");
  const isGlobal = scopeKeys === null;
  const scopeUnavailable = Array.isArray(scopeKeys) && scopeKeys.length === 0;
  const state = scopeState(rec, scopeKeys);
  const updateInfo = updates.get(id);
  const detailsUrl = detailsUrlFor(rec);
  const reloadable = canReload(rec);
  const checkable = canCheckUpdate(rec);
  const [reloading, setReloading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const sourceTextLabel = sourceLabelFor(rec.source?.kind);
  const statusText =
    rec.status === "error"
      ? L("出错", "Error")
      : state.on
        ? L("已启用", "Enabled")
        : L("已停用", "Disabled");

  const handleReload = () => {
    if (reloading) return;
    setReloading(true);
    // 必须在点击事件里直接调用 reloadLocal：可能需要向浏览器重新申请读取权限。
    reloadLocal(rec, consent).then(
      (done) => {
        setReloading(false);
        onMessage?.(done ? { kind: "ok", text: L(`已重新加载“${name}”`, `Reloaded “${name}”`) } : { kind: "info", text: L("已取消重新加载", "Reload canceled") });
      },
      (error) => {
        setReloading(false);
        onMessage?.({ kind: "error", text: L(`重新加载“${name}”失败：${error?.message ?? error}`, `Couldn’t reload “${name}”: ${error?.message ?? error}`) });
      },
    );
  };

  const handleCheckUpdate = async () => {
    if (updateInfo?.state === "checking") return;
    const u = await refreshUpdate(rec);
    if (u?.state === "latest") onMessage?.({ kind: "ok", text: L(`“${name}”已是最新版本`, `“${name}” is up to date`) });
    else if (u?.state === "available") onMessage?.({ kind: "info", text: L(`“${name}”有新版本 v${u.item.manifest.version}`, `“${name}” has a new version v${u.item.manifest.version}`) });
    else if (u?.state === "error") onMessage?.({ kind: "error", text: L(`检查“${name}”更新失败：${u.error}`, `Couldn’t check “${name}” for updates: ${u.error}`) });
  };

  const handleApplyUpdate = async () => {
    if (applying || updateInfo?.state !== "available") return;
    setApplying(true);
    try {
      const confirmed = updateInfo; // 装的必须是确认框里展示的那份
      const next = confirmed.item;
      if (!(await consent(next))) {
        onMessage?.({ kind: "info", text: L("已取消更新", "Update canceled") });
        return;
      }
      await applyUpdate(id, confirmed);
      onMessage?.({ kind: "ok", text: L(`已更新“${name}”至 v${next.manifest.version}`, `Updated “${name}” to v${next.manifest.version}`) });
    } catch (error) {
      onMessage?.({ kind: "error", text: L(`更新失败：${error?.message ?? error}`, `Update failed: ${error?.message ?? error}`) });
    } finally {
      setApplying(false);
    }
  };

  const handleRemove = async () => {
    try {
      if (await remove(manifest)) onMessage?.({ kind: "ok", text: L(`已移除“${name}”`, `Removed “${name}”`) });
    } catch (error) {
      onMessage?.({ kind: "error", text: L(`移除失败：${error?.message ?? error}`, `Couldn’t remove the extension: ${error?.message ?? error}`) });
    }
  };

  const handleSwitch = (checked) => {
    if (scopeUnavailable) return;
    setEnabledIn(id, scopeKeys, !!checked).catch((error) => {
      onMessage?.({ kind: "error", text: String(error?.message ?? error) });
    });
  };

  const handleResetScope = () => {
    if (isGlobal || scopeUnavailable) return;
    setEnabledIn(id, scopeKeys, null).catch((error) => {
      onMessage?.({ kind: "error", text: String(error?.message ?? error) });
    });
  };

  const isChecking = updateInfo?.state === "checking";
  const canConfigure = state.on && rec.status === "on" && !!rec.settings;
  const showRefreshBtn = reloadable || checkable;
  const cardError = rec.error ?? serverErrorOf(rec);

  return h(
    "article",
    { className: "t3x-card", "data-extension-id": id, "data-enabled": state.on ? "true" : "false" },
    h(
      "div",
      { className: "t3x-card-head" },
      h("div", { className: "t3x-card-icon", "aria-hidden": true }, t3xIcon("plugin", 17)),
      h(
        "div",
        { className: "t3x-card-id" },
        h(
          "div",
          { className: "t3x-card-title-row" },
          h("h3", { className: "t3x-card-name", title: name }, name),
          h("span", { className: "t3x-ver" }, `v${manifest.version}`),
          hasServer(rec)
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("带后台代码，在 T3 后台以你的用户权限运行", "Has background code that runs in the T3 backend with your user permissions") }, L("后台", "Background"))
            : null,
          hasAgent(rec)
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("可以用你的 agent 开会话、发消息", "Can start threads and send messages with your agents") }, "Agent")
            : null,
          hasTray(rec)
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("在 macOS 菜单栏放一个图标和菜单", "Adds an icon and menu to the macOS menu bar") }, L("菜单栏", "Menu bar"))
            : null,
          hasT3(rec)
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("直接读取 T3 的内部数据", "Reads T3’s internal data directly") }, L("T3 数据", "T3 data"))
            : null,
          hasSystem(rec)
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("可以发系统通知、写剪贴板、打开链接", "Can show notifications, write to the clipboard and open links") }, L("系统", "System"))
            : null,
        ),
        h(
          "div",
          { className: "t3x-card-sub" },
          h("span", { className: "t3x-card-sub-text" }, sourceTextLabel ? `${sourceTextLabel} · ${statusText}` : statusText),
          !isGlobal && state.mixed
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("这个项目在不同环境里开关不一致；切换会统一设置", "Enabled in some environments of this project but not others; toggling sets them all") }, L("部分启用", "Partially enabled"))
            : !isGlobal && state.inherited
            ? h(ui.Badge, { variant: "secondary", size: "sm", title: L("当前作用域未单独设置，沿用上一级开关", "No override in this scope; inheriting from parent scope") }, L("沿用上一级", "Inherited"))
            : null,
        ),
      ),
    ),
    h(
      "p",
      {
        className: summary ? "t3x-card-desc" : "t3x-card-desc t3x-card-desc-empty",
        title: summary || undefined,
      },
      summary || L("暂无简介", "No description"),
    ),
    // 启用失败、后台代码出错是持续的状态，留在卡片上；其余结果走 toast。
    cardError ? h(ui.Alert, { variant: "error", className: "t3x-card-alert", title: cardError }, h(ui.AlertDescription, null, cardError)) : null,
    h(
      "div",
      { className: "t3x-card-foot" },
      h(
        "div",
        { className: "t3x-card-foot-left" },
        detailsUrl
          ? h(
              "a",
              {
                className: "t3x-details-link",
                href: detailsUrl,
                target: "_blank",
                rel: "noreferrer",
                title: detailsUrl,
              },
              t3xIcon(isGithubUrl(detailsUrl) ? "github" : "external", 13),
              h("span", null, L("详情", "Details")),
            )
          : rec.source?.folder || rec.source?.file
            ? h("span", { className: "t3x-foot-meta", title: rec.source.folder || rec.source.file }, rec.source.folder || rec.source.file)
            : null,
        canConfigure
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                className: "t3x-foot-btn",
                onClick: () => onOpenSettings(id),
              },
              t3xIcon("settings", 12),
              L("设置", "Settings"),
            )
          : null,
        h(
          ui.Button,
          {
            size: "xs",
            variant: "ghost",
            className: "t3x-foot-btn t3x-btn-danger",
            "aria-label": L(`移除 ${name}`, `Remove ${name}`),
            onClick: handleRemove,
          },
          L("移除", "Remove"),
        ),
      ),
      h(
        "div",
        { className: "t3x-card-foot-right" },
        updateInfo?.state === "available"
          ? h(
              ui.Button,
              { size: "xs", variant: "default", disabled: applying, onClick: handleApplyUpdate },
              applying ? L("更新中…", "Updating…") : L(`更新至 v${updateInfo.item.manifest.version}`, `Update to v${updateInfo.item.manifest.version}`),
            )
          : null,
        !isGlobal && !scopeUnavailable && !state.inherited
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                className: "t3x-foot-btn",
                "aria-label": L(`重置 ${name} 的作用域设置`, `Reset scope override for ${name}`),
                onClick: handleResetScope,
              },
              L("重置", "Reset"),
            )
          : null,
        showRefreshBtn
          ? h(
              ui.Button,
              {
                size: "xs",
                variant: "ghost",
                className: "t3x-icon-btn",
                disabled: reloadable ? reloading : isChecking,
                "aria-label": reloadable
                  ? L(`重新加载 ${name}`, `Reload ${name}`)
                  : isChecking
                    ? L(`正在检查 ${name} 更新`, `Checking ${name} for updates`)
                    : L(`检查 ${name} 更新`, `Check for updates to ${name}`),
                title: reloadable ? L("重新加载本地扩展", "Reload local extension") : isChecking ? L("正在检查更新…", "Checking for updates…") : L("检查更新", "Check for updates"),
                onClick: reloadable ? handleReload : handleCheckUpdate,
              },
              t3xIcon("refresh", 13, reloading || isChecking ? "t3x-spin" : ""),
            )
          : null,
        h(
          "span",
          { className: "t3x-switch-wrap" },
          h(ui.Switch, {
            checked: state.on,
            disabled: scopeUnavailable,
            onCheckedChange: handleSwitch,
            "aria-label": L(`启用 ${name}`, `Enable ${name}`),
          }),
        ),
      ),
    ),
  );
}

/** 扩展设置内联视图：在扩展页内直接进入详情与设置，不再在设置浮层上叠加弹窗。 */
function ExtensionSettingsView({ ui, rec, onBack }) {
  const { manifest } = rec;
  const name = localized(manifest, "name");
  const summary = localized(manifest, "description");
  const detailsUrl = detailsUrlFor(rec);
  const sourceTextLabel = sourceLabelFor(rec.source?.kind);

  const titleRef = React.useRef(null);
  React.useEffect(() => {
    const scroller = document.querySelector("[data-settings-page-scroll]");
    if (scroller) scroller.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true }); // 点“设置”的按钮已经卸载，焦点交给标题
  }, [manifest.id]);

  return h(
    "div",
    { className: "t3x-detail", "data-extension-settings": manifest.id },
    h(
      "div",
      { className: "t3x-detail-nav" },
      h(
        ui.Button,
        {
          size: "xs",
          variant: "ghost",
          className: "t3x-back-btn",
          onClick: onBack,
        },
        t3xIcon("arrowLeft", 14),
        L("返回扩展", "Back to extensions"),
      ),
    ),
    h(
      "header",
      { className: "t3x-detail-head" },
      h(
        "div",
        { className: "t3x-detail-id" },
        h("div", { className: "t3x-card-icon t3x-detail-icon", "aria-hidden": true }, t3xIcon("plugin", 19)),
        h(
          "div",
          { className: "t3x-detail-meta" },
          h(
            "div",
            { className: "t3x-detail-title-row" },
            h("h1", { ref: titleRef, tabIndex: -1, className: "t3x-detail-title" }, name),
            h("span", { className: "t3x-ver" }, `v${manifest.version}`),
            sourceTextLabel ? h(ui.Badge, { variant: "outline" }, sourceTextLabel) : null,
          ),
          summary ? h("p", { className: "t3x-detail-desc" }, summary) : null,
        ),
      ),
      detailsUrl
        ? h(
            "a",
            {
              className: "t3x-details-link t3x-detail-ext-link",
              href: detailsUrl,
              target: "_blank",
              rel: "noreferrer",
              title: detailsUrl,
            },
            t3xIcon(isGithubUrl(detailsUrl) ? "github" : "external", 14),
            h("span", null, L("详情", "Details")),
          )
        : null,
    ),
    h(
      "div",
      { className: "t3x-detail-body" },
      h(
        Guard,
        { rec, fallback: h("p", { className: "t3x-error" }, L("设置面板出错", "The settings panel encountered an error")) },
        h(rec.settings, { ui }),
      ),
    ),
  );
}

/** “已安装”标签页：卡片网格，没有扩展或搜不到时的空状态。 */
function InstalledPanel({ ui, installedList, filteredInstalled, searchQuery, busy, renderCardGrid, onBrowse, onUploadZip, onClearSearch }) {
  return (
    filteredInstalled.length > 0
      ? renderCardGrid(filteredInstalled)
      : installedList.length === 0
        ? h(
            EmptyState,
            {
              ui,
              title: L("尚未安装扩展", "No installed extensions yet"),
              description: L("可以在“浏览”里发现社区扩展、通过链接或 ZIP 安装，或点击右上角添加本地扩展。", "Discover community extensions in Browse, install via URL or ZIP, or add a local extension above."),
            },
            h(ui.Button, { size: "xs", variant: "outline", onClick: onBrowse }, L("浏览扩展市场", "Browse extensions")),
            h(ui.Button, { size: "xs", variant: "ghost", disabled: busy, onClick: () => onUploadZip() }, t3xIcon("zip", 13), L("上传 ZIP", "Upload ZIP")),
          )
        : h(
            EmptyState,
            { ui, title: L(`没有找到与“${searchQuery.trim()}”匹配的已安装扩展`, `No installed extensions match “${searchQuery.trim()}”`) },
            h(ui.Button, { size: "xs", variant: "outline", onClick: onClearSearch }, L("清空搜索", "Clear search")),
          )
  );
}
