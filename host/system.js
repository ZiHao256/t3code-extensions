// apiVersion 8：host.system，系统通知、写剪贴板、用浏览器打开链接（manifest 要声明 permissions: ["system"]）。
// 通知用 T3 自己发完成提醒的那套（网页 Notification，点了回到 T3 窗口）；剪贴板走主进程：在菜单栏小窗里点的时候 T3 窗口不在前台，
// navigator.clipboard 会被拒；链接交给 T3 自己的 desktopBridge.openExternal（主进程再校验一遍，0.1.13 只认 http / https）。
const hasSystem = (rec) => rec.manifest.permissions?.includes("system") === true;
const SYSTEM_LIMIT = { title: 200, body: 2000, url: 8192 };
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

function systemApi(rec, life) {
  const need = () => {
    if (!hasSystem(rec)) throw new Error(L('host.system 要在 permissions 里声明 "system"', 'host.system requires the "system" permission'));
    if (!life.alive) throw new Error(L("扩展已停用", "The extension is disabled"));
  };
  const shown = new Set(); // 停用时把还在的通知一起关掉
  let hooked = false;
  return Object.freeze({
    /** 系统通知：{ title, body?, silent?, onClick? }。点通知回到 T3 窗口，再调 onClick。返回关掉这条通知的函数。 */
    async notify({ title, body = "", silent = false, onClick } = {}) {
      need();
      if (typeof title !== "string" || !title.trim() || title.length > SYSTEM_LIMIT.title) throw new Error(L(`title 需要是不超过 ${SYSTEM_LIMIT.title} 字的文字`, `title must be text of at most ${SYSTEM_LIMIT.title} characters`));
      if (typeof body !== "string" || body.length > SYSTEM_LIMIT.body) throw new Error(L(`body 需要是不超过 ${SYSTEM_LIMIT.body} 字的文字`, `body must be text of at most ${SYSTEM_LIMIT.body} characters`));
      if (onClick !== undefined && typeof onClick !== "function") throw new Error(L("onClick 需要是函数", "onClick must be a function"));
      if (typeof Notification === "undefined") throw new Error(L("这里不能发系统通知", "System notifications are unavailable here"));
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission !== "granted") throw new Error(L("系统通知没有授权", "Notification permission was denied"));
      need(); // 等授权期间可能被停用
      const n = new Notification(title, { body, silent: silent === true });
      const forget = () => shown.delete(n);
      shown.add(n);
      if (!hooked) {
        hooked = true;
        life.disposers.push(() => {
          for (const x of shown) x.close();
          shown.clear();
        });
      }
      n.addEventListener("close", forget);
      n.addEventListener("error", forget);
      n.addEventListener("click", async () => {
        n.close();
        forget();
        if (!life.alive) return; // 停用前排队的点击
        window.focus();
        await window.desktopBridge?.revealWindow?.().catch(() => {});
        if (!onClick || !life.alive) return;
        try {
          await onClick();
        } catch (error) {
          console.error(TAG, rec.manifest.id, "通知点击处理出错", error);
        }
      });
      return () => {
        n.close();
        forget();
      };
    },
    /** 把文字写进系统剪贴板。 */
    async copy(text) {
      need();
      if (typeof text !== "string") throw new Error(L("text 需要是文字", "text must be a string"));
      if (!serverBridge?.clipboard) throw new Error(L("剪贴板只能在 T3 Code Extensions 桌面版里用", "The clipboard is available only in the T3 Code Extensions desktop app."));
      await serverBridge.clipboard.write(text);
    },
    /** 用默认浏览器打开链接。 */
    async openExternal(url) {
      need();
      let parsed = null;
      try {
        parsed = typeof url === "string" && url.length <= SYSTEM_LIMIT.url ? new URL(url) : null;
      } catch {
        // 下面统一报错
      }
      if (!parsed || !EXTERNAL_PROTOCOLS.has(parsed.protocol)) throw new Error(L("只能打开 http、https 链接", "Only http and https links can be opened"));
      if (!window.desktopBridge?.openExternal) throw new Error(L("打开链接只能在桌面版里用", "Opening links is available only in the desktop app."));
      if (!(await window.desktopBridge.openExternal(parsed.href))) throw new Error(L("没能打开这个链接", "Could not open the link"));
    },
  });
}
