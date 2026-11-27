[← 返回 README](../README.md) · **简体中文** | [English](writing-extensions.en.md)

# 写扩展

```
my-ext/
  plugin.json
  web.js          # 可以是多个文件，按顺序拼接
  styles.css
  assets/…        # 图片等二进制素材
```

```json
{
  "id": "my-ext",
  "apiVersion": 1,
  "name": "我的扩展",
  "version": "1.0.0",
  "description": "…",
  "author": "…",
  "locales": { "en": { "name": "My extension", "description": "…" } },
  "repository": "https://github.com/me/my-ext",
  "permissions": ["ui"],
  "entries": { "web": ["web.js"], "styles": ["styles.css"] },
  "assets": ["assets/icon.webp"]
}
```

`apiVersion`：用到 `host.server` 或后台的 `t3x.handle` / `t3x.lang` 写 `6`；用到 `host.agent` 或 `host.outputs` 写 `5`；带后台脚本（`entries.server`）写 `4`；用到 `host.dom` 或 `host.confirm()` 写 `3`；用到设置面板的 `Input` / `Select` 系列、`host.openSettings()` 或 `host.contextMenu()` 写 `2`；只用其余接口写 `1`。宿主会拒绝安装 apiVersion 比自己新的扩展。

`repository` 可选：扩展的 GitHub 仓库，卡片上的“详情”链接到这里。

`locales` 可选：`name`、`description` 在另一种语言下的版本（`en` 或 `zh`），设置页按 T3 的界面语言显示。

字段尽量和 T3 官方插件草案（[#40222](https://github.com/pingdotgg/t3code/pull/40222) 的 `plugin.json`）对齐，方便以后迁移。不同点：`web.js` 不是 ES 模块，而是作为 `function (host) { … }` 的函数体执行（T3 的 CSP 允许内联脚本，不允许 `eval` 和 `blob:` 模块）；顶层可以 `return` 一个清理函数，停用时调用。

`host` 提供：

| API | 说明 |
|---|---|
| `host.React`、`host.h` | T3 自己的 React 和 `createElement` |
| `host.register(slot, Component)` | 挂到挂载点，返回取消函数 |
| `host.settings(Component)` | 扩展设置面板；props 里的 `ui` 是 T3 原生的 `Section` / `Row` / `Switch` / `Button` / `Input` / `Select` / `SelectTrigger` / `SelectValue` / `SelectPopup` / `SelectItem` |
| `host.storage.get/set/subscribe/use(key, fallback)` | 扩展自己的持久化存储（IndexedDB），`use` 是 React hook。扩展停用后（包括重载、升级、卸载时还没回来的异步操作）`set` 会被拒绝 |
| `host.files.list/text/url(path)` | 扩展包里的文件；`url` 给素材的 data URL |
| `host.style(css)` | 追加样式，停用时自动移除 |
| `host.openSettings()` | 跳到 设置 → 扩展，打开本扩展的设置 |
| `host.contextMenu(items, { x, y })` | 弹出 T3 样式的右键菜单，返回选中项的 `id`（没选是 `null`）。项：`{ id, label, detail?, icon?, checked?, disabled?, separatorBefore?, children? }`，`icon` 只能用 T3 内置的几个名字（如 `settings`） |
| `host.confirm(message, { variant? })` | 弹出 T3 自己的确认框，返回 `Promise<boolean>`（用 `if (await host.confirm(…))`）。`message` 里以问号结尾的那行是标题，其余行是说明；`variant: "destructive"` 时确认按钮是红色 |
| `host.dom.composer()`、`host.dom.modelPicker(target)` | 主聊天视图的输入框外壳；`target` 在主输入框的模型选择器里时返回那个选择器（side chat 里的都不算），否则 `null`。需要找 T3 页面元素时用这里，别自己查 T3 的 DOM：T3 改版时宿主跟着改，扩展不用动 |
| `host.chat.last()` | 最近一次聊天视图的会话状态（设置页里也能拿到 provider 列表） |
| `host.agent` | 用你在 T3 里配置的 agent 开会话、发消息，要声明 `"permissions": ["agent"]`，见下文“让 agent 干活” |
| `host.outputs.dir()`、`host.outputs.read(path)` | 扩展自己的输出目录 `<T3 数据目录>/t3x-out/<id>/`：`dir()` 返回绝对路径（不存在就建），`read("job/sheet.png")` 读里面的文件，不存在是 `null`，否则 `{ bytes, size, modified }`。只读普通文件，路径不能含 `..`、不跟随符号链接、不读硬链接，单个文件最大 32 MB；读的时候文件大小变了（还在写）会抛错，稍后再读 |
| `host.server.call(name, data?)` | 调用本扩展后台用 `t3x.handle(name, fn)` 登记的函数，返回它的结果；只有带后台脚本的扩展有。见下文“后台扩展” |
| `host.lang()`、`host.useLang()` | 当前界面语言：T3 是中文时为 `"zh"`，其他语言都是 `"en"`。`useLang` 是 React hook，切语言时触发重绘 |
| `host.t(中文, 英文)` | 按当前界面语言二选一；在渲染时调用，组件里先调一次 `host.useLang()` |
| `host.onDispose(fn)` | 停用时调用 |

挂载点：

| slot | 方式 | 组件收到的 props |
|---|---|---|
| `chat.overlay` | 所有扩展都渲染 | `threadKey`、`awaiting`（`"approval"`/`"input"`/`null`）、`working`、`error`、`runStatus`、`providerInstanceId`、`driver`、`providers`、`model`、`subagents`、`context`（上下文用量：`usedTokens`、`maxTokens`、`usedPercentage`、`autoCompactThreshold`，没有时为 `null`）、`compacting`（正在压缩历史）、`embedded`（side chat 里为真） |
| `composer.effort` | 最后启用的替换原生档位列表 | `label`、`steps[{id,label,description,isDefault}]`、`activeIndex`、`defaultIndex`、`disabled`、`select(index)` |

扩展组件出错只影响它自己：overlay 不渲染，`composer.effort` 退回原生列表，错误显示在扩展那一行。颜色请用 T3 的主题变量（`var(--foreground)`、`var(--muted-foreground)`、`var(--border)` 等），`html.dark` 是暗色模式。

## 让 agent 干活

声明 `"apiVersion": 5`、`"permissions": ["agent"]` 的扩展可以用 `host.agent` 让你配置好的 agent 干活，安装确认框和卡片上会标出“Agent”。发消息走 T3 输入框同一条路：会话出现在侧边栏，过程和审批都在会话里看。只针对当前会话所在的环境：

| `host.agent` | 说明 |
|---|---|
| `providers()` | harness（T3 的 provider 实例）：`{ instanceId, driver, name, enabled, status, runtimeModes, models: [{ id, name, isDefault }] }` |
| `useThreads()` | React hook，能看到的会话：`{ environmentId, threadId, projectId, title, instanceId, model, runtimeMode, interactionMode, running, lastError, lastRunCompletedAt, archived, needs }`；`needs` 是会话在等你什么：`"approval"`（批准）、`"input"`（回答）或 `null`，宿主 0.5.0 起才有 |
| `useProjects()` | React hook，项目：`{ environmentId, projectId, title, scratch }`，`scratch` 是“无项目” |
| `useSend()` | React hook，返回 `send(req)`：`req.target` 是 `{ threadId }`（已有会话，用它自己的 harness 和运行模式，排在正在跑的那轮后面）或 `{ newThread: { projectId, title } }`；另有 `instanceId`、`model`、`runtimeMode`（`approval-required` / `auto-accept-edits` / `auto` / `full-access`，新会话用，要在这个 harness 的 `runtimeModes` 里）、`text`、`images?: [{ name, dataUrl }]`（PNG / JPEG / WebP / GIF，最多 8 张、每张 10 MB）。返回 `Promise<{ environmentId, threadId }>`，T3 不接受、渲染后切了环境或扩展已停用时抛错 |
| `open({ environmentId, threadId })` | 跳到这个会话 |

生成文件的活：先用 `host.outputs.dir()` 拿到输出目录，在消息里让 agent 写到那里，再用 `host.outputs.read()` 读回来（可以轮询一个 agent 最后写的结果文件）。agent 在沙箱里时写这个目录可能要你在会话里批准。输出目录在运行桌面应用的这台机器上，所以要用本机环境里的 agent；远程环境的 agent 写的是远程机器上的同名路径，这里读不到。卸载扩展时输出目录一起删。

## 后台扩展

`entries.server` 指向一个 `.mjs` 文件时，它会在 T3 后台（Node）里运行，以你的用户权限读写文件、运行程序；清单要声明 `"apiVersion": 4` 和 `"permissions": ["server"]`，安装确认框和卡片上会标出“后台”。后台脚本是单个 ES 模块（不能 import 扩展包里的其他文件），导出 `activate(t3x)`，可以返回停用时调用的清理函数。停用后再启用同一版本时，`activate` 会在同一个模块实例上再调用一次（模块顶层状态还在），10 秒内没激活完算加载失败：

```js
export function activate(t3x) {
  t3x.usage.registerSource({
    driver: "antigravity",
    read: async (ctx) => ({ windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent: 12.5, resetsAt: "2026-12-01T00:00:00Z", windowDurationMins: 10080 }] }),
  });
}
```

| `t3x` | 说明 |
|---|---|
| `id`、`version` | 扩展的 id 和版本 |
| `dataDir` | 扩展自己的数据目录（不保证已存在）；卸载扩展时整个删掉，停用和升级时保留 |
| `log(...args)` | 写进 T3 后台日志 |
| `lang()` | 当前界面语言，`"zh"` 或 `"en"`（同 `host.lang()`），切换后下一次调用就是新值 |
| `handle(name, fn)` | 处理窗口里 `host.server.call(name, data)`：`fn(data)` 的返回值（可以是 Promise）就是调用结果，抛错时窗口那边收到同样的说明。返回取消函数，停用时自动撤掉 |
| `usage.registerSource({ driver, read })` | 接手某个 provider 的额度读取，目前只支持 `antigravity`（T3 0.1.13 自己不再读它的额度，没有扩展接手时面板里没有这一项）。`read(ctx)` 的结果显示在 T3 原生的额度面板里。第一次就读取出错、或者启用的后台扩展没加载起来，面板显示原因；读成过以后再出错，面板照 T3 的规则保留上一次读到的额度。宿主给每个窗口标上它卡住哪些模型，规则照 T3 0.1.12 判断额度是否用完的那条（`exhaustedUsageWindow`）：窗口 `id` 的前缀 `gemini-` / `claude-` / `gpt-` / `3p-` 是额度池（`3p` 是 Claude 和 GPT 共用），只卡同一家族的模型，认不出的池或模型哪个满了都卡（模型的别名也算，比如默认模型的 `antigravity-default`；不在当前模型列表里的 id 只会被认不出的池卡住）；模型列表变了会重新标。登出、需要重新登录、T3 确认找不到 CLI（状态改成未安装，不是它暂缓上报的那一次）时清掉额度，也不再读；扩展停用时马上清掉额度，启用、升级时重读（正在读的还没回来时排在它后面，最多等到它超时），读到一半扩展被停用、换掉的结果作废。`ctx`：`instanceId`、`profileDirectory`（T3 给这个实例的配置目录）、`authMethod`、`executablePath`（T3 解析出的 CLI 路径）、`environment`。返回 `{ windows: [{ id, label, kind: "session"/"weekly"/"monthly"/"other", usedPercent, resetsAt?, windowDurationMins? }] }`，出错就抛（消息显示在面板里，规则同上），60 秒没结果算失败。宿主对每个 Antigravity 实例一次只发起一个读取（不同实例各读各的），但超时只是不再等：扩展的 `read` 停不下来，可能还在跑，下一次读取会和它同时进行，扩展要自己处理并发。同一个 provider 只能由一个扩展接手 |

窗口和后台之间用 `host.server.call` ↔ `t3x.handle` 通信，扩展的设置、状态、按钮都可以自己做，不用等宿主加接口：

```js
// server.mjs
export function activate(t3x) {
  let hidden = [];
  t3x.handle("setHidden", (ids) => (hidden = ids));
  t3x.handle("status", () => ({ hidden, lang: t3x.lang() }));
}
// web.js（设置面板里）
const status = await host.server.call("status");
```

参数和结果只能是 JSON（参数最大 256 KB，结果最大 4 MB），50 秒没结果算失败。扩展 id 由宿主按调用方填，只能调到自己的后台。通道是 T3 后台在 `<T3 数据目录>/t3x-server/rpc.sock` 上开的本地 socket，目录只有你的用户能进。

启用、停用、升级后台扩展时，窗口把代码交给 Electron 主进程，写到 `<T3 数据目录>/t3x-server/`，T3 后台发现变化后重新加载（不用重启）。只有本应用启动的 T3 后台会加载它们：用官方 T3 Code 打开同一份数据时，后台扩展不运行，不影响官方版。

后台权限不是界面扩展的“上限”：界面扩展和宿主同在 T3 的窗口里，本来就能调用 T3 自己的接口（包括开终端、往终端里输入），一样能以你的权限运行程序。确认框里的“后台”提示是说明它会做什么，不是隔离。
