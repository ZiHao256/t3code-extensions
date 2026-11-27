// apiVersion 7：host.agent.useUsage(range)，T3 自己用量页的那份数据：后台按天（24h 按小时）、provider、模型汇总的 token，
// 和按 T3 里设的价格表估算的费用。读的是 T3 的 atom（bind.atoms.server.usageSummary），和 T3 用量页同一份、同一套价格。
const USAGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
const USAGE_SLOT_MS = 5 * 60_000; // 24h 的时间窗每 5 分钟往前挪一次：每分钟都换会让 T3 每分钟重新扫一遍
const usageAtoms = new Map(); // `${环境}|${输入}` -> atom：同一个时间窗用同一个 atom，不重复请求

/** 和 T3 用量页一样的时间窗（usageFormat 里的那段）：24h 按小时、到这一刻为止；其余按天，含今天。 */
function usageInput(range, now, timeZone) {
  let tz = timeZone;
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    tz = "UTC";
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  }
  if (range === "24h") {
    const until = Math.floor(now / USAGE_SLOT_MS) * USAGE_SLOT_MS;
    const since = until - 24 * 3600_000;
    return { sinceDay: fmt.format(since), untilDay: fmt.format(until), timeZone: tz, resolution: "hour", sinceTime: new Date(since).toISOString(), untilTime: new Date(until).toISOString() };
  }
  const today = fmt.format(now);
  const [y, m, d] = today.split("-").map(Number);
  const sinceDay = new Date(Date.UTC(y, m - 1, d - (USAGE_DAYS[range] - 1))).toISOString().slice(0, 10);
  return { sinceDay, untilDay: today, timeZone: tz, resolution: "day" };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** T3 的 UsageSummary 换成扩展用的形状：只留文档里写的字段，数字缺了按 0。input 是这次查询的时间窗（24h 的桶从 sinceTime 起每 60 分钟一个）。 */
function usageSummaryView(v, input) {
  const buckets = (Array.isArray(v?.buckets) ? v.buckets : [])
    .filter((b) => b && typeof b.day === "string" && typeof b.provider === "string")
    .map((b) => ({
      day: b.day,
      hourStart: typeof b.hourStart === "string" ? b.hourStart : null,
      provider: b.provider,
      model: typeof b.model === "string" ? b.model : "",
      uncachedInput: num(b.totals?.uncachedInputTokens),
      cacheRead: num(b.totals?.cachedInputTokens),
      cacheWrite: num(b.totals?.cacheCreationTokens),
      output: num(b.totals?.outputTokens),
      reasoning: num(b.totals?.reasoningTokens),
      costUsd: num(b.costUsd),
      cacheSavingsUsd: num(b.cacheSavingsUsd),
      sessions: num(b.sessions),
      unpriced: num(b.unpricedRecords) > 0,
    }));
  // 会话数不能把桶加起来（同一个会话跨天、跨模型会在几个桶里各算一次）：T3 用量页用每个来源去重后的 distinctSessions
  const sources = (Array.isArray(v?.sources) ? v.sources : [])
    .filter((x) => x && typeof x.fingerprint?.provider === "string")
    .map((x) => ({ provider: x.fingerprint.provider, status: typeof x.status === "string" ? x.status : null, distinctSessions: num(x.distinctSessions) }));
  return {
    readAt: v?.readAt ?? null,
    timeZone: v?.timeZone ?? null,
    sinceDay: v?.sinceDay ?? null,
    untilDay: v?.untilDay ?? null,
    sinceTime: input?.sinceTime ?? null,
    untilTime: input?.untilTime ?? null,
    buckets,
    sources,
  };
}

const usageViews = new WeakMap(); // atom 的结果对象 -> 换好的形状：useSyncExternalStore 每次渲染都要拿到同一个对象
/** atom 的 Result（Initial / Success / Failure，waiting 表示正在读）换成 { status, refreshing, summary, error }。 */
function usageView(result, input) {
  if (!result || typeof result !== "object") return { status: "unavailable", refreshing: false, summary: null, error: null };
  const cached = usageViews.get(result);
  if (cached) return cached;
  const refreshing = result.waiting === true;
  const view =
    result._tag === "Success"
      ? { status: "ready", refreshing: refreshing || (Array.isArray(result.value?.sources) && result.value.sources.some((s) => s?.refreshing === true)), summary: usageSummaryView(result.value, input), error: null }
      : result._tag === "Failure"
        ? { status: "error", refreshing, summary: null, error: L("T3 没能读出用量", "T3 couldn’t read usage") }
        : { status: "loading", refreshing: true, summary: null, error: null };
  usageViews.set(result, view);
  return view;
}

// filter 是 T3 设置里这个环境的用量模型过滤（usageModelFilterAtom），T3 用量页把它合进查询，这里也一样
function usageAtom(environmentId, range, slot, filter) {
  const input = usageInput(range, slot * USAGE_SLOT_MS, Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (filter !== undefined) input.modelFilter = filter;
  const key = `${environmentId}|${JSON.stringify(input)}`;
  let hit = usageAtoms.get(key);
  if (!hit) {
    if (usageAtoms.size > 16) usageAtoms.clear(); // 时间窗一直往前挪，旧的不会再用
    hit = { atom: bind.atoms.server.usageSummary({ environmentId, input }), input };
    usageAtoms.set(key, hit);
  }
  return hit;
}

/** 订阅一个 atom 的值（atom 为 null 时是 undefined）。 */
function useAtomValue(atom) {
  const subscribe = React.useCallback((fn) => (atom ? bind.atoms.registry.subscribe(atom, fn) : () => {}), [atom]);
  return React.useSyncExternalStore(subscribe, () => (atom ? bind.atoms.registry.get(atom) : undefined));
}

/** 订阅一组 atom：任何一个变了都重绘；值都没变时返回同一个数组（useSyncExternalStore 要求）。 */
function useAtomValues(atoms) {
  const last = React.useRef(null);
  const subscribe = React.useCallback(
    (fn) => {
      const offs = atoms.map((a) => bind.atoms.registry.subscribe(a, fn));
      return () => offs.forEach((off) => off());
    },
    [atoms],
  );
  return React.useSyncExternalStore(subscribe, () => {
    const values = atoms.map((a) => bind.atoms.registry.get(a));
    const prev = last.current;
    return prev && prev.length === values.length && prev.every((v, i) => v === values[i]) ? prev : (last.current = values);
  });
}

// 几个环境的用量照 T3 用量页的合并规则（usageFormat 模块里的那几个函数，MIT；没导出，所以照写一份）：
// 同一台机器上的几个后台会扫到同一份记录。每份来源（hostId + provider + 目录 + 卷；physicalSourceId 相同的也算一份）只算一次：
// 按 ok > partial > failed、读得新的优先，选一个环境当这份来源的主，其余环境里这份来源的桶不算；
// 比主读得新的 partial 来源补上主没有的桶。协议版本不在 4..6 的环境（和 T3 0.1.13 对不上）整个不算，T3 也是这样。
const USAGE_CONTRACT = { min: 4, max: 6 };
function usageSourceKeys(fingerprints) {
  const parent = new Map();
  const find = (k) => {
    const p = parent.get(k);
    if (p === undefined || p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const base = (f) => [f.hostId, f.provider, f.resolvedHomePath, f.volumeId].join(" ");
  for (const f of fingerprints) {
    if (f.physicalSourceId === undefined) continue;
    const a = find(base(f));
    const b = find(`\u0000${f.provider}\u0000${f.physicalSourceId}`);
    if (a !== b) parent.set(a, b);
  }
  return (f) => find(base(f));
}
function sourceBuckets(summary, source) {
  const sameProvider = summary.sources.filter((s) => s.fingerprint.provider === source.fingerprint.provider);
  return summary.buckets.filter((b) => b.provider === source.fingerprint.provider && (b.sourcePath === source.fingerprint.resolvedHomePath || (b.sourcePath === undefined && sameProvider.length === 1)));
}
const usageBucketKey = (b) => JSON.stringify([b.day, b.hourStart ?? null, b.provider, b.model]);

/** envs：[{ environmentId, summary（T3 原始的 UsageSummary） }]，返回合并后的原始 summary：去重后的 buckets，sources 每个 provider 一项（会话数已去重）。 */
function mergeUsageSummaries(envs) {
  const ok = envs.filter((e) => e.summary.contractVersion >= USAGE_CONTRACT.min && e.summary.contractVersion <= USAGE_CONTRACT.max);
  const keyOf = usageSourceKeys(ok.flatMap((e) => e.summary.sources.map((s) => s.fingerprint)));
  const readAt = (e) => Date.parse(e.summary.readAt) || 0;
  const order = [...ok].sort((a, b) => readAt(b) - readAt(a) || a.environmentId.localeCompare(b.environmentId));
  const owner = new Map(); // 来源 -> { env, source }
  const sessions = new Map(); // 来源 -> 会话数
  const extra = new Map(); // 环境 -> 补上的桶
  const ownerBuckets = new Map(); // 来源 -> 主已有的桶 key
  for (const status of ["ok", "partial", "failed"]) {
    for (const e of order) {
      for (const s of e.summary.sources) {
        const k = s.status === status ? keyOf(s.fingerprint) : null;
        if (k === null || owner.has(k)) continue;
        owner.set(k, { env: e, source: s });
        sessions.set(k, s.distinctSessions);
      }
    }
  }
  for (const e of order) {
    for (const s of e.summary.sources) {
      if (s.status !== "partial") continue;
      const k = keyOf(s.fingerprint);
      const o = owner.get(k);
      if (o?.source.status !== "ok" || readAt(e) <= readAt(o.env) || JSON.stringify(e.summary.modelFilter) !== JSON.stringify(o.env.summary.modelFilter)) continue;
      if (!ownerBuckets.has(k)) ownerBuckets.set(k, new Set(sourceBuckets(o.env.summary, o.source).map(usageBucketKey)));
      const have = ownerBuckets.get(k);
      const add = extra.get(e.environmentId) ?? new Set();
      const before = add.size;
      for (const b of sourceBuckets(e.summary, s)) {
        if (have.has(usageBucketKey(b))) continue;
        have.add(usageBucketKey(b));
        add.add(b);
      }
      if (add.size === before) continue;
      extra.set(e.environmentId, add);
      sessions.set(k, Math.max(sessions.get(k) ?? 0, s.distinctSessions));
    }
  }
  const buckets = [];
  const byProvider = new Map();
  for (const e of ok) {
    const providers = new Set();
    const paths = new Set();
    for (const s of e.summary.sources) {
      const k = s.status === "missing" ? null : keyOf(s.fingerprint);
      if (k === null || owner.get(k)?.source !== s) continue;
      const p = s.fingerprint.provider;
      providers.add(p);
      paths.add(`${p}\u0000${s.fingerprint.resolvedHomePath}`);
      byProvider.set(p, (byProvider.get(p) ?? 0) + (sessions.get(k) ?? s.distinctSessions));
    }
    const add = extra.get(e.environmentId);
    for (const b of e.summary.buckets) if (add?.has(b) || (b.sourcePath === undefined ? providers.has(b.provider) : paths.has(`${b.provider}\u0000${b.sourcePath}`))) buckets.push(b);
  }
  const sources = [...byProvider].map(([provider, distinctSessions]) => ({ fingerprint: { provider }, status: "ok", distinctSessions }));
  return { ...(ok[0] ?? envs[0]).summary, buckets, sources };
}

/** 几个环境的用量合成一份：读出来的照 T3 的规则合并，读不出的略过；都还没读出来时是 loading，全读不出才是 error。 */
function mergeUsage(list) {
  const views = list.map((x) => usageView(x.result, x.input));
  if (views.length === 1) return views[0];
  const ready = list.filter((_, i) => views[i].status === "ready");
  const refreshing = views.some((v) => v.refreshing);
  if (ready.length === 0) return views.some((v) => v.status === "loading") ? { status: "loading", refreshing: true, summary: null, error: null } : (views.find((v) => v.status === "error") ?? usageView(null));
  const merged = mergeUsageSummaries(ready.map((x) => ({ environmentId: x.environmentId, summary: x.result.value })));
  return { status: "ready", refreshing, summary: usageSummaryView(merged, ready[0].input), error: null };
}

/** hook：用量。range 是 "24h" / "7d" / "30d" / "90d"；environmentIds 不给时是当前会话所在的环境。 */
function useAgentUsage(range, { environmentIds } = {}) {
  if (!Object.hasOwn(USAGE_DAYS, range)) throw new Error(L(`range 要是 ${Object.keys(USAGE_DAYS).join(" / ")}`, `range must be ${Object.keys(USAGE_DAYS).join(" / ")}`));
  if (environmentIds !== undefined && !(Array.isArray(environmentIds) && environmentIds.every((x) => typeof x === "string" && x))) {
    throw new Error(L("environmentIds 要是环境 id 的数组", "environmentIds must be an array of environment ids"));
  }
  const current = React.useSyncExternalStore(subscribeChat, currentEnvironment);
  const envKey = JSON.stringify(environmentIds ?? (current ? [current] : [])); // 编码成 JSON：环境 id 里可以有换行
  const envs = React.useMemo(() => [...new Set(JSON.parse(envKey))], [envKey]);
  const filters = useAtomValues(React.useMemo(() => envs.map((env) => bind.atoms.server.usageModelFilterAtom(env)), [envs]));
  const slot = Math.floor(Date.now() / USAGE_SLOT_MS);
  // 到下一个 5 分钟自己重绘一次：时间窗（含跨午夜）不靠调用方碰巧重绘才往前挪
  const [, tick] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    const id = setTimeout(tick, (slot + 1) * USAGE_SLOT_MS - Date.now() + 50);
    return () => clearTimeout(id);
  }, [slot]);
  const hits = React.useMemo(() => envs.map((env, i) => usageAtom(env, range, slot, filters[i])), [envs, range, slot, filters]);
  const results = useAtomValues(React.useMemo(() => hits.map((x) => x.atom), [hits]));
  return React.useMemo(() => (hits.length === 0 ? usageView(null) : mergeUsage(hits.map((x, i) => ({ environmentId: envs[i], result: results[i] ?? null, input: x.input })))), [hits, results]);
}
