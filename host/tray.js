// apiVersion 7：host.tray 让扩展在 macOS 菜单栏放一个图标（manifest 要声明 permissions: ["tray"]），点开是原生菜单（items）
// 或弹出小窗（popover）。图标、菜单由主进程画（tray-main.cjs），扩展 id 由宿主按调用方填。
// 弹出小窗：宿主 window.open 一个 about:blank 小窗（主进程把它做成菜单栏下面的面板），把 T3 窗口的样式和主题照搬过去，
// 扩展的 React 组件经 host.tray.Popover 用 portal 画进去：还在 T3 的 React 树里，hooks、T3 的数据都照常能用。
// 停用、卸载时宿主去掉图标和小窗，T3 窗口关掉、重载时主进程去掉。
const hasTray = (rec) => rec.manifest.permissions?.includes("tray") === true;
const traySelectListeners = new Map(); // 扩展 id -> Set<fn>
const trayPopups = new Map(); // 扩展 id -> { win, root, open, stop, subs }
let trayHooked = false;
const PNG_URL_PREFIX = "data:image/png;base64,";
const ipcText = (error) => String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (?:Error: )?(?:t3x: )?/, "");
// 小窗的底：页面透明（圆角、阴影由扩展的内容画），样式表照搬 T3 的，这几条放最后盖过 T3 给 body 的背景
const POPUP_BASE_CSS = "html,body{margin:0!important;padding:0!important;background:transparent!important;overflow:hidden!important;height:100%}.t3x-popover-root{height:100%}";

function popupOf(id) {
  let p = trayPopups.get(id);
  if (!p) trayPopups.set(id, (p = { win: null, root: null, open: false, stop: null, subs: new Set() }));
  return p;
}
const emitPopup = (p) => {
  for (const fn of [...p.subs]) fn();
};
const subscribePopup = (id) => (fn) => {
  const p = popupOf(id);
  p.subs.add(fn);
  return () => p.subs.delete(fn);
};

function hookTray(tray) {
  if (trayHooked) return;
  trayHooked = true;
  tray.onSelect((extId, itemId) => {
    for (const f of traySelectListeners.get(extId) ?? []) {
      try {
        f(itemId);
      } catch (error) {
        console.error(TAG, extId, "菜单栏点击处理出错", error);
      }
    }
  });
  tray.onPopover?.((extId, open) => {
    const p = trayPopups.get(extId);
    if (!p) return;
    p.open = open === true;
    emitPopup(p);
  });
}

/** 把 T3 窗口 <head> 里的样式表复制到小窗并跟着增删改，<html> 的 class、style、lang、data-*（主题、深浅色）同步过去。 */
function mirrorDocument(doc) {
  const src = document;
  const clones = new Map();
  const base = doc.createElement("style");
  base.textContent = POPUP_BASE_CSS;
  doc.head.appendChild(base);
  const isStyle = (n) => n.nodeName === "STYLE" || (n.nodeName === "LINK" && /\bstylesheet\b/i.test(n.rel ?? ""));
  // 按源 <head> 里的顺序插：同优先级的规则谁在后谁赢，两边顺序要一样
  const add = (n) => {
    if (!isStyle(n) || clones.has(n)) return;
    const c = doc.importNode(n, true);
    clones.set(n, c);
    let next = n.nextElementSibling;
    while (next && !clones.has(next)) next = next.nextElementSibling;
    doc.head.insertBefore(c, next ? clones.get(next) : base);
  };
  const syncRoot = () => {
    const from = src.documentElement;
    const to = doc.documentElement;
    for (const a of [...to.attributes]) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name);
    for (const a of from.attributes) to.setAttribute(a.name, a.value);
  };
  for (const n of src.head.children) add(n);
  syncRoot();
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target === src.documentElement && r.type === "attributes") {
        syncRoot();
        continue;
      }
      if (r.type === "attributes") {
        const c = clones.get(r.target); // 样式节点改了 href、media、disabled 等
        if (c) r.target.hasAttribute(r.attributeName) ? c.setAttribute(r.attributeName, r.target.getAttribute(r.attributeName)) : c.removeAttribute(r.attributeName);
        continue;
      }
      for (const n of r.addedNodes) add(n);
      for (const n of r.removedNodes) {
        clones.get(n)?.remove();
        clones.delete(n);
      }
      const style = r.target.nodeName === "STYLE" ? r.target : r.target.parentNode?.nodeName === "STYLE" ? r.target.parentNode : null;
      if (style && clones.has(style)) clones.get(style).textContent = style.textContent; // 扩展 / T3 改了 <style> 的内容
    }
  });
  mo.observe(src.head, { childList: true, subtree: true, characterData: true, attributes: true });
  mo.observe(src.documentElement, { attributes: true });
  return () => mo.disconnect();
}

/** 给带小窗的图标开 about:blank 小窗（主进程按 t3x-tray:<id>:<开窗口令> 认出来），已经开着就不重开。 */
function ensurePopup(id, size, tray, token) {
  const p = popupOf(id);
  if (p.win && !p.win.closed) return p;
  if (!token) throw new Error(L("开不了菜单栏小窗", "Couldn’t open the menu bar popover")); // 主进程那边小窗还在、这边丢了（不该发生）
  const win = window.open("about:blank", `t3x-tray:${id}:${token}`, `width=${size.width},height=${size.height}`);
  if (!win) throw new Error(L("开不了菜单栏小窗", "Couldn’t open the menu bar popover"));
  const doc = win.document;
  const root = doc.createElement("div");
  root.className = "t3x-popover-root";
  doc.body.appendChild(root);
  p.stop?.();
  p.stop = mirrorDocument(doc);
  // Esc 收起：扩展自己处理了（preventDefault）就不管
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) tray.popover(id, false).catch(() => {});
  });
  Object.assign(p, { win, root, open: false });
  emitPopup(p);
  return p;
}

// 只清这边：窗口由主进程销毁（clear、不带 popover 的 set、窗口关掉时），这里 close() 只会被它当成“收起”
function closePopup(id) {
  const p = trayPopups.get(id);
  if (!p) return;
  p.stop?.();
  Object.assign(p, { win: null, root: null, open: false, stop: null });
  emitPopup(p);
}

function trayApi(rec, life) {
  const id = rec.manifest.id;
  const bridge = () => {
    if (!hasTray(rec)) throw new Error(L('host.tray 要在 permissions 里声明 "tray"', 'host.tray requires the "tray" permission'));
    if (!life.alive) throw new Error(L("扩展已停用", "The extension is disabled"));
    if (!serverBridge?.tray) throw new Error(L("菜单栏只能在 T3 Code Extensions 桌面版里用", "The menu bar is available only in the T3 Code Extensions desktop app."));
    return serverBridge.tray;
  };
  const send = async (fn) => {
    try {
      return await fn();
    } catch (error) {
      throw new Error(ipcText(error));
    }
  };
  // icon：扩展包 assets 里的 PNG 路径，或者扩展自己画的 PNG data URL（比如带状态标签的图标）
  const iconUrl = (icon) => {
    if (icon === undefined || icon === null) return null;
    if (typeof icon === "string" && icon.startsWith(PNG_URL_PREFIX)) return icon;
    const url = typeof icon === "string" && rec.manifest.assets?.includes(icon) && Object.hasOwn(rec.files, icon) ? rec.files[icon] : undefined;
    if (typeof url === "string" && url.startsWith(PNG_URL_PREFIX)) return url;
    throw new Error(L(`icon 要是扩展包里声明的 PNG 或 PNG 的 data URL：${String(icon).slice(0, 80)}`, `icon must be a PNG declared in the extension’s assets or a PNG data URL: ${String(icon).slice(0, 80)}`));
  };
  let shown = false;
  let op = 0; // set / clear 的序号：回执回来时已经有更新的操作，就不再开关本地小窗
  // 同一个扩展的 Popover / usePopover 都用这两个
  const subscribe = subscribePopup(id);
  function Popover({ children }) {
    const root = React.useSyncExternalStore(subscribe, () => trayPopups.get(id)?.root ?? null);
    return root ? bind.portal(children, root) : null;
  }
  return Object.freeze({
    /**
     * 显示或更新菜单栏图标：{ title?, tooltip?, icon?, template?（默认 true，按模板图跟着菜单栏深浅色）,
     *   items?: [{ id, label, detail?, tooltip?, disabled?, separatorBefore? }], popover?: { width, height } }。
     */
    async set({ title, tooltip, icon, template, items, popover } = {}) {
      const tray = bridge();
      const url = iconUrl(icon);
      hookTray(tray);
      if (!shown) {
        shown = true;
        life.disposers.push(() => {
          closePopup(id);
          tray.clear(id).catch((error) => console.error(TAG, id, "去掉菜单栏图标失败", error));
        });
      }
      const mine = ++op;
      const res = await send(() => tray.set(id, { title, tooltip, icon: url, template, items, popover }));
      if (mine !== op || !life.alive) return;
      if (popover) ensurePopup(id, popover, tray, res?.openToken);
      else closePopup(id);
    },
    async clear() {
      const tray = bridge();
      op++;
      closePopup(id);
      return send(() => tray.clear(id));
    },
    /** 原生菜单项被点时调 fn(itemId)；返回取消函数，停用时自动取消。 */
    onSelect(fn) {
      const tray = bridge();
      if (typeof fn !== "function") throw new Error(L("onSelect 需要一个函数", "onSelect needs a function"));
      hookTray(tray);
      const set = traySelectListeners.get(id) ?? new Set();
      traySelectListeners.set(id, set);
      const wrapped = (itemId) => fn(itemId); // 同一个 fn 注册两次也各算一次
      set.add(wrapped);
      const off = () => {
        set.delete(wrapped);
        if (set.size === 0 && traySelectListeners.get(id) === set) traySelectListeners.delete(id);
      };
      life.disposers.push(off);
      return off;
    },
    /** 组件：把 children 画进弹出小窗（还在当前 React 树里，hooks 照常用）。小窗还没开时什么都不画。 */
    Popover,
    /** hook：{ open, close({ focusWindow? }), resize({ width, height }) }。focusWindow 时收起后把 T3 窗口提到前面。 */
    usePopover() {
      const open = React.useSyncExternalStore(subscribe, () => trayPopups.get(id)?.open === true);
      return React.useMemo(
        () => ({
          open,
          close: (opts) => send(() => bridge().popover(id, false, { focusWindow: opts?.focusWindow === true })),
          resize: (size) => send(() => bridge().resize(id, size)),
        }),
        [open],
      );
    },
  });
}
