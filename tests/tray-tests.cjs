"use strict";
// apiVersion 7：菜单栏（tray-main.cjs 主进程、tray.js 窗口里的 host.tray）和会话最新回复（host.agent.replies）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const pure = require("../host/pure.js");
const trayMain = require("../host/tray-main.cjs");

const ROOT = path.join(__dirname, "..");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const { png, PNG, BROKEN, fakeElectron } = require("./fake-electron.cjs");

/** 单独求值 tray.js（宿主里和 core.js 等拼在一起）。 */
function loadTray(bridge) {
  const src = fs.readFileSync(path.join(ROOT, "host", "tray.js"), "utf8");
  return new Function("serverBridge", "L", "TAG", `${src}\nreturn { trayApi, hasTray };`)(bridge, (zh) => zh, "[t3x]");
}

/** 单独求值 usage.js：bind.atoms 换成假的 registry，记下订阅和请求。 */
function loadUsage({ env = "env-1" } = {}) {
  const src = fs.readFileSync(path.join(ROOT, "host", "usage.js"), "utf8");
  const made = [];
  const values = new Map();
  const subs = new Map();
  const registry = {
    get: (atom) => (values.has(atom) ? values.get(atom) : atom.key ? { _tag: "Initial", waiting: true } : undefined), // 用量 atom 先是 Initial，过滤 atom 没设时是 undefined
    subscribe: (atom, fn) => ((subs.get(atom) ?? subs.set(atom, new Set()).get(atom)).add(fn), () => subs.get(atom).delete(fn)),
  };
  const filterAtoms = new Map(); // 环境 -> 模型过滤 atom（和 T3 的 family 一样，同一个环境同一个）
  const usageModelFilterAtom = (env) => filterAtoms.get(env) ?? filterAtoms.set(env, { filterOf: env }).get(env);
  const bind = { atoms: { registry, server: { usageSummary: (key) => (made.push(key), { key }), usageModelFilterAtom } } };
  const React = { useMemo: (fn) => fn(), useCallback: (fn) => fn, useSyncExternalStore: (sub, get) => (sub(() => {}), get()), useReducer: () => [0, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }) };
  const state = { env };
  const api = new Function("bind", "React", "L", "subscribeChat", "currentEnvironment", `${src}\nreturn { usageInput, usageView, useAgentUsage };`)(bind, React, (zh) => zh, () => () => {}, () => state.env);
  return { ...api, made, values, subs, state, filterOf: usageModelFilterAtom };
}

module.exports = (test) => {
  test("用量（apiVersion 7）：和 T3 用量页一样的时间窗，结果换成文档里的形状，同一个时间窗不重复请求", () => {
    const u = loadUsage();
    const now = Date.UTC(2026, 10, 27, 3, 7, 30); // 上海 11:07
    assert.deepEqual(u.usageInput("7d", now, "Asia/Shanghai"), { sinceDay: "2026-11-21", untilDay: "2026-11-27", timeZone: "Asia/Shanghai", resolution: "day" });
    assert.deepEqual(u.usageInput("90d", now, "Asia/Shanghai").sinceDay, "2026-08-30");
    assert.deepEqual(u.usageInput("24h", now, "Asia/Shanghai"), { sinceDay: "2026-11-26", untilDay: "2026-11-27", timeZone: "Asia/Shanghai", resolution: "hour", sinceTime: "2026-11-26T03:05:00.000Z", untilTime: "2026-11-27T03:05:00.000Z" });
    assert.equal(u.usageInput("7d", now, "Not/AZone").timeZone, "UTC", "认不出的时区按 UTC，和 T3 一样");

    const ok = { _tag: "Success", waiting: false, value: { readAt: "r", timeZone: "Asia/Shanghai", sinceDay: "a", untilDay: "b", sources: [{ refreshing: false }, { fingerprint: { provider: "claude" }, status: "ok", distinctSessions: 3 }], buckets: [{ day: "2026-11-27", provider: "claude", model: "claude-opus-5-5", totals: { uncachedInputTokens: 10, cachedInputTokens: 20, cacheCreationTokens: 3, outputTokens: 4, reasoningTokens: 1 }, costUsd: 1.5, cacheSavingsUsd: 0.5, sessions: 2, unpricedRecords: 0, records: 9 }, { day: 1 }, null] } };
    const view = u.usageView(ok);
    assert.equal(u.usageView(ok), view, "同一个结果对象换出同一个视图（useSyncExternalStore 要求）");
    assert.deepEqual(view, { status: "ready", refreshing: false, error: null, summary: { readAt: "r", timeZone: "Asia/Shanghai", sinceDay: "a", untilDay: "b", sinceTime: null, untilTime: null, sources: [{ provider: "claude", status: "ok", distinctSessions: 3 }], buckets: [{ day: "2026-11-27", hourStart: null, provider: "claude", model: "claude-opus-5-5", uncachedInput: 10, cacheRead: 20, cacheWrite: 3, output: 4, reasoning: 1, costUsd: 1.5, cacheSavingsUsd: 0.5, sessions: 2, unpriced: false }] } });
    assert.equal(u.usageView({ ...ok, value: { ...ok.value, sources: [{ refreshing: true }] } }).refreshing, true, "有来源还在扫就算在刷新");
    assert.deepEqual([u.usageView({ _tag: "Failure", waiting: false }).status, u.usageView({ _tag: "Initial", waiting: true }).status, u.usageView(null).status], ["error", "loading", "unavailable"]);

    assert.throws(() => u.useAgentUsage("1y"), /range/);
    const first = u.useAgentUsage("7d");
    assert.equal(first.status, "loading");
    assert.equal(u.made.length, 1);
    assert.equal(u.made[0].environmentId, "env-1");
    assert.equal(u.made[0].input.resolution, "day");
    u.useAgentUsage("7d");
    assert.equal(u.made.length, 1, "同一个时间窗用同一个 atom");
    u.values.set([...u.subs.keys()].find((a) => a.key), ok); // 另一个订阅是模型过滤 atom
    assert.equal(u.useAgentUsage("7d").status, "ready");
    assert.equal(u.made[0].input.modelFilter, undefined, "T3 设置里没有模型过滤时不带");
    // T3 设置里有模型过滤：和 T3 用量页一样合进查询，换了过滤就换一个查询
    const filter = { exclude: [{ provider: "claude", model: "claude-haiku" }] };
    u.values.set(u.filterOf("env-1"), filter);
    u.useAgentUsage("7d");
    assert.equal(u.made.length, 2);
    assert.deepEqual(u.made[1].input.modelFilter, filter);
    // 24h：结果里带上这次查询的时间窗（桶从 sinceTime 起每 60 分钟一个）
    u.useAgentUsage("24h");
    const hourAtom = [...u.subs.keys()].find((a) => a.key?.input.resolution === "hour");
    u.values.set(hourAtom, { ...ok }); // 不同 atom 的结果是不同对象（视图按结果对象缓存）
    const hourly = u.useAgentUsage("24h").summary;
    assert.deepEqual([hourly.sinceTime, hourly.untilTime], [hourAtom.key.input.sinceTime, hourAtom.key.input.untilTime]);
    u.state.env = null;
    const made = u.made.length;
    assert.equal(u.useAgentUsage("7d").status, "unavailable", "还不知道当前环境时不请求");
    assert.equal(u.made.length, made);
  });

  test("用量（apiVersion 8）：environmentIds 查几个环境，照 T3 用量页的规则合并（同一份来源只算一次），读不出的略过", () => {
    const u = loadUsage({ env: null });
    assert.throws(() => u.useAgentUsage("7d", { environmentIds: "e1" }), /environmentIds/);
    assert.throws(() => u.useAgentUsage("7d", { environmentIds: [""] }), /environmentIds/);
    assert.equal(u.useAgentUsage("7d", { environmentIds: [] }).status, "unavailable");
    assert.equal(u.useAgentUsage("7d", { environmentIds: ["e1", "e2", "e1", "a\nb"] }).status, "loading", "还没读出来");
    assert.deepEqual(u.made.map((k) => k.environmentId), ["e1", "e2", "a\nb"], "每个环境一个查询，重复的只查一次，id 里的换行不拆");
    const atomOf = (env) => [...u.subs.keys()].find((a) => a.key?.environmentId === env);
    // 一份来源：哪台机器、哪个 provider、哪个目录；桶的 sourcePath 是来源目录
    const src = (host, path, sessions, status = "ok") => ({ fingerprint: { hostId: host, provider: "claude", resolvedHomePath: path, volumeId: "v" }, status, distinctSessions: sessions });
    const bucket = (path, model, cost) => ({ day: "2026-11-27", provider: "claude", model, sourcePath: path, totals: { outputTokens: 10 }, costUsd: cost });
    const summary = (readAt, sources, buckets) => ({ _tag: "Success", waiting: false, value: { contractVersion: 6, readAt, sinceDay: "a", untilDay: "b", sources, buckets } });
    const read = (ids) => u.useAgentUsage("7d", { environmentIds: ids });
    const cost = (v) => v.summary.buckets.reduce((n, b) => n + b.costUsd, 0);
    const sessions = (v) => v.summary.sources.reduce((n, x) => n + x.distinctSessions, 0);

    u.values.set(atomOf("e1"), summary("2026-11-27T10:00:00Z", [src("mac", "/u/.claude", 2)], [bucket("/u/.claude", "m1", 3)]));
    const partial = read(["e1", "e2"]);
    assert.deepEqual([partial.status, partial.refreshing, cost(partial)], ["ready", true, 3], "有的读出来了就先显示，还在读的标 refreshing");
    // e2 是同一台机器上的另一个后台，扫到同一份记录：T3 用量页只算一次（Codex 实测 T3 自己的合并是 $3、2 个会话）
    u.values.set(atomOf("e2"), summary("2026-11-27T09:00:00Z", [src("mac", "/u/.claude", 2)], [bucket("/u/.claude", "m1", 3)]));
    const shared = read(["e1", "e2"]);
    assert.deepEqual([shared.refreshing, cost(shared), sessions(shared)], [false, 3, 2], "同一份来源只算一次");
    // 同一个 provider 两份独立的来源（另一台机器）：都算
    u.values.set(atomOf("e2"), summary("2026-11-27T09:00:00Z", [src("vps", "/root/.claude", 5)], [bucket("/root/.claude", "m2", 4)]));
    const both = read(["e1", "e2"]);
    assert.deepEqual([cost(both), sessions(both), both.summary.buckets.map((b) => b.model)], [7, 7, ["m1", "m2"]]);
    // 读不出的略过；重试中的失败（waiting）仍算在读
    u.values.set(atomOf("e2"), { _tag: "Failure", waiting: true });
    assert.deepEqual([cost(read(["e1", "e2"])), read(["e1", "e2"]).refreshing], [3, true]);
    u.values.set(atomOf("e2"), { _tag: "Failure", waiting: false });
    assert.deepEqual([cost(read(["e1", "e2"])), read(["e1", "e2"]).refreshing], [3, false], "读不出的环境略过");
    u.values.set(atomOf("e1"), { _tag: "Failure", waiting: false });
    assert.equal(read(["e1", "e2"]).status, "error", "全读不出才是 error");
  });

  test("菜单栏清单：tray 权限要 apiVersion 7", () => {
    const ok = { id: "bar", apiVersion: 7, name: "Bar", version: "1.0.0", permissions: ["agent", "tray"], entries: { web: "web.js" } };
    pure.t3xCheckManifest(ok, { "web.js": "" });
    assert.throws(() => pure.t3xCheckManifest({ ...ok, apiVersion: 6 }, { "web.js": "" }), /apiVersion 7/);
  });

  test("菜单栏内容：校验类型、条数、长度，图标只收 PNG，文字压成一行", () => {
    const item = { id: "t:1", label: "a" };
    const notPng = `data:image/png;base64,${Buffer.from("fake png bytes that are long enough").toString("base64")}`;
    for (const bad of [null, { title: "x", items: "no" }, { items: [] }, { title: "x", popover: { width: "a" } }, { title: 1, items: [] }, { title: "x".repeat(41), items: [] }, { title: "x", icon: "data:image/svg+xml;base64,AAAA", items: [] }, { title: "x", icon: `data:image/png;base64,${"A".repeat(90 << 10)}`, items: [] }, { title: "x", icon: notPng, items: [] }, { title: "x", icon: png(513, 16), items: [] }, { title: "x", icon: `${PNG}!`, items: [] }, { title: "x", items: Array(61).fill(item) }, { title: "x", items: [{ id: "a b", label: "x" }] }, { title: "x", items: [{ id: "a", label: "  " }] }, { title: "x", items: [{ id: "a", label: "x", detail: {} }] }]) {
      assert.throws(() => trayMain.checkSpec(bad), /t3x:/, JSON.stringify(bad)?.slice(0, 80));
    }
    const bytes = Buffer.from(PNG.split(",")[1], "base64");
    const halfSig = Buffer.from(bytes);
    halfSig[4] = 0; // 前 4 字节对、后 4 字节不对
    assert.throws(() => trayMain.checkSpec({ icon: `data:image/png;base64,${halfSig.toString("base64")}` }), /不是 PNG/, "8 字节签名要全对");
    const big = Buffer.concat([bytes, Buffer.alloc((64 << 10) + 2 - bytes.length)]); // base64 长度没超、解出来多 2 字节
    assert.throws(() => trayMain.checkSpec({ icon: `data:image/png;base64,${big.toString("base64")}` }), /64 KB/, "解码后也不能超过 64 KB");
    assert.deepEqual(trayMain.checkSpec({ icon: PNG, items: [{ id: "a", label: " 第一\n行 ", detail: "d", tooltip: "两\n行", disabled: 1, separatorBefore: true, extra: 1 }] }), {
      title: "",
      tooltip: "",
      icon: PNG,
      template: true,
      items: [{ id: "a", label: "第一 行", detail: "d", tooltip: "两\n行", disabled: false, separatorBefore: true }],
      popover: null,
    });
    assert.deepEqual(trayMain.checkSpec({ title: "x" }).items, [], "items 可以不给（只用弹出小窗时）");
    assert.deepEqual(trayMain.checkSpec({ title: "x", template: false, popover: { width: 9000, height: 1 } }).popover, { width: 560, height: 60 }, "小窗大小夹在上下限里");
    assert.equal(trayMain.checkSpec({ title: "x", template: false }).template, false);
    trayMain.checkSpec({ title: "x", icon: png(400, 44) }); // 2x 的“图标 + 状态标签”：宽 200 点
    assert.throws(() => trayMain.checkSpec({ title: "x", icon: png(36, 65) }), /512×64/);
    const picked = [];
    const tpl = trayMain.menuTemplate(trayMain.checkSpec({ title: "2", items: [{ id: "h", label: "等你处理", disabled: true, separatorBefore: true }, { id: "t1", label: "会话", detail: "Codex", tooltip: "回复" }, { id: "t2", label: "另一个", separatorBefore: true }] }).items, (id) => picked.push(id));
    assert.deepEqual(tpl.map((t) => t.type ?? t.label), ["等你处理", "会话", "separator", "另一个"], "第一项前不放分隔线");
    assert.equal(tpl[0].enabled, false);
    assert.deepEqual([tpl[1].sublabel, tpl[1].toolTip, "sublabel" in tpl[3]], ["Codex", "回复", false]);
    tpl[1].click();
    assert.deepEqual(picked, ["t1"]);
  });

  test("菜单栏：每个窗口每个扩展一个图标，点击先提窗口再回给扩展，窗口关掉、重载时去掉", () => {
    const { electron, log, trays, sender } = fakeElectron();
    const m = trayMain.createTrays(electron);
    const w1 = sender(1);
    const spec = { title: "1", icon: PNG, items: [{ id: "t1", label: "会话" }] };
    assert.throws(() => m.set(w1, "../x", spec), /扩展 id/);
    m.set(w1, "bar", spec);
    assert.equal(trays.length, 1);
    assert.deepEqual([trays[0].img.reps, trays[0].img.template, trays[0].title], [[{ scaleFactor: 2, dataURL: PNG }], true, "1"]);
    m.set(w1, "bar", { ...spec, title: "2" });
    assert.equal(trays.length, 1, "同一个扩展再 set 是更新");
    assert.equal(trays[0].title, "2");
    assert(!log.includes("setImage"), "图标没变不重建");
    assert.throws(() => m.set(w1, "bar", { ...spec, icon: BROKEN }), /解不出/);
    assert.equal(trays[0].img.reps.length, 1, "解不出的图标不换掉原来的");
    assert.throws(() => m.set(w1, "new", { ...spec, icon: BROKEN }), /解不出/);
    assert.equal(trays.length, 1, "解不出的图标不建空托盘");
    m.set(w1, "bar", { title: "3", items: [] });
    assert(log.includes("setImage") && trays[0].img.reps.length === 0);
    m.set(w1, "bar", spec);
    trays[0].menu[0].click();
    assert.deepEqual(log.slice(-4), ["restore", "show", "focus", ["app.focus", { steal: true }]]);
    assert.deepEqual(w1.sent, [["t3x:tray:select", "bar", "t1"]]);

    m.set(w1, "pets", spec);
    const w2 = sender(2);
    m.set(w2, "bar", spec);
    assert.equal(m.count(), 3);
    m.clear(w1, "pets");
    assert.equal(m.count(), 2);
    w1.emit("did-navigate");
    assert.equal(m.count(), 1, "重载只去掉这个窗口的");
    assert(trays[0].destroyed && !trays[2].destroyed);
    m.set(w1, "bar", spec);
    w1.destroyed = true;
    trays.at(-1).menu[0].click();
    assert.equal(w1.sent.length, 1, "窗口没了不再回调");
    w1.emit("destroyed");
    w2.emit("render-process-gone");
    assert.equal(m.count(), 0);
  });

  test("最新回复：只读本机环境，取最后一条说完的 agent 回复，太长截断", () => {
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch {
      return console.log("  （这个 Node 没有 node:sqlite，跳过）");
    }
    const dir = tmp("t3x-replies-");
    try {
      const all = (threadIds, environmentId = "env-local") => trayMain.replies(dir, threadIds.map((threadId) => ({ environmentId, threadId })));
      assert.deepEqual(all(["t1"]), {}, "还没有 environment-id 时什么都不读");
      fs.writeFileSync(path.join(dir, "environment-id"), "env-local\n");
      assert.deepEqual(all(["t1"]), {}, "还没有库");
      const db = new DatabaseSync(path.join(dir, "statev2.sqlite"));
      db.exec("CREATE TABLE orchestration_v2_projection_messages (message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, run_id TEXT, node_id TEXT, role TEXT NOT NULL, streaming INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL)");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, deleted_at TEXT)");
      db.exec("INSERT INTO orchestration_v2_projection_threads VALUES ('t1', NULL), ('gone', '2026-01-02T00:00:00Z')");
      const add = db.prepare("INSERT INTO orchestration_v2_projection_messages VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?)");
      const row = (id, thread, role, streaming, at, text) => add.run(id, thread, role, streaming, at, at, JSON.stringify({ text }));
      row("m1", "t1", "assistant", 0, "2026-01-01T00:00:01Z", "旧的");
      row("m3", "t1", "assistant", 0, "2026-01-01T00:00:02Z", "新的");
      row("m2", "t1", "assistant", 0, "2026-01-01T00:00:02Z", "同一时刻 id 小的");
      row("m4", "t1", "assistant", 1, "2026-01-01T00:00:03Z", "还在写");
      row("m5", "t1", "user", 0, "2026-01-01T00:00:04Z", "问题");
      row("m6", "t2", "user", 0, "2026-01-01T00:00:01Z", "只有提问");
      row("m7", "t3", "assistant", 0, "2026-01-01T00:00:01Z", `  ${"长".repeat(2500)}  `);
      row("m8", "t4", "assistant", 0, "2026-01-01T00:00:01Z", "   ");
      row("m9", "gone", "assistant", 0, "2026-01-01T00:00:01Z", "删掉的会话");
      const sub = "thread:delegated-task:command%3Amcp%3A" + "a".repeat(100); // 真实 id 里有冒号、百分号，超过 128 字
      row("m10", sub, "assistant", 0, "2026-01-01T00:00:01Z", "子任务");
      row("m11", "import:codex:x", "assistant", 0, "2026-01-01T00:00:01Z", "导入的");
      // T3 后台开着写连接、还有没提交的写入时也能读，只看到已提交的
      db.exec("BEGIN IMMEDIATE");
      row("m12", "t1", "assistant", 0, "2026-01-01T00:00:09Z", "还没提交");
      const r = all(["t1", "t2", "t3", "t4", "t1", "gone", sub, "import:codex:x"]);
      assert.deepEqual(Object.keys(r).sort(), ["import:codex:x", sub, "t1", "t3"].sort());
      assert.deepEqual(r.t1, { text: "新的", at: "2026-01-01T00:00:02Z" });
      assert.equal(r.t3.text, `${"长".repeat(1999)}…`);
      db.exec("COMMIT");
      assert.equal(all(["t1"]).t1.text, "还没提交", "提交后读到新的");
      db.close();
      assert.deepEqual(all(["t1"], "env-remote"), {}, "远程环境的会话不在本机库里");
      for (const bad of [null, "t1", [{ environmentId: "env-local", threadId: "" }], [{ environmentId: "env-local", threadId: "x".repeat(513) }], [{ threadId: "t1" }], Array(201).fill({ environmentId: "e", threadId: "t" })]) {
        assert.throws(() => trayMain.replies(dir, bad), /t3x:/, JSON.stringify(bad)?.slice(0, 60));
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("主进程补丁：拼起来能编译，preload 调的每个通道主进程都登记了", () => {
    const { mainServerPatch, preloadPatch } = require("../lib/patch-server.cjs");
    const code = mainServerPatch.apply("/* T3 main.cjs */");
    new vm.Script(code); // 三个文件拼在同一个作用域：重名的顶层 const 在这里就报错
    const handled = [];
    const intercepted = [];
    const electron = { app: { isPackaged: true, on: (ev, fn) => intercepted.push(ev) }, ipcMain: { handle: (ch) => handled.push(ch) } };
    const fakeProcess = { ...process, versions: { ...process.versions, electron: "44" }, type: "browser", env: {} };
    new Function("require", "process", code)((m) => (m === "electron" ? electron : require(m)), fakeProcess);
    const invoked = [...preloadPatch.apply("").matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((x) => x[1]);
    assert(invoked.includes("t3x:tray:set") && invoked.includes("t3x:agent:replies"));
    assert.deepEqual(invoked.filter((ch) => !handled.includes(ch)), []);
    assert.equal(new Set(handled).size, handled.length, "同一个通道登记了两次");
    assert.deepEqual(intercepted, ["web-contents-created"], "要在窗口创建时包上 window.open 规则");
  });

  test("host.tray：权限、桌面版以外报错、图标只能是包里的 PNG、扩展 id 宿主填、停用时去掉", async () => {
    const calls = [];
    let select = null;
    const bridge = {
      tray: {
        async set(id, spec) {
          calls.push(["set", id, spec]);
          if (spec.title === "bad") throw new Error("Error invoking remote method 't3x:tray:set': Error: t3x: title 需要是不超过 40 字的字符串");
        },
        async clear(id) {
          calls.push(["clear", id]);
        },
        onSelect: (fn) => (select = fn),
      },
    };
    const { trayApi } = loadTray(bridge);
    const rec = (permissions, files = {}) => ({ manifest: { id: "bar", permissions, assets: ["icon.png", "pic.webp"] }, files });
    const life = { alive: true, disposers: [] };
    assert.throws(() => trayApi(rec(["agent"]), life).onSelect(() => {}), /"tray"/);
    await assert.rejects(trayApi(rec(["agent"]), life).set({ title: "1", items: [] }), /"tray"/);
    const api = trayApi(rec(["tray"], { "icon.png": PNG, "web.js": "code", "pic.webp": "data:image/webp;base64,AAAA" }), life);
    await assert.rejects(api.set({ icon: "nope.png", items: [] }), /PNG/);
    await assert.rejects(api.set({ icon: "web.js", items: [] }), /PNG/);
    await assert.rejects(api.set({ icon: "pic.webp", items: [] }), /PNG/);
    await assert.rejects(api.set({ icon: "constructor", items: [] }), /PNG/);
    await assert.rejects(trayApi({ manifest: { id: "bar", permissions: ["tray"], assets: [] }, files: { "icon.png": PNG } }, life).set({ icon: "icon.png", items: [] }), /PNG/, "要在 assets 里声明");
    await api.set({ title: "1", icon: "icon.png", items: [{ id: "t1", label: "会话" }], extra: 1 });
    assert.deepEqual(calls, [["set", "bar", { title: "1", tooltip: undefined, icon: PNG, template: undefined, items: [{ id: "t1", label: "会话" }], popover: undefined }]]);
    await assert.rejects(api.set({ title: "bad", items: [] }), /^Error: title 需要是不超过 40 字的字符串$/);

    const got = [];
    const other = trayApi({ manifest: { id: "other", permissions: ["tray"] }, files: {} }, { alive: true, disposers: [] });
    other.onSelect((item) => got.push(["other", item]));
    api.onSelect((item) => got.push(["bar", item]));
    const off = api.onSelect((item) => got.push(["bar2", item]));
    select("bar", "t1");
    off();
    select("bar", "t2");
    select("other", "x");
    assert.deepEqual(got, [["bar", "t1"], ["bar2", "t1"], ["bar", "t2"], ["other", "x"]]);

    for (const fn of life.disposers.splice(0).reverse()) fn();
    life.alive = false;
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.at(-1), ["clear", "bar"], "停用时去掉图标");
    select("bar", "t3");
    assert.equal(got.length, 4, "停用后不再回调");
    await assert.rejects(api.set({ title: "1", items: [] }), /已停用/);
    await assert.rejects(loadTray(null).trayApi(rec(["tray"]), { alive: true, disposers: [] }).set({ title: "1", items: [] }), /桌面版/);
  });
};
