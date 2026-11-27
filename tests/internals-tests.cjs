"use strict";
// apiVersion 8：host.t3（直接读 T3 的 atom）、host.system（通知、剪贴板、打开链接）和主进程的剪贴板通道。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const serverMain = require("../host/server-main.cjs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "host", f), "utf8");
const rec = (permissions) => ({ manifest: { id: "demo", permissions } });
const life = () => ({ alive: true, disposers: [] });
const dispose = (l) => {
  l.alive = false;
  for (const fn of l.disposers.splice(0).reverse()) fn();
};

function loadT3() {
  const subs = new Set();
  const values = new Map();
  const registry = {
    get: (atom) => values.get(atom),
    subscribe: (atom, fn) => {
      const s = { atom, fn };
      subs.add(s);
      return () => subs.delete(s);
    },
  };
  const t3 = { server: { name: "server" }, threads: { threadShellAtom: () => ({}) } };
  const bind = { atoms: { registry, t3 } };
  const useAtomValue = (atom) => ["hook", atom];
  const { t3Api } = new Function("bind", "L", "useAtomValue", `${read("t3.js")}\nreturn { t3Api };`)(bind, (zh) => zh, useAtomValue);
  return { t3Api, subs, values, t3 };
}

function loadSystem({ permission = "granted", opened = true, bridge = true } = {}) {
  const log = [];
  const shown = [];
  class Notification {
    static permission = permission;
    static async requestPermission() {
      log.push("request");
      Notification.permission = "granted";
      return "granted";
    }
    constructor(title, opts) {
      this.title = title;
      this.opts = opts;
      this.listeners = {};
      this.closed = false;
      shown.push(this);
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    close() {
      this.closed = true;
    }
  }
  const window = {
    focus: () => log.push("focus"),
    desktopBridge: { revealWindow: async () => log.push("reveal"), openExternal: async (url) => (log.push(["open", url]), opened) },
  };
  const serverBridge = bridge ? { clipboard: { write: async (text) => log.push(["copy", text]) } } : null;
  const errors = [];
  const console = { error: (...a) => errors.push(a) };
  const { systemApi } = new Function("L", "TAG", "serverBridge", "window", "Notification", "console", `${read("system.js")}\nreturn { systemApi };`)((zh) => zh, "[t3x]", serverBridge, window, Notification, console);
  return { systemApi, log, shown, Notification, errors };
}

module.exports = (test) => {
  test("host.t3（apiVersion 8）：要权限；atoms 是 T3 的原对象、外层冻结；get / subscribe 走 registry，停用时自动取消", () => {
    const { t3Api, subs, values, t3 } = loadT3();
    const denied = t3Api(rec([]), life());
    assert.throws(() => denied.atoms, /t3-internals/);
    assert.throws(() => denied.get({}), /t3-internals/);
    assert.throws(() => denied.useAtom({}), /t3-internals/);

    const l = life();
    const api = t3Api(rec(["t3-internals"]), l);
    assert(Object.isFrozen(api.atoms));
    assert.equal(api.atoms, api.atoms, "每次拿到同一个对象（扩展拿它当 hook 依赖）");
    assert.equal(api.atoms.threads, t3.threads, "里面是 T3 的原对象，不是副本");
    assert(!Object.isFrozen(t3.threads), "不冻结 T3 自己的对象");
    assert.equal("set" in api, false, "不给写");

    const atom = { key: 1 };
    values.set(atom, 42);
    assert.equal(api.get(atom), 42);
    assert.deepEqual(api.useAtom(atom), ["hook", atom]);
    const seen = [];
    const off = api.subscribe(atom, () => seen.push(1));
    api.subscribe(atom, () => {});
    assert.equal(subs.size, 2);
    off();
    assert.equal(subs.size, 1);
    dispose(l);
    assert.equal(subs.size, 0, "停用时取消剩下的订阅");
    api.subscribe(atom, () => {});
    assert.equal(subs.size, 0, "停用后不再订阅");
    assert.throws(() => api.get(atom), /停用/, "停用后晚到的回调读不到");
    assert.throws(() => api.atoms, /停用/);
  });

  test("host.system（apiVersion 8）：通知点了回到 T3 再调 onClick，停用时关掉；剪贴板走主进程；只打开 http / https", async () => {
    const s = loadSystem({ permission: "default" });
    const l = life();
    await assert.rejects(s.systemApi(rec([]), l).copy("x"), /"system"/);
    const api = s.systemApi(rec(["system"]), l);
    for (const bad of [{}, { title: " " }, { title: "x".repeat(201) }, { title: "t", body: 1 }, { title: "t", onClick: 1 }]) await assert.rejects(api.notify(bad), /title|body|onClick/, JSON.stringify(bad));
    let clicks = 0;
    const close = await api.notify({ title: "完成", body: "会话", onClick: () => clicks++ });
    assert.deepEqual(s.log, ["request"], "还没授权时先请求");
    assert.deepEqual([s.shown[0].title, s.shown[0].opts], ["完成", { body: "会话", silent: false }]);
    await s.shown[0].listeners.click();
    assert.equal(clicks, 1);
    assert.equal(s.shown[0].closed, true);
    assert.deepEqual(s.log.slice(1), ["focus", "reveal"]);
    await api.notify({ title: "二", onClick: async () => Promise.reject(new Error("坏了")) });
    await s.shown[1].listeners.click();
    assert.equal(s.errors.length, 1, "async 的 onClick 出错记下来，不变成未处理的 rejection");
    await api.notify({ title: "三" });
    const late = s.shown[2].listeners.click;
    close(); // 已经关掉的再关一次没事
    dispose(l);
    assert.deepEqual(s.shown.map((n) => n.closed), [true, true, true], "停用时关掉还在的通知");
    const before = s.log.length;
    await late();
    assert.equal(s.log.length, before, "停用前排队的点击不再把 T3 提到前面");
    await assert.rejects(api.notify({ title: "晚了" }), /停用/);

    const denied = loadSystem({ permission: "denied" });
    await assert.rejects(denied.systemApi(rec(["system"]), life()).notify({ title: "t" }), /授权/);

    const c = loadSystem();
    const sys = c.systemApi(rec(["system"]), life());
    await sys.copy("你好");
    await assert.rejects(sys.copy(1), /text/);
    await assert.rejects(loadSystem({ bridge: false }).systemApi(rec(["system"]), life()).copy("x"), /桌面版/);
    await sys.openExternal("https://example.com/a b");
    // mailto 也不收：T3 0.1.13 的主进程只放行 http / https，交过去一定失败
    for (const bad of ["mailto:someone@example.com", "file:///etc/passwd", "javascript:alert(1)", "not a url", `https://e.com/${"x".repeat(8200)}`, 1]) await assert.rejects(sys.openExternal(bad), /http/, String(bad).slice(0, 40));
    assert.deepEqual(c.log, [["copy", "你好"], ["open", "https://example.com/a%20b"]]);
    await assert.rejects(loadSystem({ opened: false }).systemApi(rec(["system"]), life()).openExternal("https://e.com"), /没能打开/);
  });

  test("主进程剪贴板（apiVersion 8）：只收文字，有长度上限，写完（或写失败）才回给窗口", async () => {
    const written = [];
    let finish;
    const clipboard = { writeText: (t) => (written.push(t), t === "bad" ? Promise.reject(new Error("写不进去")) : new Promise((r) => (finish = r))) };
    let done = false;
    const pending = serverMain.writeClipboard(clipboard, "abc").then(() => (done = true));
    await Promise.resolve();
    assert.equal(done, false, "Electron 44 的 writeText 是 Promise：没写完不算完成");
    finish();
    await pending;
    await assert.rejects(serverMain.writeClipboard(clipboard, "bad"), /写不进去/);
    assert.throws(() => serverMain.writeClipboard(clipboard, { toString: () => "x" }), /text/);
    assert.throws(() => serverMain.writeClipboard(clipboard, "x".repeat((4 << 20) + 1)), /text/);
    assert.deepEqual(written, ["abc", "bad"]);
  });
};
