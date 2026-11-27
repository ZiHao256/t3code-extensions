/* T3X_SERVER_MAIN_V1 */
// 追加到 T3 Electron 主进程（main.cjs）末尾：后台扩展的落盘。
// 窗口里的宿主（background.js）交来该运行的后台脚本，写到 <T3 数据目录>/t3x-server，T3 后台从那里加载（server.mjs）。
// 主进程把这个目录放进 T3X_SERVER_DIR：T3 启动后台时继承主进程环境，所以只有我们的 app 启动的后台会加载后台扩展。
const t3xServerMain = (() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const net = require("node:net");
  const ID_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/;
  const LIMIT = { extensions: 64, installed: 256, code: 5 << 20, version: 40 }; // code 和窗口里单个文件的上限（install.js LIMITS.file）一致
  const fail = (msg) => {
    throw new Error(`t3x: ${msg}`);
  };

  /** 和 T3 主进程同一套规则（resolveDesktopBaseDir / resolveDesktopStateDir）：T3CODE_HOME 或 ~/.t3 下的 userdata。 */
  function serverDir(env, homedir, isDevelopment) {
    const configured = env.T3CODE_HOME?.trim();
    const base = configured || path.join(homedir, ".t3");
    return path.join(base, isDevelopment && !configured ? "dev" : "userdata", "t3x-server");
  }

  function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // 窗口传来的内容按不可信处理：id 会拼进路径，代码有大小上限。
  function check(payload) {
    if (!payload || typeof payload !== "object") fail("同步内容无效");
    const { extensions, installed, lang } = payload;
    if (lang !== undefined && lang !== "zh" && lang !== "en") fail("lang 无效");
    if (!Array.isArray(installed) || installed.length > LIMIT.installed || !installed.every((id) => typeof id === "string" && ID_RE.test(id))) fail("installed 无效");
    if (!Array.isArray(extensions) || extensions.length > LIMIT.extensions) fail("extensions 无效");
    const seen = new Set();
    for (const e of extensions) {
      if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || seen.has(e.id) || !installed.includes(e.id)) fail(`扩展 id 无效：${e?.id}`);
      if (typeof e.version !== "string" || e.version.length > LIMIT.version) fail(`${e.id} 的版本号无效`);
      if (typeof e.code !== "string" || e.code.length > LIMIT.code) fail(`${e.id} 的后台脚本无效或超过 5 MB`);
      seen.add(e.id);
    }
  }

  // 要往里写或者在里面删东西的目录必须是真目录：是符号链接（或文件）就停下，免得写到、删到链接指向的地方。
  function realDir(p) {
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(p).isDirectory()) fail(`${p} 不是目录（可能是符号链接），不往里写也不清理`);
  }

  /** 写入启用的后台脚本和索引，清掉旧版本；卸载了的扩展连同数据目录一起删。返回每个扩展收下的 sha256。 */
  function sync(dir, payload) {
    check(payload);
    const codeRoot = path.join(dir, "code");
    const dataRoot = path.join(dir, "data");
    realDir(codeRoot); // 先查完再动手：任何一步不对都不写索引、不删东西
    realDir(dataRoot);
    for (const e of payload.extensions) realDir(path.join(codeRoot, e.id));
    const entries = payload.extensions.map((e) => {
      const sha256 = crypto.createHash("sha256").update(e.code, "utf8").digest("hex");
      const file = `code/${e.id}/${sha256}.mjs`; // 按内容命名：后台按文件 URL 导入，换版本就是换文件，不会撞上 ESM 缓存
      const abs = path.join(dir, file);
      if (!fs.existsSync(abs)) writeAtomic(abs, e.code);
      return { id: e.id, version: e.version, file, sha256 };
    });
    // lang：界面语言，后台扩展用 t3x.lang() 读（apiVersion 6）
    const indexText = `${JSON.stringify({ version: 1, lang: payload.lang === "zh" ? "zh" : "en", extensions: entries }, null, 2)}\n`;
    writeAtomic(path.join(dir, "index.json"), indexText);
    indexGen.set(dir, crypto.createHash("sha256").update(indexText).digest("hex"));
    const current = new Map(entries.map((e) => [e.id, path.basename(e.file)]));
    for (const id of fs.readdirSync(codeRoot)) {
      const sub = path.join(codeRoot, id);
      if (!current.has(id)) fs.rmSync(sub, { recursive: true, force: true });
      else for (const f of fs.readdirSync(sub)) if (f !== current.get(id)) fs.rmSync(path.join(sub, f), { recursive: true, force: true });
    }
    // rmSync 不跟随符号链接：扩展在数据目录里建的链接只删链接本身。卸载了的扩展，输出目录（apiVersion 5）一起删。
    for (const id of fs.readdirSync(dataRoot)) if (!payload.installed.includes(id)) fs.rmSync(path.join(dataRoot, id), { recursive: true, force: true });
    const outRoot = outputRoot(dir);
    if (fs.existsSync(outRoot) && fs.lstatSync(outRoot).isDirectory()) {
      for (const id of fs.readdirSync(outRoot)) if (!payload.installed.includes(id)) fs.rmSync(path.join(outRoot, id), { recursive: true, force: true });
    }
    return { extensions: entries.map(({ id, sha256 }) => ({ id, sha256 })) };
  }

  // apiVersion 5 的输出目录：<T3 数据目录>/t3x-out/<扩展 id>/。扩展让 agent 把生成的文件写到这里，再经主进程读回窗口。
  // 只读这个目录里面的普通文件：路径逐段检查，不跟随符号链接，不能用 . / .. 跳出去。
  // 防的是 agent 按扩展给的路径写文件时写错、写成链接（符号链接、硬链接）。
  // shortcut: 检查和打开之间把中间目录换成链接的竞态不防（Node 没有 openat，要逐级持目录句柄）；只能写输出目录、
  // 自己又读不到目标文件的写入方才用得上它，要支持这种受限写入方时再改成逐级打开。
  const OUT_PART_RE = /^\w[\w.-]{0,99}$/;
  const OUT_MAX = 32 << 20;
  const outputRoot = (serverDirPath) => path.join(path.dirname(serverDirPath), "t3x-out");

  function outputDir(root, id) {
    if (typeof id !== "string" || !ID_RE.test(id)) fail("扩展 id 无效");
    realDir(root);
    const dir = path.join(root, id);
    realDir(dir);
    return dir;
  }

  /** 逐段 lstat：都不是符号链接、中间是目录、最后是文件；不存在返回 null，否则返回最后一段的 stat。 */
  function walkOutput(root, segs) {
    if (!fs.existsSync(root)) return null;
    if (!fs.lstatSync(root).isDirectory()) fail(`${root} 不是目录（可能是符号链接），不读`);
    let cur = root;
    let st = null;
    for (const [i, part] of segs.entries()) {
      cur = path.join(cur, part);
      try {
        st = fs.lstatSync(cur);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      if (st.isSymbolicLink()) fail(`${part} 是符号链接，不读`);
      if (i < segs.length - 1 && !st.isDirectory()) fail(`${part} 不是目录`);
    }
    if (!st.isFile()) fail(`${segs.at(-1)} 不是文件`);
    return st;
  }

  /**
   * 读 <root>/<id>/<rel>；不存在返回 null。检查和读取之间文件可能被换掉（agent 还在写，或者有人换成链接）：
   * 不跟随链接、不阻塞地打开，在同一个文件描述符上查类型、读（最多上限 + 1 字节），读完再走一遍路径，前后必须是同一个文件。
   */
  function readOutput(root, id, rel) {
    if (typeof id !== "string" || !ID_RE.test(id)) fail("扩展 id 无效");
    const parts = typeof rel === "string" && rel.length <= 400 ? rel.split("/") : [];
    if (parts.length === 0 || parts.length > 8 || !parts.every((p) => OUT_PART_RE.test(p))) fail(`输出路径无效：${String(rel).slice(0, 80)}`);
    const segs = [id, ...parts];
    const before = walkOutput(root, segs);
    if (!before) return null;
    const file = path.join(root, ...segs);
    const name = parts.at(-1);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const st = fs.fstatSync(fd);
      const same = (a) => a && a.dev === st.dev && a.ino === st.ino;
      if (!st.isFile() || !same(before)) fail(`${name} 在读的时候被换掉了`);
      if (st.nlink > 1) fail(`${name} 是硬链接，不读`);
      if (st.size > OUT_MAX) fail(`${name} 超过 32 MB`);
      const buf = Buffer.alloc(st.size + 1);
      let got = 0;
      for (let n; got < buf.length && (n = fs.readSync(fd, buf, got, buf.length - got, null)) > 0; ) got += n;
      const after = walkOutput(root, segs);
      if (!same(after)) fail(`${name} 在读的时候被换掉了`);
      // 读的时候或读完以后大小变了就是还在写：报错让调用方稍后再读，不返回截断的内容
      if (got !== st.size || after.size !== got) fail(`${name} 还在写，稍后再读`);
      return { bytes: buf.subarray(0, got), size: got, modified: st.mtimeMs };
    } finally {
      fs.closeSync(fd);
    }
  }

  // apiVersion 6：窗口里的扩展调用自己后台用 t3x.handle 登记的函数（host.server.call）。
  // T3 后台在 <dir>/rpc.sock 上听（目录 0700，只有这台 Mac 上的这个用户能连）；一次调用一条连接，去一行 JSON、回一行 JSON。
  // 扩展 id 由窗口里的宿主按调用方填，扩展自己改不了；参数和返回值只能是 JSON，有大小和时间上限。
  const CALL_NAME_RE = /^[A-Za-z][\w.-]{0,63}$/;
  const CALL_LIMIT = { request: 256 << 10, response: 4 << 20, ms: 60_000 }; // 按 UTF-8 字节算
  const indexGen = new Map(); // dir -> 最近写的 index.json 的 SHA-256：调用带上它，后台还没重载到这一份就先重载

  function call(dir, id, name, data) {
    if (typeof id !== "string" || !ID_RE.test(id)) fail("扩展 id 无效");
    if (typeof name !== "string" || !CALL_NAME_RE.test(name)) fail(`调用名无效：${String(name).slice(0, 80)}`);
    let line;
    try {
      line = JSON.stringify({ ext: id, name, data: data ?? null, gen: indexGen.get(dir) ?? null });
    } catch {
      fail("参数要能转成 JSON");
    }
    if (Buffer.byteLength(line) > CALL_LIMIT.request) fail("参数超过 256 KB");
    return new Promise((resolve, reject) => {
      const sock = net.connect(path.join(dir, "rpc.sock"));
      let buf = "";
      let size = 0;
      const done = (fn, value) => {
        clearTimeout(timer);
        sock.destroy();
        fn(value);
      };
      const timer = setTimeout(() => done(reject, new Error(`t3x: ${name} 超过 ${CALL_LIMIT.ms / 1000} 秒没有结果`)), CALL_LIMIT.ms);
      sock.setEncoding("utf8");
      sock.on("connect", () => sock.write(`${line}\n`));
      sock.on("data", (chunk) => {
        buf += chunk;
        size += Buffer.byteLength(chunk);
        if (size > CALL_LIMIT.response + 1024) return done(reject, new Error("t3x: 后台返回超过 4 MB"));
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        let msg;
        try {
          msg = JSON.parse(buf.slice(0, nl));
        } catch {
          return done(reject, new Error("t3x: 后台返回的不是 JSON"));
        }
        if (msg?.ok === true) done(resolve, msg.result);
        else done(reject, new Error(String(msg?.error ?? "后台调用失败").slice(0, 500)));
      });
      sock.on("error", (error) => done(reject, new Error(error.code === "ENOENT" || error.code === "ECONNREFUSED" ? "t3x: T3 后台还没准备好，稍后再试" : `t3x: ${error.message}`)));
      sock.on("close", () => done(reject, new Error("t3x: 后台没有回应就断开了")));
    });
  }

  /** T3 后台写的加载结果；还没加载过时是空的。 */
  function status(dir) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { extensions: {} };
      throw error;
    }
  }

  // apiVersion 8：host.system.copy。T3 窗口不在前台（比如在菜单栏小窗里点）时 navigator.clipboard 写不进去，这里用主进程的剪贴板
  const CLIPBOARD_MAX = 4 << 20;
  function writeClipboard(clipboard, text) {
    if (typeof text !== "string" || text.length > CLIPBOARD_MAX) fail("text 需要是不超过 4M 字的文字");
    return clipboard.writeText(text); // Electron 44 里是 Promise：写完才回给窗口，写失败窗口能收到错误
  }

  // 和 T3 自己的 isMainFrameEvent 一样：只认窗口主框架发来的请求。update-main.cjs、tray-main.cjs 也用它。
  // window.open 开出来的子窗（菜单栏小窗等）也是 "window"，但不是 T3 主窗口：tray-main.cjs 在它们创建时登记进 distrusted。
  const distrusted = new WeakSet();
  const distrust = (wc) => void distrusted.add(wc);
  const trusted = ({ sender, senderFrame }) => sender.getType() === "window" && !distrusted.has(sender) && Boolean(senderFrame) && senderFrame === sender.mainFrame;
  const guard = (fn) => (event, ...args) => {
    if (!trusted(event)) fail("只接受主窗口的请求");
    return fn(...args);
  };

  function install(electron) {
    const dir = serverDir(process.env, os.homedir(), !electron.app.isPackaged);
    process.env.T3X_SERVER_DIR = dir;
    electron.ipcMain.handle("t3x:server:sync", guard((payload) => sync(dir, payload)));
    electron.ipcMain.handle("t3x:server:status", guard(() => status(dir)));
    const out = outputRoot(dir);
    electron.ipcMain.handle("t3x:out:dir", guard((id) => outputDir(out, id)));
    electron.ipcMain.handle("t3x:out:read", guard((id, rel) => readOutput(out, id, rel)));
    electron.ipcMain.handle("t3x:server:call", guard((id, name, data) => call(dir, id, name, data)));
    electron.ipcMain.handle("t3x:clipboard:write", guard((text) => writeClipboard(electron.clipboard, text)));
  }

  return { serverDir, sync, status, outputRoot, outputDir, readOutput, call, writeClipboard, trusted, distrust, guard, install };
})();
if (process.versions.electron && process.type === "browser") t3xServerMain.install(require("electron"));
// @node-only
module.exports = t3xServerMain;
