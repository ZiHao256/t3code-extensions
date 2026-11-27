"use strict";
// 菜单栏测试共用：真的 PNG、假的 Electron（托盘、菜单、窗口、屏幕都只记下调用）。
const zlib = require("node:zlib");

/** 真的 PNG（全透明），宽高可调。 */
function png(w, h) {
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(td.length + 8);
    out.writeUInt32BE(data.length, 0);
    td.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(td), td.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
const PNG = png(36, 36);
const BROKEN = png(8, 8); // 假 Electron 当它解不出图

const emitter = () => {
  const on = {};
  return { on: (ev, fn) => (on[ev] ??= []).push(fn), once: (ev, fn) => (on[ev] ??= []).push(fn), emit: (ev, ...a) => (on[ev] ?? []).forEach((fn) => fn(...a)) };
};

/** 假的弹出小窗（BrowserWindow）。 */
function fakeWindow(log) {
  const ev = emitter();
  const wc = { ...emitter(), handler: null, setWindowOpenHandler(h) { this.handler = h; } };
  return {
    ...ev,
    webContents: wc,
    visible: false,
    destroyed: false,
    bounds: null,
    isVisible() { return this.visible; },
    isDestroyed() { return this.destroyed; },
    show() { this.visible = true; log.push("popover.show"); },
    hide() { this.visible = false; log.push("popover.hide"); },
    focus() { log.push("popover.focus"); },
    setBounds(b) { this.bounds = b; },
    setSize(w, h) { this.bounds = { ...this.bounds, width: w, height: h }; },
    setVisibleOnAllWorkspaces(v, opts) { this.allSpaces = [v, opts]; },
    invalidateShadow() {},
    destroy() { this.destroyed = true; this.visible = false; ev.emit("closed"); },
    // 用户关窗（Cmd+W）：先发 close，没被拦下才真的关
    close() {
      let prevented = false;
      ev.emit("close", { preventDefault: () => (prevented = true) });
      if (!prevented) this.destroy();
    },
  };
}

/** 假的 Electron：记下托盘、窗口和 app 收到的调用。 */
function fakeElectron() {
  const log = [];
  const trays = [];
  class Tray {
    constructor(img) {
      Object.assign(this, emitter());
      this.img = img;
      trays.push(this);
    }
    setImage(img) {
      this.img = img;
      log.push("setImage");
    }
    setTitle(t) {
      this.title = t;
    }
    setToolTip(t) {
      this.tooltip = t;
    }
    setContextMenu(m) {
      this.menu = m?.template ?? null;
    }
    popUpContextMenu(m) {
      log.push(["popUp", m.template.length]);
    }
    getBounds() {
      return { x: 1400, y: 0, width: 30, height: 24 };
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const nativeImage = {
    // 只认测试里的真 PNG：模拟 Electron 解不出图时 isEmpty() 为真
    createEmpty: () => ({ reps: [], addRepresentation(r) { if (r.dataURL !== BROKEN) this.reps.push(r); }, isEmpty() { return this.reps.length === 0; }, setTemplateImage(v) { this.template = v; } }),
  };
  const win = { minimized: true, isDestroyed: () => false, isMinimized() { return this.minimized; }, restore() { this.minimized = false; log.push("restore"); }, show: () => log.push("show"), focus: () => log.push("focus") };
  const electron = {
    Tray,
    nativeImage,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    BrowserWindow: { fromWebContents: (wc) => wc.win },
    app: { focus: (o) => log.push(["app.focus", o]) },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } }) },
  };
  const sender = (id, type = "window") => ({ ...emitter(), id, win, sent: [], destroyed: false, handler: null, getType: () => type, isDestroyed() { return this.destroyed; }, send(...a) { this.sent.push(a); }, setWindowOpenHandler(h) { this.handler = h; } });
  return { electron, log, trays, sender, popover: () => fakeWindow(log) };
}

module.exports = { png, PNG, BROKEN, fakeElectron };
