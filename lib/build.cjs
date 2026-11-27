"use strict";
// 把宿主拼成一段运行时代码；也负责生成扩展市场的 registry/index.json。
const fs = require("node:fs");
const path = require("node:path");
const { sha256 } = require("./asar.cjs");
const { t3xCheckManifest, t3xEntryList } = require("../host/pure.js");

const ROOT = path.join(__dirname, "..");
const PKG = require("../package.json");
const HOST_FILES = ["pure.js", "core.js", "install.js", "background.js", "agent.js", "usage.js", "t3.js", "system.js", "tray.js", "github.js", "community.js", "settings.js", "settings-installed.js", "settings-browse.js", "self-update.js"];
const MARKER = "/* T3X_HOST_V1 */";

const MIME = { ".webp": "image/webp", ".png": "image/png", ".gif": "image/gif" };
const dataUrl = (file) => `data:${MIME[path.extname(file)] ?? "application/octet-stream"};base64,${fs.readFileSync(file).toString("base64")}`;

function hostSource() {
  // @node-only 之后是给 Node 测试用的导出，浏览器里没有 module。
  return HOST_FILES.map((f) => fs.readFileSync(path.join(ROOT, "host", f), "utf8").split("// @node-only")[0]).join("\n");
}

function readExtension(dir) {
  const manifestText = fs.readFileSync(path.join(dir, "plugin.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  const list = t3xEntryList(manifest);
  const files = { "plugin.json": manifestText };
  for (const p of [...list.web, ...list.styles, ...list.server]) files[p] = fs.readFileSync(path.join(dir, p), "utf8");
  for (const p of list.assets) files[p] = dataUrl(path.join(dir, p));
  t3xCheckManifest(manifest, files);
  return { manifest, files };
}

/**
 * 追加到 T3 ThreadRouteView 模块末尾的代码。bind 里的 Z / $ / Gn 是 0.1.13 这个模块里 React、jsx 运行时和档位选项函数的名字；
 * agent 里的是这个模块顶层导入的：Ls=会话命令（startTurn 即输入框发送），Yh=把命令变成可调用函数的 hook，js=可见会话列表 hook，Os=项目列表 hook。
 * portal 是 react-dom 的 createPortal（这个模块里 react-dom 叫 pO）：菜单栏弹出小窗把扩展的组件画进另一个窗口（apiVersion 7）。
 * atoms：ge 是 T3 的 atom registry（get / subscribe），Fp 是各环境的后台数据 atom（usageSummary 即 T3 用量页的数据）。
 * atoms.t3（apiVersion 8，host.t3 原样交给扩展）：这个模块顶层导入的几组 T3 atom。Ps=会话（threadShellAtom、hiddenThreadKeysAtom），
 *   us=会话数据的同步状态（statusAtom、quietThreadAtom），Zp=环境后台的 shell 状态（stateValueAtom），
 *   不给 cs（会话连接）：preparedConnectionValueAtom 里有远程环境的访问令牌。
 *   threadState 是 entities 模块导出的会话详情 atom（消息、运行等，T3 打开会话时读的那个），这个模块没导入它，所以补一行 import。
 *   om=环境的展示信息（presentationsAtom：名字、连接状态、后台配置），Tw=环境目录（catalogValueAtom）。
 * version 是这一版宿主的版本（package.json），检查宿主自己的更新时用。
 */
function runtime() {
  const css = fs.readFileSync(path.join(ROOT, "host", "host.css"), "utf8");
  return [
    MARKER,
    'import{tt as t3xThreadState}from"./entities-Cv_YurUT.js";',
    'const t3xHost=(function(bind,hostCss){"use strict";',
    hostSource(),
    'if(typeof document!=="undefined")addStyle(hostCss,"t3x-host");',
    "boot();",
    "return{ChatOverlay,EffortSlot,SettingsPage};",
    `})({React:Z,jsx:$,choices:Gn,agent:{commands:Ls,useCommand:Yh,useThreads:js,useProjects:Os},portal:pO.createPortal,atoms:{registry:ge,server:Fp,t3:{server:Fp,threads:Ps,threadState:t3xThreadState,threadStatus:us,shells:Zp,environments:om,catalog:Tw}},version:${JSON.stringify(PKG.version)}},${JSON.stringify(css)});`,
    "globalThis.t3xHost=t3xHost;",
  ].join("\n");
}

// 市场里是给扩展作者参考的示例，从市场安装。
const EXAMPLES = ["hello-badge"];

/** 扩展市场索引：每个文件的 SHA-256，安装时逐个校验。 */
function registry() {
  const extensions = EXAMPLES.map((id) => {
    const dir = path.join(ROOT, "examples", id);
    const { manifest } = readExtension(dir);
    const list = t3xEntryList(manifest);
    const hashes = {};
    for (const p of ["plugin.json", ...list.web, ...list.styles, ...list.server, ...list.assets]) hashes[p] = sha256(fs.readFileSync(path.join(dir, p)));
    const { name, version, description, author, locales } = manifest;
    return { id, name, version, description, author, locales, manifest: `../examples/${id}/plugin.json`, sha256: hashes };
  });
  return { name: "T3 Code Extensions", apiVersion: 1, extensions };
}

if (require.main === module) {
  const out = path.join(ROOT, "registry", "index.json");
  fs.writeFileSync(out, `${JSON.stringify(registry(), null, 2)}\n`);
  console.log(`已写入 ${path.relative(ROOT, out)}`);
}

module.exports = { MARKER, EXAMPLES, runtime, registry, readExtension, hostSource };
