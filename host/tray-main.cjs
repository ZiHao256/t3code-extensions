/* T3X_TRAY_MAIN_V1 */
// 追加到 T3 Electron 主进程（main.cjs）末尾，接在 server-main.cjs 后面（apiVersion 7）：
//   菜单栏（host.tray）：每个扩展最多一个图标，内容由窗口里的宿主按扩展交来（扩展 id 由宿主填）。
//     两种点开方式：原生菜单（items），或者弹出小窗（popover）：窗口里的宿主用 window.open 开一个 about:blank 小窗，
//     这里把它做成不抢焦点的 macOS 面板，点图标时摆到图标下面，失焦收起；内容由扩展用 React portal 画进去（tray.js）。
//     窗口关掉、重载或崩溃时它的图标和小窗一起去掉。
//   会话最新回复（host.agent.replies）：只读打开 T3 自己的 statev2.sqlite，取每个会话最后一条说完的 agent 回复。
const t3xTrayMain = (() => {
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const ID_RE = /^[a-z0-9][a-z0-9.-]{1,63}$/;
  const ITEM_ID_RE = /^[\w.:-]{1,128}$/;
  // 小窗的 frame 名：t3x-tray:<扩展 id>:<主进程发的一次性开窗口令>。同一窗口里的 iframe 也能 window.open，只认得口令的宿主能开
  const POPOVER_FRAME_RE = /^t3x-tray:([a-z0-9][a-z0-9.-]{1,63}):([A-Za-z0-9_-]{24})$/;
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const PNG_PREFIX = "data:image/png;base64,";
  const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
  // 图标按 2x 显示：宽 512、高 64 像素是 256×32 点，够画“图标 + 状态标签”
  const LIMIT = { items: 60, title: 40, tooltip: 1000, label: 120, detail: 120, icon: 64 << 10, iconW: 512, iconH: 64 };
  const POPOVER = { minW: 240, maxW: 560, minH: 60, maxH: 760, gap: 6, reopenMs: 300 };
  const fail = (msg) => {
    throw new Error(`t3x: ${msg}`);
  };
  const oneLine = (s) => s.replace(/\s+/g, " ").trim();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** 解码前先看 PNG 头：签名对、宽高在上限内，免得一张小文件解压成巨图。 */
  function checkPng(icon) {
    const b64 = typeof icon === "string" && icon.startsWith(PNG_PREFIX) ? icon.slice(PNG_PREFIX.length) : "";
    if (b64.length > Math.ceil(LIMIT.icon / 3) * 4 || !BASE64_RE.test(b64)) fail("icon 需要是不超过 64 KB 的 PNG");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > LIMIT.icon) fail("icon 需要是不超过 64 KB 的 PNG");
    const png = bytes.length > 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.readUInt32BE(8) === 13 && bytes.toString("latin1", 12, 16) === "IHDR";
    if (!png) fail("icon 不是 PNG");
    const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    if (!w || !h || w > LIMIT.iconW || h > LIMIT.iconH) fail(`icon 不能超过 ${LIMIT.iconW}×${LIMIT.iconH} 像素`);
  }

  function checkSize(v, key) {
    if (!v || typeof v !== "object" || !Number.isFinite(v.width) || !Number.isFinite(v.height)) fail(`${key} 需要是 { width, height }`);
    return { width: Math.round(clamp(v.width, POPOVER.minW, POPOVER.maxW)), height: Math.round(clamp(v.height, POPOVER.minH, POPOVER.maxH)) };
  }

  /** 窗口交来的菜单栏内容按不可信处理：只留认识的字段，类型、条数、长度都有上限。 */
  function checkSpec(spec) {
    if (!spec || typeof spec !== "object") fail("菜单栏内容无效");
    const text = (v, key, max) => {
      if (v === undefined || v === null) return "";
      if (typeof v !== "string" || v.length > max) fail(`${key} 需要是不超过 ${max} 字的字符串`);
      return v;
    };
    const title = oneLine(text(spec.title, "title", LIMIT.title));
    const tooltip = text(spec.tooltip, "tooltip", LIMIT.tooltip);
    const icon = spec.icon ?? null;
    if (icon !== null) checkPng(icon);
    if (!icon && !title) fail("title 和 icon 至少要有一个");
    const list = spec.items ?? [];
    if (!Array.isArray(list) || list.length > LIMIT.items) fail(`items 需要是不超过 ${LIMIT.items} 项的数组`);
    const items = list.map((it, i) => {
      if (!it || typeof it !== "object") fail(`第 ${i + 1} 项无效`);
      if (typeof it.id !== "string" || !ITEM_ID_RE.test(it.id)) fail(`第 ${i + 1} 项的 id 无效`);
      const label = oneLine(text(it.label, "label", LIMIT.label));
      if (!label) fail(`第 ${i + 1} 项没有 label`);
      return {
        id: it.id,
        label,
        detail: oneLine(text(it.detail, "detail", LIMIT.detail)),
        tooltip: text(it.tooltip, "tooltip", LIMIT.tooltip),
        disabled: it.disabled === true,
        separatorBefore: it.separatorBefore === true,
      };
    });
    const popover = spec.popover === undefined || spec.popover === null ? null : checkSize(spec.popover, "popover");
    return { title, tooltip, icon, template: spec.template !== false, items, popover };
  }

  /** Electron 菜单模板：detail 是第二行小字（macOS 的 sublabel），tooltip 是悬停说明。 */
  function menuTemplate(items, onSelect) {
    return items.flatMap((it, i) => [
      ...(it.separatorBefore && i > 0 ? [{ type: "separator" }] : []),
      {
        label: it.label,
        ...(it.detail ? { sublabel: it.detail } : {}),
        ...(it.tooltip ? { toolTip: it.tooltip } : {}),
        enabled: !it.disabled,
        click: () => onSelect(it.id),
      },
    ]);
  }

  /** 弹出小窗：无边框、透明、不抢焦点的面板（type: panel），不进 Dock / 窗口列表，不能拖动、缩放。 */
  const popoverOptions = (size) => ({
    ...size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    type: "panel",
    hasShadow: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  });

  /**
   * 每个窗口、每个扩展一个图标。图标当 2x 图用：36×36 像素显示成 18 点；template 时按模板图跟着菜单栏的深浅色。
   * 带 popover 的图标：点一下开关小窗，右键（有 items 时）弹原生菜单；不带的点开就是原生菜单。
   */
  function createTrays(electron, distrust) {
    const trays = new Map(); // `${窗口 id}:${扩展 id}` -> { tray, icon, template, menu, size, popover, hiddenAt, sender, id, openToken, expect }
    const watched = new Set(); // 已经挂了清理监听的窗口 id
    const image = (icon, template) => {
      const img = electron.nativeImage.createEmpty();
      if (!icon) return img;
      img.addRepresentation({ scaleFactor: 2, dataURL: icon });
      if (img.isEmpty()) fail("icon 解不出图片");
      img.setTemplateImage(template);
      return img;
    };
    // 小窗只由这里销毁（destroy 不触发 close）；用户关它（比如 Cmd+W）只是收起，见 attach
    const kill = (t) => {
      if (t.popover && !t.popover.isDestroyed()) {
        t.popover.destroy();
        notify(t, false);
      }
      t.popover = null;
    };
    const drop = (key) => {
      const t = trays.get(key);
      if (!t) return;
      trays.delete(key);
      t.tray.destroy();
      kill(t);
    };
    const clearWindow = (wid) => {
      for (const key of [...trays.keys()]) if (key.startsWith(`${wid}:`)) drop(key);
    };
    const watch = (sender) => {
      const wid = sender.id; // 销毁后再读 id 会抛错，先记下
      if (watched.has(wid)) return;
      watched.add(wid);
      const gone = () => clearWindow(wid);
      sender.once("destroyed", () => {
        gone();
        watched.delete(wid);
      });
      sender.on("did-navigate", gone); // 重载：新页面里的宿主会重新交内容
      sender.on("render-process-gone", gone);
    };
    // 点菜单栏不会激活 app：要把 T3 窗口提到前面
    const focusWindow = (sender) => {
      const win = electron.BrowserWindow.fromWebContents(sender);
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      electron.app.focus({ steal: true });
    };
    const select = (sender, id, itemId) => {
      if (sender.isDestroyed()) return;
      focusWindow(sender);
      sender.send("t3x:tray:select", id, itemId);
    };
    const notify = (t, open) => {
      if (!t.sender.isDestroyed()) t.sender.send("t3x:tray:popover", t.id, open);
    };
    const hide = (t) => {
      if (!t.popover || t.popover.isDestroyed() || !t.popover.isVisible()) return;
      t.popover.hide();
      t.hiddenAt = Date.now();
      notify(t, false);
    };
    // 摆在图标正下方，左右不出屏幕
    const place = (t) => {
      const b = t.tray.getBounds();
      const wa = electron.screen.getDisplayMatching(b).workArea;
      const { width, height } = t.size;
      const x = clamp(Math.round(b.x + b.width / 2 - width / 2), wa.x + POPOVER.gap, wa.x + wa.width - width - POPOVER.gap);
      t.popover.setBounds({ x, y: Math.round(b.y + b.height + POPOVER.gap), width, height });
    };
    const show = (t) => {
      if (!t.popover || t.popover.isDestroyed()) return;
      place(t);
      t.popover.show();
      t.popover.focus();
      notify(t, true);
    };
    // 点图标时小窗先失焦收起、再收到这次点击：刚收起的不要马上又打开
    const toggle = (key) => {
      const t = trays.get(key);
      if (!t?.size) return;
      if (t.popover?.isVisible()) return hide(t);
      if (Date.now() - t.hiddenAt < POPOVER.reopenMs) return;
      show(t);
    };

    function set(sender, id, spec) {
      if (typeof id !== "string" || !ID_RE.test(id)) fail("扩展 id 无效");
      const s = checkSpec(spec);
      watch(sender);
      const key = `${sender.id}:${id}`;
      let t = trays.get(key);
      const img = !t || t.icon !== s.icon || t.template !== s.template ? image(s.icon, s.template) : null; // 先解图：解不出就报错，不留下空图标
      if (!t) {
        t = { tray: new electron.Tray(img), icon: s.icon, template: s.template, menu: null, size: null, popover: null, hiddenAt: 0, sender, id, openToken: null, expect: null };
        trays.set(key, t);
        t.tray.on("click", () => toggle(key));
        t.tray.on("right-click", () => {
          const cur = trays.get(key);
          if (cur?.size && cur.menu) cur.tray.popUpContextMenu(cur.menu);
        });
      } else if (img) {
        t.tray.setImage(img);
        Object.assign(t, { icon: s.icon, template: s.template });
      }
      t.tray.setTitle(s.title);
      t.tray.setToolTip(s.tooltip);
      t.menu = s.items.length ? electron.Menu.buildFromTemplate(menuTemplate(s.items, (itemId) => select(sender, id, itemId))) : null;
      t.size = s.popover;
      // 有小窗时点图标开小窗，原生菜单只在右键弹；没有小窗时点开就是原生菜单
      t.tray.setContextMenu(t.size ? null : t.menu);
      if (!t.size) {
        kill(t);
        t.openToken = null;
        return {};
      }
      if (t.popover && !t.popover.isDestroyed()) {
        if (t.popover.isVisible()) place(t);
        else t.popover.setSize(t.size.width, t.size.height);
        return {};
      }
      // 还没有小窗：给窗口里的宿主一个开窗口令（没用掉之前一直是同一个，几次 set 叠在一起也不冲突）
      t.openToken ??= crypto.randomBytes(18).toString("base64url");
      return { openToken: t.openToken };
    }

    function clear(sender, id) {
      if (typeof id !== "string" || !ID_RE.test(id)) fail("扩展 id 无效");
      drop(`${sender.id}:${id}`);
    }

    /** 窗口里的宿主开的 about:blank 小窗（did-create-window）：挂到它的图标上；没有对应的带小窗图标就关掉。 */
    function attach(t, win) {
      if (trays.get(`${t.sender.id}:${t.id}`) !== t || !t.size || (t.popover && !t.popover.isDestroyed())) return win.destroy();
      t.popover = win;
      // 不带 skipTransformProcessType 时 Electron 会 app.dock.hide()：T3 变成没有 Dock 图标、没有菜单栏的后台 App
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.on("blur", () => hide(t));
      // 用户关小窗（Cmd+W 等）只收起：窗口里的宿主还拿着它画内容，关掉了图标就再也点不开
      win.on("close", (event) => {
        event.preventDefault();
        hide(t);
      });
      win.on("closed", () => {
        if (t.popover === win) t.popover = null;
      });
    }

    /** 窗口里改小窗大小（扩展按内容高度调）。 */
    function resize(sender, id, size) {
      const t = trays.get(`${sender.id}:${id}`);
      if (!t?.size) fail("这个图标没有弹出小窗");
      t.size = checkSize(size, "size");
      if (t.popover && !t.popover.isDestroyed()) {
        if (t.popover.isVisible()) place(t);
        else t.popover.setSize(t.size.width, t.size.height);
        t.popover.invalidateShadow?.(); // 透明窗口的阴影按内容算，大小变了要重算（只有 macOS 有）
      }
    }

    /** 窗口里开关小窗；focusWindow 时收起后把 T3 窗口提到前面（比如在小窗里点了会话）。 */
    function popover(sender, id, open, opts) {
      const t = trays.get(`${sender.id}:${id}`);
      if (!t?.size) fail("这个图标没有弹出小窗");
      if (open === true) show(t);
      else hide(t);
      if (open !== true && opts?.focusWindow === true) focusWindow(sender);
    }

    /**
     * 拦截 T3 窗口里的 window.open：t3x-tray: 开头的名字只放行带着有效开窗口令的 about:blank（口令用一次就作废），
     * 其余照 T3 自己的规则。开出来的子窗一律不当 T3 主窗口（distrust），不能用宿主的 IPC。
     */
    function intercept(wc) {
      const parse = (details) => {
        const m = POPOVER_FRAME_RE.exec(details?.frameName ?? "");
        const t = m && details.url === "about:blank" && wc.getType() === "window" ? trays.get(`${wc.id}:${m[1]}`) : null;
        return t ? { t, token: m[2] } : null;
      };
      const original = wc.setWindowOpenHandler.bind(wc);
      let theirs = null;
      const handler = (details) => {
        if (!String(details?.frameName ?? "").startsWith("t3x-tray:")) return theirs ? theirs(details) : { action: "allow" }; // T3 没设过时和 Electron 默认一样放行
        const hit = parse(details);
        if (!hit?.t.size || !hit.t.openToken || hit.token !== hit.t.openToken) return { action: "deny" };
        hit.t.openToken = null;
        hit.t.expect = hit.token;
        return { action: "allow", overrideBrowserWindowOptions: popoverOptions(hit.t.size) };
      };
      wc.setWindowOpenHandler = (fn) => {
        theirs = fn;
        original(handler);
      };
      original(handler);
      wc.on("did-create-window", (win, details) => {
        distrust(win.webContents);
        const hit = parse(details);
        if (!hit || hit.token !== hit.t.expect) {
          if (String(details?.frameName ?? "").startsWith("t3x-tray:")) win.destroy(); // 上面不会放行它；万一有，也不留着
          return;
        }
        hit.t.expect = null;
        attach(hit.t, win);
      });
    }

    return { set, clear, attach, resize, popover, intercept, count: () => trays.size };
  }

  // 最新回复：T3 后台（不是我们）写这个库；我们只读，每次现开现关，不长期占着连接。
  // 只有本机环境的会话在这个库里：environmentId 要等于 T3 桌面版的本机环境 id（<数据目录>/environment-id）。
  // 会话 id 有 uuid，也有 import:codex:…、thread:subagent:…、带 %3A 的委派任务 id；只做参数绑定，不拼进 SQL
  const REPLY = { threads: 200, text: 2000, id: 512 };
  // 删除了但消息还留着的会话（T3 清理时会为还有分叉、待办的会话保留内容）不给；正文在 SQL 里先截一段，不把整篇读进主进程
  const REPLY_SQL = `SELECT substr(json_extract(m.payload_json, '$.text'), 1, 4000) AS text, m.created_at AS at
    FROM orchestration_v2_projection_messages m
    WHERE m.thread_id = ? AND m.role = 'assistant' AND m.streaming = 0
      AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_threads t WHERE t.thread_id = m.thread_id AND t.deleted_at IS NOT NULL)
    ORDER BY m.created_at DESC, m.message_id DESC LIMIT 1`;

  /** threads：[{ environmentId, threadId }]；返回 { [threadId]: { text, at } }，没有回复、不是本机环境的不在里面。 */
  function replies(stateDir, threads) {
    if (!Array.isArray(threads) || threads.length > REPLY.threads) fail(`threads 需要是不超过 ${REPLY.threads} 项的数组`);
    for (const t of threads) {
      if (typeof t?.environmentId !== "string" || typeof t.threadId !== "string" || !t.threadId || t.threadId.length > REPLY.id) fail("会话参数无效");
    }
    let local;
    try {
      local = fs.readFileSync(path.join(stateDir, "environment-id"), "utf8").trim();
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
    const ids = [...new Set(threads.filter((t) => t.environmentId === local).map((t) => t.threadId))];
    const file = path.join(stateDir, "statev2.sqlite");
    if (ids.length === 0 || !fs.existsSync(file)) return {};
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const q = db.prepare(REPLY_SQL);
      const out = {};
      for (const id of ids) {
        const row = q.get(id);
        const text = typeof row?.text === "string" ? row.text.trim() : "";
        if (text) out[id] = { text: text.length > REPLY.text ? `${text.slice(0, REPLY.text - 1)}…` : text, at: row.at };
      }
      return out;
    } finally {
      db.close();
    }
  }

  function install(electron, server) {
    const stateDir = path.dirname(server.serverDir(process.env, os.homedir(), !electron.app.isPackaged));
    const trays = createTrays(electron, server.distrust);
    // 托盘要知道是哪个窗口发来的（点击时回给它、窗口关了一起清）：自己核对来源，不用 guard
    const own = (fn) => (event, ...args) => {
      if (!server.trusted(event)) fail("只接受主窗口的请求");
      return fn(event.sender, ...args);
    };
    electron.ipcMain.handle("t3x:tray:set", own((sender, id, spec) => trays.set(sender, id, spec)));
    electron.ipcMain.handle("t3x:tray:clear", own((sender, id) => trays.clear(sender, id)));
    electron.ipcMain.handle("t3x:tray:resize", own((sender, id, size) => trays.resize(sender, id, size)));
    electron.ipcMain.handle("t3x:tray:popover", own((sender, id, open, opts) => trays.popover(sender, id, open, opts)));
    // 在 T3 自己设 window.open 规则之前包上一层（T3 在 new BrowserWindow 之后才设）
    electron.app.on("web-contents-created", (_event, wc) => trays.intercept(wc));
    electron.ipcMain.handle("t3x:agent:replies", server.guard((threads) => replies(stateDir, threads)));
  }

  return { checkSpec, menuTemplate, createTrays, replies, install };
})();
if (process.versions.electron && process.type === "browser") t3xTrayMain.install(require("electron"), t3xServerMain);
// @node-only
module.exports = t3xTrayMain;
