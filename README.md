<div align="center">

<img src="docs/logo.svg" alt="T3 Code Extensions logo" width="72" height="72" />

# T3 Code Extensions

**T3 Code 的非官方扩展宿主和扩展市场**<br/>
装好后 T3 Code 的设置里会多一个“扩展”页，在那里装扩展、开关扩展、改扩展的设置。

<p align="center"><a href="https://github.com/ZiHao256/t3code-extensions/releases/latest"><img src="https://img.shields.io/github/v/release/ZiHao256/t3code-extensions?style=flat-square&label=version&color=7c3aed" alt="Version" /></a> <a href="https://github.com/pingdotgg/t3code/releases/tag/v0.1.13"><img src="https://img.shields.io/badge/T3_Code-0.1.13-0ea5e9?style=flat-square" alt="T3 Code 0.1.13" /></a> <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A5%2022-339933?style=flat-square" alt="Node.js ≥ 22" /></a> <img src="https://img.shields.io/badge/dependencies-0-22c55e?style=flat-square" alt="Zero dependencies" /> <img src="https://img.shields.io/badge/platform-macOS-64748b?style=flat-square" alt="macOS" /> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license" /></a></p>

**[⬇ 安装](#快速开始)** · [实机演示](#实机演示) · [扩展一览](#扩展一览) · [写扩展](docs/writing-extensions.md) · [文档导航](#文档导航)

<b>简体中文</b> · <a href="README.en.md">English</a>

</div>

> 这是个人做的非官方项目，跟 T3 Tools, Inc. 没有关系，也没有得到他们的认可。安装时会把你电脑上的官方 T3 Code 复制一份再改，官方那份不动。

## 实机演示

![设置 → 扩展：已安装的扩展](docs/installed.png)

| 桌宠 | 边缘光 |
|---|---|
| ![桌宠](https://github.com/ZiHao256/t3x-desk-pets/raw/main/docs/pets.gif) | ![边缘光](https://github.com/ZiHao256/t3x-edge-glow/raw/main/docs/edge-glow.png) |
| **推理强度滑条** | **Antigravity 官方额度** |
| ![推理强度滑条](https://github.com/ZiHao256/t3x-effort-slider/raw/main/docs/effort-slider.png) | ![Antigravity 官方额度](https://github.com/ZiHao256/t3x-agy-usage/raw/main/docs/usage-panel.png) |
| **菜单栏会话** | **菜单栏会话 · 用量** |
| ![菜单栏会话](https://github.com/ZiHao256/t3x-menubar/raw/main/docs/menubar.png) | ![菜单栏会话的用量页](https://github.com/ZiHao256/t3x-menubar/raw/main/docs/usage.png) |

## 扩展一览

宿主本身不带扩展。作者维护的五个扩展各在自己的仓库里，装好宿主后到 设置 → 扩展 →“浏览”里安装，或把仓库地址粘贴到那里的链接框：

| 扩展 | 作用 |
|---|---|
| 边缘光 [`t3x-edge-glow`](https://github.com/ZiHao256/t3x-edge-glow) | 需要审批、等你回答、出错或后台跑完时，窗口边缘亮起对应颜色的光 |
| 推理强度滑条 [`t3x-effort-slider`](https://github.com/ZiHao256/t3x-effort-slider) | 把推理强度的档位列表换成竖向分档滑条，档位越高星点越亮越快 |
| 桌宠 [`t3x-desk-pets`](https://github.com/ZiHao256/t3x-desk-pets) | 输入框上沿站着当前 agent 的宠物，跟着会话状态动；子代理各派一只到旁边干活；还能让 agent 照描述生成新宠物 |
| Antigravity 官方额度 [`t3x-agy-usage`](https://github.com/ZiHao256/t3x-agy-usage) | 用官方 CLI 的 `/usage` 读 Antigravity 额度，不发消息、不耗 token。T3 0.1.13 起自己不再读这项额度 |
| 菜单栏会话 [`t3x-menubar`](https://github.com/ZiHao256/t3x-menubar) | macOS 菜单栏上的会话面板：图标显示最急的状态，有会话等你批准或回答时旁边出现胶囊；点开列出各环境的会话，悬停看最后回复，点一下打开；还能看额度、费用和 Token |

![“浏览”：GitHub 上带 t3code-extension 话题的社区扩展](docs/browse.png)

社区扩展是 GitHub 上带 `t3code-extension` 话题的仓库。另有示例扩展 `examples/hello-badge`，演示安装流程，也是写扩展的模板。

## 快速开始

需要：`/Applications` 里装着官方 T3 Code (Beta)，Node.js 22 以上。每个版本的宿主只认一个 T3 版本：

| T3 Code | 用这个版本 |
|---|---|
| 0.1.13 | 最新的 `main` |
| 0.1.12 | [v0.5.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.5.0)（`git clone --branch v0.5.0 …`） |
| 0.1.11 | [v0.1.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.1.0)（`git clone --branch v0.1.0 …`） |

```sh
git clone https://github.com/ZiHao256/t3code-extensions && cd t3code-extensions
node install.cjs install             # 和官方版共用 ~/.t3，两者不能同时开
node install.cjs install --isolated  # 或者：独立数据，可以和官方版同时开
```

装好的应用在 `~/Applications/T3 Code Extensions.app`。之后在 设置 → 扩展 顶部就能更新宿主。想让 coding agent 代装，或者想了解安装过程、卸载、从旧版切换，见[安装与更新](docs/install.md)。

## 文档导航

- **[安装与更新](docs/install.md)**：让 agent 安装的提示词、安装过程、在 app 里更新、卸载、从旧版或 T3 Code Enhancer 切换
- **[使用说明](docs/usage.md)**：设置 → 扩展 页的作用域、已安装、浏览、本地扩展和刷新
- **[写扩展](docs/writing-extensions.md)**：`plugin.json`、`host` 接口、挂载点、让 agent 干活、后台扩展、菜单栏图标、读 T3 内部数据、通知和剪贴板
- **[发布扩展与第三方市场](docs/publishing.md)**：发到自己的 GitHub 仓库、检查更新的规则、注册表格式
- **[原理与限制](docs/architecture.md)**：补丁打在哪里、签名方式、和官方版的关系
- **[资源占用](docs/performance.md)**：和官方版对比的 CPU、内存实测
- **[开发](docs/development.md)**：跑测试、生成注册表、改宿主接口

## 说明与许可

- T3 Code 是 T3 Tools, Inc. 的项目。本项目是个人做的，跟他们没有关系，也没有得到他们的认可。
- 本仓库不分发 T3 Code：安装时复制你本机的官方版，只在 `lib/patch.cjs` 里留了几段用于定位的压缩代码片段。
- 采用 [MIT 许可](LICENSE)。
- 本项目积极参与并认可 [LINUX DO 社区](https://linux.do)。
