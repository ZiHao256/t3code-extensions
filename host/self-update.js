// 宿主自己的更新：查本项目 GitHub 上的最新 Release，比这一版新就在 设置 → 扩展 顶部提示。
// 点“更新”后主进程下载新版（需要时连同它针对的官方 T3 安装包），退出 app，更新器重装后重新打开（update-main.cjs、install.cjs update）。
// 只有 T3 Code Extensions 桌面版有这个入口（serverBridge.update）；浏览器里打开的 T3 没有。

// id 和 update-main.cjs 的 REPO_ID 一致：按仓库 ID 查，仓库或账号改名、旧名字被别人占用时也认得出
const HOST_REPO_ID = 1471226568;
const HOST_VERSION = bind.version;
const selfUpdate = serverBridge?.update ?? null;

// idle | checking | latest | error { error } | available { tag, sha, version, t3Version, error?, progress? }（progress 有值表示正在更新）
let hostUpdate = { state: "idle" };
const setHostUpdate = (next) => {
  hostUpdate = next;
  bump();
  return next;
};

/** 查最新 Release，固定到 tag 指向的提交；那个提交的 package.json 要写着版本和它针对的 T3 版本（t3Version），否则不算能自动更新。 */
async function checkHostUpdate() {
  if (!selfUpdate || hostUpdate.state === "checking" || hostUpdate.progress) return hostUpdate;
  setHostUpdate({ state: "checking" });
  try {
    const release = await githubJson(`/repositories/${HOST_REPO_ID}/releases/latest`);
    const tag = typeof release?.tag_name === "string" ? release.tag_name : "";
    const version = tag.replace(/^v/, "");
    if (!t3xNewerVersion(version, HOST_VERSION)) return setHostUpdate({ state: "latest" });
    // 主进程按这个提交下载：确认时看到的和装上的是同一份
    const sha = (await githubFetch(`/repositories/${HOST_REPO_ID}/commits/${encodeURIComponent(tag)}`, "application/vnd.github.sha")).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(L("GitHub 没有返回有效的提交", "GitHub didn’t return a valid commit"));
    const pkg = JSON.parse(await githubFetch(`/repositories/${HOST_REPO_ID}/contents/package.json?ref=${sha}`, "application/vnd.github.raw"));
    if (pkg?.version !== version || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(pkg?.t3Version ?? "")) {
      throw new Error(L(`${tag} 不是能自动更新的版本`, `${tag} can’t be installed automatically`));
    }
    return setHostUpdate({ state: "available", tag, sha, version, t3Version: pkg.t3Version });
  } catch (error) {
    return setHostUpdate({ state: "error", error: String(error?.message ?? error) });
  }
}

/** 确认后开始更新，轮询主进程的下载进度；主进程开始重装（app 马上退出）或出错时停。 */
async function startHostUpdate() {
  const u = hostUpdate;
  if (!selfUpdate || u.state !== "available" || u.progress) return;
  // 要不要下官方包看的是「应用程序」里官方版的实际版本（主进程查），这里只能照实说条件
  const official = L(`；「应用程序」里的官方版不是 ${u.t3Version} 时，还会下载官方 T3 Code ${u.t3Version}（约 230 MB）并替换它`, `. If the official app in Applications isn’t ${u.t3Version}, T3 Code ${u.t3Version} (about 230 MB) is downloaded too and replaces it`);
  const ok = await showConfirm(
    L(
      `更新到 T3 Code Extensions ${u.version}？\n会下载新版${official}。下载完 app 会退出、重装并自动重新打开，进行中的回复会中断。`,
      `Update to T3 Code Extensions ${u.version}?\nThe new version is downloaded${official}. The app then quits, reinstalls and reopens; replies in progress are interrupted.`,
    ),
  );
  if (!ok || hostUpdate !== u) return;
  setHostUpdate({ ...u, error: null, progress: { phase: "downloading", step: "source", got: 0, total: 0 } });
  try {
    await selfUpdate.start({ tag: u.tag, sha: u.sha });
    for (;;) {
      const p = await selfUpdate.status();
      if (p?.phase === "error") throw new Error(p.error);
      setHostUpdate({ ...u, error: null, progress: p });
      if (p?.phase === "restarting") return;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (error) {
    const text = String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (?:Error: )?(?:t3x: )?/, "");
    setHostUpdate({ ...u, error: text, progress: null });
    showToast({ type: "error", title: L(`更新失败：${text}`, `Update failed: ${text}`) });
  }
}

const mb = (n) => Math.round(n / (1 << 20));
function hostUpdateText(u) {
  const p = u.progress;
  if (!p) return L(`T3 Code Extensions ${u.version} 可以更新了（现在是 ${HOST_VERSION}，新版针对 T3 Code ${u.t3Version}）`, `T3 Code Extensions ${u.version} is available (you have ${HOST_VERSION}; it targets T3 Code ${u.t3Version})`);
  if (p.phase === "restarting") return L("下载完了，app 马上退出、重装并重新打开…", "Downloaded. The app will quit, reinstall and reopen…");
  const what = p.step === "official" ? L(`官方 T3 Code ${p.version}`, `T3 Code ${p.version}`) : `T3 Code Extensions ${u.version}`;
  const amount = p.total ? `${Math.floor((p.got / p.total) * 100)}% · ${mb(p.got)} / ${mb(p.total)} MB` : `${mb(p.got)} MB`;
  return L(`正在下载 ${what}… ${amount}`, `Downloading ${what}… ${amount}`);
}

/** 设置 → 扩展 顶部的提示条：有新版时出现，更新过程中显示进度。 */
function HostUpdateBanner({ ui }) {
  useHostVersion();
  const u = hostUpdate;
  if (u.state !== "available") return null;
  return h(
    ui.Alert,
    { variant: u.error ? "warning" : "info" },
    h(ui.AlertDescription, null, hostUpdateText(u), u.error ? h("div", null, L(`上次没有更新成功：${u.error}`, `The last attempt failed: ${u.error}`)) : null),
    u.progress ? null : h(ui.AlertAction, null, h(ui.Button, { size: "xs", onClick: startHostUpdate }, u.error ? L("重试", "Retry") : L("更新", "Update"))),
  );
}

/** 标题旁：宿主版本和“检查更新”。有新版时的更新按钮在下面的提示条里。 */
function HostVersion({ ui }) {
  useHostVersion();
  const u = hostUpdate;
  const status = {
    checking: L("检查中…", "Checking…"),
    latest: L("已是最新版", "Up to date"),
    available: L(`有新版 ${u.version}`, `${u.version} is available`),
    error: L("检查失败", "Check failed"),
  }[u.state];
  return h(
    "div",
    { className: "t3x-host-version" },
    h("span", { title: u.state === "error" ? u.error : undefined }, `T3 Code Extensions ${HOST_VERSION}`, status ? ` · ${status}` : null),
    selfUpdate && u.state !== "checking" && !u.progress
      ? h(ui.Button, { size: "xs", variant: "ghost", onClick: () => checkHostUpdate() }, t3xIcon("refresh", 12), L("检查更新", "Check for updates"))
      : null,
  );
}

/** 启动时：报告上次更新的结果，过一会儿查一次新版（有就提示一次）。 */
async function bootHostUpdate() {
  if (!selfUpdate) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const r = await selfUpdate.result();
    if (r) {
      await wait(3000); // T3 的 toast 容器挂载前加的提示会丢
      if (r.ok) {
        showToast({ type: r.warning ? "warning" : "success", title: L(`已更新到 T3 Code Extensions ${r.version}`, `Updated to T3 Code Extensions ${r.version}`), description: r.warning });
      } else {
        showToast({ type: "error", title: L("T3 Code Extensions 没有更新成功，还是原来的版本", "T3 Code Extensions wasn’t updated; you still have the previous version"), description: r.error });
      }
    }
  } catch (error) {
    console.error(TAG, "读取上次更新的结果失败", error);
  }
  await wait(10_000);
  const u = await checkHostUpdate();
  if (u.state === "available") {
    showToast({ type: "info", title: L(`T3 Code Extensions ${u.version} 可以更新了`, `T3 Code Extensions ${u.version} is available`), description: L("到 设置 → 扩展 更新", "Update it in Settings → Extensions") });
  }
}
