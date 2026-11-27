// 扩展宿主核心。构建时和 settings.js 一起包进同一个函数，追加到 T3 Code 的 ThreadRouteView 模块末尾（_chat 静态导入它）。
// 作用域里有 bind（T3 自己的 React、jsx 运行时、推理档位选项函数，以及 agent.js 用的会话命令和列表 hook）。

const { React } = bind;

// ---------- 存储：IndexedDB 持久化 + 内存缓存（读同步，写异步） ----------

const cache = new Map();
const keyWatchers = new Map();
let dbPromise = null;
// 启动时读失败就只用内存：这时写回去会用默认值覆盖掉读不到的已有数据。
let persistent = true;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("t3x", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function loadStore() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readonly");
    const keys = tx.objectStore("kv").getAllKeys();
    const values = tx.objectStore("kv").getAll();
    tx.oncomplete = () => {
      keys.result.forEach((k, i) => cache.set(k, values.result[i]));
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

const store = {
  get: (key, fallback) => (cache.has(key) ? cache.get(key) : fallback),
  /** 先改内存再异步写盘；返回写盘完成的 Promise，安装、卸载这类需要确认落盘的操作要等它。 */
  set(key, value) {
    if (value === undefined) cache.delete(key);
    else cache.set(key, value);
    keyWatchers.get(key)?.forEach((fn) => fn(value));
    if (!persistent) {
      const failed = Promise.reject(new Error(L("扩展数据没能读出，本次修改只在内存里，重启后丢失", "Couldn’t load extension data. Changes made now will be lost when you restart.")));
      failed.catch(() => {}); // 只给等它的调用方看；不等的不报未处理的拒绝
      return failed;
    }
    const saved = openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite");
          if (value === undefined) tx.objectStore("kv").delete(key);
          else tx.objectStore("kv").put(value, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );
    saved.catch((error) => console.error(TAG, "保存失败", key, error));
    return saved;
  },
  subscribe(key, fn) {
    if (!keyWatchers.has(key)) keyWatchers.set(key, new Set());
    keyWatchers.get(key).add(fn);
    return () => keyWatchers.get(key).delete(fn);
  },
};

// 用 useSyncExternalStore：读值和订阅之间有变化也不会漏掉。快照取缓存里的原值（缺省时 undefined），保持引用稳定。
function useStored(key, fallback) {
  const value = React.useSyncExternalStore(
    React.useCallback((fn) => store.subscribe(key, fn), [key]),
    () => cache.get(key),
  );
  return value === undefined ? fallback : value;
}

// ---------- 扩展记录与挂载点 ----------

const records = new Map(); // id -> { manifest, files, source, status, error, settings, dispose }
const slotEntries = Object.fromEntries(Object.keys(SLOTS).map((s) => [s, []]));
const hostWatchers = new Set();
let hostVersion = 0;
let lastChat = null;
let ready = false;
let regSeq = 0;
let runSeq = 0;

function bump() {
  hostVersion += 1;
  for (const fn of hostWatchers) fn(hostVersion);
  queueServerSync(); // 装卸、启停都会走到这里；后台扩展集合没变时什么都不做
}

function subscribeHost(fn) {
  hostWatchers.add(fn);
  return () => hostWatchers.delete(fn);
}

// 档位面板不在聊天视图里，要知道当前会话属于哪个项目：订阅聊天视图上报的 lastChat。
const chatWatchers = new Set();
let chatCtxKey = "";
function bumpChat() {
  const key = `${lastChat?.environmentId}|${lastChat?.projectId}`;
  if (key === chatCtxKey) return; // 只在会话换了项目或环境时通知
  chatCtxKey = key;
  for (const fn of chatWatchers) fn();
}
function subscribeChat(fn) {
  chatWatchers.add(fn);
  return () => chatWatchers.delete(fn);
}

function useHostVersion() {
  return React.useSyncExternalStore(subscribeHost, () => hostVersion);
}

function subscribeLang(fn) {
  const mo = new MutationObserver(() => fn());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  return () => mo.disconnect();
}
/** 组件里调用一次：切语言时重新渲染（T3 的组件有缓存，不一定会带着我们一起重绘）。 */
const useLang = () => React.useSyncExternalStore(subscribeLang, () => (isZh() ? "zh" : "en"));
/** plugin.json 里的 name / description 可以在 locales.en / locales.zh 里给另一种语言的版本。 */
// 旧版宿主装的扩展没校验过 locales：不是非空字符串就退回顶层字段，别让一行渲染失败。
const localized = (manifest, key) => {
  const v = manifest.locales?.[isZh() ? "zh" : "en"]?.[key];
  return typeof v === "string" && v.trim() ? v : manifest[key];
};

/** 全局开关（设置页作用域为“所有项目、所有环境”时的那个）。 */
function isEnabled(rec) {
  const flag = store.get("t3x:enabled", {})[rec.manifest.id];
  // 安装时都会写 true；没有这个键的只有旧版宿主里“覆盖内置版本”的那份，旧版默认启用它。
  return flag ?? true;
}

// 按项目、按环境的开关：t3x:scoped = { 扩展 id: { "proj:环境:项目" | "env:环境": true/false } }。只管启用，扩展自己的设置全局共用。
const scopedOf = (id) => store.get("t3x:scoped", {})[id] ?? {};
/** 在某个会话（{ environmentId, projectId }）里是否生效。 */
const enabledAt = (rec, ctx) => t3xEnabledAt(isEnabled(rec), scopedOf(rec.manifest.id), ctx);
/** 只要有任何作用域开着就运行代码；具体哪个会话显示，由挂载点按当前会话过滤。 */
const shouldRun = (rec) => isEnabled(rec) || Object.values(scopedOf(rec.manifest.id)).includes(true);

/**
 * 设置页当前作用域下的开关状态：keys 来自 t3xScopeKeys（null=全局）。
 * 返回 { on, inherited }：inherited=这个作用域没单独设，沿用上一级；成员项目设得不一致时按第一个算。
 */
function scopeState(rec, keys) {
  if (keys === null) return { on: !!isEnabled(rec), inherited: false, mixed: false };
  const map = scopedOf(rec.manifest.id);
  // 逐个成员算实际生效值：跨环境的项目可能一部分单独开了、一部分沿用关闭。
  const effective = keys.map((k) => {
    if (typeof map[k] === "boolean") return map[k];
    const env = k.startsWith("proj:") ? map[`env:${k.split(":")[1]}`] : undefined;
    return typeof env === "boolean" ? env : !!isEnabled(rec);
  });
  const mixed = new Set(effective).size > 1;
  return { on: mixed ? false : !!effective[0], inherited: keys.every((k) => typeof map[k] !== "boolean"), mixed };
}

/** 在当前作用域开关扩展；on=null 表示清掉这个作用域的单独设置，回到沿用上一级。返回写盘的 Promise。 */
function setEnabledIn(id, keys, on) {
  if (keys === null) return setEnabled(id, !!on);
  const rec = records.get(id);
  const all = store.get("t3x:scoped", {});
  const next = { ...(all[id] ?? {}) };
  for (const k of keys) {
    if (on === null) delete next[k];
    else next[k] = on;
  }
  const saved = store.set("t3x:scoped", { ...all, [id]: next });
  syncRunning(rec);
  bump(); // 运行状态没变时 syncRunning 不通知，但哪些会话显示它变了
  return saved;
}

function syncRunning(rec) {
  if (shouldRun(rec)) activate(rec);
  else if (rec.status !== "off") {
    deactivate(rec);
    bump();
  }
}

function addStyle(css, id) {
  const el = document.createElement("style");
  el.dataset.t3x = id;
  el.textContent = css;
  document.head.appendChild(el);
  return () => el.remove();
}

// T3 的 CSP 允许内联脚本、不允许 eval 和 blob: 模块，所以用内联 <script> 把代码变成 function(host)。
function compile(id, code) {
  const name = `__t3xRun${++runSeq}`;
  let syntaxError = null;
  const onError = (ev) => {
    syntaxError = ev.message;
  };
  window.addEventListener("error", onError);
  const el = document.createElement("script");
  el.textContent = `globalThis[${JSON.stringify(name)}]=function(host){"use strict";\n${code}\n};\n//# sourceURL=t3x-extension://${id}/web.js`;
  document.head.appendChild(el);
  el.remove();
  window.removeEventListener("error", onError);
  const fn = globalThis[name];
  delete globalThis[name];
  if (typeof fn !== "function") throw new Error(syntaxError ?? L("脚本没有执行（可能被 CSP 拦截）", "The script didn’t run. It may have been blocked by the content security policy."));
  return fn;
}

// 右键菜单：用 T3 自己画的那套（网页版的右键菜单，和 T3 下拉菜单同一套样式），不用 macOS 原生菜单。
// 宿主追加在 ThreadRouteView 模块里，相对路径从 assets 目录解析；文件名带构建哈希，补丁本来就只认 0.1.13。
// items 格式同 desktopBridge.showContextMenu：{ id, label, detail, icon, checked, disabled, separatorBefore, children }，返回选中项 id 或 null。
const CONTEXT_MENU_MODULE = "./contextMenuFallback-BiKUAfIY.js";
let contextMenuModule = null;
function showContextMenu(items, position) {
  contextMenuModule ??= import(CONTEXT_MENU_MODULE);
  return contextMenuModule.then((m) => m.r(items, position));
}

// T3 的页面结构只在这里出现：T3 改版时改这里，扩展不用跟着改。side chat 里也有一套输入框，不算。
const MAIN_COMPOSER = '[data-slot="composer-host"]';
const inSideChat = (el) => !!el.closest("[data-side-chat-pane]");
const dom = {
  /** 主聊天视图的输入框外壳，没有时返回 null。 */
  composer: () => [...document.querySelectorAll(MAIN_COMPOSER)].find((el) => !inSideChat(el)) ?? null,
  /** target 在主输入框的模型选择器里时返回那个选择器，否则 null。 */
  modelPicker: (target) => {
    const picker = target instanceof Element ? target.closest("[data-chat-provider-model-picker]") : null;
    return picker?.closest(MAIN_COMPOSER) && !inSideChat(picker) ? picker : null;
  },
};

// T3 自己的确认框（删除会话用的那个）：以“？”结尾的那行是标题，其余行是说明；返回 true/false。
const CONFIRM_MODULE = "./toast-CuwWVZD5.js";
let confirmModule = null;
function showConfirm(message, options) {
  confirmModule ??= import(CONFIRM_MODULE);
  return confirmModule.then(async (m) => (await m.D(message, options)) ?? false); // 确认框没挂载时 T3 也当作取消
}
/** T3 的 toast 管理器（同一个模块的导出 i），设置页以外也能用，比如启动时报告宿主更新的结果。 */
function showToast(toast) {
  confirmModule ??= import(CONFIRM_MODULE);
  return confirmModule.then((m) => m.i.add(toast));
}

// 扩展要求打开自己的设置（比如桌宠右键菜单）：跳到 设置 → 扩展，设置页挂载时或已挂载时取走这个 id。
let settingsRequest = null;
const settingsRequestListeners = new Set();
function requestSettings(id) {
  settingsRequest = id;
  for (const fn of settingsRequestListeners) fn();
  if (location.hash !== "#/settings/extensions") location.hash = "#/settings/extensions"; // T3 桌面版用 hash 路由
}
/** 设置页调用：取走待打开设置的扩展 id，取一次就清空。 */
function takeSettingsRequest() {
  const id = settingsRequest;
  settingsRequest = null;
  return id;
}
function subscribeSettingsRequest(fn) {
  settingsRequestListeners.add(fn);
  return () => settingsRequestListeners.delete(fn);
}

// life 是这一次启用的生命周期：停用后 alive=false，扩展晚到的异步回调再注册什么都不生效。
function makeApi(rec, life) {
  const id = rec.manifest.id;
  const own = (key) => `ext:${id}:${key}`;
  const noop = () => {};
  const track = (off) => {
    if (!life.alive) {
      off();
      return noop;
    }
    life.disposers.push(off);
    return off;
  };
  return {
    id,
    manifest: structuredClone(rec.manifest), // 副本：宿主按 rec.manifest 授权、存盘，扩展改不到
    React,
    h: React.createElement,
    register(slot, Component) {
      if (!SLOTS[slot]) throw new Error(L(`未知挂载点：${slot}`, `Unknown extension slot: ${slot}`));
      if (!life.alive) return noop;
      const entry = { rec, Component, key: ++regSeq };
      slotEntries[slot].push(entry);
      const off = () => {
        const list = slotEntries[slot];
        if (list.includes(entry)) list.splice(list.indexOf(entry), 1);
        bump();
      };
      life.disposers.push(off);
      bump();
      return off;
    },
    settings(Component) {
      if (!life.alive) return;
      rec.settings = Component;
      bump();
    },
    openSettings: () => requestSettings(id),
    contextMenu: showContextMenu,
    confirm: showConfirm,
    dom,
    storage: {
      get: (key, fallback) => store.get(own(key), fallback),
      set: (key, value) => {
        if (life.alive) return store.set(own(key), value);
        // 停用后的旧实例（重载、升级、卸载时还没回来的请求）不能再写：会盖掉新实例的数据，或者写回卸载时清掉的键
        const stale = Promise.reject(new Error(L("扩展已停用", "The extension is disabled")));
        stale.catch(() => {}); // 只给等它的调用方看
        return stale;
      },
      subscribe: (key, fn) => track(store.subscribe(own(key), fn)),
      use: (key, fallback) => useStored(own(key), fallback),
    },
    files: {
      list: () => Object.keys(rec.files),
      text: (p) => rec.files[p],
      url: (p) => (rec.files[p]?.startsWith("data:") ? rec.files[p] : null),
    },
    style: (css) => (life.alive ? track(addStyle(css, id)) : noop),
    onDispose: (fn) => (life.alive ? life.disposers.push(fn) : fn()),
    chat: { last: () => lastChat },
    agent: agentApi(rec, life),
    outputs: outputsApi(rec, life),
    server: serverApi(rec, life),
    tray: trayApi(rec, life),
    t3: t3Api(rec, life),
    system: systemApi(rec, life),
    lang: () => (isZh() ? "zh" : "en"),
    useLang,
    t: L,
  };
}

function deactivate(rec) {
  if (rec.life) rec.life.alive = false;
  for (const fn of (rec.life?.disposers ?? []).splice(0).reverse()) {
    try {
      fn();
    } catch (error) {
      console.error(TAG, rec.manifest.id, "停用时出错", error);
    }
  }
  rec.settings = null;
  rec.status = "off";
}

function activate(rec) {
  if (rec.status === "on") return; // 幂等：重复启用不能覆盖上一次的清理列表
  const life = { alive: true, disposers: [] };
  rec.life = life;
  rec.error = null;
  try {
    const list = t3xCheckManifest(rec.manifest, rec.files);
    for (const p of list.styles) life.disposers.push(addStyle(rec.files[p], rec.manifest.id));
    // 只有后台脚本的扩展在窗口里没有代码要跑；后台那份由 background.js 交给 T3 后台。
    if (list.web.length) {
      const run = compile(rec.manifest.id, list.web.map((p) => rec.files[p]).join("\n;\n"));
      const cleanup = run(makeApi(rec, life));
      if (typeof cleanup === "function") life.disposers.push(cleanup);
    }
    rec.status = "on";
  } catch (error) {
    deactivate(rec);
    rec.status = "error";
    rec.error = L(`启用失败：${error?.message ?? error}`, `Couldn’t enable the extension: ${error?.message ?? error}`);
    console.error(TAG, rec.manifest.id, error);
  }
  bump();
}

/** 返回启用状态写盘的 Promise。 */
function setEnabled(id, on) {
  const rec = records.get(id);
  const saved = store.set("t3x:enabled", { ...store.get("t3x:enabled", {}), [id]: on });
  syncRunning(rec);
  bump(); // 其他作用域开着时仍在运行，但沿用全局的会话要刷新
  return saved;
}

// 扩展组件出错时只影响它自己：overlay 不渲染，替换类挂载点退回原生组件。
class Guard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    this.props.rec.error = L(`运行出错：${error?.message ?? error}`, `Extension error: ${error?.message ?? error}`);
    console.error(TAG, this.props.rec.manifest.id, error);
    queueMicrotask(bump);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// 挂载点 chat.overlay：T3 的聊天视图每次渲染都把会话状态传进来。
function ChatOverlay({ state }) {
  useHostVersion();
  useLang();
  const driver = state.providers?.find?.((p) => p.instanceId === state.providerInstanceId)?.driver ?? null;
  const full = Object.freeze({ ...state, driver }); // chat.last() 把它交给扩展：环境 ID 决定 agent 发到哪，不能被改
  React.useEffect(() => {
    if (!state.embedded) {
      lastChat = full;
      bumpChat();
    }
  });
  return slotEntries["chat.overlay"].filter((e) => enabledAt(e.rec, full)).map((e) =>
    React.createElement(Guard, { key: e.key, rec: e.rec, fallback: null }, React.createElement(e.Component, full)),
  );
}

// 挂载点 composer.effort：替换输入框“推理强度”面板里的档位列表。
function EffortSlot({ props, Default }) {
  useHostVersion();
  useLang();
  React.useSyncExternalStore(subscribeChat, () => lastChat);
  const entry = slotEntries["composer.effort"].filter((e) => enabledAt(e.rec, lastChat)).at(-1);
  const native = React.createElement(Default, props);
  const model = entry ? t3xEffortModel(props, bind.choices) : null;
  if (!model) return native;
  return React.createElement(Guard, { key: entry.key, rec: entry.rec, fallback: native }, React.createElement(entry.Component, model));
}
