[← 返回 README](../README.md) · **简体中文** | [English](install.en.md)

# 安装与更新

需要：`/Applications/T3 Code (Beta).app` 是官方 0.1.13（其他版本看 [README 里的对照表](../README.md#快速开始)），Node.js 22 以上。

## 让 agent 安装

把下面的提示词发给 Claude Code、Codex 等 coding agent：

```text
帮我在这台 Mac 上安装 T3 Code Extensions（https://github.com/ZiHao256/t3code-extensions）。
1. 检查前提：/Applications/T3 Code (Beta).app 存在，读出它 Contents/Info.plist 里的 CFBundleShortVersionString；node -v 是 22 以上。
2. 按这个仓库 README 里的对照表选版本：T3 Code 0.1.13 用 main 分支，0.1.12 用 v0.5.0 标签，0.1.11 用 v0.1.0 标签；其他版本停下来告诉我，不要安装。
3. 把仓库 clone 到 ~/t3code-extensions（已存在就更新到对应版本），在里面运行 npm test，失败就停下把输出给我。
4. 问我要“和官方版共用数据”还是“独立数据（--isolated，可以和官方版同时开）”。共用数据时先提醒我退出 T3 Code，等我确认后再运行 node install.cjs install（独立数据加 --isolated）。
5. 运行 node install.cjs status，把输出给我，然后打开 ~/Applications/T3 Code Extensions.app。
不要用 sudo，不要修改 /Applications 里的官方应用。
```

## 手动安装

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
