// apiVersion 5：host.agent 让扩展用你配置好的 agent 开会话、发消息（manifest 要声明 permissions: ["agent"]）；
// host.outputs 是扩展自己的输出目录（<T3 数据目录>/t3x-out/<id>/），agent 把生成的文件写到这里，扩展再读回来。
// 发消息走 T3 输入框同一条路（bind.agent.commands.startTurn），图片由 T3 先存成附件再发；会话、项目列表读 T3 自己的 atom。

const AGENT_TEXT_MAX = 100_000;
const AGENT_IMAGES_MAX = 8;
const AGENT_IMAGE_MAX = 10 << 20; // T3 单张图片上限（PROVIDER_SEND_TURN_MAX_IMAGE_BYTES）
const AGENT_TITLE_MAX = 120;
const RUNTIME_MODES = ["approval-required", "auto-accept-edits", "auto", "full-access"];
const hasAgent = (rec) => rec.manifest.permissions?.includes("agent") === true;
const IMAGE_DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,/;
// 字符类加长度检查，不用分组重复：几 MB 的图用 (?:…{4})* 会把正则引擎的栈撑爆（RangeError）
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** 当前会话所在环境里配置的 harness（T3 的 provider 实例）和它们的模型。 */
function agentProviders() {
  const list = Array.isArray(lastChat?.providers) ? lastChat.providers : [];
  return list
    .filter((p) => p && typeof p.instanceId === "string")
    .map((p) => ({
      instanceId: p.instanceId,
      driver: typeof p.driver === "string" ? p.driver : null,
      name: p.displayName || p.instanceId,
      enabled: p.enabled !== false,
      status: typeof p.status === "string" ? p.status : null,
      // 没声明或声明为空时和 T3 的选择器一样给全部模式；每次给新数组，调用方改了也不影响宿主的校验
      runtimeModes: Array.isArray(p.supportedRuntimeModes) && p.supportedRuntimeModes.length > 0 ? p.supportedRuntimeModes.filter((m) => RUNTIME_MODES.includes(m)) : [...RUNTIME_MODES],
      models: (Array.isArray(p.models) ? p.models : [])
        .filter((m) => typeof m?.slug === "string")
        .map((m) => ({ id: m.slug, name: m.name || m.slug, isDefault: m.isDefault === true })),
    }));
}

const currentEnvironment = () => (typeof lastChat?.environmentId === "string" ? lastChat.environmentId : null);

const errorText = (e) => (typeof e === "string" ? e : typeof e?.message === "string" ? e.message : null);

/** T3 shell 里的时间可能是 ISO 字符串、Date 或 Effect 的 DateTime（epochMilliseconds）：统一成 ISO 字符串，认不出是 null。 */
function isoTime(v) {
  const ms = typeof v === "string" ? Date.parse(v) : v instanceof Date ? v.getTime() : typeof v === "number" ? v : typeof v?.epochMilliseconds === "number" ? v.epochMilliseconds : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// 会话在等你什么：和 T3 侧边栏同一套判断（批准优先；pendingSubagentRequest 是它派出的子代理在等）。
const threadNeeds = (s) =>
  s.hasPendingApprovals === true || s.pendingSubagentRequest === "approval" ? "approval" : s.hasPendingUserInput === true || s.pendingSubagentRequest === "user_input" ? "input" : null;

// 子会话：子代理、侧聊、工作流步骤，或者从还在（没归档）的会话委派出去的。和 T3 侧栏同一套判断（navigationThreadShellsAtom），侧栏不列它们
const threadKey = (env, id) => `${env}\n${id}`;
function isChildThread(s, live) {
  const l = s.lineage;
  if (l && (l.relationshipToParent === "subagent" || l.sideChat === true || l.workflowStep === true)) return true;
  const from = s.delegatedFrom;
  return from != null && live.has(threadKey(from.environmentId, from.threadId));
}

/**
 * 当前环境里能看到的会话（hook）；all 时是所有环境的（apiVersion 7，useThreads({ allEnvironments: true })）。
 * 运行状态在 shell 的 runtime / latestRun 里（T3 0.1.13 的 visibleThreadShellsAtom）。
 */
function useAgentThreads(all = false) {
  const shells = bind.agent.useThreads();
  const env = React.useSyncExternalStore(subscribeChat, currentEnvironment); // 环境是聊天视图在 effect 里报上来的，换了要重新渲染
  return React.useMemo(() => {
    const list = (Array.isArray(shells) ? shells : []).filter((s) => s && typeof s.id === "string");
    const live = new Set(list.filter((s) => s.archivedAt == null).map((s) => threadKey(s.environmentId, s.id))); // 委派方可能在别的环境
    return list
      .filter((s) => all || s.environmentId === env)
      .map((s) => ({
        environmentId: s.environmentId,
        threadId: s.id,
        projectId: s.projectId ?? null,
        title: s.title || s.id,
        instanceId: s.providerInstanceId ?? s.modelSelection?.instanceId ?? null,
        model: s.modelSelection?.model ?? null,
        runtimeMode: s.runtimeMode ?? null,
        interactionMode: s.interactionMode ?? "default",
        running: s.runtime?.activeRunId != null,
        lastError: errorText(s.runtime?.lastError) ?? (s.latestRun?.status === "failed" ? L("这一轮失败了", "The run failed") : null),
        lastRunCompletedAt: s.latestRun?.completedAt ?? null,
        archived: s.archivedAt != null,
        needs: threadNeeds(s),
        // apiVersion 7（菜单栏这类需要更细状态的扩展用）
        branch: typeof s.branch === "string" ? s.branch : null,
        runStatus: typeof s.runtime?.status === "string" ? s.runtime.status : null, // preparing / queued / starting / running / waiting / idle …
        lastRunStatus: typeof s.latestRun?.status === "string" ? s.latestRun.status : null, // completed / failed / interrupted / cancelled …
        runStartedAt: isoTime(s.runtime?.activityStartedAt ?? s.latestRun?.startedAt),
        limitResetAt: isoTime(s.runtime?.usageLimitResetAt ?? s.limitRecovery?.resetAt),
        updatedAt: isoTime(s.updatedAt),
        lastVisitedAt: isoTime(s.lastVisitedAt),
        pinned: s.pinnedAt != null,
        // T3 侧栏的顺序和分组：置顶顺序、活动顺序、创建 / 取消收尾时间，收尾了的、稍后提醒到什么时候
        createdAt: isoTime(s.createdAt),
        pinOrderKey: typeof s.pinOrderKey === "string" ? s.pinOrderKey : null,
        activeOrderKey: typeof s.activeOrderKey === "string" ? s.activeOrderKey : null,
        unsettledAt: isoTime(s.unsettledAt),
        settled: s.settledOverride === "settled",
        snoozedUntil: isoTime(s.snoozedUntil),
        child: isChildThread(s, live),
      }));
  }, [shells, env, all]);
}

/** 当前环境里的项目（hook），all 时是所有环境的；scratch 是 T3 的“无项目”。 */
function useAgentProjects(all = false) {
  const projects = bind.agent.useProjects();
  const env = React.useSyncExternalStore(subscribeChat, currentEnvironment);
  return React.useMemo(
    () =>
      (Array.isArray(projects) ? projects : [])
        .filter((p) => p && typeof p.id === "string" && (all || p.environmentId === env) && p.archivedAt == null)
        .map((p) => ({ environmentId: p.environmentId, projectId: p.id, title: p.title || p.id, scratch: p.isScratch === true })),
    [projects, env, all],
  );
}

function agentImages(images) {
  if (images === undefined) return [];
  if (!Array.isArray(images) || images.length > AGENT_IMAGES_MAX) throw new Error(L(`图片最多 ${AGENT_IMAGES_MAX} 张`, `At most ${AGENT_IMAGES_MAX} images`));
  return images.map((img, i) => {
    const m = typeof img?.dataUrl === "string" ? IMAGE_DATA_URL_RE.exec(img.dataUrl) : null;
    const b64 = m ? img.dataUrl.slice(m[0].length) : "";
    if (!m || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) throw new Error(L("图片需要是 PNG / JPEG / WebP / GIF 的 data URL", "Images must be PNG, JPEG, WebP or GIF data URLs"));
    const sizeBytes = (b64.length / 4) * 3 - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    if (sizeBytes > AGENT_IMAGE_MAX) throw new Error(L("单张图片不能超过 10 MB", "Each image must be 10 MB or smaller"));
    const name = String(img.name || `image-${i + 1}`).replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || `image-${i + 1}`;
    return { type: "image", name, mimeType: m[1], sizeBytes, dataUrl: img.dataUrl };
  });
}

/** T3 命令失败时的 Exit / Cause（Effect 的 Cause 把原因放在 reasons[] 里）：尽量找出一句人能看懂的话。 */
function causeMessage(exit) {
  const seen = new Set();
  const walk = (v, depth) => {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 6) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.reduce((found, x) => found ?? walk(x, depth + 1), null);
    if (typeof v.message === "string" && v.message) return v.message;
    for (const k of ["reasons", "error", "defect", "cause", "failure"]) {
      const found = walk(v[k], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(exit?.cause, 0) ?? L("T3 没有接受这条消息", "T3 did not accept the message");
}

/**
 * 发一条消息。target 二选一：{ threadId }（当前环境里已有的会话，用它自己的 harness），
 * 或 { newThread: { projectId, title } }（新开会话）。返回 { environmentId, threadId }。
 */
async function agentSend(start, threads, projects, req) {
  if (!req || typeof req !== "object") throw new Error(L("发送参数无效", "Invalid send request"));
  const environmentId = currentEnvironment();
  if (!environmentId) throw new Error(L("先打开一个会话，才知道发到哪个环境", "Open a thread first so the environment is known"));
  const text = typeof req.text === "string" ? req.text : "";
  if (!text.trim() || text.length > AGENT_TEXT_MAX) throw new Error(L("消息不能为空，也不能超过 10 万字", "The message must be non-empty and at most 100,000 characters"));
  if (typeof req.model !== "string" || !req.model) throw new Error(L("没有选模型", "No model selected"));
  const attachments = agentImages(req.images);
  const target = req.target ?? {};
  // 会话、项目列表是渲染时那个环境的；之后切了环境就对不上，按 (环境, id) 核对
  const existing = typeof target.threadId === "string" ? threads.find((t) => t.threadId === target.threadId && t.environmentId === environmentId) : null;
  if (target.threadId !== undefined && !existing) throw new Error(L("当前环境里找不到这个会话", "Thread not found in the current environment"));
  const instanceId = existing ? existing.instanceId : req.instanceId;
  const provider = agentProviders().find((p) => p.instanceId === instanceId);
  if (!provider || !provider.enabled) throw new Error(L(`harness ${instanceId ?? ""} 不可用`, `Harness ${instanceId ?? ""} is unavailable`));
  const runtimeMode = existing ? existing.runtimeMode : req.runtimeMode;
  if (!RUNTIME_MODES.includes(runtimeMode) || (!existing && !provider.runtimeModes.includes(runtimeMode))) throw new Error(L("运行模式无效", "Invalid runtime mode"));
  const modelSelection = { instanceId, model: req.model };
  const createdAt = new Date().toISOString();
  const message = { messageId: crypto.randomUUID(), role: "user", text, attachments };
  let input;
  if (existing) {
    // 排在正在跑的那轮后面，不打断它
    input = { threadId: existing.threadId, message, modelSelection, runtimeMode, interactionMode: existing.interactionMode, dispatchMode: "queue", createdAt };
  } else {
    const nt = target.newThread;
    if (!nt || typeof nt.projectId !== "string") throw new Error(L("新会话要指定项目", "A new thread needs a project"));
    if (!projects.some((p) => p.projectId === nt.projectId && p.environmentId === environmentId)) throw new Error(L("当前环境里找不到这个项目", "Project not found in the current environment"));
    const title = String(nt.title || "").trim().slice(0, AGENT_TITLE_MAX) || L("扩展发起的会话", "Thread from an extension");
    input = {
      threadId: crypto.randomUUID(),
      message,
      modelSelection,
      titleSeed: title,
      runtimeMode,
      interactionMode: "default",
      bootstrap: { createThread: { projectId: nt.projectId, title, modelSelection, runtimeMode, interactionMode: "default", branch: null, worktreePath: null, createdAt } },
      createdAt,
    };
  }
  const exit = await start({ environmentId, input });
  if (exit?._tag === "Failure") throw new Error(causeMessage(exit));
  return { environmentId, threadId: input.threadId };
}

// life：这次启用的生命周期，停用或卸载后拿到手的 send 也不能再发
function agentApi(rec, life) {
  const allowed = hasAgent(rec);
  const need = () => {
    if (!allowed) throw new Error(L('host.agent 要在 permissions 里声明 "agent"', 'host.agent requires the "agent" permission'));
    if (!life.alive) throw new Error(L("扩展已停用", "The extension is disabled"));
  };
  return {
    providers: () => (need(), agentProviders()),
    useThreads: (opts) => (need(), useAgentThreads(opts?.allEnvironments === true)),
    useProjects: (opts) => (need(), useAgentProjects(opts?.allEnvironments === true)),
    /** apiVersion 7：hook，T3 用量页的数据（usage.js）。 */
    useUsage: (range, opts) => (need(), useAgentUsage(range, opts)),
    /** hook：返回 send(req)。 */
    useSend() {
      need();
      const start = bind.agent.useCommand(bind.agent.commands.startTurn);
      const lists = { threads: useAgentThreads(), projects: useAgentProjects() };
      const ref = React.useRef(lists);
      ref.current = lists;
      return React.useCallback(async (req) => (need(), agentSend(start, ref.current.threads, ref.current.projects, req)), [start]);
    },
    /**
     * apiVersion 7：会话最后一条说完的 agent 回复。threads 是 useThreads() 给的会话（或 { environmentId, threadId }）；
     * 返回 { [threadId]: { text, at } }。只读得到本机环境的会话，远程环境的、还没有回复的不在里面。
     */
    async replies(threads) {
      need();
      if (!serverBridge?.replies) throw new Error(L("读取回复只能在 T3 Code Extensions 桌面版里用", "Reading replies is available only in the T3 Code Extensions desktop app."));
      const list = (Array.isArray(threads) ? threads : []).map((t) => ({ environmentId: t?.environmentId, threadId: t?.threadId }));
      try {
        return await serverBridge.replies(list);
      } catch (error) {
        throw new Error(String(error?.message ?? error).replace(/^Error invoking remote method '[^']*': (?:Error: )?(?:t3x: )?/, ""));
      }
    },
    open({ environmentId, threadId } = {}) {
      need();
      if (typeof environmentId !== "string" || typeof threadId !== "string") throw new Error(L("会话参数无效", "Invalid thread"));
      location.hash = `#/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
    },
  };
}

function outputsApi(rec, life) {
  const id = rec.manifest.id;
  const bridge = () => {
    if (!life.alive) throw new Error(L("扩展已停用", "The extension is disabled"));
    if (!serverBridge?.outDir) throw new Error(L("输出目录只能在 T3 Code Extensions 桌面版里用", "The output folder is available only in the T3 Code Extensions desktop app."));
    return serverBridge;
  };
  return {
    /** 输出目录的绝对路径（不存在就建）。 */
    dir: async () => bridge().outDir(id),
    /** 读输出目录里的文件（相对路径，用 / 分隔）；不存在返回 null，否则 { bytes: Uint8Array, size, modified }。 */
    read: async (rel) => bridge().outRead(id, rel),
  };
}
