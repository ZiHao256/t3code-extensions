"use strict";
// 后台扩展（apiVersion 4）的四处补丁，针对 T3 Code 0.1.13：
//   preload：给主窗口一个只能领一次的入口 t3xServerBridge，窗口里的宿主先领走（background.js）；apiVersion 5 起也用它读扩展的输出目录，6 起转发 host.server.call，7 起转发 host.tray 和 host.agent.replies，8 起转发 host.system.copy。
//   主进程：收下启用的后台脚本写到 <T3 数据目录>/t3x-server，并用 T3X_SERVER_DIR 告诉后台（server-main.cjs）。
//         另有宿主自己的更新：下载新版、退出 app 交给更新器（update-main.cjs），preload 的 update.* 转发过去。
//         apiVersion 7 起还有菜单栏图标和会话最新回复（tray-main.cjs），preload 的 tray.*、replies 转发过去。
//   T3 后台：加载后台扩展（server.mjs）；Antigravity 的额度交给接手的扩展读（0.1.13 的 T3 自己已经不读了，见下面 serverPatch）。
//   T3 runtimeLayer：给共用的 managed provider 加 t3xEnrichUsage 开关（仅 Antigravity 打开，有额度时才生效），并在 ProviderRegistry 合并模型后重算 Antigravity 窗口的 modelIds（managedPatch）。
const fs = require("node:fs");
const path = require("node:path");
const { replaceOnce, stripMap } = require("./patch.cjs");

const HOST = path.join(__dirname, "..", "host");
const nodeOnly = (text) => text.split("// @node-only")[0];

const PRELOAD_MARKER = "/* T3X_SERVER_BRIDGE_V1 */";
const PRELOAD_CODE = `${PRELOAD_MARKER}
;(() => {
  const { contextBridge, ipcRenderer } = require("electron");
  let claimed = false; // 窗口里的 t3x 宿主模块加载时先领走，之后再领（界面扩展）拿到 null
  // window.open 开的子窗（菜单栏小窗是 about:blank）也会跑 preload：那里的入口没人先领，界面扩展能拿到，所以不给
  if (window.opener !== null || location.protocol === "about:") return;
  contextBridge.exposeInMainWorld("t3xServerBridge", {
    claim() {
      if (claimed) return null;
      claimed = true;
      return {
        sync: (payload) => ipcRenderer.invoke("t3x:server:sync", payload),
        status: () => ipcRenderer.invoke("t3x:server:status"),
        outDir: (id) => ipcRenderer.invoke("t3x:out:dir", id),
        outRead: (id, rel) => ipcRenderer.invoke("t3x:out:read", id, rel),
        call: (id, name, data) => ipcRenderer.invoke("t3x:server:call", id, name, data),
        replies: (threads) => ipcRenderer.invoke("t3x:agent:replies", threads),
        clipboard: { write: (text) => ipcRenderer.invoke("t3x:clipboard:write", text) },
        tray: {
          set: (id, spec) => ipcRenderer.invoke("t3x:tray:set", id, spec),
          clear: (id) => ipcRenderer.invoke("t3x:tray:clear", id),
          onSelect: (fn) => void ipcRenderer.on("t3x:tray:select", (_event, id, item) => fn(id, item)),
          resize: (id, size) => ipcRenderer.invoke("t3x:tray:resize", id, size),
          popover: (id, open, opts) => ipcRenderer.invoke("t3x:tray:popover", id, open, opts),
          onPopover: (fn) => void ipcRenderer.on("t3x:tray:popover", (_event, id, open) => fn(id, open)),
        },
        update: {
          start: (release) => ipcRenderer.invoke("t3x:update:start", release),
          status: () => ipcRenderer.invoke("t3x:update:status"),
          result: () => ipcRenderer.invoke("t3x:update:result"),
        },
      };
    },
  });
})();
`;

const preloadPatch = {
  id: "server-preload",
  label: "Electron preload",
  targetRegex: /^apps\/desktop\/dist-electron\/preload\.cjs$/,
  originalHash: "b16e220e5a5a984d30b200e2a6b540bba974908bc0cee71a3841d40339534dca",
  marker: PRELOAD_MARKER,
  module: "commonjs",
  apply: (text) => `${stripMap(text)}\n${PRELOAD_CODE}`,
};

const mainServerPatch = {
  id: "server-main",
  label: "Electron 主进程",
  targetRegex: /^apps\/desktop\/dist-electron\/main\.cjs$/,
  originalHash: "80eb399935ad079a3f3084ca6da80dd495fbe9b69f473831819361223a50c559",
  marker: "/* T3X_SERVER_MAIN_V1 */",
  module: "commonjs",
  apply: (text) => [stripMap(text), ...["server-main.cjs", "update-main.cjs", "tray-main.cjs"].map((f) => nodeOnly(fs.readFileSync(path.join(HOST, f), "utf8")))].join("\n"),
};

// Antigravity 的额度：0.1.13 的 T3 不再自己读（上游 #43026 删掉了用 token 调 Google 内部接口的读取和 probeUsage / clearUsage），
// 也删了按模型家族认额度的逻辑。这里只在有后台扩展接手时读，没有扩展就什么都不读、不显示（和官方 0.1.13 一样），不存在退回 T3 自己读取的路径。
// 读取照 0.1.12 被删掉的那段：健康检查通过、会话启动时读，不挡这两件事；一次只读一个（又要读时排队，等前一个回来再读）；
// 登出、要重新登录、找不到 CLI 时不读，正在读的结果作废。调用扩展前再核对一次：前面要等 hasSource 和解析 CLI 路径，这期间可能登出了。
// 后台扩展启用、停用、升级时（server.mjs 的 whenSourcesChange）重新读一次。
// 结果存进 provider 的 draft（读取失败时保留上一次成功的，和 T3 对已发布额度的规则一样，见 server.mjs 的 mergeUsage）。
// 发布：T3 的 managed provider 只让健康检查的结果改已发布的额度，enrichment 发布时一律沿用旧的。managedPatch 给它加一个开关
// t3xEnrichUsage（只有 Antigravity 打开），打开后 enrichment 发布 draft 时连额度一起发：登出、模型列表变化、读到新结果
// 和其他字段在同一次发布里，不用等正在跑的健康检查。发布前按当前模型列表（含别名）写好 modelIds（server.mjs 的 routeUsage）。
// 下面用到的 gen / promise / option / map$2 / scope / suspend / void_ / flatMap / andThen / ensuring / ignoreCause / forkIn / none / some /
// get$6 / updateSome（后两个是 SubscriptionRef 的）都是这个模块已经导入的名字（测试会核对），
// installation、settings、processEnvironment、instanceId、profileDirectory、auth 是 Antigravity driver 里的局部变量，metadata 是 provider 里的；
// 改了行为要跑 tests/agy-provider.mjs（verify.cjs 里“Antigravity 额度接回 provider”那一项，用官方 app 里真的 provider 跑）。
const AGY_MARKER = "/* T3X_AGY_USAGE_V1 */";

// driver：t3xStillValid（Effect）/ t3xValidNow（同步）是 provider 给的“这次读取还算数吗”。接手时由扩展读（返回 T3 的 usageLimits，从不 reject），
// 没有扩展接手返回 undefined（清掉额度），读取作废、找不到 CLI 返回 null（什么都不改）。只有 Google 登录的实例交给扩展。
// t3xValidNow 交给宿主，在真正调用扩展的那一刻再核对一次（readUsage 里调用前还隔着一个微任务）。
const AGY_DRIVER_PROBE = `const t3xUsageProbe = (t3xStillValid, t3xValidNow) => gen(function* () {
\t\t\tconst t3x = globalThis.__t3xServer;
\t\t\tif (!t3x || !String(auth.authMethod).startsWith("oauth-") || !(yield* promise(() => t3x.hasSource("antigravity")))) return void 0;
\t\t\tconst t3xInstallation = yield* installation.resolve(settings.binaryPath, processEnvironment).pipe(option);
\t\t\tif (t3xInstallation._tag !== "Some" || !(yield* t3xStillValid)) return null;
\t\t\treturn yield* promise(() => t3x.readUsage("antigravity", {
\t\t\t\tinstanceId,
\t\t\t\tprofileDirectory,
\t\t\t\tauthMethod: auth.authMethod,
\t\t\t\texecutablePath: t3xInstallation.value.executablePath,
\t\t\t\tenvironment: { ...processEnvironment }
\t\t\t}, t3xValidNow));
\t\t});`;

// provider 开头：发布的快照按模型家族给额度窗口写 modelIds；读取的状态。
//   generation：登录、登出、找不到 CLI、来源没了时加一，之前开始的读取结果作废、还没调用扩展的不再调用；
//   reading / queued：每个实例一次只读一个，读的时候又要读就排队。
const AGY_PROVIDER_HEAD = `${AGY_MARKER}
\tconst t3xStampIdentity = options.stampIdentity;
\toptions = { ...options, stampIdentity: (draft) => t3xStampIdentity(draft).pipe(map$2((snapshot) => globalThis.__t3xServer?.routeUsage?.("antigravity", snapshot) ?? snapshot)) };
\tconst t3xUsage = { generation: 0, reading: false, queued: false };
\tconst t3xScope = yield* scope;
`;

// checkProvider 前：读取、存进 draft；后台扩展有变化时重新读。
const AGY_PROVIDER_REFRESH = `\tconst t3xWithUsage = (draft, usageLimits) => {
\t\tconst { usageLimits: _previous, ...rest } = draft;
\t\treturn usageLimits ? { ...rest, usageLimits } : rest;
\t};
\tconst t3xCanRead = (state) => state.draft.auth.status !== "unauthenticated" && state.draft.installed !== false;
\tconst t3xResetUsage = () => {
\t\tt3xUsage.generation += 1;
\t\tt3xUsage.queued = false;
\t};
\tconst t3xDropUsage = updateSome(metadata, (state) => state.draft.usageLimits === void 0 ? none() : some({ ...state, draft: t3xWithUsage(state.draft, void 0) }));
\tconst t3xRefreshUsage = gen(function* () {
\t\tif (!options.t3xProbeUsage || !t3xCanRead(yield* get$6(metadata))) return;
\t\tif (t3xUsage.reading) {
\t\t\tt3xUsage.queued = true;
\t\t\treturn;
\t\t}
\t\tconst generation = t3xUsage.generation;
\t\tconst valid = (state) => generation === t3xUsage.generation && t3xCanRead(state);
\t\tt3xUsage.reading = true;
\t\tyield* options.t3xProbeUsage(get$6(metadata).pipe(map$2(valid)), () => generation === t3xUsage.generation).pipe(flatMap((probed) => updateSome(metadata, (state) => probed === null || !valid(state) || probed && globalThis.__t3xServer?.resultCurrent?.("antigravity", probed) === false || probed === void 0 && state.draft.usageLimits === void 0 ? none() : some({ ...state, draft: t3xWithUsage(state.draft, globalThis.__t3xServer?.mergeUsage?.(state.draft.usageLimits, probed) ?? probed) }))), ensuring(suspend(() => {
\t\t\tt3xUsage.reading = false;
\t\t\tif (!t3xUsage.queued) return void_;
\t\t\tt3xUsage.queued = false;
\t\t\treturn t3xRefreshUsage;
\t\t})), ignoreCause({ log: true }), forkIn(t3xScope));
\t});
\tconst t3xSources = globalThis.__t3xServer;
\tif (options.t3xProbeUsage && t3xSources?.whenSourcesChange && t3xSources.hasRegisteredSource) yield* gen(function* () {
\t\tlet version = t3xSources.sourcesVersion();
\t\tfor (;;) {
\t\t\tyield* promise((signal) => t3xSources.whenSourcesChange(version, signal));
\t\t\tversion = t3xSources.sourcesVersion();
\t\t\t// 没有扩展登记来源了：不等正在读的、正在重载的，马上清掉（hasSource 要等重载完，还把加载失败的也算上）
\t\t\tif (!t3xSources.hasRegisteredSource("antigravity")) {
\t\t\t\tt3xResetUsage();
\t\t\t\tyield* t3xDropUsage;
\t\t\t}
\t\t\tyield* t3xRefreshUsage;
\t\t}
\t}).pipe(ignoreCause({ log: true }), forkIn(t3xScope));
`;

const SERVER_MARKER = "/* T3X_SERVER_HOST_V1 */";
function serverHostSource() {
  const src = fs.readFileSync(path.join(HOST, "server.mjs"), "utf8");
  return replaceOnce(src, "export function t3xCreateServerHost", "function t3xCreateServerHost", "后台宿主入口");
}

const serverPatch = {
  id: "server-host",
  label: "T3 后台主模块",
  targetRegex: /^apps\/server\/dist\/server-[\w-]{8}\.mjs$/,
  originalHash: "aca92129c6b8b58c799aa0d619beb19f1537403da1d44f70625b45c1036a9d76",
  marker: SERVER_MARKER,
  apply(text) {
    // provider（makeAntigravityProvider）
    const head = 'const makeAntigravityProvider = fn("makeAntigravityProvider")(function* (settings, options) {\n';
    let out = replaceOnce(text, head, `${head}${AGY_PROVIDER_HEAD}`, "Antigravity provider");
    const check = '\tconst checkProvider = fn("checkAntigravityProvider")(function* () {';
    out = replaceOnce(out, check, `${AGY_PROVIDER_REFRESH}${check}`, "Antigravity 健康检查");
    // 健康检查通过后读；找不到 CLI 时清掉额度（下面 missing），正在读的作废（不管 T3 这次是不是先不报失败，等 30 秒后复查）
    const checked = "\t\t\treturn [checked, stored === state ? none() : some(stored)];\n\t\t});\n\t\treturn yield* options.stampIdentity(next.draft);";
    out = replaceOnce(out, checked, checked.replace("\t\treturn yield*", "\t\tif (missingInstallation && (yield* get$6(metadata)).authRevision === before.authRevision) t3xResetUsage();\n\t\tif (initialized !== void 0) yield* t3xRefreshUsage;\n\t\treturn yield*"), "Antigravity 健康检查结果");
    const missing = "\t\t\t\t\t...missingInstallation ? {\n\t\t\t\t\t\tmodels: [],";
    out = replaceOnce(out, missing, missing.replace("models: [],", "usageLimits: void 0,\n\t\t\t\t\t\tmodels: [],"), "Antigravity 未安装");
    // enrichment 连额度一起发布（managedPatch 的开关）
    const managed = "\tconst managed = yield* makeManagedServerProvider({\n";
    out = replaceOnce(out, managed, `${managed}\t\tt3xEnrichUsage: true,\n\t\tt3xCurrentSnapshot: getSnapshot,\n`, "Antigravity managed provider");
    // 会话启动时还没有额度（或上次没读成）就读
    const started = "\t\tyield* rememberRuntimeModes(previousModes, supportedRuntimeModes);\n\t});";
    out = replaceOnce(out, started, started.replace("\n\t});", "\n\t\tif (!before.draft.usageLimits || before.draft.usageLimits.unavailable) yield* t3xRefreshUsage;\n\t});"), "Antigravity 会话启动");
    // 登出、需要重新登录：作废正在读的结果，清掉额度
    const cleared = '\tconst clearAccountMetadata = fn("AntigravityProvider.clearAccountMetadata")(function* () {\n\t\tif (!settings.enabled) return;';
    out = replaceOnce(out, cleared, cleared.replace("\t\tif (!settings.enabled) return;", "\t\tt3xResetUsage();\n\t\tif (!settings.enabled) return;\n\t\tyield* t3xDropUsage;"), "Antigravity 登出");
    // 新登录可能换了账号：作废正在读的结果、清掉旧账号的额度，之后的会话启动再读新账号的
    const exported = "\t\tonAuthRequired: clearAccountMetadata(),\n\t\tsnapshotForCwd\n\t};";
    out = replaceOnce(
      out,
      exported,
      exported.replace("\t\tsnapshotForCwd", "\t\tt3xOnSignedIn: suspend(() => {\n\t\t\tt3xResetUsage();\n\t\t\treturn updateSome(metadata, (state) => some({ ...state, authRevision: state.authRevision + 1, draft: t3xWithUsage(state.draft, void 0) }));\n\t\t}),\n\t\tsnapshotForCwd"),
      "Antigravity provider 导出",
    );
    // driver（AntigravityDriver.create）
    const create = "\t\tconst provider = yield* makeAntigravityProvider(settings, {";
    out = replaceOnce(out, create, `\t\t${AGY_DRIVER_PROBE}\n${create}\n\t\t\tt3xProbeUsage: t3xUsageProbe,`, "Antigravity driver");
    out = replaceOnce(
      out,
      "\t\t\tonAuthenticated: publishCatalog,",
      "\t\t\tonAuthenticated: (...t3xArgs) => suspend(() => provider.t3xOnSignedIn).pipe(andThen(publishCatalog(...t3xArgs))),",
      "Antigravity 登录",
    );
    out = replaceOnce(
      out,
      "export { runServer };",
      `${serverHostSource()}\nglobalThis.__t3xServer ??= process.env.T3X_SERVER_DIR ? t3xCreateServerHost({ dir: process.env.T3X_SERVER_DIR }) : void 0;\nglobalThis.__t3xServer?.start();\nexport { runServer };`,
      "后台模块导出",
    );
    return stripMap(out);
  },
};

// T3 的 managed provider（所有 provider 共用，在 runtimeLayer 里）：enrichment 发布时沿用已发布的额度，只有健康检查的结果能改。
// 加一个开关 t3xEnrichUsage，打开时连 enrichment 快照里的额度一起发布；只有上面 Antigravity 的 provider 打开，别的 provider 行为不变。
// 打开、并且已发布的或这次检查的快照里有额度（有扩展接手，或者刚停用、要清掉的）时，健康检查的结果也不由 managed 自己换上去：
// 那是检查中途取的快照，可能比 provider 现在的状态旧（检查期间登出、登录），只记下“检查过了”并重启 enrichment，
// 由 enrichment 按 provider 现在的状态按顺序发布（T3 的 registry 刷新后本来也读 provider 现在的快照），返回 provider 给的 t3xCurrentSnapshot。
// 两边都没有额度（没装额度扩展）时照 T3 原样：检查结果由 managed 发布、返回；enrichment 这时发布的额度两边都是空的，和 T3 一样。
// 出现过一次额度（t3xUsageSeen）以后就一直这样：检查期间读到额度又登出清掉时，提交那一刻两边都空，照 T3 原样会把检查前的已登录快照再发一次。
// registry（同一个文件）：provider 快照和保存的模型列表合并之后再写 modelIds（冷启动时 provider 还没有模型列表，registry 先用保存的）。
const REGISTRY_MERGE = "\t\t\t\tmergedProviders.set(key, options?.replace === true ? provider : mergeProviderSnapshot(mergedProviders.get(key), provider));";
const MANAGED_RETURN = "\t\tyield* publish(changesPubSub, nextSnapshot);\n\t\tyield* restartSnapshotEnrichment(nextSettings, nextSnapshot, nextGeneration);\n\t\treturn nextSnapshot;";
const MANAGED_ENRICH = "\t\t\t}, state.snapshot.usageLimits);\n\t\t\tif (equals(state.snapshot, merged)) return [null, state];";
const MANAGED_COMMIT = "\t\t\tconst generation = input.enrichSnapshot ? state.enrichmentGeneration + 1 : state.enrichmentGeneration;\n\t\t\tconst previous = state.snapshot.auth;";
const MANAGED_HEAD = 'const makeManagedServerProvider = fn("makeManagedServerProvider")(function* (input) {\n';
const MANAGED_CHECKED = "\t\tconst { snapshot: nextSnapshot, generation: nextGeneration } = yield* modify$2(snapshotStateRef, (state) => {";
const managedPatch = {
  id: "server-managed",
  label: "T3 managed provider",
  targetRegex: /^apps\/server\/dist\/runtimeLayer-bHa_wuNB\.mjs$/,
  originalHash: "b1f1d6ce44e1b16124753de7f37505fb8a9cbb315754f4b46ffce1c057825d5c",
  marker: "input.t3xEnrichUsage ? nextSnapshot.usageLimits",
  apply(text) {
    let out = replaceOnce(text, MANAGED_HEAD, `${MANAGED_HEAD}\tlet t3xUsageSeen = false;\n`, "managed provider");
    out = replaceOnce(out, MANAGED_ENRICH, MANAGED_ENRICH.replace("}, state.snapshot.usageLimits);", "}, input.t3xEnrichUsage ? nextSnapshot.usageLimits : state.snapshot.usageLimits);\n\t\t\tif (input.t3xEnrichUsage && merged.usageLimits !== void 0) t3xUsageSeen = true;"), "managed provider 的 enrichment 发布");
    out = replaceOnce(
      out,
      MANAGED_COMMIT,
      MANAGED_COMMIT.replace("\n", "\n\t\t\tif (input.t3xEnrichUsage && (t3xUsageSeen ||= state.snapshot.usageLimits !== void 0 || probedSnapshot.usageLimits !== void 0)) return [{ snapshot: state.snapshot, generation, t3xEnriched: true }, { ...state, enrichmentGeneration: generation, checked: true }];\n"),
      "managed provider 的检查结果",
    );
    out = replaceOnce(out, MANAGED_CHECKED, MANAGED_CHECKED.split("generation: nextGeneration }").join("generation: nextGeneration, t3xEnriched }"), "managed provider 的检查提交");
    out = replaceOnce(out, MANAGED_RETURN, "\t\tif (!t3xEnriched) yield* publish(changesPubSub, nextSnapshot);\n\t\tyield* restartSnapshotEnrichment(nextSettings, nextSnapshot, nextGeneration);\n\t\treturn t3xEnriched && input.t3xCurrentSnapshot ? yield* input.t3xCurrentSnapshot : nextSnapshot;", "managed provider 的检查发布");
    out = replaceOnce(out, REGISTRY_MERGE, REGISTRY_MERGE.replace("mergedProviders.set(key, ", "mergedProviders.set(key, ((t3xMerged) => globalThis.__t3xServer?.routeUsage?.(t3xMerged.driver, t3xMerged) ?? t3xMerged)(").replace("provider));", "provider)));"), "registry 合并 provider 快照");
    return stripMap(out);
  },
};

module.exports = { preloadPatch, mainServerPatch, serverPatch, managedPatch, PRELOAD_CODE, AGY_MARKER };
