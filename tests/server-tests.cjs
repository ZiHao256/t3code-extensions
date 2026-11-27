"use strict";
// 后台扩展（apiVersion 4）：清单、主进程落盘、后台宿主加载与额度读取、T3 后台补丁的锚点。
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pure = require("../host/pure.js");
const serverMain = require("../host/server-main.cjs");

const ROOT = path.join(__dirname, "..");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const quiet = { info() {}, error() {} };

module.exports = (test) => {
  test("后台扩展清单", () => {
    const ok = { id: "bg", apiVersion: 4, name: "Bg", version: "1.0.0", permissions: ["server"], entries: { server: "server.mjs" } };
    assert.deepEqual(pure.t3xCheckManifest(ok, { "server.mjs": "" }).server, ["server.mjs"]); // 只有后台脚本也算有入口
    assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion: 3 }), /apiVersion 4/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, permissions: [] }), /server/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { server: "server.js" } }), /\.mjs/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { server: ["a.mjs"] } }), /\.mjs/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { server: "../x.mjs" } }), /路径/);
    assert.throws(() => pure.t3xCheckManifest(ok, {}), /缺少文件/);
    assert.throws(() => pure.t3xCheckManifest({ ...ok, entries: { web: "x.mjs", server: "x.mjs" } }, { "x.mjs": "" }), /两次/);
  });

  test("主进程落盘：校验输入、按内容命名、清理旧版本、卸载删数据", () => {
    assert.equal(serverMain.serverDir({}, "/Users/u", false), "/Users/u/.t3/userdata/t3x-server");
    assert.equal(serverMain.serverDir({}, "/Users/u", true), "/Users/u/.t3/dev/t3x-server");
    assert.equal(serverMain.serverDir({ T3CODE_HOME: " /tmp/h " }, "/Users/u", true), "/tmp/h/userdata/t3x-server"); // 和 T3 一样：设了 T3CODE_HOME 就不用 dev
    const dir = tmp("t3x-main-");
    try {
      for (const bad of [null, { installed: ["../x"], extensions: [] }, { installed: ["a1"], extensions: [{ id: "b1", version: "1", code: "" }] }, { installed: ["a1"], extensions: [{ id: "a1", version: "1", code: 1 }] }, { installed: ["a1"], extensions: [{ id: "a1", version: "1", code: "x".repeat((5 << 20) + 1) }] }]) {
        assert.throws(() => serverMain.sync(dir, bad), /t3x:/, JSON.stringify(bad)?.slice(0, 80));
      }
      const v1 = "export function activate(){}";
      const r1 = serverMain.sync(dir, { installed: ["a1", "b1"], extensions: [{ id: "a1", version: "1.0.0", code: v1 }] });
      assert.deepEqual(r1, { extensions: [{ id: "a1", sha256: sha(v1) }] });
      const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
      assert.deepEqual(index.extensions, [{ id: "a1", version: "1.0.0", file: `code/a1/${sha(v1)}.mjs`, sha256: sha(v1) }]);
      assert.equal(fs.readFileSync(path.join(dir, index.extensions[0].file), "utf8"), v1);
      fs.mkdirSync(path.join(dir, "data", "a1"), { recursive: true });
      fs.mkdirSync(path.join(dir, "data", "b1"), { recursive: true });
      const outside = tmp("t3x-outside-");
      fs.writeFileSync(path.join(outside, "keep.txt"), "x");
      fs.symlinkSync(outside, path.join(dir, "data", "b1", "link"));
      const v2 = "export function activate(){ return () => {}; }";
      serverMain.sync(dir, { installed: ["a1"], extensions: [{ id: "a1", version: "1.1.0", code: v2 }] });
      assert.deepEqual(fs.readdirSync(path.join(dir, "code", "a1")), [`${sha(v2)}.mjs`], "旧版本要删掉");
      assert(fs.existsSync(path.join(dir, "data", "a1")), "停用、升级不删数据");
      assert(!fs.existsSync(path.join(dir, "data", "b1")), "卸载了的扩展删数据");
      assert(fs.existsSync(path.join(outside, "keep.txt")), "删数据目录不能跟着符号链接删到外面");
      fs.rmSync(outside, { recursive: true, force: true });
      serverMain.sync(dir, { installed: ["a1"], extensions: [] }); // 停用
      assert(!fs.existsSync(path.join(dir, "code", "a1")) && fs.existsSync(path.join(dir, "data", "a1")), "停用：删代码、留数据");
      assert.deepEqual(serverMain.status(dir), { extensions: {} });

      // data / code 被换成指向别处的符号链接：拒绝同步，不碰链接指向的目录
      const elsewhere = tmp("t3x-elsewhere-");
      fs.mkdirSync(path.join(elsewhere, "victim"));
      fs.rmSync(path.join(dir, "data"), { recursive: true, force: true });
      fs.symlinkSync(elsewhere, path.join(dir, "data"));
      assert.throws(() => serverMain.sync(dir, { installed: [], extensions: [] }), /不是目录/);
      assert(fs.existsSync(path.join(elsewhere, "victim")), "不能删到 data 链接指向的目录里");
      fs.rmSync(path.join(dir, "data"));
      const indexText = fs.readFileSync(path.join(dir, "index.json"), "utf8");
      fs.rmSync(path.join(dir, "code"), { recursive: true, force: true });
      fs.symlinkSync(elsewhere, path.join(dir, "code"));
      assert.throws(() => serverMain.sync(dir, { installed: ["a1"], extensions: [{ id: "a1", version: "1", code: v1 }] }), /不是目录/);
      assert(fs.existsSync(path.join(elsewhere, "victim")) && !fs.existsSync(path.join(elsewhere, "a1")), "不能写到、删到 code 链接指向的目录里");
      assert.equal(fs.readFileSync(path.join(dir, "index.json"), "utf8"), indexText, "检查不过时索引不动");
      fs.rmSync(elsewhere, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("后台宿主：加载扩展、接手额度、规整窗口、出错和哈希不符", async () => {
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const dir = tmp("t3x-host-");
    try {
      const good = `export function activate(t3x) {
        return t3x.usage.registerSource({ driver: "antigravity", read: async (ctx) => {
          if (ctx.instanceId === "boom") throw new Error("agy 说不行");
          return { windows: [
            { id: "w", label: " Gemini · Weekly ", kind: "weekly", usedPercent: 34.1, resetsAt: "2026-12-01T07:52:02Z", windowDurationMins: 10080 },
            { id: "s", label: "Gemini · 5-hour", kind: "session", usedPercent: 120 },
            { id: "bad", label: "", kind: "weekly", usedPercent: 1 },
            { id: "x", label: "Other", kind: "nope", usedPercent: 0, resetsAt: "not a date" },
            { id: "y", label: "Proto", kind: "toString", usedPercent: 5, windowDurationMins: 1.5 },
          ] };
        } });
      }`;
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.0", code: good }] });
      const host = t3xCreateServerHost({ dir, log: quiet });
      assert.equal(await host.hasSource("antigravity"), true);
      assert.equal(host.status().good.state, "running");
      const usage = await host.readUsage("antigravity", { instanceId: "a" });
      assert.deepEqual(usage.windows, [
        { id: "s", label: "Gemini · 5-hour", kind: "session", usedPercent: 100 },
        { id: "w", label: "Gemini · Weekly", kind: "weekly", usedPercent: 34.1, resetsAt: "2026-12-01T07:52:02.000Z", windowDurationMins: 10080 },
        { id: "x", label: "Other", kind: "other", usedPercent: 0 },
        { id: "y", label: "Proto", kind: "other", usedPercent: 5 },
      ]);
      const failed = await host.readUsage("antigravity", { instanceId: "boom" });
      assert.deepEqual([failed.windows, failed.unavailable], [[], { reason: "probeFailed", message: "good：agy 说不行" }]);

      // 第二个扩展抢同一个来源：加载失败，不影响第一个
      const rival = `export function activate(t3x) { t3x.usage.registerSource({ driver: "antigravity", read: () => ({ windows: [] }) }); }`;
      serverMain.sync(dir, { installed: ["good", "rival"], extensions: [{ id: "good", version: "1.0.0", code: good }, { id: "rival", version: "1.0.0", code: rival }] });
      await host.reload();
      assert.match(host.status().rival.error, /已经由 good 接手/);
      assert.equal((await host.readUsage("antigravity", { instanceId: "a" })).windows.length, 4);

      // 文件被改过（和索引里的哈希对不上）就不加载
      serverMain.sync(dir, { installed: ["good"], extensions: [] });
      await host.reload();
      assert.equal(await host.hasSource("antigravity"), false, "停用后要撤掉来源");
      assert.equal((await host.readUsage("antigravity", {})).unavailable.reason, "probeFailed");
      const evil = `export function activate(t3x) { t3x.usage.registerSource({ driver: "antigravity", read: () => ({ windows: [] }) }); }`;
      const { extensions } = serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.1", code: evil }] });
      fs.writeFileSync(path.join(dir, "code", "good", `${extensions[0].sha256}.mjs`), good);
      await host.reload();
      assert.match(host.status().good.error, /SHA-256/);
      const written = JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));
      assert.equal(written.extensions.good.state, "error", "状态写给主进程读");
      assert.equal(await host.hasSource("antigravity"), true, "启用了却没加载起来：面板上说明原因，不当成没有扩展接手");
      assert.match((await host.readUsage("antigravity", {})).unavailable.message, /后台扩展 good 没有加载起来：.*SHA-256/);

      // 能解析但格式不对的索引不当成“全部停用”
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.0", code: good }] });
      await host.reload();
      fs.writeFileSync(path.join(dir, "index.json"), "{}");
      await host.reload();
      assert.equal(host.status().good.state, "running");
      assert.equal((await host.readUsage("antigravity", { instanceId: "a" })).windows.length, 4);

      // 扩展抛出的东西取不出说明时也不能让 readUsage reject
      const weird = `export function activate(t3x) { t3x.usage.registerSource({ driver: "antigravity", read: () => { throw { get message() { throw new Error("x"); } }; } }); }`;
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.3", code: weird }] });
      await host.reload();
      assert.equal((await host.readUsage("antigravity", {})).unavailable.message, "good：未知错误");

      // 不支持的 provider、读取超时之外的普通异常都变成错误状态
      const odd = `export function activate(t3x) { t3x.usage.registerSource({ driver: "codex", read: () => ({}) }); }`;
      serverMain.sync(dir, { installed: ["good"], extensions: [{ id: "good", version: "1.0.2", code: odd }] });
      await host.reload();
      assert.match(host.status().good.error, /不支持的额度来源/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const none = t3xCreateServerHost({ dir: undefined, log: quiet });
    assert.equal(await none.hasSource("antigravity"), false, "没有 T3X_SERVER_DIR（官方 app 启动的后台）时什么都不加载");
  });

  test("readUsage 的结果记着来源：来源换掉后 resultCurrent 为 false", async () => {
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const dir = tmp("t3x-origin-");
    try {
      const code = (n) => `export function activate(t3x) { return t3x.usage.registerSource({ driver: "antigravity", read: () => ({ windows: [{ id: "w", label: "W", kind: "weekly", usedPercent: ${n} }] }) }); }`;
      serverMain.sync(dir, { installed: ["src"], extensions: [{ id: "src", version: "1.0.0", code: code(1) }] });
      const host = t3xCreateServerHost({ dir, log: quiet });
      await host.start();
      const result = await host.readUsage("antigravity", {});
      assert.equal(host.resultCurrent("antigravity", result), true);
      serverMain.sync(dir, { installed: ["src"], extensions: [{ id: "src", version: "1.0.1", code: code(2) }] });
      await host.reload();
      assert.equal(host.resultCurrent("antigravity", result), false, "升级换掉来源后，旧来源的结果不算");
      assert.equal(host.resultCurrent("antigravity", { windows: [] }), true, "不是 readUsage 给的一律算");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("来源变了通知 provider；读的时候来源换了，结果作废（null）", async () => {
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const dir = tmp("t3x-src-");
    try {
      // read 等外面放行，用来造“读的时候停用了”
      const slow = `export function activate(t3x) {
        return t3x.usage.registerSource({ driver: "antigravity", read: () => new Promise((resolve) => { globalThis.t3xRelease = () => resolve({ windows: [{ id: "w", label: "W", kind: "weekly", usedPercent: 1 }] }); }) });
      }`;
      serverMain.sync(dir, { installed: ["slow"], extensions: [{ id: "slow", version: "1.0.0", code: slow }] });
      const host = t3xCreateServerHost({ dir, log: quiet });
      await host.start();
      const v1 = host.sourcesVersion();
      assert(v1 > 0, "登记来源算一次变化");
      let woke = false;
      host.whenSourcesChange(v1).then(() => (woke = true));
      await host.reload(); // 什么都没变
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(woke, false, "没变就不通知");
      await host.whenSourcesChange(v1 - 1); // 已经变过了就马上兑现

      // 调用扩展的那一刻调用方说不算数了：不调用扩展
      let flipped = true;
      const skipped = host.readUsage("antigravity", {}, () => flipped);
      flipped = false; // readUsage 调用扩展前还隔着一个微任务，这里就是那个空档
      assert.equal(await skipped, null, "不算数了就不调用扩展");
      assert.equal(globalThis.t3xRelease, undefined, "扩展的 read 没被调用");
      // provider 关掉时撤掉等待
      const abort = new AbortController();
      const before = host.waiterCount();
      const waiting = host.whenSourcesChange(host.sourcesVersion(), abort.signal);
      assert.equal(host.waiterCount(), before + 1);
      abort.abort();
      await waiting;
      assert.equal(host.waiterCount(), before, "中止后撤掉等待");
      await host.whenSourcesChange(host.sourcesVersion(), abort.signal);
      assert.equal(host.waiterCount(), before, "已经中止的 signal 不登记等待");
      assert.equal(host.hasRegisteredSource("antigravity"), true);

      // 读的时候停用：结果作废，并通知 provider 重新读
      const pending = host.readUsage("antigravity", {});
      await new Promise((r) => setTimeout(r, 10));
      serverMain.sync(dir, { installed: ["slow"], extensions: [] });
      await host.reload();
      assert.equal(woke, true, "停用了通知");
      assert.equal(host.hasRegisteredSource("antigravity"), false, "停用后马上就没有登记的来源");
      globalThis.t3xRelease();
      assert.equal(await pending, null, "读的时候来源没了：作废");
      assert.equal(await host.hasSource("antigravity"), false);

      // 启用了却没加载起来也算变化（hasSource 认它）
      const v2 = host.sourcesVersion();
      const { extensions } = serverMain.sync(dir, { installed: ["slow"], extensions: [{ id: "slow", version: "1.0.1", code: slow }] });
      fs.writeFileSync(path.join(dir, "code", "slow", `${extensions[0].sha256}.mjs`), "export function activate() {}");
      await host.reload();
      assert.equal(host.status().slow.state, "error");
      assert.equal(await host.hasSource("antigravity"), true, "加载失败的也算接手（面板要显示原因）");
      assert.equal(host.hasRegisteredSource("antigravity"), false, "但不算登记了来源");
      // 加载失败的原因换了（同一个扩展换了版本还是失败）也要通知；旧原因的结果不算
      const failure = await host.readUsage("antigravity", {});
      assert.equal(host.resultCurrent("antigravity", failure), true);
      const v3 = host.sourcesVersion();
      const again = serverMain.sync(dir, { installed: ["slow"], extensions: [{ id: "slow", version: "1.0.2", code: `${slow}\n// 1.0.2` }] });
      fs.writeFileSync(path.join(dir, "code", "slow", `${again.extensions[0].sha256}.mjs`), "export const nope = 1;");
      await host.reload();
      assert.notEqual(host.sourcesVersion(), v3, "失败的换了一个版本也通知");
      assert.equal(host.resultCurrent("antigravity", failure), false, "旧的失败原因不算");
      assert.notEqual(host.sourcesVersion(), v2, "加载失败也通知");
    } finally {
      delete globalThis.t3xRelease;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("额度窗口写上 modelIds（T3 0.1.12 exhaustedUsageWindow 里 Antigravity 的规则）、读取失败保留上一次的", async () => {
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const { routeUsage, mergeUsage } = t3xCreateServerHost({ dir: undefined, log: quiet });
    const models = ["gemini-3.1-pro", "gemini-3-flash", "gemini-argon-1", "claude-sonnet-4.6", "gpt-oss-120b", "fast", "ag/gemini-3.1-pro", "gemini-3.1-pro", " padded "].map((slug) => ({ slug }));
    const win = (id) => ({ id, label: id, kind: "weekly", usedPercent: 100 });
    const snapshot = { driver: "antigravity", models, usageLimits: { checkedAt: "2026-11-27T00:00:00.000Z", windows: [win("gemini-weekly"), win("3p-5h"), win("claude-weekly"), win("quota")] } };
    const routed = routeUsage("antigravity", snapshot);
    const ids = Object.fromEntries(routed.usageLimits.windows.map((w) => [w.id, w.modelIds]));
    const unknown = ["fast", "ag/gemini-3.1-pro"]; // 认不出家族（别名、带前缀）的哪个窗口满了都卡
    assert.deepEqual(ids["gemini-weekly"], ["gemini-3.1-pro", "gemini-3-flash", "gemini-argon-1", ...unknown], "Gemini 池卡所有 Gemini，去重，T3 schema 不收首尾有空白的 id");
    assert.deepEqual(ids["3p-5h"], ["claude-sonnet-4.6", "gpt-oss-120b", ...unknown], "3p 是 Claude 和 GPT 共用");
    assert.deepEqual(ids["claude-weekly"], ["claude-sonnet-4.6", ...unknown]);
    assert.equal(ids.quota, undefined, "认不出的池不写 modelIds：卡全部，包括不在模型列表里的 id（和 0.1.12 一样）");
    // 0.1.13 的 exhaustedUsageWindow 只认 window.modelIds.includes(model)：用它的判断方式核对 0.1.12 的结果
    const blocks = (model) => routed.usageLimits.windows.filter((w) => w.modelIds === undefined || w.modelIds.includes(model)).map((w) => w.id);
    assert.deepEqual(blocks("gemini-3.1-pro"), ["gemini-weekly", "quota"], "Claude / GPT 的额度满了不挡 Gemini");
    assert.deepEqual(blocks("gpt-oss-120b"), ["3p-5h", "quota"]);
    assert.equal(routed.usageLimits.checkedAt, snapshot.usageLimits.checkedAt);
    assert.equal(snapshot.usageLimits.windows[0].modelIds, undefined, "不改原来的快照");
    // 不用改的原样返回：别的 provider、没有额度、读取失败（没有窗口）
    for (const [driver, s] of [["codex", snapshot], ["antigravity", { models }], ["antigravity", { models, usageLimits: { windows: [], unavailable: { reason: "probeFailed" } } }]]) {
      assert.equal(routeUsage(driver, s), s);
    }
    // 还没有模型列表：池认得出的写空列表（不卡），认不出的照样不写（卡全部）
    const cold = routeUsage("antigravity", { ...snapshot, models: [] });
    assert.deepEqual(cold.usageLimits.windows.map((w) => [w.id, w.modelIds]), [["gemini-weekly", []], ["3p-5h", []], ["claude-weekly", []], ["quota", undefined]]);
    // 别名也算：默认模型带 antigravity-default（新会话按它判断额度用完没有），认不出家族，哪个窗口满了都卡
    const aliased = routeUsage("antigravity", { ...snapshot, models: [{ slug: "gemini-1", aliases: ["antigravity-default"] }, { slug: "claude-1" }] });
    assert.deepEqual(aliased.usageLimits.windows.map((w) => [w.id, w.modelIds]), [["gemini-weekly", ["gemini-1", "antigravity-default"]], ["3p-5h", ["antigravity-default", "claude-1"]], ["claude-weekly", ["antigravity-default", "claude-1"]], ["quota", undefined]]);

    // mergeUsage 和 T3 的 resolveUsageLimitsAfterProbe 一样
    const good = { checkedAt: "2026-11-27T01:00:00.000Z", windows: [win("gemini-weekly")] };
    const failed = { checkedAt: "2026-11-27T02:00:00.000Z", windows: [], unavailable: { reason: "probeFailed", message: "x" } };
    assert.equal(mergeUsage(good, failed), good, "读取失败保留上一次成功的");
    assert.equal(mergeUsage(undefined, failed), failed, "从没读成过就显示原因");
    assert.equal(mergeUsage(failed, good), good);
    const older = { checkedAt: "2026-11-27T00:30:00.000Z", windows: [] };
    assert.deepEqual(mergeUsage(good, older), { ...older, checkedAt: good.checkedAt, windows: good.windows }, "较早的结果不覆盖较新的");
    assert.equal(mergeUsage(good, undefined), undefined, "没有扩展接手了就清掉");
  });

  test("调用通道（apiVersion 6）：主进程 → 后台 t3x.handle，界面语言，出错、停用和限制", async () => {
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const dir = tmp("t3x-rpc-");
    try {
      const code = `export function activate(t3x) {
        t3x.handle("echo", (data) => ({ data, lang: t3x.lang() }));
        t3x.handle("boom", async () => { throw new Error("后台说不行"); });
        t3x.handle("cyclic", () => { const a = {}; a.a = a; return a; });
        t3x.handle("later", () => new Promise((r) => setTimeout(() => r("ok"), 50)));
        const off = t3x.handle("gone", () => 1);
        off();
        assert(() => t3x.handle("bad name", () => 1));
        function assert(fn) { try { fn(); } catch { return; } throw new Error("非法调用名没有被拒绝"); }
      }`;
      serverMain.sync(dir, { installed: ["a1", "b1"], lang: "zh", extensions: [{ id: "a1", version: "1.0.0", code }] });
      const host = t3xCreateServerHost({ dir, log: quiet });
      await host.start();
      assert.equal(host.status().a1.state, "running", host.status().a1.error);
      assert.deepEqual(await serverMain.call(dir, "a1", "echo", { n: [1, "二"] }), { data: { n: [1, "二"] }, lang: "zh" });
      assert.deepEqual(await serverMain.call(dir, "a1", "echo"), { data: null, lang: "zh" }, "不带参数时是 null");
      assert.equal(await serverMain.call(dir, "a1", "later"), "ok");
      await assert.rejects(serverMain.call(dir, "a1", "boom"), /^Error: 后台说不行$/);
      await assert.rejects(serverMain.call(dir, "a1", "cyclic"), /circular/i);
      await assert.rejects(serverMain.call(dir, "a1", "gone"), /a1 没有登记 gone/);
      await assert.rejects(serverMain.call(dir, "b1", "echo"), /后台扩展 b1 没有在运行/, "装了但没有后台在跑");
      assert.throws(() => serverMain.call(dir, "../x", "echo"), /扩展 id 无效/);
      assert.throws(() => serverMain.call(dir, "a1", "a b"), /调用名无效/);
      assert.throws(() => serverMain.call(dir, "a1", "echo", { big: "x".repeat(256 << 10) }), /256 KB/);
      assert.throws(() => serverMain.call(dir, "a1", "echo", { n: 1n }), /JSON/);
      assert.throws(() => serverMain.call(dir, "a1", "echo", "汉".repeat(100 << 10)), /256 KB/, "按字节算：10 万个汉字约 300 KB");
      assert.throws(() => serverMain.sync(dir, { installed: [], lang: "fr", extensions: [] }), /lang/);

      // 切语言、换版本后马上调用（文件监视还没来得及重载）：按主进程写的索引先重载
      serverMain.sync(dir, { installed: ["a1"], lang: "en", extensions: [{ id: "a1", version: "1.0.0", code }] });
      assert.equal((await serverMain.call(dir, "a1", "echo")).lang, "en");
      const v2 = code.replace('"echo"', '"echo2"');
      serverMain.sync(dir, { installed: ["a1"], lang: "en", extensions: [{ id: "a1", version: "1.0.1", code: v2 }] });
      assert.equal((await serverMain.call(dir, "a1", "echo2")).lang, "en");
      // 停用后处理函数跟着撤掉
      serverMain.sync(dir, { installed: ["a1"], lang: "en", extensions: [] });
      await host.reload();
      await assert.rejects(serverMain.call(dir, "a1", "echo"), /没有在运行/);
      // 后台没起来（没有 socket）
      fs.rmSync(path.join(dir, "rpc.sock"));
      await assert.rejects(serverMain.call(dir, "a1", "echo"), /还没准备好/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("调用通道：socket 和目录的归属", async () => {
    const net = require("node:net");
    const { t3xCreateServerHost } = await import(path.join(ROOT, "host", "server.mjs"));
    const errors = [];
    const log = { info() {}, error: (...a) => errors.push(a.map(String).join(" ")) };
    const code = `export function activate(t3x) { t3x.handle("who", () => "host"); }`;
    const dir = tmp("t3x-own-");
    try {
      serverMain.sync(dir, { installed: ["a1"], extensions: [{ id: "a1", version: "1.0.0", code }] });
      // 另一个后台正占着 socket：不抢，它退了再接手
      const sock = path.join(dir, "rpc.sock");
      const other = net.createServer((c) => c.end(`${JSON.stringify({ ok: true, result: "other" })}\n`));
      await new Promise((r) => other.listen(sock, r));
      const host = t3xCreateServerHost({ dir, log, rpcRetryMs: 50 });
      await host.start();
      assert.equal(host.status().a1.state, "running");
      assert.equal(await serverMain.call(dir, "a1", "who"), "other", "活着的 socket 不能被摘走");
      other.close(); // 不等 close 回调：探测连接被这边先断开时它可能迟迟不来
      let got = null;
      for (let i = 0; i < 40 && got !== "host"; i++) {
        await new Promise((r) => setTimeout(r, 50));
        got = await serverMain.call(dir, "a1", "who").catch(() => null);
      }
      assert.equal(got, "host", "原来的退了以后接手");
      assert.equal(fs.statSync(sock).mode & 0o777, 0o600);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // 同名的普通文件不删；目录权限收紧
    const dir2 = tmp("t3x-own2-");
    try {
      fs.chmodSync(dir2, 0o755);
      fs.writeFileSync(path.join(dir2, "rpc.sock"), "keep");
      await t3xCreateServerHost({ dir: dir2, log }).start();
      assert.equal(fs.readFileSync(path.join(dir2, "rpc.sock"), "utf8"), "keep");
      assert.match(errors.join("\n"), /不是 socket/);
      assert.equal(fs.statSync(dir2).mode & 0o777, 0o700);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }

    // 目录是符号链接：什么都不加载
    const real = tmp("t3x-real-");
    const link = `${real}-link`;
    try {
      fs.symlinkSync(real, link);
      serverMain.sync(real, { installed: ["a1"], extensions: [{ id: "a1", version: "1.0.0", code }] });
      const host = t3xCreateServerHost({ dir: link, log });
      await host.start();
      assert.deepEqual(host.status(), {});
      assert(!fs.existsSync(path.join(real, "rpc.sock")));
      assert.match(errors.join("\n"), /不是自己的目录/);
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  test("host.server（apiVersion 6）：按扩展 id 走主进程，去掉 IPC 前缀；没有后台入口、停用、桌面版以外报错", async () => {
    const src = fs.readFileSync(path.join(ROOT, "host", "background.js"), "utf8");
    const load = (bridge) =>
      new Function("window", "t3xEntryList", "L", "subscribeLang", `${src}\nreturn serverApi;`)({ t3xServerBridge: { claim: () => bridge } }, pure.t3xEntryList, (zh) => zh, () => () => {});
    const calls = [];
    const bridge = {
      async call(id, name, data) {
        calls.push([id, name, data]);
        if (name === "bad") throw new Error("Error invoking remote method 't3x:server:call': Error: t3x: T3 后台还没准备好，稍后再试");
        if (name === "ext") throw new Error("Error invoking remote method 't3x:server:call': Error: 后台说不行");
        return { ok: 1 };
      },
    };
    const rec = (entries) => ({ manifest: { id: "agy-usage", entries } });
    const life = { alive: true };
    const api = load(bridge)(rec({ server: "server.mjs", web: "web.js" }), life);
    assert.deepEqual(await api.call("status", { x: 1 }), { ok: 1 });
    assert.deepEqual(calls, [["agy-usage", "status", { x: 1 }]]);
    await assert.rejects(api.call("bad"), /^Error: T3 后台还没准备好，稍后再试$/);
    await assert.rejects(api.call("ext"), /^Error: 后台说不行$/);
    assert.equal(load(bridge)(rec({ web: "web.js" }), life), undefined, "没有后台入口就没有 host.server");
    life.alive = false;
    await assert.rejects(api.call("status"), /已停用/);
    await assert.rejects(load(null)(rec({ server: "server.mjs" }), { alive: true }).call("status"), /桌面版/);
  });
};
