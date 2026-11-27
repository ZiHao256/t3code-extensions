// 安装来源：注册表（逐个文件校验 SHA-256）、GitHub 仓库（固定到提交，见 github.js）、plugin.json 链接（不校验）、本地文件夹、zip。启动时载入全部扩展。

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 明文 HTTP 上，中间人能同时改注册表里的哈希和文件，校验就没意义了：只允许 HTTPS，本机回环地址除外（开发用）。
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isSecure = (url) => url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));

function httpUrl(raw) {
  const url = new URL(String(raw).trim());
  if (!isSecure(url)) throw new Error(L("只支持 https 链接（本机 localhost 除外）", "Only HTTPS URLs are supported, except for localhost"));
  return url;
}

// 下载上限：注册表、单个文件、整个扩展包、文件个数。
const LIMITS = { index: 1 << 20, file: 5 << 20, total: 20 << 20, files: MAX_FILES };

/** 下载并按实际收到的字节数截断；重定向后的地址也必须安全。 */
async function fetchBytes(url, max = LIMITS.file, headers) {
  const res = await fetch(url, { cache: "no-store", headers });
  if (!res.ok) throw Object.assign(new Error(L(`下载失败 ${res.status}：${url}`, `Download failed (${res.status}): ${url}`)), { status: res.status, headers: res.headers });
  if (res.url && !isSecure(new URL(res.url))) throw new Error(L(`被重定向到不安全的地址：${res.url}`, `Redirected to an insecure URL: ${res.url}`));
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error(L(`文件超过 ${Math.round(max / 1048576)} MB：${url}`, `File exceeds ${Math.round(max / 1048576)} MB: ${url}`));
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function bytesToDataUrl(bytes, type) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: type || "application/octet-stream" }));
  });
}

const MIME = { webp: "image/webp", png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
const mimeOf = (p) => MIME[p.split(".").pop().toLowerCase()];

/** 下载一个扩展。hashes 来自注册表：给了就要求每个文件都有且一致。 */
async function fetchExtension(manifestUrl, hashes) {
  const base = httpUrl(manifestUrl);
  const check = async (p, bytes) => {
    if (!hashes) return;
    const want = hashes[p];
    if (!want) throw new Error(L(`注册表没有给出 ${p} 的校验值`, `The registry has no checksum for ${p}`));
    if ((await sha256Hex(bytes)) !== want) throw new Error(L(`${p} 的 SHA-256 与注册表不一致，已拒绝安装`, `Installation blocked because the SHA-256 checksum for ${p} doesn’t match the registry`));
  };
  const manifestBytes = await fetchBytes(base, LIMITS.index);
  await check("plugin.json", manifestBytes);
  const manifestText = new TextDecoder().decode(manifestBytes);
  const manifest = JSON.parse(manifestText);
  const list = t3xCheckManifest(manifest);
  const files = { "plugin.json": manifestText };
  let total = manifestBytes.length;
  const get = async (p) => {
    const bytes = await fetchBytes(new URL(p, base));
    total += bytes.length;
    if (total > LIMITS.total) throw new Error(L(`扩展包超过 ${LIMITS.total >> 20} MB`, `Extension package exceeds ${LIMITS.total >> 20} MB`));
    await check(p, bytes);
    return bytes;
  };
  for (const p of [...list.web, ...list.styles, ...list.server]) files[p] = new TextDecoder().decode(await get(p));
  for (const p of list.assets) files[p] = await bytesToDataUrl(await get(p), mimeOf(p));
  t3xCheckManifest(manifest, files);
  return { manifest, files, source: { kind: hashes ? "registry" : "url", url: base.href } };
}

/** 本地文件（文件夹或 zip 解出来的）按 plugin.json 组装；read(路径) 返回字节或 undefined。 */
async function packLocal(read, source) {
  const manifestBytes = await read("plugin.json");
  if (!manifestBytes) throw new Error(L("没有找到 plugin.json", "Couldn’t find plugin.json"));
  if (manifestBytes.length > LIMITS.index) throw new Error(L("plugin.json 太大", "plugin.json is too large"));
  const manifestText = new TextDecoder().decode(manifestBytes);
  const manifest = JSON.parse(manifestText);
  const list = t3xCheckManifest(manifest);
  const files = { "plugin.json": manifestText };
  for (const p of [...list.web, ...list.styles, ...list.server]) {
    const bytes = await read(p);
    files[p] = bytes && new TextDecoder().decode(bytes);
  }
  for (const p of list.assets) {
    const bytes = await read(p);
    files[p] = bytes ? await bytesToDataUrl(bytes, mimeOf(p)) : undefined;
  }
  t3xCheckManifest(manifest, files);
  return { manifest, files, source };
}

/** 本地文件夹（<input webkitdirectory>）：去掉最外层目录名后按 plugin.json 取文件。 */
function readFolder(fileList) {
  const byPath = new Map();
  for (const f of fileList) byPath.set(f.webkitRelativePath.split("/").slice(1).join("/"), f);
  const folder = fileList[0]?.webkitRelativePath.split("/")[0] ?? "";
  let total = 0;
  // 和远程下载一样的上限：先看 File.size，超了就不读进内存。
  return packLocal(async (p) => {
    const f = byPath.get(p);
    if (!f) return undefined;
    total += f.size;
    const max = p === "plugin.json" ? LIMITS.index : LIMITS.file;
    if (f.size > max) throw new Error(L(`文件超过 ${Math.round(max / 1048576)} MB：${p}`, `File exceeds ${Math.round(max / 1048576)} MB: ${p}`));
    if (total > LIMITS.total) throw new Error(L(`扩展包超过 ${LIMITS.total >> 20} MB`, `Extension package exceeds ${LIMITS.total >> 20} MB`));
    return new Uint8Array(await f.arrayBuffer());
  }, { kind: "local", folder });
}

// ---------- 本地扩展（开发用）：记住文件夹，点“重新加载”时重读 ----------

/** 能不能记住文件夹（File System Access API）；不能时退回一次性的文件夹导入。 */
const canPickFolder = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";

/** 按 plugin.json 从文件夹句柄里读文件，上限和其他来源一样。 */
function readHandle(dir) {
  let total = 0;
  return packLocal(async (p) => {
    let node = dir;
    const parts = p.split("/").filter((s) => s && s !== "."); // ./web.js、a//b 这类写法清单校验允许，句柄 API 不认
    try {
      for (const part of parts.slice(0, -1)) node = await node.getDirectoryHandle(part);
      const file = await (await node.getFileHandle(parts.at(-1))).getFile();
      const max = p === "plugin.json" ? LIMITS.index : LIMITS.file;
      total += file.size;
      if (file.size > max) throw new Error(L(`文件超过 ${Math.round(max / 1048576)} MB：${p}`, `File is larger than ${Math.round(max / 1048576)} MB: ${p}`));
      if (total > LIMITS.total) throw new Error(L(`扩展包超过 ${LIMITS.total >> 20} MB`, `Extension package is larger than ${LIMITS.total >> 20} MB`));
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (error?.name === "NotFoundError" || error?.name === "TypeMismatchError") return undefined;
      throw error;
    }
  }, { kind: "local", folder: dir.name, handle: dir });
}

/** “添加本地扩展”：选文件夹并读出来（调用方再走 consent → install）。用户取消选择时返回 null。 */
async function pickLocalFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: "read" });
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw error;
  }
  return readHandle(dir);
}

/** 本地扩展能不能重新加载：装的时候记住了文件夹。 */
const canReload = (rec) => rec.source?.kind === "local" && !!rec.source.handle;

/** 重新读同一个文件夹并替换（同一个文件夹是用户自己选的，不再弹安装确认；新加了后台代码时例外，交给 confirm）。
 *  必须在点击事件里调用：可能要重新申请读权限。返回是否替换了。 */
async function reloadLocal(rec, confirm) {
  const dir = rec.source.handle;
  if ((await dir.queryPermission?.({ mode: "read" })) !== "granted" && (await dir.requestPermission?.({ mode: "read" })) !== "granted") {
    throw new Error(L(`没有读取文件夹 ${dir.name} 的权限`, `No permission to read the folder ${dir.name}`));
  }
  const item = await readHandle(dir);
  // 读文件期间扩展可能被移除或换成别的来源：这次重载作废，别把它装回来。
  if (records.get(rec.manifest.id) !== rec) throw new Error(L("扩展在重新加载期间被移除或替换了", "The extension was removed or replaced while reloading."));
  if (item.manifest.id !== rec.manifest.id) {
    throw new Error(L(`文件夹里的扩展 id 变成了“${item.manifest.id}”，没有替换“${rec.manifest.id}”`, `The folder now contains “${item.manifest.id}”, so “${rec.manifest.id}” wasn’t replaced.`));
  }
  // 新加了后台代码或 agent、t3-internals、system 权限：和安装一样先确认
  const gains = (has) => has(item) && !has(rec);
  if ([hasServer, hasAgent, hasT3, hasSystem].some(gains) && !(await confirm(item))) return false;
  await install(item);
  return true;
}

/** 上传的 zip：根目录（或唯一的外层目录）里要有 plugin.json。 */
async function readZip(file) {
  if (file.size > LIMITS.total) throw new Error(L(`zip 超过 ${LIMITS.total >> 20} MB`, `ZIP file exceeds ${LIMITS.total >> 20} MB`));
  const entries = await t3xUnzip(new Uint8Array(await file.arrayBuffer()), { maxFile: LIMITS.file, maxTotal: LIMITS.total, maxEntries: LIMITS.files * 4 });
  return packLocal(async (p) => entries.get(p), { kind: "zip", file: file.name });
}

async function fetchRegistry(url) {
  const base = httpUrl(url);
  const index = t3xCheckRegistry(JSON.parse(new TextDecoder().decode(await fetchBytes(base, LIMITS.index))));
  return {
    url: base.href,
    name: typeof index.name === "string" ? index.name : base.host,
    extensions: index.extensions.map((e) => ({ ...e, manifestUrl: new URL(e.manifest, base).href })),
  };
}

function addRecord(item) {
  records.set(item.manifest.id, { ...item, status: "off", error: null, settings: null, life: null });
}

function sourceText(source) {
  if (source?.kind === "local") return L(`本地文件夹 ${source.folder}`, `Local folder ${source.folder}`);
  if (source?.kind === "zip") return L(`zip 文件 ${source.file}`, `ZIP file ${source.file}`);
  if (source?.kind === "github") {
    const ref = source.ref === "默认分支" ? L("默认分支", "Default branch") : source.ref;
    const commit = `GitHub ${githubName(source)} @ ${source.sha.slice(0, 7)}`;
    return L(`${commit}（${ref}）`, `${commit} (${ref})`);
  }
  return source?.url ?? "";
}
// 判断“是不是同一个来源的升级”：GitHub 扩展按仓库 ID + 子目录算（改名、大小写不影响，旧名被别人占用也认得出）。
// 本地文件夹和 zip 只有个名字，证明不了是同一份，一律当不同来源，让用户看到“会沿用旧数据”的提醒。
const sourceKey = (source) =>
  source?.kind === "github" ? `github:${source.repoId}/${source.path}` : source?.kind === "local" || source?.kind === "zip" ? null : `${source?.kind}:${source?.url}`;

/** 同 id 已装过的话，描述会被替换的那个（来源不同时要让用户知道）。 */
function replacing(item) {
  const old = records.get(item.manifest.id);
  if (!old) return null;
  const key = sourceKey(item.source);
  const sameSource = key !== null && sourceKey(old.source) === key;
  return { name: localized(old.manifest, "name"), version: old.manifest.version, from: sourceText(old.source), sameSource };
}

/** 安装（或升级同 id 的扩展）并启用，等写盘完成。新版本启用失败时恢复旧版本；升级已停用的扩展只换代码，不启用。 */
async function install(item) {
  if (!ready) throw new Error(L("扩展还在载入，稍后再试", "Extensions are still loading. Try again in a moment."));
  const id = item.manifest.id;
  const old = records.get(id);
  const oldSaved = store.get("t3x:installed", []);
  const oldEnabled = store.get("t3x:enabled", {});
  const saveInstalled = () => store.set("t3x:installed", [...oldSaved.filter((x) => x.manifest.id !== id), { ...item, installedAt: new Date().toISOString() }]);
  if (old && !shouldRun(old)) {
    await saveInstalled(); // 写盘成功再换记录，失败时界面仍是旧版
    addRecord(item);
    bump();
    return;
  }
  if (old) deactivate(old);
  addRecord(item);
  const rec = records.get(id);
  activate(rec);
  if (rec.status !== "on") {
    const reason = rec.error;
    deactivate(rec);
    records.delete(id);
    if (old) {
      records.set(id, old);
      if (shouldRun(old)) activate(old);
    }
    bump();
    throw new Error(old ? L(`${reason}；已恢复原来的版本`, `${reason}. Restored the previous version.`) : `${reason}`);
  }
  await Promise.all([
    saveInstalled(),
    // 新装的全局启用；升级沿用原来的全局和按作用域开关。
    old ? Promise.resolve() : store.set("t3x:enabled", { ...oldEnabled, [id]: true }),
  ]);
}

/** 移除扩展：停用并删掉它的代码、启用状态和它自己存的数据，等写盘完成。 */
async function uninstall(id) {
  const rec = records.get(id);
  if (!rec) return;
  if (!ready) throw new Error(L("扩展还在载入，稍后再试", "Extensions are still loading. Try again in a moment."));
  deactivate(rec);
  serverKeep.add(id);
  records.delete(id);
  bump();
  const { [id]: _drop, ...rest } = store.get("t3x:enabled", {});
  const { [id]: _dropScoped, ...restScoped } = store.get("t3x:scoped", {});
  const writes = [
    store.set("t3x:installed", store.get("t3x:installed", []).filter((x) => x.manifest.id !== id)),
    store.set("t3x:enabled", rest),
    store.set("t3x:scoped", restScoped),
  ];
  for (const key of [...cache.keys()]) if (key.startsWith(`ext:${id}:`)) writes.push(store.set(key, undefined));
  await Promise.all(writes);
  serverKeep.delete(id); // 卸载写盘成功了，主进程这才删它的后台数据；写盘失败就留着
  queueServerSync();
}

function boot() {
  if (typeof document === "undefined") return;
  bootHostUpdate(); // self-update.js
  loadStore()
    .catch((error) => {
      persistent = false;
      console.error(TAG, "读取扩展数据失败，按默认设置启动，本次修改不会保存", error);
    })
    .finally(() => {
      ready = true;
      for (const item of store.get("t3x:installed", [])) addRecord(item);
      for (const rec of records.values()) if (shouldRun(rec)) activate(rec);
      bump();
    });
}
