"use strict";
// apiVersion 7 的菜单栏弹出小窗：主进程把 window.open 的 about:blank 做成面板（tray-main.cjs），窗口里照搬样式、portal 画内容（tray.js）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const trayMain = require("../host/tray-main.cjs");
const { PNG, fakeElectron } = require("./fake-electron.cjs");

const ROOT = path.join(__dirname, "..");
const TOKEN = "T".repeat(24);
const BLANK = (id, token) => ({ url: "about:blank", frameName: `t3x-tray:${id}:${token}` });

/** 够 tray.js 用的假 DOM：节点、属性、head / body、importNode、事件。 */
function fakeDoc() {
  const doc = { listeners: {} };
  class El {
    constructor(name) {
      Object.assign(this, { nodeName: name.toUpperCase(), children: [], attrs: new Map(), parentNode: null, textContent: "", rel: "", className: "" });
    }
    appendChild(c) {
      c.parentNode = this;
      this.children.push(c);
      return c;
    }
    insertBefore(c, ref) {
      c.parentNode = this;
      this.children.splice(this.children.indexOf(ref), 0, c);
      return c;
    }
    remove() {
      this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    get attributes() {
      return [...this.attrs].map(([name, value]) => ({ name, value }));
    }
    setAttribute(n, v) {
      this.attrs.set(n, String(v));
    }
    removeAttribute(n) {
      this.attrs.delete(n);
    }
    hasAttribute(n) {
      return this.attrs.has(n);
    }
    getAttribute(n) {
      return this.attrs.get(n) ?? null;
    }
    get nextElementSibling() {
      const list = this.parentNode?.children ?? [];
      return list[list.indexOf(this) + 1] ?? null;
    }
  }
  doc.createElement = (n) => new El(n);
  doc.importNode = (n) => Object.assign(new El(n.nodeName), { rel: n.rel, textContent: n.textContent, attrs: new Map(n.attrs) });
  doc.addEventListener = (ev, fn) => (doc.listeners[ev] ??= []).push(fn);
  doc.documentElement = new El("html");
  doc.head = doc.documentElement.appendChild(new El("head"));
  doc.body = doc.documentElement.appendChild(new El("body"));
  return doc;
}

function loadTray({ bridge, main, opened, observers }) {
  const src = fs.readFileSync(path.join(ROOT, "host", "tray.js"), "utf8");
  const React = { useSyncExternalStore: (sub, get) => (sub(() => {}), get()), useMemo: (fn) => fn() };
  const bind = { portal: (children, root) => ({ portal: children, root }) };
  const window = {
    open(...args) {
      const win = { args, closed: false, document: fakeDoc(), close() { this.closed = true; } };
      opened.push(win);
      return win;
    },
  };
  class MutationObserver {
    constructor(cb) {
      Object.assign(this, { cb, targets: [] });
      observers.push(this);
    }
    observe(t) {
      this.targets.push(t);
    }
    disconnect() {
      this.dead = true;
    }
  }
  return new Function("serverBridge", "L", "TAG", "React", "bind", "document", "window", "MutationObserver", `${src}\nreturn { trayApi };`)(bridge, (zh) => zh, "[t3x]", React, bind, main, window, MutationObserver);
}

module.exports = (test) => {
  test("弹出小窗（主进程）：只放行带一次性口令的 about:blank，子窗不受信任，做成面板摆在图标下面，失焦、关窗都是收起", () => {
    const { electron, log, trays, sender, popover } = fakeElectron();
    const distrusted = [];
    const m = trayMain.createTrays(electron, (wc) => distrusted.push(wc));
    const w1 = sender(1);
    m.intercept(w1);
    w1.setWindowOpenHandler(() => ({ action: "allow" })); // T3 自己的规则：这里假设它什么都放行
    assert.deepEqual(w1.handler({ url: "https://x.test/", frameName: "" }), { action: "allow" }, "不是 t3x-tray: 的名字照 T3 的规则");
    assert.deepEqual(w1.handler(BLANK("bar", "A".repeat(24))), { action: "deny" }, "t3x-tray: 的名字不交给 T3 的规则：没有口令一律不开");

    const { openToken } = m.set(w1, "bar", { icon: PNG, popover: { width: 360, height: 400 }, items: [{ id: "quit", label: "退出" }] });
    assert.match(openToken, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(m.set(w1, "bar", { icon: PNG, popover: { width: 360, height: 400 }, items: [{ id: "quit", label: "退出" }] }).openToken, openToken, "没用掉之前几次 set 给同一个口令");
    assert.equal(trays[0].menu, null, "有小窗时点图标不弹原生菜单");
    trays[0].emit("right-click");
    assert.deepEqual(log.at(-1), ["popUp", 1], "右键弹原生菜单");
    for (const bad of [{ url: "https://x.test/", frameName: `t3x-tray:bar:${openToken}` }, BLANK("bar", "B".repeat(24)), BLANK("other", openToken), BLANK("bar", "short")]) assert.deepEqual(w1.handler(bad), { action: "deny" }, JSON.stringify(bad));
    const view = sender(9, "webview");
    m.intercept(view);
    assert.deepEqual(view.handler(BLANK("bar", openToken)), { action: "deny" }, "别的 webContents（webview）拿着口令也不行");
    const allowed = w1.handler(BLANK("bar", openToken));
    assert.equal(allowed.action, "allow");
    assert.deepEqual([allowed.overrideBrowserWindowOptions.type, allowed.overrideBrowserWindowOptions.show, allowed.overrideBrowserWindowOptions.width, allowed.overrideBrowserWindowOptions.transparent], ["panel", false, 360, true]);
    assert.deepEqual(w1.handler(BLANK("bar", openToken)), { action: "deny" }, "口令只能用一次：同一窗口里的 iframe 抢不到第二个");

    const other = popover();
    w1.emit("did-create-window", other, { url: "https://x.test/", frameName: "" });
    assert(distrusted.includes(other.webContents) && !other.destroyed, "T3 自己开的子窗也不当主窗口，但不动它");
    const win = popover();
    w1.emit("did-create-window", win, BLANK("bar", openToken));
    assert(distrusted.includes(win.webContents), "小窗不能用宿主的 IPC");
    assert.deepEqual(win.webContents.handler(), { action: "deny" }, "小窗自己不能再开窗口");
    assert.equal(m.set(w1, "bar", { icon: PNG, popover: { width: 360, height: 400 } }).openToken, undefined, "小窗在了就不再发口令");
    const stray = popover();
    w1.emit("did-create-window", stray, BLANK("bar", openToken));
    assert(stray.destroyed, "口令对不上的 t3x-tray: 子窗关掉，不挂到图标上");

    trays[0].emit("click");
    assert(win.visible);
    assert.deepEqual(win.bounds, { x: 1074, y: 30, width: 360, height: 400 }, "图标正下方，右边不出屏幕");
    assert.deepEqual(w1.sent.at(-1), ["t3x:tray:popover", "bar", true]);
    assert.deepEqual(win.allSpaces, [true, { visibleOnFullScreen: true, skipTransformProcessType: true }], "不能让 Electron 藏 Dock：T3 会丢掉菜单栏");
    trays[0].emit("click");
    assert(!win.visible, "再点收起");
    assert.deepEqual(w1.sent.at(-1), ["t3x:tray:popover", "bar", false]);

    m.popover(w1, "bar", true);
    assert(win.visible);
    win.emit("blur");
    assert(!win.visible, "失焦收起");
    assert.deepEqual(w1.sent.at(-1), ["t3x:tray:popover", "bar", false]);
    trays[0].emit("click");
    assert(!win.visible, "点图标导致的失焦：刚收起的不马上又打开");
    const realNow = Date.now;
    Date.now = () => realNow() + 1000;
    try {
      trays[0].emit("click");
    } finally {
      Date.now = realNow;
    }
    assert(win.visible, "过了保护期再点就打开");
    win.close();
    assert(!win.visible && !win.destroyed, "用户关小窗（Cmd+W）只是收起，下次还能点开");
    assert.deepEqual(w1.sent.at(-1), ["t3x:tray:popover", "bar", false]);

    m.resize(w1, "bar", { width: 300, height: 9999 });
    assert.deepEqual([win.bounds.width, win.bounds.height], [300, 760], "大小夹在上限里");
    assert.throws(() => m.resize(w1, "nope", { width: 300, height: 300 }), /没有弹出小窗/);

    m.popover(w1, "bar", true);
    assert(win.visible);
    m.popover(w1, "bar", false, { focusWindow: true });
    assert(!win.visible);
    assert.deepEqual(log.slice(-3), ["show", "focus", ["app.focus", { steal: true }]], "收起后把 T3 窗口提到前面");

    m.popover(w1, "bar", true);
    assert.deepEqual(m.set(w1, "bar", { icon: PNG, items: [{ id: "quit", label: "退出" }] }), {});
    assert(win.destroyed, "不要小窗了就销毁");
    assert.deepEqual(w1.sent.at(-1), ["t3x:tray:popover", "bar", false]);
    assert.deepEqual(trays[0].menu.map((x) => x.label), ["退出"], "去掉小窗后点开就是原生菜单");
    const again = m.set(w1, "bar", { icon: PNG, popover: { width: 360, height: 400 } }).openToken;
    assert(again && again !== openToken, "再要小窗时发新口令");
    const win3 = popover();
    w1.handler(BLANK("bar", again));
    w1.emit("did-create-window", win3, BLANK("bar", again));
    m.clear(w1, "bar");
    assert(trays[0].destroyed && win3.destroyed, "去掉图标时小窗一起销毁");

    const pets = m.set(w1, "pets", { icon: PNG, popover: { width: 360, height: 400 } }).openToken;
    const win2 = popover();
    w1.handler(BLANK("pets", pets));
    w1.emit("did-create-window", win2, BLANK("pets", pets));
    w1.emit("did-navigate");
    assert(win2.destroyed && m.count() === 0, "窗口重载时图标和小窗都去掉");
  });

  test("弹出小窗（窗口里）：照搬 T3 的样式和主题、portal 画内容、Esc 收起、开关状态、停用时关掉", async () => {
    const main = fakeDoc();
    main.documentElement.setAttribute("class", "dark");
    main.documentElement.setAttribute("lang", "zh");
    const css = main.head.appendChild(main.createElement("style"));
    css.textContent = "a{}";
    const link = main.head.appendChild(Object.assign(main.createElement("link"), { rel: "stylesheet" }));
    main.head.appendChild(main.createElement("meta"));
    const calls = [];
    let onPopover = null;
    const bridge = {
      tray: {
        set: async (id, spec) => (calls.push(["set", id, spec.popover ?? null, spec.icon?.slice(0, 22) ?? null]), spec.popover ? { openToken: TOKEN } : {}),
        clear: async (id) => calls.push(["clear", id]),
        popover: async (id, open, opts) => calls.push(["popover", id, open, opts ?? null]),
        resize: async (id, size) => calls.push(["resize", id, size]),
        onSelect: () => {},
        onPopover: (fn) => (onPopover = fn),
      },
    };
    const opened = [];
    const observers = [];
    const { trayApi } = loadTray({ bridge, main, opened, observers });
    const life = { alive: true, disposers: [] };
    const api = trayApi({ manifest: { id: "bar", permissions: ["tray"], assets: ["icon.png"] }, files: { "icon.png": PNG } }, life);

    assert.equal(api.Popover({ children: "内容" }), null, "小窗还没开时什么都不画");
    await api.set({ icon: "icon.png", popover: { width: 360, height: 400 } });
    assert.deepEqual(opened[0].args, ["about:blank", `t3x-tray:bar:${TOKEN}`, "width=360,height=400"], "用主进程发的开窗口令开");
    const doc = opened[0].document;
    const root = doc.body.children[0];
    assert.equal(root.className, "t3x-popover-root");
    assert.deepEqual(api.Popover({ children: "内容" }), { portal: "内容", root }, "portal 进小窗的根节点");
    assert.deepEqual(doc.head.children.map((n) => n.nodeName), ["STYLE", "LINK", "STYLE"], "复制样式表（meta 不要），最后是宿主的底");
    assert.match(doc.head.children.at(-1).textContent, /background:transparent!important/);
    assert.deepEqual(doc.documentElement.attributes, [{ name: "class", value: "dark" }, { name: "lang", value: "zh" }], "深浅色、语言跟着 T3 窗口");

    const mo = observers[0];
    const added = main.head.appendChild(main.createElement("style"));
    added.textContent = ".ext{}";
    mo.cb([{ type: "childList", target: main.head, addedNodes: [added], removedNodes: [] }]);
    assert.deepEqual(doc.head.children.map((n) => n.textContent.slice(0, 6)), ["a{}", "", ".ext{}", "html,b"], "后加的样式插在宿主的底前面");
    css.textContent = "a{color:red}";
    mo.cb([{ type: "characterData", target: { nodeName: "#text", parentNode: css }, addedNodes: [], removedNodes: [] }]);
    assert.equal(doc.head.children[0].textContent, "a{color:red}", "样式内容变了跟着变");
    const early = main.head.insertBefore(main.createElement("style"), css);
    early.textContent = ".early{}";
    mo.cb([{ type: "childList", target: main.head, addedNodes: [early], removedNodes: [] }]);
    assert.deepEqual(doc.head.children.map((n) => n.textContent.slice(0, 6)), [".early", "a{colo", "", ".ext{}", "html,b"], "插在前面的样式在小窗里也在前面（层叠顺序一样）");
    link.setAttribute("media", "print");
    mo.cb([{ type: "attributes", target: link, attributeName: "media", addedNodes: [], removedNodes: [] }]);
    assert.equal(doc.head.children[2].getAttribute("media"), "print", "样式节点的属性（media、href…）跟着改");
    mo.cb([{ type: "childList", target: main.head, addedNodes: [], removedNodes: [link, early] }]);
    assert.equal(doc.head.children.length, 3, "删掉的样式表小窗里也删");
    main.documentElement.setAttribute("class", "light");
    main.documentElement.removeAttribute("lang");
    mo.cb([{ type: "attributes", target: main.documentElement, addedNodes: [], removedNodes: [] }]);
    assert.deepEqual(doc.documentElement.attributes, [{ name: "class", value: "light" }]);

    assert.equal(api.usePopover().open, false);
    onPopover("bar", true);
    assert.equal(api.usePopover().open, true, "主进程说开了");
    doc.listeners.keydown[0]({ key: "Escape", defaultPrevented: false });
    assert.deepEqual(calls.at(-1), ["popover", "bar", false, null], "Esc 收起");
    await api.usePopover().close({ focusWindow: true });
    assert.deepEqual(calls.at(-1), ["popover", "bar", false, { focusWindow: true }]);
    await api.usePopover().resize({ width: 360, height: 300 });
    assert.deepEqual(calls.at(-1), ["resize", "bar", { width: 360, height: 300 }]);

    await api.set({ icon: PNG, template: false, popover: { width: 360, height: 400 } });
    assert.equal(opened.length, 1, "小窗开着就不重开");
    assert.deepEqual(calls.at(-1), ["set", "bar", { width: 360, height: 400 }, "data:image/png;base64,"], "可以直接给扩展自己画的 PNG");
    await assert.rejects(api.set({ icon: "data:image/svg+xml;base64,AAAA" }), /PNG/);
    await api.set({ icon: PNG });
    assert(mo.dead, "不要小窗了：停止同步样式（窗口由主进程销毁）");
    assert.equal(api.Popover({ children: "内容" }), null);

    // set 的回执回来之前又 clear 了：不能再开小窗
    const late = api.set({ icon: PNG, popover: { width: 360, height: 400 } });
    await api.clear();
    await late;
    assert.equal(opened.length, 1, "被 clear 取代的 set 不开小窗");
    assert.deepEqual(calls.at(-1), ["clear", "bar"]);

    await api.set({ icon: PNG, popover: { width: 360, height: 400 } });
    assert.equal(opened.length, 2);
    for (const fn of life.disposers.splice(0).reverse()) fn();
    assert(observers.at(-1).dead && api.Popover({ children: "内容" }) === null, "停用时停止同步样式、不再画");
    assert.deepEqual(calls.at(-1), ["clear", "bar"], "停用时让主进程去掉图标和小窗");
  });
};
