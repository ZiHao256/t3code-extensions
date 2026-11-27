**简体中文** | [English](README.en.md)

# T3 Code Extensions

给 [T3 Code](https://github.com/pingdotgg/t3code) 加一个**扩展宿主**和**扩展市场**：设置导航里“外观”下面多出一个“扩展”页，可以开关、配置、从市场或链接安装扩展。

![设置 → 扩展：已安装的扩展](docs/installed.png)

> 非官方项目，和 T3 Code 及其团队没有关系。它把你已安装的官方 T3 Code 复制一份再打补丁，官方版本身不动。目前只支持 **macOS 上的 T3 Code (Beta)**，每个版本只认一个 T3 版本：
>
> | T3 Code | 用这个版本 |
> |---|---|
> | 0.1.13 | 最新的 `main` |
> | 0.1.12 | [v0.5.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.5.0)（`git clone --branch v0.5.0 …`） |
> | 0.1.11 | [v0.1.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.1.0)（`git clone --branch v0.1.0 …`） |

## 扩展

宿主本身不带扩展。作者维护的四个扩展各在自己的仓库里，装好后在 设置 → 扩展 →“浏览”里安装（或把仓库地址粘贴到那里的链接框）：

| 扩展 | 作用 |
|---|---|
| 边缘光 [`t3x-edge-glow`](https://github.com/ZiHao256/t3x-edge-glow) | 需要审批（琥珀）、等你回答（蓝）、出错（红）、后台跑完（绿）时窗口边缘亮光。动效档位：省电 / 混合 / 30fps |
| 推理强度滑条 [`t3x-effort-slider`](https://github.com/ZiHao256/t3x-effort-slider) | 把模型面板里“推理强度”的档位列表换成竖向分档滑条（最高档在上，档名写在刻度旁边），档位越高星点越亮越快，最高档流动星云。星点动效：跟随档位 / 静态 / 关闭 |
| 桌宠 [`t3x-desk-pets`](https://github.com/ZiHao256/t3x-desk-pets) | 输入框上沿站着当前 agent 的宠物，跟会话状态动，上下文越满越胖，压缩历史时挤扁、压完弹回；子代理各派一只到旁边干活、收工击掌；每只都能单独拖，拖到另一只身上会互动；窗口不在前台或切到别的会话时错过的进出场，回来补播。右键宠物有菜单（T3 样式）：换一只、打个招呼、安静模式、桌宠设置、隐藏；隐藏后右键输入框里的模型选择器叫回。每个 agent 用哪只、宠物库（增删改）在设置里；也能选 harness、模型和会话，让 agent 照描述或参考图生成新宠物，预览每个动作、让它修改后再导入（用 `host.agent`）。内置 Codex、Clawd、Moffy 和鲸鱼娘 Dafeiyu（社区同人形象，出处和授权见扩展 README） |
| Antigravity 官方额度 [`t3x-agy-usage`](https://github.com/ZiHao256/t3x-agy-usage) | 额度面板里的 Antigravity 额度由官方 CLI 的 `/usage` 读取：每个实例用自己的登录，不发消息、不耗 token，不读 token、不直接调 Google 的接口（T3 0.1.13 起自己不再读 Antigravity 额度，不装这个扩展面板里就没有这一项）。设置里能看每个实例的读取结果、立即重读、选面板里显示哪些额度。后台扩展（见下文“后台扩展”） |

![“浏览”：GitHub 上带 t3code-extension 话题的社区扩展](docs/browse.png)

| 桌宠 | 边缘光 |
|---|---|
| ![桌宠](https://github.com/ZiHao256/t3x-desk-pets/raw/main/docs/pets.gif) | ![边缘光](https://github.com/ZiHao256/t3x-edge-glow/raw/main/docs/edge-glow.png) |
| **推理强度滑条** | **Antigravity 官方额度** |
| ![推理强度滑条](https://github.com/ZiHao256/t3x-effort-slider/raw/main/docs/effort-slider.png) | ![Antigravity 官方额度](https://github.com/ZiHao256/t3x-agy-usage/raw/main/docs/usage-panel.png) |

另有示例扩展 `examples/hello-badge`（右下角显示 agent 和会话状态），放在市场里演示安装流程，也是写扩展的模板。

## 安装

需要：`/Applications/T3 Code (Beta).app` 是官方 0.1.13（其他版本看上面的对照表），Node.js 22 以上。

### 让 agent 安装

把下面的提示词发给 Claude Code、Codex 等 coding agent：

```text
帮我在这台 Mac 上安装 T3 Code Extensions（https://github.com/ZiHao256/t3code-extensions）。
1. 检查前提：/Applications/T3 Code (Beta).app 存在，读出它 Contents/Info.plist 里的 CFBundleShortVersionString；node -v 是 22 以上。
2. 按这个仓库 README 开头的对照表选版本：T3 Code 0.1.13 用 main 分支，0.1.12 用 v0.5.0 标签，0.1.11 用 v0.1.0 标签；其他版本停下来告诉我，不要安装。
3. 把仓库 clone 到 ~/t3code-extensions（已存在就更新到对应版本），在里面运行 npm test，失败就停下把输出给我。
4. 问我要“和官方版共用数据”还是“独立数据（--isolated，可以和官方版同时开）”。共用数据时先提醒我退出 T3 Code，等我确认后再运行 node install.cjs install（独立数据加 --isolated）。
5. 运行 node install.cjs status，把输出给我，然后打开 ~/Applications/T3 Code Extensions.app。
不要用 sudo，不要修改 /Applications 里的官方应用。
```

### 手动安装

```sh
node install.cjs install             # 和官方版共用 ~/.t3（会话、项目、设置），两者不能同时开
node install.cjs install --isolated  # 独立数据和端口 3775，可以和官方版同时开
node install.cjs status
node install.cjs uninstall           # 先退出应用
```

装好的应用在 `~/Applications/T3 Code Extensions.app`。安装过程：校验官方签名 → 复制 → 打补丁（每个目标文件先核对 0.1.13 的原始哈希，补丁后用 `node --check` 检查语法）→ 更新 asar 完整性值 → 本机重新签名。自动更新会被关掉（否则会换掉打过补丁的文件）。

**更新 T3 Code Extensions**：T3 自己的自动更新关掉了，换成本仓库的更新。启动约 10 秒后查一次最新 Release（1 次 GitHub 接口，有新版时再多 1 次），有新版就提示，到 设置 → 扩展 顶部点“更新”：
- 在 app 里下载新版；「应用程序」里的官方版不是新版针对的 T3 版本时，还会下载那个版本的官方安装包（约 230 MB），校验官方签名后替换官方版。官方版正在运行、比它还新，或者 macOS 不让改（可能弹“已阻止修改 App”，可在 系统设置 → 隐私与安全性 → App 管理 里允许）时不替换，直接用下载的包安装；
- 下载完 app 退出，按原来的方式（有没有 `--isolated`）重装并重新打开，下次启动时提示结果；没装成就还是原来的版本。日志在 `~/Library/Caches/t3code-extensions/update.log`。

**从带内置扩展的旧版升级**：退出应用，`node install.cjs uninstall` 后重新 `install`（原来用 `--isolated` 的照样加上；卸载不删数据）。边缘光、推理强度滑条、桌宠不再随宿主分发：
- 以前点“检查更新”装过新版的，还在“已安装”里，版本旧的话点刷新更新；
- 其余的到“浏览”里重新安装，原来的设置和数据还在（别先点“移除”，移除会删掉数据）；
- 以前放在 `local-pets/` 的本机宠物不再并入，到桌宠设置里“添加桌宠”重新上传。

**从 T3 Code Enhancer 切换**：退出 Enhancer 后在旧仓库运行 `node macos.cjs uninstall`（会话在 `~/.t3`，不受影响），再在这里 `node install.cjs install`。两者可以并存，只是共用数据时同一时间只能开一个。

## 使用

设置 → 扩展：

- 顶部 “Applying settings for [项目] on [环境]” 是 T3 自己的作用域选择。选了具体项目或环境后，开关只影响那里的会话（项目 > 环境 > 全局，没单独设的显示“沿用上一级”，可以“重置”）。只管显示与否：扩展代码只要在任一作用域开着就会加载，扩展自己的设置全局共用。
- **已安装**：装好的扩展。开关、设置、移除、刷新（GitHub 来源检查更新；本地扩展重新读取文件夹）。
- **浏览**：
  - 社区扩展：GitHub 上带 `t3code-extension` 话题的仓库，按 star 排序，默认列出前 30 个，其余靠搜索。标着“社区”，安装时固定到某个提交。卡片简介取仓库默认分支 `plugin.json` 里的 `description` / `locales`，跟着界面语言切换；读不到时显示 GitHub 的仓库简介。
  - 也可以填 GitHub 仓库地址、`plugin.json` 链接或第三方市场的 `index.json` 链接，或者上传 zip。
  - 安装前都会弹窗确认来源。
- **添加本地扩展**：选一个扩展文件夹，之后改了代码点卡片上的刷新就重新读取（开发用；不支持记住文件夹的环境退回一次性导入）。
- **刷新**：依次检查所有能更新的扩展和 T3 Code Extensions 自己的新版，并刷新社区列表。打开页面时不自动检查：不登录 GitHub 时，每个出口 IP 每小时只能调 60 次接口（检查一次约 3 次），搜索每分钟约 10 次；共用的代理出口常被别人用光，这时会提示多久后恢复。

## 写扩展

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

### 让 agent 干活

声明 `"apiVersion": 5`、`"permissions": ["agent"]` 的扩展可以用 `host.agent` 让你配置好的 agent 干活，安装确认框和卡片上会标出“Agent”。发消息走 T3 输入框同一条路：会话出现在侧边栏，过程和审批都在会话里看。只针对当前会话所在的环境：

| `host.agent` | 说明 |
|---|---|
| `providers()` | harness（T3 的 provider 实例）：`{ instanceId, driver, name, enabled, status, runtimeModes, models: [{ id, name, isDefault }] }` |
| `useThreads()` | React hook，能看到的会话：`{ environmentId, threadId, projectId, title, instanceId, model, runtimeMode, interactionMode, running, lastError, lastRunCompletedAt, archived, needs }`；`needs` 是会话在等你什么：`"approval"`（批准）、`"input"`（回答）或 `null`，宿主 0.5.0 起才有 |
| `useProjects()` | React hook，项目：`{ environmentId, projectId, title, scratch }`，`scratch` 是“无项目” |
| `useSend()` | React hook，返回 `send(req)`：`req.target` 是 `{ threadId }`（已有会话，用它自己的 harness 和运行模式，排在正在跑的那轮后面）或 `{ newThread: { projectId, title } }`；另有 `instanceId`、`model`、`runtimeMode`（`approval-required` / `auto-accept-edits` / `auto` / `full-access`，新会话用，要在这个 harness 的 `runtimeModes` 里）、`text`、`images?: [{ name, dataUrl }]`（PNG / JPEG / WebP / GIF，最多 8 张、每张 10 MB）。返回 `Promise<{ environmentId, threadId }>`，T3 不接受、渲染后切了环境或扩展已停用时抛错 |
| `open({ environmentId, threadId })` | 跳到这个会话 |

生成文件的活：先用 `host.outputs.dir()` 拿到输出目录，在消息里让 agent 写到那里，再用 `host.outputs.read()` 读回来（可以轮询一个 agent 最后写的结果文件）。agent 在沙箱里时写这个目录可能要你在会话里批准。输出目录在运行桌面应用的这台机器上，所以要用本机环境里的 agent；远程环境的 agent 写的是远程机器上的同名路径，这里读不到。卸载扩展时输出目录一起删。

### 后台扩展

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

## 发布扩展

不需要向任何人提交，在自己的 GitHub 仓库里完成：

1. `plugin.json` 和代码放在仓库根目录。社区列表里的“安装”按钮只装根目录的扩展。
2. 给仓库加话题 `t3code-extension`，GitHub 建好索引后就能搜到（默认列表只显示 star 最多的 30 个）。
3. 发新版本：改 `plugin.json` 的 `version`，打 tag 并发一个 Release。

“检查更新”沿用安装时的地址：

| 安装时填的地址 | 检查更新时取 |
|---|---|
| `https://github.com/作者/仓库` 或社区列表 | 最新 Release；没有 Release 就取默认分支的最新提交 |
| `…/tree/分支名[/子目录]` | 这个分支的最新提交 |
| `…/tree/标签名[/子目录]` | 一直是这个标签，不会自动换到新标签 |

一个仓库放多个扩展时放子目录，用户填 `https://github.com/作者/仓库/tree/分支或标签/子目录` 安装；想让子目录扩展也能更新，让用户填分支地址。名字里带 `/` 的分支或标签（比如 `release/1.0`）解析不了，地址里也不能直接填提交号。

用户装的是某一个提交的文件（`raw.githubusercontent.com/作者/仓库/提交/…`），作者之后再推代码不会影响已经装上的那份。安装时会记下仓库 ID：仓库改名没关系，但如果旧名字被别的仓库占用，“检查更新”会拒绝。

## 第三方市场（注册表）

想做一个经过审核的精选列表，可以托管一个注册表 JSON。市场就是一个 JSON 文件，`registry/index.json` 是本仓库的市场：

```json
{
  "name": "T3 扩展市场",
  "apiVersion": 1,
  "extensions": [
    { "id": "…", "name": "…", "version": "…", "description": "…", "author": "…",
      "manifest": "../examples/…/plugin.json",
      "sha256": { "plugin.json": "…", "web.js": "…" } }
  ]
}
```

`manifest` 相对 index.json 解析，也可以是完整地址；安装时每个文件都必须有 `sha256` 且一致，否则拒绝。改了扩展后运行 `node lib/build.cjs` 重新生成。托管的地方要允许跨域（GitHub raw 默认允许）。

SHA-256 只保证下载到的就是注册表写的那份，**不代表代码安全**：扩展以完整权限运行在 T3 里，能读你的对话、调用本机 T3 服务。只装你信任的。

## 原理与限制

- 界面补丁只开三个口子：聊天视图把会话状态交给 `chat.overlay`；推理档位列表交给 `composer.effort`；设置里加一个“扩展”页（路由表、导航分组和名字、导航图标各改一处，页面组件追加在外观设置页模块里，顶部沿用 T3 的项目/环境作用域选择）。宿主运行时追加在 T3 的 `ThreadRouteView` 模块末尾（聊天视图所在，`_chat` 静态导入它；见 `lib/patch.cjs`、`host/`）。
- `host.agent` 用的是这个模块顶层导入的 T3 会话命令（`startTurn`，输入框发送用的那个）和会话、项目列表 hook，测试会核对它们真是这些东西。
- 后台扩展另有四处补丁（`lib/patch-server.cjs`）：preload 给主窗口一个只能领一次的入口（宿主先领走，界面扩展拿不到；同步后台脚本、读扩展输出目录都经过它）；主进程校验并落盘后台脚本；T3 后台加载它们，并在 Antigravity provider 里接回额度读取（T3 0.1.13 删掉了自己的读取，补丁照 0.1.12 的做法：只在有扩展接手时读，健康检查通过、会话开始时读，不挡这两件事，一次只读一个；登录、登出时作废正在读的结果）；最后一处改在 `runtimeLayer` 里：在 T3 所有 provider 共用的 managed provider 里加一个开关，T3 原本只让健康检查的结果改已发布的额度，Antigravity 打开这个开关后，只要有额度要显示或要清掉，额度就和登录状态、模型列表在同一次发布里更新，不用等正在跑的健康检查（没装额度扩展时照 T3 原样发布）；同时在 `ProviderRegistry` 合并上次保存的模型列表后再重算 Antigravity 窗口的 `modelIds`。别的 provider 不打开、也不受影响。测试用官方 app 里真的 provider、managed provider 和 `ProviderRegistry` 跑这些时序。
- 界面语言跟着 T3：T3 的原文是英文，中文由它的翻译函数在渲染时查表。导航和搜索里的“Extensions / 扩展”靠在这个翻译函数入口补了一处；扩展页和扩展自己按 `<html lang>` 选中文或英文，其他语言显示英文。
- 依赖 0.1.13 压缩代码里的变量名，T3 一更新就要重新适配（扩展不用改，只改这个仓库）；补丁前会核对原始文件哈希，对不上直接拒绝安装，不会装出一个坏掉的应用。
- 本机 ad-hoc 签名，没有官方签名和公证，也没有 Hardened Runtime：官方的 entitlements 依赖官方描述文件，ad-hoc 签名带上它们反而启动不了。
- `--isolated` 副本和官方版注册的是同一个 `t3code://` 链接。两者同时开着时，T3 Connect 等网页登录的回调可能被另一个应用接走，这时先关掉另一个再登录。
- T3 官方正在做插件系统（实验 PR，尚未合并）。合并后计划把这些扩展迁成官方插件，这个宿主就可以退役。

## 开发

```sh
npm test               # 纯函数、示例扩展在宿主包装里编译激活、补丁打到官方 0.1.13、asar 读回、注册表哈希
node tests/verify.cjs "/path/to/T3 Code (Beta).app"  # 本机官方版不是 0.1.13 时，指定一个 0.1.13 的 app 跑补丁检查
node lib/build.cjs     # 重新生成 registry/index.json
```

本仓库只有宿主（补丁、`host` 接口、设置页、市场）和示例扩展。扩展各自在自己的仓库里开发、测试和发版，按上面“发布扩展”的流程走，宿主这边不用跟着改。

改宿主接口：先在本仓库加接口、提高 `host/pure.js` 的 `API_VERSION` 并发布，再让用到新接口的扩展把 `apiVersion` 改成新值。

## 社区

本项目积极参与并认可 [LINUX DO 社区](https://linux.do)。

## 许可

MIT。T3 Code 是 T3 Tools Inc. 的项目；本仓库不分发 T3 Code（安装时复制你本机的官方版），只在 `lib/patch.cjs` 里留了几段用于定位的压缩代码片段。
