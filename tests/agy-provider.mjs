// 用官方 app 里真的 Antigravity provider、managed provider 和 ProviderRegistry（打过补丁的 T3 后台模块）跑额度接回的各种时序。由 verify.cjs 起子进程调用：
//   node tests/agy-provider.mjs <补丁后的 server-*.mjs，末尾加了测试用的导出> <同目录的 Schema-*.mjs> <补丁后的 runtimeLayer-*.mjs>
// 健康检查的 probe、driver 的读取都是假的，它们等的 Promise 由这里决定什么时候兑现，用来造“读的时候登出了”“检查卡住时登出”之类的时序。
// 假读取照 driver 的样子：先等“前面的查询”（hasSource、解析 CLI 路径），再问 provider 这次还算不算数，算数才调用扩展。
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";

const [serverFile, schemaFile, managedFile] = process.argv.slice(2);
// T3 后台模块顶层 require 了一个原生包，这里用不到
const load = Module._load;
Module._load = function (id, ...rest) {
  return id === "@ff-labs/fff-node" ? {} : load.call(this, id, ...rest);
};
const T = await import(serverFile);
const R = (await import(managedFile)).t3xRegistryTest;
const runPromise = (await import(schemaFile))[/\brunPromise as ([\w$]+)[,}]/.exec(fs.readFileSync(schemaFile, "utf8"))[1]];
const { t3xCreateServerHost } = await import(new URL("../host/server.mjs", import.meta.url));
globalThis.__t3xServer = t3xCreateServerHost({ dir: undefined, log: { info() {}, error() {} } });

const { gen, sync, promise, succeed, suspend, fail, sleep, scoped, provideService, forkIn, runForEach, scope, empty } = T.t3xTest;
const host = {
  settings: { get: succeed({ backgroundActivityProfile: "custom", backgroundActivity: { profile: "custom", baseProfile: "balanced", overrides: { providerHealthRefreshInterval: "0 seconds" } } }), subscribe: succeed(empty) },
  shouldRunBackgroundWork: () => succeed(false),
  awaitServerReady: promise(() => new Promise(() => {})), // 不自动做第一次检查，由这里调 refresh
};
const at = (minutes) => new Date(Date.UTC(2026, 10, 27, 0, minutes)).toISOString();
const usage = (gemini, minutes) => ({ checkedAt: at(minutes), windows: [{ id: "3p-5h", kind: "session", label: "3p", usedPercent: 100 }, { id: "gemini-weekly", kind: "weekly", label: "Gemini", usedPercent: gemini }] });
const failed = (minutes) => ({ checkedAt: at(minutes), windows: [], unavailable: { reason: "probeFailed", message: "agy 说不行" } });
const session = (models) => ({
  initializeResult: { agentInfo: { version: "1" } },
  sessionSetupResult: { configOptions: [{ id: "model", type: "select", currentValue: models[0], options: models.map((value) => ({ value, name: value })) }] },
});
const gate = () => {
  let open;
  const promise = new Promise((resolve) => (open = resolve));
  return { promise, open };
};

const program = (withExtension) =>
  gen(function* () {
    const s = yield* scope;
    // probeGate / lookupGate 不为空时，健康检查 / 读取前的查询停在那里；missing 时健康检查报找不到 CLI
    const state = { probes: 0, calls: [], valids: [], published: [], probeGate: null, lookupGate: null, missing: false, hasSource: true };
    const probe = gen(function* () {
      state.probes++;
      const missing = state.missing; // 检查开始时的结果，停在 probeGate 上也不变
      yield* promise(() => state.probeGate?.promise ?? Promise.resolve());
      if (missing) return yield* fail({ _tag: "ProviderSetupError", operation: "resolve", detail: "Antigravity is not installed" });
      return { agentInfo: { version: "1" } };
    });
    // 照 driver：没有来源返回 undefined；查询完核对 stillValid；validNow 记下来，核对“调用扩展那一刻”的判断
    const read = (stillValid, validNow) =>
      gen(function* () {
        if (!withExtension || !state.hasSource) return undefined;
        if (state.lookupGate) yield* promise(() => state.lookupGate.promise);
        if (!(yield* stillValid)) return null;
        state.valids.push(validNow);
        return yield* promise(() => new Promise((resolve) => state.calls.push(resolve)));
      });
    const provider = yield* T.t3xTest.makeAntigravityProvider({ enabled: true }, {
      auth: { type: "oauth-personal", label: "Google account" },
      stampIdentity: (draft) => succeed(draft),
      probe,
      supportsTextGeneration: succeed(false),
      t3xProbeUsage: read,
    });
    yield* runForEach(provider.snapshot.streamChanges, (snapshot) => sync(() => state.published.push(snapshot))).pipe(forkIn(s, { startImmediately: true }));
    const flush = sleep("40 millis");
    const last = () => state.published.at(-1);
    const windows = (snapshot) => Object.fromEntries((snapshot.usageLimits?.windows ?? []).map((w) => [w.id, { used: w.usedPercent, modelIds: w.modelIds }]));
    // 在后台跑（健康检查可能停在 probeGate 上）
    const background = (effect) => effect.pipe(forkIn(s));
    return { provider, state, flush, last, windows, background };
  });

const run = (fn) => runPromise(scoped(gen(fn).pipe(provideService(T.t3xTest.ProviderHost, host))));

await run(function* () {
  const { provider, state, flush, last, windows, background } = yield* program(true);
  const draft = () => provider.snapshot.getSnapshot;
  // 发布过的每一个快照都不能是“登出了却还带着额度”
  const neverSignedOutWithUsage = () => assert(!state.published.some((s) => s.auth.status === "unauthenticated" && s.usageLimits !== undefined), "发布过登出状态带着额度的快照");

  // 健康检查通过后读一次；读完发布出去，发布时不另做健康检查
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(state.calls.length, 1, "健康检查通过后读一次");
  assert.equal(last().usageLimits, undefined);
  state.calls[0](usage(40, 1));
  yield* flush;
  assert.deepEqual(windows(last()), { "3p-5h": { used: 100, modelIds: [] }, "gemini-weekly": { used: 40, modelIds: [] } }, "读到的额度发布出去；还没有模型列表时池认得出的窗口写空列表（不卡之后才出现的模型）");
  assert.equal(state.probes, 1, "发布额度不另做健康检查");

  // 模型列表变了：已发布的 modelIds 跟着改（含默认模型的别名）；Claude 和 GPT 的额度满了不挡 Gemini
  yield* provider.onSessionStarted(session(["gemini-1", "claude-1"]));
  yield* flush;
  assert.deepEqual(windows(last()), { "3p-5h": { used: 100, modelIds: ["antigravity-default", "claude-1"] }, "gemini-weekly": { used: 40, modelIds: ["gemini-1", "antigravity-default"] } }, "模型列表变了重写 modelIds，别名也算");
  assert.equal(state.calls.length, 1, "已经有额度时会话启动不再读");
  yield* provider.onSessionStarted(session(["claude-1", "gemini-1"]));
  yield* flush;
  yield* provider.snapshot.refresh; // 普通健康检查发布的也要按新列表
  yield* flush;
  state.calls[1](usage(40, 2));
  yield* flush;
  yield* provider.onSessionStarted(session(["gemini-1", "claude-1"])); // 再换回来
  yield* flush;
  assert.deepEqual(windows(last())["gemini-weekly"].modelIds, ["gemini-1", "antigravity-default"], "列表换回去后 modelIds 也跟着换回去");
  const settled = state.published.length;
  yield* flush;
  assert.equal(state.published.length, settled, "发布完不会来回发");

  // 后来的读取失败：draft 和已发布的都保留上一次成功的
  yield* provider.snapshot.refresh;
  yield* flush;
  state.calls[2](failed(3));
  yield* flush;
  assert.equal(windows(last())["gemini-weekly"].used, 40, "已发布的保留上一次成功的");
  assert.equal((yield* draft()).usageLimits?.windows?.find((w) => w.id === "gemini-weekly")?.usedPercent, 40, "draft 也保留，和已发布的一致");

  // 读的时候登录了（可能换了账号）：清掉旧额度；旧的读取回来前不再调用扩展，回来后作废，再读新账号的
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(state.calls.length, 4);
  assert.equal(state.valids[3](), true);
  yield* provider.t3xOnSignedIn;
  yield* flush;
  assert.equal(state.valids[3](), false, "登录后旧读取在调用扩展那一刻也不算数");
  assert.equal(last().usageLimits, undefined, "登录后已发布的旧额度清掉");
  yield* provider.onSessionStarted(session(["gemini-1", "claude-1"]));
  yield* flush;
  assert.equal(state.calls.length, 4, "旧的读取还没回来时不同时再读");
  state.calls[3](usage(99, 4));
  yield* flush;
  assert.equal(state.calls.length, 5, "旧的回来后接着读新账号的");
  assert.equal(last().usageLimits, undefined, "旧账号的结果作废");
  state.calls[4](usage(20, 5));
  yield* flush;
  assert.deepEqual(windows(last())["gemini-weekly"], { used: 20, modelIds: ["gemini-1", "antigravity-default"] });

  // 健康检查卡在半路时登出：不等检查，登出和清掉额度一起发布；检查放行后也不会把额度带回来
  state.probeGate = gate();
  yield* background(provider.snapshot.refresh);
  yield* flush;
  yield* provider.onSignedOut;
  yield* flush;
  assert.equal(last().auth.status, "unauthenticated");
  assert.equal(last().usageLimits, undefined, "检查还没完就已经清掉");
  state.probeGate.open();
  state.probeGate = null;
  yield* flush;
  assert.equal(last().usageLimits, undefined, "检查完也没有带回来");
  assert.equal((yield* draft()).usageLimits, undefined);
  neverSignedOutWithUsage();

  // 登出状态下健康检查不读
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(state.calls.length, 5, "登出状态下不读");

  // 读取前的查询还没完时登出：不调用扩展
  yield* provider.t3xOnSignedIn;
  state.lookupGate = gate();
  yield* provider.onSessionStarted(session(["gemini-1"]));
  yield* flush;
  yield* provider.onSignedOut;
  state.lookupGate.open();
  state.lookupGate = null;
  yield* flush;
  assert.equal(state.calls.length, 5, "登出以后不再调用扩展");
  neverSignedOutWithUsage();

  // 重新登录后第一次就读失败：面板上显示原因
  yield* provider.t3xOnSignedIn;
  yield* provider.onSessionStarted(session(["gemini-1"]));
  yield* flush;
  assert.equal(state.calls.length, 6);
  state.calls[5](failed(6));
  yield* flush;
  assert.equal(last().usageLimits?.unavailable?.message, "agy 说不行", "从没读成过就显示原因");

  // 读的时候 CLI 不见了：清掉额度，正在读的结果作废，找不到 CLI 时不读
  yield* provider.snapshot.refresh;
  yield* flush;
  state.calls[6](usage(10, 7));
  yield* flush;
  assert.equal(windows(last())["gemini-weekly"].used, 10);
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(state.calls.length, 8);
  state.missing = true;
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(last().installed, false);
  assert.equal(last().usageLimits, undefined, "找不到 CLI 时清掉额度");
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(state.calls.length, 8, "找不到 CLI 时不读");
  state.missing = false; // CLI 又回来了：新的读取排在旧的后面
  yield* provider.snapshot.refresh;
  yield* flush;
  assert.equal(state.calls.length, 8, "旧的还没回来时不同时再读");
  state.calls[7](usage(77, 8));
  yield* flush;
  assert.equal(last().usageLimits, undefined, "CLI 不见之前开始的读取回来也不带回额度");
  assert.equal((yield* draft()).usageLimits, undefined);
  assert.equal(state.calls.length, 9, "接着读");
  state.calls[8](usage(30, 9));
  yield* flush;
  assert.equal(windows(last())["gemini-weekly"].used, 30);
  // 一次“找不到 CLI”的检查卡在半路，期间 CLI 回来、会话重新开始并读到了：卡住的检查回来时已经过期，不能作废新的读取
  state.missing = true;
  state.probeGate = gate();
  yield* background(provider.snapshot.refresh);
  yield* flush;
  state.missing = false;
  yield* provider.t3xOnSignedIn;
  yield* provider.onSessionStarted(session(["gemini-1"]));
  yield* flush;
  const fresh = state.calls.length;
  state.probeGate.open();
  state.probeGate = null;
  yield* flush;
  state.calls[fresh - 1](usage(55, 10));
  yield* flush;
  assert.equal(windows(last())["gemini-weekly"]?.used, 55, "过期的找不到 CLI 检查不作废新会话的读取");
  neverSignedOutWithUsage();
});

// 没有扩展接手：什么都不发布，额度一直没有
await run(function* () {
  const { provider, state, flush, last } = yield* program(false);
  yield* provider.snapshot.refresh;
  yield* flush;
  yield* provider.onSessionStarted(session(["gemini-1"]));
  yield* flush;
  assert.equal(last().usageLimits, undefined);
  assert.equal(state.probes, 1);
  assert(state.published.every((s) => s.usageLimits === undefined));
});

// 后台扩展停用、启用、升级（宿主的来源变了）：不等健康检查马上重新读；读的时候又变了就排队，读完再读一次
{
  const real = globalThis.__t3xServer;
  let version = 0;
  let waiters = [];
  const bump = () => {
    version += 1;
    for (const resolve of waiters.splice(0)) resolve();
  };
  let hasSource = true;
  let registered = true;
  const retired = new WeakSet();
  globalThis.__t3xServer = {
    ...real,
    hasSource: async () => hasSource,
    hasRegisteredSource: () => registered,
    resultCurrent: (driver, result) => !retired.has(result),
    sourcesVersion: () => version,
    whenSourcesChange: (v) => (v !== version ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
  };
  await run(function* () {
    const { state, flush, last, windows, provider, background } = yield* program(true);
    yield* provider.snapshot.refresh;
    yield* flush;
    state.calls[0](usage(40, 1));
    yield* flush;
    bump();
    yield* flush;
    assert.equal(state.calls.length, 2, "来源变了马上重新读");
    bump();
    yield* flush;
    assert.equal(state.calls.length, 2, "读的时候又变了：不同时再读");
    state.calls[1](usage(50, 2));
    yield* flush;
    assert.equal(state.calls.length, 3, "读完再读一次");
    state.calls[2](usage(60, 3));
    yield* flush;
    assert.equal(windows(last())["gemini-weekly"].used, 60);
    assert.equal(state.probes, 1, "来源变了不做健康检查");
    // 来源没了：不等正在读的那个回来，马上清掉；它回来也作废
    yield* provider.snapshot.refresh;
    yield* flush;
    assert.equal(state.calls.length, 4);
    registered = false; // 来源没了，但还有个加载失败的扩展（hasSource 照样是 true）
    state.hasSource = false;
    bump();
    yield* flush;
    assert.equal(last().usageLimits, undefined, "来源没了马上清掉，不管有没有加载失败的扩展");
    state.calls[3](usage(70, 4));
    yield* flush;
    assert.equal(last().usageLimits, undefined, "来源没了之前开始的读取作废");
    registered = true;
    state.hasSource = true;
    bump();
    yield* flush;
    state.calls[4](usage(80, 5));
    yield* flush;
    assert.equal(windows(last())["gemini-weekly"].used, 80, "来源回来了再读");
    // 读到结果之后、存进去之前来源被换掉了：这份结果不算
    yield* provider.snapshot.refresh;
    yield* flush;
    const late = usage(99, 6);
    retired.add(late);
    state.calls[5](late);
    yield* flush;
    assert.equal(windows(last())["gemini-weekly"].used, 80, "被换掉的来源读到的结果不存");
    // 登录时清掉额度和 authRevision 加一在同一次更新里：卡在半路的“找不到 CLI”检查回来时认得出已经过期，
    // 不作废登录后（会话还没开始）就开始的读取
    state.missing = true;
    state.probeGate = gate();
    yield* background(provider.snapshot.refresh);
    yield* flush;
    state.missing = false;
    yield* provider.t3xOnSignedIn;
    bump(); // 来源变了，触发登录后的这次读取
    yield* flush;
    assert.equal(state.calls.length, 7, "登录后开始读");
    state.probeGate.open();
    state.probeGate = null;
    yield* flush;
    state.calls[6](usage(65, 7));
    yield* flush;
    assert.equal(windows(last())["gemini-weekly"]?.used, 65, "登录前开始的找不到 CLI 检查不作废登录后的读取");
    // 找不到 CLI 时来源变了也不读
    state.missing = true;
    yield* provider.snapshot.refresh;
    yield* flush;
    bump();
    yield* flush;
    assert.equal(state.calls.length, 7, "找不到 CLI 时来源变了也不读");
    assert.equal(last().usageLimits, undefined);
  });
  globalThis.__t3xServer = real;
}

// managed provider（打开 t3xEnrichUsage）：健康检查取快照之后状态变了（比如登出），检查提交时不能把旧快照发出去
await run(function* () {
  const s = yield* scope;
  const snap = (v, auth, used) => ({ instanceId: "x", enabled: true, installed: true, status: "ready", auth: { status: auth }, v, ...(used === undefined ? {} : { usageLimits: { checkedAt: at(v), windows: [{ id: "gemini-weekly", kind: "weekly", label: "G", usedPercent: used }] } }) });
  let current = snap(0, "unknown"); // 启动占位
  let wake = gate();
  let held = null;
  const managed = yield* T.t3xTest.makeManagedServerProvider({
    t3xEnrichUsage: true,
    resolveMaintenance: () => succeed({}),
    getSettings: succeed({}),
    streamSettings: empty,
    haveSettingsChanged: () => false,
    initialSnapshot: () => succeed(current),
    t3xCurrentSnapshot: suspend(() => succeed(current)),
    checkProvider: suspend(() => {
      const h = held; // 放行前就取好：放行后 held 会被清掉
      return h ? promise(() => h.gate.promise.then(() => h.snapshot)) : succeed(current);
    }),
    enrichSnapshot: ({ publishSnapshot }) =>
      gen(function* () {
        for (;;) {
          yield* publishSnapshot(current);
          yield* promise(() => wake.promise);
        }
      }),
  });
  const published = [];
  yield* runForEach(managed.streamChanges, (snapshot) => sync(() => published.push(snapshot))).pipe(forkIn(s, { startImmediately: true }));
  const flush = sleep("40 millis");
  const change = (next) => {
    current = next;
    const w = wake;
    wake = gate();
    w.open();
  };
  current = snap(1, "authenticated", 40); // 第一次检查时 provider 已经是这个状态
  const first = yield* managed.refresh;
  yield* flush;
  assert.equal(first.v, 1, "refresh 返回 provider 现在的快照，不是启动占位");
  assert(!published.some((p) => p.v === 0), "不发布启动占位");
  held = { gate: gate(), snapshot: current }; // 检查取到的是登出前的快照
  yield* managed.refresh.pipe(forkIn(s));
  yield* flush;
  change(snap(2, "unauthenticated"));
  yield* flush;
  assert.equal(published.at(-1).v, 2, "登出不等检查就发布");
  held.gate.open();
  held = null;
  yield* flush;
  const signedOut = published.findIndex((p) => p.v === 2);
  assert(published.slice(signedOut).every((p) => p.v === 2 && p.usageLimits === undefined), "检查提交时不把旧快照发出去");
  assert.equal((yield* managed.getSnapshot).v, 2);
  assert.equal(yield* managed.isAwaitingFirstCheck, false);
});

// managed provider：检查开始时还没有额度，检查期间读到额度、随后又登出清掉了，检查提交时也不能把检查前的已登录快照发出去
await run(function* () {
  const s = yield* scope;
  const snap = (v, auth, used) => ({ instanceId: "x", enabled: true, installed: true, status: "ready", auth: { status: auth }, v, ...(used === undefined ? {} : { usageLimits: { checkedAt: at(v), windows: [{ id: "gemini-weekly", kind: "weekly", label: "G", usedPercent: used }] } }) });
  let current = snap(1, "authenticated");
  let wake = gate();
  let held = null;
  const managed = yield* T.t3xTest.makeManagedServerProvider({
    t3xEnrichUsage: true,
    resolveMaintenance: () => succeed({}),
    getSettings: succeed({}),
    streamSettings: empty,
    haveSettingsChanged: () => false,
    initialSnapshot: () => succeed(current),
    t3xCurrentSnapshot: suspend(() => succeed(current)),
    checkProvider: suspend(() => {
      const h = held;
      return h ? promise(() => h.gate.promise.then(() => h.snapshot)) : succeed(current);
    }),
    enrichSnapshot: ({ publishSnapshot }) =>
      gen(function* () {
        for (;;) {
          yield* publishSnapshot(current);
          yield* promise(() => wake.promise);
        }
      }),
  });
  const published = [];
  yield* runForEach(managed.streamChanges, (snapshot) => sync(() => published.push(snapshot))).pipe(forkIn(s, { startImmediately: true }));
  const flush = sleep("40 millis");
  const change = (next) => {
    current = next;
    const w = wake;
    wake = gate();
    w.open();
  };
  yield* managed.refresh;
  yield* flush;
  held = { gate: gate(), snapshot: snap(2, "authenticated") }; // 检查取到的快照还没有额度
  yield* managed.refresh.pipe(forkIn(s));
  yield* flush;
  change(snap(3, "authenticated", 40)); // 检查期间读到额度
  yield* flush;
  change(snap(4, "unauthenticated")); // 又登出了，额度清掉
  yield* flush;
  held.gate.open();
  held = null;
  yield* flush;
  const signedOut = published.findIndex((p) => p.v === 4);
  assert(signedOut >= 0 && published.slice(signedOut).every((p) => p.v === 4), `登出后不再发布检查前的快照：${published.map((p) => p.v)}`);
});

// managed provider：打开了 t3xEnrichUsage，但已发布的和这次检查的都没有额度（没装额度扩展）时，照 T3 原样发布、返回检查结果
await run(function* () {
  const s = yield* scope;
  const snap = (v) => ({ instanceId: "x", enabled: true, installed: true, status: "ready", auth: { status: "authenticated" }, v });
  const managed = yield* T.t3xTest.makeManagedServerProvider({
    t3xEnrichUsage: true,
    resolveMaintenance: () => succeed({}),
    getSettings: succeed({}),
    streamSettings: empty,
    haveSettingsChanged: () => false,
    initialSnapshot: () => succeed(snap(0)),
    t3xCurrentSnapshot: succeed(snap(99)), // 走了 enrichment 那条路才会拿到它
    checkProvider: succeed(snap(1)),
    enrichSnapshot: () => promise(() => new Promise(() => {})), // enrichment 一直不发布
  });
  const published = [];
  yield* runForEach(managed.streamChanges, (snapshot) => sync(() => published.push(snapshot))).pipe(forkIn(s, { startImmediately: true }));
  const checked = yield* managed.refresh;
  yield* sleep("40 millis");
  assert.equal(checked.v, 1, "没有额度时返回检查结果");
  assert.deepEqual(published.map((p) => p.v), [1], "没有额度时检查结果由 managed 自己发布");
});

// ProviderRegistry 合并：冷启动时 provider 还没有模型列表，registry 合入上次保存的模型后要重算 modelIds
await runPromise(scoped(gen(function* () {
  const s = yield* scope;
  const instanceChanges = yield* R.unbounded();
  const snapshotChanges = yield* R.unbounded();
  const base = { instanceId: "antigravity", driver: "antigravity", displayName: "Antigravity", enabled: true, installed: true, slashCommands: [], skills: [] };
  const saved = { ...base, status: "ready", auth: { status: "authenticated", type: "oauth-personal" }, checkedAt: at(0), models: [{ slug: "gemini-1", name: "Gemini 1", isCustom: false }, { slug: "claude-1", name: "Claude 1", isCustom: false }] };
  let current = saved;
  const instance = {
    instanceId: "antigravity",
    driverKind: "antigravity",
    snapshot: { getSnapshot: suspend(() => succeed(current)), refresh: succeed(saved), streamChanges: R.fromPubSub(snapshotChanges), isAwaitingFirstCheck: succeed(false) },
  };
  const ctx = yield* R.build(R.layer).pipe(
    provideService(R.ProviderInstanceRegistry, { listInstances: succeed([instance]), listUnavailable: succeed([]), getInstance: (id) => succeed(id === instance.instanceId ? instance : void 0), subscribeChanges: R.subscribe(instanceChanges) }),
    provideService(R.ProviderInstanceRegistryMutator, {}),
    provideService(R.ModelManifest, { current: succeed({ updatedAt: at(0), compatibility: [] }), refresh: succeed(void 0) }),
    provideService(R.ProviderLatestVersions, {}),
    provideService(R.ServerConfig, { providerStatusCacheDir: "/tmp/t3x-unused" }),
    provideService(R.FileSystem, new Proxy({ exists: () => succeed(false) }, { get: (t, k) => t[k] ?? (() => fail({ reason: { _tag: "Unknown" } })) })),
    provideService(R.Path, path),
    provideService(R.Environment, { PATH: "" }),
    provideService(R.ChildProcessSpawner, {}),
  );
  const registry = yield* R.ProviderRegistry.pipe(R.provide(ctx));
  const published = [];
  yield* runForEach(registry.streamChanges, (providers) => sync(() => published.push(providers))).pipe(forkIn(s, { startImmediately: true }));
  current = globalThis.__t3xServer.routeUsage("antigravity", { ...base, status: "warning", auth: { status: "unknown" }, checkedAt: at(1), models: [], usageLimits: usage(0, 1) });
  yield* R.publish(snapshotChanges, current);
  yield* sleep("40 millis");
  const agy = published.at(-1)?.find((p) => p.instanceId === "antigravity");
  assert(agy, "registry 应发布合并后的 Antigravity 快照");
  assert.deepEqual(agy.models.map((m) => m.slug), ["gemini-1", "claude-1"], "冷启动应保留上次保存的模型列表");
  const w3p = agy.usageLimits?.windows?.find((w) => w.id === "3p-5h");
  const wGem = agy.usageLimits?.windows?.find((w) => w.id === "gemini-weekly");
  assert.deepEqual(w3p?.modelIds, ["claude-1"], "合并模型后 3p-5h 的 modelIds 应含 claude-1 且不含 gemini-1");
  assert.deepEqual(wGem?.modelIds, ["gemini-1"], "合并模型后 gemini-weekly 的 modelIds 应含 gemini-1 且不含 claude-1");
})));

console.log("ok");
