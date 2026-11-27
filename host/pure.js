// 宿主的纯函数：浏览器里和 core.js 拼在一起运行，Node 里由 tests/verify.cjs 直接 require。

// 界面语言跟着 T3：T3 切语言时会改 <html lang>（中文是 zh），中文以外的语言都显示英文。Node 测试里按中文。
const isZh = () => typeof document === "undefined" || /^zh\b/i.test(document.documentElement.lang);
const L = (zh, en) => (isZh() ? zh : en);

// 2：设置面板的 ui 加了 Input / Select 系列，host 加了 openSettings、contextMenu。3：host 加了 dom、confirm。
// 4：entries.server，后台扩展（在 T3 后台以用户权限运行，要声明 permissions: ["server"]）。
// 5：host.agent（用你的 agent 开会话、发消息，要声明 permissions: ["agent"]）和 host.outputs（扩展自己的输出目录）。
// 6：host.server.call ↔ t3x.handle（扩展自己的窗口和后台互相调用）和 t3x.lang()。
// 7：host.tray（macOS 菜单栏图标和菜单，要声明 permissions: ["tray"]）和 host.agent.replies（会话最新回复）。
// 8：host.t3（直接读 T3 自己的 atom，要声明 permissions: ["t3-internals"]）和 host.system（系统通知、剪贴板、打开链接，要声明 permissions: ["system"]）。
// 旧 apiVersion 的扩展照常能用；用到新接口的扩展声明新值，旧宿主会拒绝安装，而不是装上后出错。
const API_VERSION = 8;
const SERVER_API_VERSION = 4;
const AGENT_API_VERSION = 5;
const TRAY_API_VERSION = 7;
const T3_API_VERSION = 8;
const SYSTEM_API_VERSION = 8;
const REGISTRY_VERSION = 1; // 注册表格式没变
const TAG = "[t3x]";
// add：所有扩展的组件都渲染；replace：最后启用的那个替换原生组件。
const SLOTS = { "chat.overlay": "add", "composer.effort": "replace" };
const ID_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/;
const PATH_RE = /^(?!\/)(?!.*\.\.)[\w./-]+$/;

/** 扩展声明的文件，按 web 脚本、样式、后台脚本、二进制素材分组。 */
function t3xEntryList(manifest) {
  const web = manifest.entries?.web;
  const server = manifest.entries?.server;
  return {
    web: web === undefined ? [] : Array.isArray(web) ? web : [web],
    styles: manifest.entries?.styles ?? [],
    server: server === undefined ? [] : [server],
    assets: manifest.assets ?? [],
  };
}

/** 校验 plugin.json；给了 files 时同时检查声明的文件都在。不合法直接抛错，错误信息给用户看。 */
function t3xCheckManifest(manifest, files) {
  const fail = (msg) => {
    throw new Error(L(`plugin.json 无效：${msg}`, `Invalid plugin.json: ${msg}`));
  };
  if (!manifest || typeof manifest !== "object") fail(L("不是 JSON 对象", "Expected a JSON object"));
  if (typeof manifest.id !== "string" || !ID_RE.test(manifest.id)) fail(L("id 只能用小写字母、数字、点和连字符", "id may contain only lowercase letters, digits, periods, and hyphens"));
  if (!Number.isInteger(manifest.apiVersion) || manifest.apiVersion < 1 || manifest.apiVersion > API_VERSION) fail(L(`apiVersion 需要是 1 到 ${API_VERSION}，请升级 T3 Code Extensions`, `apiVersion must be 1 to ${API_VERSION}. Update T3 Code Extensions.`));
  if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 60) fail(L("name 必填，最多 60 字", "name is required and must be at most 60 characters"));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version)) fail(L("version 需要是 x.y.z", "version must have the form x.y.z"));
  // 这些字段会直接显示在设置页：类型不对（比如对象）会让整个扩展区块渲染失败，入库前就拦下。
  for (const [key, max] of [["description", 300], ["author", 60]]) {
    if (manifest[key] !== undefined && (typeof manifest[key] !== "string" || manifest[key].length > max)) fail(L(`${key} 需要是不超过 ${max} 字的字符串`, `${key} must be a string of at most ${max} characters`));
  }
  const badLocale = t3xLocalesError(manifest.locales);
  if (badLocale) fail(badLocale);
  // repository：扩展的 GitHub 仓库地址，设置页里显示为来源链接。
  if (manifest.repository !== undefined && !(typeof manifest.repository === "string" && t3xParseGithub(manifest.repository))) {
    fail(L("repository 需要是 https://github.com/作者/仓库 地址", "repository must be an https://github.com/owner/repo URL"));
  }
  // repositoryId：GitHub 仓库的数字 ID，可选；宿主目前只校验格式。
  if (manifest.repositoryId !== undefined && !Number.isSafeInteger(manifest.repositoryId)) fail(L("repositoryId 需要是整数", "repositoryId must be an integer"));
  const strings = (v) => Array.isArray(v) && v.every((p) => typeof p === "string");
  if (manifest.permissions !== undefined && !strings(manifest.permissions)) fail(L("permissions 需要是字符串数组", "permissions must be an array of strings"));
  const web = manifest.entries?.web;
  if (web !== undefined && typeof web !== "string" && !strings(web)) fail(L("entries.web 需要是字符串或字符串数组", "entries.web must be a string or an array of strings"));
  if (manifest.entries?.styles !== undefined && !strings(manifest.entries.styles)) fail(L("entries.styles 需要是字符串数组", "entries.styles must be an array of strings"));
  if (manifest.assets !== undefined && !strings(manifest.assets)) fail(L("assets 需要是字符串数组", "assets must be an array of strings"));
  const server = manifest.entries?.server;
  if (server !== undefined) {
    if (typeof server !== "string" || !server.endsWith(".mjs")) fail(L("entries.server 需要是一个 .mjs 文件", "entries.server must be a single .mjs file"));
    if (manifest.apiVersion < SERVER_API_VERSION) fail(L(`后台扩展需要 apiVersion ${SERVER_API_VERSION}`, `Background extensions need apiVersion ${SERVER_API_VERSION}`));
    if (!manifest.permissions?.includes("server")) fail(L('后台扩展要在 permissions 里声明 "server"', 'Background extensions must declare "server" in permissions'));
  }
  if (manifest.permissions?.includes("agent") && manifest.apiVersion < AGENT_API_VERSION) fail(L(`agent 权限需要 apiVersion ${AGENT_API_VERSION}`, `The agent permission needs apiVersion ${AGENT_API_VERSION}`));
  if (manifest.permissions?.includes("tray") && manifest.apiVersion < TRAY_API_VERSION) fail(L(`tray 权限需要 apiVersion ${TRAY_API_VERSION}`, `The tray permission needs apiVersion ${TRAY_API_VERSION}`));
  if (manifest.permissions?.includes("t3-internals") && manifest.apiVersion < T3_API_VERSION) fail(L(`t3-internals 权限需要 apiVersion ${T3_API_VERSION}`, `The t3-internals permission needs apiVersion ${T3_API_VERSION}`));
  if (manifest.permissions?.includes("system") && manifest.apiVersion < SYSTEM_API_VERSION) fail(L(`system 权限需要 apiVersion ${SYSTEM_API_VERSION}`, `The system permission needs apiVersion ${SYSTEM_API_VERSION}`));
  const list = t3xEntryList(manifest);
  const all = [...list.web, ...list.styles, ...list.server, ...list.assets];
  if (list.web.length === 0 && list.server.length === 0) fail(L("entries.web 至少要有一个脚本", "entries.web must list at least one script"));
  if (all.length > MAX_FILES) fail(L(`声明的文件超过 ${MAX_FILES} 个`, `More than ${MAX_FILES} files are declared`));
  if (new Set(all).size !== all.length) fail(L("同一个文件声明了两次", "The same file is declared twice"));
  for (const p of all) {
    if (typeof p !== "string" || !PATH_RE.test(p)) fail(L(`文件路径不合法：${p}`, `Invalid file path: ${p}`));
    if (files && typeof files[p] !== "string") fail(L(`缺少文件：${p}`, `Missing file: ${p}`));
  }
  return list;
}

/** plugin.json 和注册表条目共用：locales 无效时返回错误信息，没问题返回 null。 */
function t3xLocalesError(locales) {
  if (locales === undefined) return null;
  const ok = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!ok(locales)) return L("locales 需要是对象", "locales must be an object");
  for (const [lang, text] of Object.entries(locales)) {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang) || !ok(text)) return L(`locales.${lang} 无效`, `Invalid locales.${lang}`);
    for (const [key, max] of [["name", 60], ["description", 300]]) {
      if (text[key] !== undefined && (typeof text[key] !== "string" || !text[key].trim() || text[key].length > max)) {
        return L(`locales.${lang}.${key} 需要是不超过 ${max} 字的非空字符串`, `locales.${lang}.${key} must be a non-empty string of at most ${max} characters`);
      }
    }
  }
  return null;
}

const MAX_FILES = 64;

/**
 * 设置页顶部选中的作用域 → 存储键。T3 的作用域：search.project（逻辑项目，可能横跨多个环境）、search.machine（环境）、
 * search.checkout；解析后的 scope.members 是落到各环境的成员项目。全局返回 null。
 * 键：proj:环境:项目（某个环境里的某个项目），env:环境（某个环境的所有项目）。
 */
function t3xScopeKeys(scope) {
  const search = scope?.search ?? {};
  if (search.project) {
    const members = Array.isArray(scope?.scope?.members) ? scope.scope.members : [];
    const keys = members.map((m) => m?.environmentId && (m.projectId ?? m.id) && `proj:${m.environmentId}:${m.projectId ?? m.id}`).filter(Boolean);
    return keys.length ? [...new Set(keys)] : [];
  }
  if (search.machine) return [`env:${search.machine}`];
  return null;
}

/** 某个会话里扩展是否生效：项目 > 环境 > 全局。ctx = { environmentId, projectId }。 */
function t3xEnabledAt(global, scoped, ctx) {
  const map = scoped ?? {};
  const proj = ctx?.environmentId && ctx?.projectId ? map[`proj:${ctx.environmentId}:${ctx.projectId}`] : undefined;
  if (typeof proj === "boolean") return proj;
  const env = ctx?.environmentId ? map[`env:${ctx.environmentId}`] : undefined;
  if (typeof env === "boolean") return env;
  return !!global;
}

/** 注册表 index.json：{ name, apiVersion, extensions: [{ id, name, version, description, author, manifest, sha256: { 路径: 哈希 } }] } */
function t3xCheckRegistry(index) {
  if (!index || index.apiVersion !== REGISTRY_VERSION || !Array.isArray(index.extensions)) throw new Error(L("不是扩展注册表（需要 apiVersion 1 和 extensions 数组）", "Invalid extension registry. Expected apiVersion 1 and an extensions array."));
  for (const e of index.extensions) {
    const text = ["name", "version", "description", "author"].every((k) => e?.[k] === undefined || typeof e[k] === "string");
    const locales = !t3xLocalesError(e?.locales); // 和 plugin.json 同一套规则
    const hashes = e?.sha256 && typeof e.sha256 === "object" && Object.values(e.sha256).every((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h));
    if (index.extensions.filter((x) => x?.id === e?.id).length > 1) throw new Error(L(`注册表里 ${e.id} 出现了两次`, `${e.id} appears twice in the registry`));
    if (typeof e?.id !== "string" || !ID_RE.test(e.id) || typeof e.manifest !== "string" || !hashes || !text || !locales) {
      throw new Error(L(`注册表条目无效：${typeof e?.id === "string" ? e.id : "?"}`, `Invalid registry entry: ${typeof e?.id === "string" ? e.id : "?"}`));
    }
  }
  return index;
}

/** 把 T3 原生的推理档位控件（档位列表组件 Xz 的 props）整理成扩展用的稳定结构；没有可选档位时返回 null。 */
function t3xEffortModel({ control, traits, locked }, choicesOf) {
  const d = control?.descriptor;
  if (!d || !traits) return null;
  if (control.kind === "boolean") {
    return {
      label: d.label,
      steps: [{ id: "off", label: L("关", "Off") }, { id: "on", label: L("开", "On") }],
      activeIndex: d.currentValue === true ? 1 : 0,
      defaultIndex: 1,
      disabled: !!locked,
      select: (i) => traits.changeBoolean(d.id, i === 1),
    };
  }
  const steps = (choicesOf(d) || []).map((c) => ({ id: c.id, label: c.label || c.id, description: c.description ?? null, isDefault: !!c.isDefault }));
  if (steps.length === 0) return null;
  const current = traits.selectValue(d);
  return {
    label: d.label,
    steps,
    activeIndex: Math.max(0, steps.findIndex((s) => s.id === current)),
    defaultIndex: Math.max(0, steps.findIndex((s) => s.isDefault)),
    disabled: !!locked,
    select: (i) => {
      const s = steps[i];
      if (s && s.id !== current) traits.changeSelect(d, s.id);
    },
  };
}

// 社区扩展：GitHub 上带这个话题的仓库都会出现在扩展市场里，作者不用向谁提交。
const GITHUB_TOPIC = "t3code-extension";
const GH_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GH_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * 解析 GitHub 仓库地址：https://github.com/作者/仓库[.git][/tree/分支或标签[/子目录]]。
 * 不是 GitHub 仓库地址时返回 null；子目录里放 plugin.json 的单仓多扩展也支持。
 */
function t3xParseGithub(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return null;
  const [owner, rawRepo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!GH_OWNER_RE.test(owner ?? "") || !GH_REPO_RE.test(repo ?? "") || repo === "." || repo === "..") return null;
  if (kind === undefined) return { owner, repo, ref: null, path: "" };
  if (kind !== "tree" || !ref) return null;
  const path = rest.join("/");
  if (path && !PATH_RE.test(path)) return null;
  try {
    return { owner, repo, ref: decodeURIComponent(ref), path };
  } catch {
    return null; // 坏的百分号编码
  }
}

/** a 是不是比 b 新：只认 x.y.z 这种纯数字版本，认不出的都不算新。 */
function t3xNewerVersion(a, b) {
  const parse = (v) => (typeof v === "string" && /^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(v) ? v.split(".").map(Number) : null);
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return false;
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
}

/** 固定到某个提交的文件地址：内容永远不会再变。 */
const t3xRawUrl = ({ owner, repo, path }, sha, file) => `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path ? `${path}/` : ""}${file}`;

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 解压 zip（只支持“存储”和 deflate，不支持加密和 zip64），返回 路径 -> 字节。
 * 单个文件和总大小都有上限，按实际解出的字节数截断，防 zip 炸弹。
 */
async function t3xUnzip(bytes, { maxFile = 5 << 20, maxTotal = 20 << 20, maxEntries = 256 } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (msg) => {
    throw new Error(L(`zip 文件无效：${msg}`, `Invalid ZIP file: ${msg}`));
  };
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail(L("找不到目录区", "Central directory not found"));
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count > maxEntries) fail(L(`文件超过 ${maxEntries} 个`, `Archive contains more than ${maxEntries} files`));
  const out = new Map();
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) fail(L("目录区损坏", "The central directory is corrupt"));
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const unpacked = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || name.split("/").pop() === ".DS_Store") continue;
    if (flags & 1) fail(L("不支持加密的 zip", "Encrypted ZIP files are unsupported"));
    if (size === 0xffffffff || local === 0xffffffff) fail(L("不支持 zip64", "ZIP64 is unsupported"));
    if (!PATH_RE.test(name)) fail(L(`文件路径不合法：${name}`, `Invalid file path: ${name}`));
    if (out.has(name)) fail(L(`文件重复：${name}`, `Duplicate file: ${name}`));
    if (unpacked > maxFile || total + unpacked > maxTotal) fail(L(`超过大小上限：${name}`, `File exceeds the size limit: ${name}`));
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) fail(L(`${name} 的数据损坏`, `${name} contains corrupt data`));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > bytes.length) fail(L(`${name} 的数据不完整`, `${name} contains incomplete data`));
    const raw = bytes.subarray(start, start + size);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) {
      // 解码器会把一个输入块的全部输出攒完才交出来：按 4 KB 小块喂，峰值内存才受上限约束。
      let fed = 0;
      const input = new ReadableStream(
        {
          pull(c) {
            if (fed >= raw.length) return c.close();
            c.enqueue(raw.slice(fed, fed + 4096));
            fed += 4096;
          },
        },
        { highWaterMark: 0 },
      );
      const reader = input.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const chunks = [];
      let len = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        len += value.length;
        if (len > maxFile || total + len > maxTotal) {
          await reader.cancel();
          fail(L(`解压后超过大小上限：${name}`, `Decompressed file exceeds the size limit: ${name}`));
        }
        chunks.push(value);
      }
      data = new Uint8Array(len);
      let p = 0;
      for (const c of chunks) {
        data.set(c, p);
        p += c.length;
      }
    } else fail(L(`不支持的压缩方式 ${method}：${name}`, `Unsupported compression method ${method}: ${name}`));
    if (data.length !== unpacked || crc32(data) !== crc) fail(L(`${name} 的数据损坏（长度或校验和不符）`, `${name} contains corrupt data (length or checksum mismatch)`));
    total += data.length;
    out.set(name, data);
  }
  // 打包时常把整个文件夹一起压进去：plugin.json 不在根目录、只有一层外壳目录时去掉它。
  if (!out.has("plugin.json")) {
    const tops = new Set([...out.keys()].map((k) => k.split("/")[0]));
    const [top] = tops;
    if (tops.size === 1 && out.has(`${top}/plugin.json`)) {
      return new Map([...out].map(([k, v]) => [k.slice(top.length + 1), v]));
    }
  }
  return out;
}

// @node-only
if (typeof module === "object") module.exports = { t3xScopeKeys, t3xEnabledAt, t3xLocalesError, t3xEntryList, t3xCheckManifest, t3xCheckRegistry, t3xEffortModel, t3xParseGithub, t3xRawUrl, t3xNewerVersion, t3xUnzip, GITHUB_TOPIC, SLOTS, API_VERSION, SERVER_API_VERSION, AGENT_API_VERSION };
