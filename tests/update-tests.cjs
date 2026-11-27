"use strict";
// 宿主自己的更新：版本比较、主进程下载和准备（update-main.cjs）、更新器替换官方版（install.cjs）。
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const pure = require("../host/pure.js");
const updateMain = require("../host/update-main.cjs");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** 和 GitHub 源码包一样带一层外壳目录的 tar.gz。 */
function sourceTarball(dir, pkg) {
  const top = path.join(dir, "pkg", "t3code-extensions-x");
  fs.mkdirSync(top, { recursive: true });
  fs.writeFileSync(path.join(top, "package.json"), JSON.stringify(pkg));
  fs.writeFileSync(path.join(top, "install.cjs"), "");
  const out = path.join(dir, "src.tgz");
  execFileSync("tar", ["-czf", out, "-C", path.join(dir, "pkg"), "t3code-extensions-x"]);
  return fs.readFileSync(out);
}

/** 按地址返回内容的 fetch；记下请求过的地址。 */
function fakeFetch(routes, seen = []) {
  const fetch = async (url) => {
    seen.push(url);
    const body = routes[url];
    if (body === undefined) return new Response("no", { status: 404 });
    if (body instanceof Error) throw body;
    return new Response(body.bytes ?? body, { headers: { "content-length": String(body.length ?? body.bytes.length) } });
  };
  return Object.assign(fetch, { seen });
}

/** 只有 Info.plist 和主程序文件的假 app。 */
function fakeApp(app, version, id = "com.t3tools.t3code") {
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents", "MacOS", "Fake"), "");
  fs.writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleExecutable</key><string>Fake</string></dict></plist>`,
  );
  return app;
}

module.exports = (test) => {
  test("版本比较", () => {
    assert.equal(pure.t3xNewerVersion("0.5.0", "0.4.9"), true);
    assert.equal(pure.t3xNewerVersion("0.10.0", "0.9.0"), true, "按数字比，不按字符串");
    assert.equal(pure.t3xNewerVersion("0.4.0", "0.4.0"), false);
    assert.equal(pure.t3xNewerVersion("0.3.9", "0.4.0"), false);
    for (const bad of ["", "v0.5.0", "0.5", "0.5.0-beta", null, undefined]) assert.equal(pure.t3xNewerVersion(bad, "0.4.0"), false, String(bad));
    assert.equal(pure.t3xNewerVersion("0.5.0", "dev"), false);
  });

  const SHA = "a".repeat(40);
  const REL = { tag: "v0.5.0", sha: SHA };
  const SOURCE = `https://api.github.com/repositories/1471226568/tarball/${SHA}`;

  test("自动更新：主进程按仓库 ID 和提交下载源码包，官方版不对时再下官方安装包", async () => {
    const dir = tmp("t3x-update-");
    try {
      const home = path.join(dir, "home");
      const tgz = sourceTarball(dir, { version: "0.5.0", t3Version: "0.1.12" });
      const OFFICIAL = "https://github.com/pingdotgg/t3code/releases/download/v0.1.12/T3-Code-0.1.12-arm64.zip";
      const root = updateMain.cacheDir(home);
      const [stale, fresh, rescue] = ["work-old", "work-busy", "work-rescue"].map((n) => path.join(root, n));
      for (const d of [stale, fresh, rescue]) fs.mkdirSync(d, { recursive: true });
      fs.mkdirSync(path.join(rescue, "T3 Code Extensions.app")); // 回滚失败时留下的旧版
      const hoursAgo = new Date(Date.now() - 2 * 3600e3);
      for (const d of [stale, rescue]) fs.utimesSync(d, hoursAgo, hoursAgo);
      fs.writeFileSync(path.join(root, "update-result.json"), "{}");

      const steps = [];
      const fetch = fakeFetch({ [SOURCE]: tgz, [OFFICIAL]: Buffer.from("zip") });
      const same = await updateMain.prepare(REL, { fetch, home, arch: "arm64", official: "0.1.12", progress: (p) => steps.push(p.step) });
      assert.deepEqual(fetch.seen, [SOURCE], "官方版已经是 0.1.12 时不下官方包");
      assert.deepEqual(same.args, [path.join(same.work, "source", "install.cjs"), "update", same.work]);
      assert.match(path.basename(same.work), /^work-/);
      assert(fs.existsSync(same.args[0]), "源码包解开时去掉了外壳目录");
      assert(!fs.existsSync(stale), "一小时以上没动的下载目录清掉了");
      assert(fs.existsSync(fresh) && fs.existsSync(path.join(root, "update-result.json")), "可能还在用的下载目录和结果文件不动");
      assert(fs.existsSync(path.join(rescue, "T3 Code Extensions.app")), "放着旧版 app 的下载目录多久都不清");

      const other = await updateMain.prepare(REL, { fetch, home, arch: "arm64", official: "0.1.11", progress: (p) => steps.push(p.step) });
      assert.deepEqual(fetch.seen.slice(1), [SOURCE, OFFICIAL]);
      assert.equal(fs.readFileSync(path.join(other.work, "official.zip"), "utf8"), "zip");
      assert(steps.includes("source") && steps.includes("official"));
      const x64 = fakeFetch({ [SOURCE]: tgz });
      await assert.rejects(updateMain.prepare(REL, { fetch: x64, home, arch: "x64", official: null, progress() {} }), /HTTP 404/);
      assert.equal(x64.seen[1], OFFICIAL.replace("arm64", "x64"), "Intel Mac 下 x64 包；没装官方版也要下");

      const quiet = { home, arch: "arm64", official: "0.1.12", progress() {} };
      for (const tag of ["0.5.0", "v0.5", "v0.5.0/../../x", "main", 1]) await assert.rejects(updateMain.prepare({ tag, sha: SHA }, { ...quiet, fetch }), /版本号无效/, String(tag));
      for (const sha of [undefined, "abc", "A".repeat(40), `${SHA}/x`]) await assert.rejects(updateMain.prepare({ tag: "v0.5.0", sha }, { ...quiet, fetch }), /提交号无效/, String(sha));
      await assert.rejects(updateMain.prepare(null, { ...quiet, fetch }), /版本号无效/);
      await assert.rejects(updateMain.prepare({ tag: "v0.6.0", sha: SHA }, { ...quiet, fetch }), /不是能自动更新/, "包里的版本和 tag 对不上");
      const noT3 = sourceTarball(path.join(dir, "b"), { version: "0.5.0" });
      await assert.rejects(updateMain.prepare(REL, { ...quiet, fetch: fakeFetch({ [SOURCE]: noT3 }) }), /不是能自动更新/, "没写 t3Version 的旧版本");
      await assert.rejects(updateMain.prepare(REL, { ...quiet, fetch: fakeFetch({ [SOURCE]: { bytes: tgz, length: tgz.length + 10 } }) }), /没有下载完整/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("自动更新：更新器报到了才退出 app，起不来或出错时停在 app 里", async () => {
    const dir = tmp("t3x-update-");
    try {
      const home = path.join(dir, "home");
      const tgz = sourceTarball(dir, { version: "0.5.0", t3Version: "0.1.12" });
      const spawned = [];
      let quits = 0;
      let mode = "ready";
      const deps = {
        fetch: fakeFetch({ [SOURCE]: tgz }),
        home,
        arch: "arm64",
        official: "0.1.12",
        execPath: "/fake/electron",
        readyTimeout: 2000,
        spawn: (cmd, args, opts) => {
          spawned.push({ cmd, args, opts });
          const child = Object.assign(new EventEmitter(), { unref() {}, kill() {} });
          process.nextTick(() => {
            child.emit("spawn");
            if (mode !== "die") fs.writeFileSync(path.join(args[2], "ready"), ""); // 像 install.cjs update 那样报到
            if (mode !== "ready") child.emit("exit", 1, null); // die：一启动就出错退出；flake：报到后马上退出
          });
          return child;
        },
        quit: () => (quits += 1),
      };
      const settle = async () => {
        for (let i = 0; i < 400 && updateMain.status().phase === "downloading"; i++) await new Promise((r) => setTimeout(r, 5));
        return updateMain.status();
      };

      assert.throws(() => updateMain.start({ tag: "bad" }, deps) && updateMain.start(REL, deps), /已经在更新/); // 第一次还没出错时第二次被拒
      assert.deepEqual(await settle(), { phase: "error", error: "版本号无效：bad" }, "错误不带 t3x: 前缀");

      for (mode of ["die", "flake"]) {
        updateMain.start(REL, deps);
        assert.match((await settle()).error, /更新器没有起来（1）/, mode);
        assert.equal(quits, 0, `更新器起不来时 app 不退出（${mode}）`);
      }

      mode = "ready";
      updateMain.start(REL, deps);
      assert.equal((await settle()).phase, "restarting");
      assert.equal(quits, 1);
      const { cmd, args, opts } = spawned.at(-1);
      assert.equal(cmd, "/fake/electron");
      assert.deepEqual(args.slice(1), ["update", path.dirname(path.dirname(args[0]))]);
      assert.equal(opts.env.ELECTRON_RUN_AS_NODE, "1");
      assert.equal(opts.env.ELECTRON_NO_ASAR, "1", "更新器要把 app.asar 当普通文件读写");
      assert.equal(opts.detached, true);
      assert(fs.existsSync(path.join(updateMain.cacheDir(home), "update.log")));
      assert.throws(() => updateMain.start(REL, deps), /已经在更新/, "退出前不再开第二次");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("自动更新：更新器只认主进程建的下载目录，别的目录不碰", async () => {
    const { update } = require("../install.cjs");
    const dir = tmp("t3x-work-");
    try {
      fs.writeFileSync(path.join(dir, "keep.txt"), "x");
      await assert.rejects(update(dir), /不是自动更新的下载目录/);
      assert(fs.existsSync(path.join(dir, "keep.txt")));
      // 缓存目录里指向别处的 work-* 链接也不认
      const cache = path.join(os.homedir(), "Library", "Caches", "t3code-extensions");
      const link = path.join(cache, `work-link-${process.pid}`);
      const made = !fs.existsSync(cache);
      fs.mkdirSync(cache, { recursive: true });
      fs.symlinkSync(dir, link);
      try {
        await assert.rejects(update(link), /不是自动更新的下载目录/);
      } finally {
        fs.unlinkSync(link);
        if (made) fs.rmdirSync(cache);
      }
      assert(!fs.existsSync(path.join(dir, "ready")), "没报到：主进程不会退出 app");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("自动更新：上次的结果读一次就删", () => {
    const home = tmp("t3x-update-");
    try {
      assert.equal(updateMain.takeResult(home), null);
      fs.mkdirSync(updateMain.cacheDir(home), { recursive: true });
      const file = path.join(updateMain.cacheDir(home), "update-result.json");
      fs.writeFileSync(file, JSON.stringify({ ok: true, version: "0.5.0" }));
      assert.deepEqual(updateMain.takeResult(home), { ok: true, version: "0.5.0" });
      assert(!fs.existsSync(file));
      fs.writeFileSync(file, "{");
      assert.equal(updateMain.takeResult(home).ok, false);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test("自动更新：窗口里检查新版、确认后轮询进度，出错能重试", async () => {
    const { hostSource } = require("../lib/build.cjs");
    let statuses = [];
    const started = [];
    const bridge = { update: { start: async (tag) => started.push(tag), status: async () => statuses.shift(), result: async () => null } };
    const ctx = vm.createContext({
      bind: { React: { Component: class {}, createElement: (type, props, ...children) => ({ type, props, children }), useSyncExternalStore: (_s, get) => get() }, jsx: {}, choices: () => [], version: "0.4.0" },
      window: { t3xServerBridge: { claim: () => bridge } },
      document: { documentElement: { lang: "zh" } },
      MutationObserver: class {
        observe() {}
      },
      console,
      URL,
      TextDecoder,
      TextEncoder,
      setTimeout,
    });
    vm.runInContext(`${hostSource()}\nthis.api = { checkHostUpdate, startHostUpdate, hostUpdateText, HostVersion, get hostUpdate() { return hostUpdate; } };`, ctx);
    const { api } = ctx;
    let release = "v0.4.0";
    let pkg = {};
    const fetched = [];
    const confirms = [];
    const toasts = [];
    const SHA_V5 = "b".repeat(40);
    ctx.fetchBytes = async (url) => {
      fetched.push(url);
      const body = url.includes("/commits/") ? SHA_V5 : JSON.stringify(url.includes("/contents/") ? pkg : { tag_name: release });
      return new TextEncoder().encode(body);
    };
    ctx.showConfirm = async (message) => (confirms.push(message), confirms.length > 1);
    ctx.showToast = (t) => toasts.push(t);

    // 标题旁的版本行：文字和有没有“检查更新”按钮
    const Button = function Button() {};
    const versionLine = () => {
      const el = api.HostVersion({ ui: { Button } });
      const text = (n) => (n == null ? "" : typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : n.type === Button ? "[按钮]" : text(n.children));
      return text(el.children);
    };
    assert.equal(versionLine(), "T3 Code Extensions 0.4.0[按钮]", "还没查过：只有版本和按钮");
    assert.equal((await api.checkHostUpdate()).state, "latest");
    assert.equal(versionLine(), "T3 Code Extensions 0.4.0 · 已是最新版[按钮]");
    assert.deepEqual(fetched, ["https://api.github.com/repositories/1471226568/releases/latest"], "按仓库 ID 查；不比现在新就不往下读");
    release = "v0.5.0";
    pkg = { version: "0.5.0" };
    assert.match((await api.checkHostUpdate()).error, /不是能自动更新/, "没写 t3Version 的版本不提示");
    assert.deepEqual(fetched.slice(-2), ["https://api.github.com/repositories/1471226568/commits/v0.5.0", `https://api.github.com/repositories/1471226568/contents/package.json?ref=${SHA_V5}`], "package.json 也按仓库 ID 读，读的是 tag 指向的那个提交");
    pkg = { version: "0.5.0", t3Version: "0.1.13" };
    assert.deepEqual({ ...(await api.checkHostUpdate()) }, { state: "available", tag: "v0.5.0", sha: SHA_V5, version: "0.5.0", t3Version: "0.1.13" });
    assert.equal(versionLine(), "T3 Code Extensions 0.4.0 · 有新版 0.5.0[按钮]");

    await api.startHostUpdate(); // 第一次取消
    assert.match(confirms[0], /^更新到 T3 Code Extensions 0\.5\.0？\n.*不是 0\.1\.13 时.*约 230 MB/, "说清楚什么时候要下官方包、多大");
    assert.deepEqual(started, []);
    statuses = [{ phase: "downloading", step: "official", version: "0.1.13", got: 50 << 20, total: 100 << 20 }, { phase: "restarting" }];
    const seen = [];
    const running = api.startHostUpdate();
    await new Promise((r) => setTimeout(r, 100));
    seen.push(api.hostUpdateText(api.hostUpdate));
    await running;
    assert.deepEqual(started.map((r) => ({ ...r })), [{ tag: "v0.5.0", sha: SHA_V5 }], "主进程按确认时的那个提交下载");
    assert.equal(seen[0], "正在下载 官方 T3 Code 0.1.13… 50% · 50 / 100 MB");
    assert.equal(api.hostUpdate.progress.phase, "restarting");
    assert.equal((await api.checkHostUpdate()).progress.phase, "restarting", "更新中不再检查");
    assert.equal(versionLine(), "T3 Code Extensions 0.4.0 · 有新版 0.5.0", "更新中不给检查按钮");

    // 出错：提示条留着，带上原因，可以重试
    vm.runInContext(`hostUpdate = { state: 'available', tag: 'v0.5.0', sha: '${SHA_V5}', version: '0.5.0', t3Version: '0.1.12' };`, ctx);
    statuses = [{ phase: "error", error: "下载失败（HTTP 404）" }];
    await api.startHostUpdate();
    assert.equal(api.hostUpdate.state, "available");
    assert.equal(api.hostUpdate.progress, null);
    assert.equal(api.hostUpdate.error, "下载失败（HTTP 404）");
    assert.deepEqual(toasts.map((t) => [t.type, t.title]), [["error", "更新失败：下载失败（HTTP 404）"]]);
  });

  test("自动更新：替换官方版，比新版还新或者换不了时不动它", () => {
    const { replaceOfficial } = require("../install.cjs");
    const dir = tmp("t3x-official-");
    try {
      const apps = path.join(dir, "Applications");
      const official = path.join(apps, "T3 Code (Beta).app");
      const fresh = () => fakeApp(path.join(dir, `new-${Math.random()}`, "T3 Code (Beta).app"), "0.1.12");

      fakeApp(official, "0.1.11");
      const a = fresh();
      assert.equal(replaceOfficial(a, official), null);
      assert(!fs.existsSync(a));
      assert.match(fs.readFileSync(path.join(official, "Contents", "Info.plist"), "utf8"), /0\.1\.12/);
      assert.deepEqual(fs.readdirSync(apps), ["T3 Code (Beta).app"], "旧版删掉了");

      fs.rmSync(official, { recursive: true });
      fakeApp(official, "0.1.13");
      const b = fresh();
      assert.match(replaceOfficial(b, official), /已经是 0\.1\.13/);
      assert(fs.existsSync(b));

      fs.rmSync(official, { recursive: true });
      fakeApp(official, "0.1.11", "com.example.other");
      assert.match(replaceOfficial(fresh(), official), /不是官方 T3 Code/, "同名的别的 app 不动");
      assert.match(fs.readFileSync(path.join(official, "Contents", "Info.plist"), "utf8"), /com\.example\.other/);

      fs.rmSync(official, { recursive: true });
      const c = fresh();
      assert.equal(replaceOfficial(c, official), null, "没装官方版就放进去");
      assert(fs.existsSync(official));

      fs.rmSync(official, { recursive: true });
      fakeApp(official, "0.1.11");
      fs.chmodSync(apps, 0o555); // 像 macOS 拦下改动那样：改不了「应用程序」
      try {
        assert.match(replaceOfficial(fresh(), official), /没能替换.*EACCES/);
      } finally {
        fs.chmodSync(apps, 0o755);
      }
      assert.match(fs.readFileSync(path.join(official, "Contents", "Info.plist"), "utf8"), /0\.1\.11/, "官方版原样留着");

      // 旧的挪走了、新的放不进去、旧的也放不回：停下这次更新，报出旧版在哪
      const rename = fs.renameSync;
      let n = 0;
      fs.renameSync = (...args) => (++n === 1 ? rename(...args) : (() => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); })());
      try {
        assert.throws(() => replaceOfficial(fresh(), official), /没能把官方版放回原处，原来的官方版在 .*\.t3x-old/);
      } finally {
        fs.renameSync = rename;
      }
      assert(fs.existsSync(path.join(apps, ".T3 Code (Beta).app.t3x-old")), "旧版留在报出的位置");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
};
