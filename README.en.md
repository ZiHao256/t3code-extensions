<div align="center">

<img src="docs/logo.svg" alt="T3 Code Extensions logo" width="72" height="72" />

# T3 Code Extensions

**An unofficial extension host and marketplace for T3 Code**<br/>
Once installed, T3 Code's settings get an "Extensions" page where you install extensions, turn them on and off, and change their settings.

<p align="center"><a href="https://github.com/ZiHao256/t3code-extensions/releases/latest"><img src="https://img.shields.io/github/v/release/ZiHao256/t3code-extensions?style=flat-square&label=version&color=7c3aed" alt="Version" /></a> <a href="https://github.com/pingdotgg/t3code/releases/tag/v0.1.13"><img src="https://img.shields.io/badge/T3_Code-0.1.13-0ea5e9?style=flat-square" alt="T3 Code 0.1.13" /></a> <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A5%2022-339933?style=flat-square" alt="Node.js ≥ 22" /></a> <img src="https://img.shields.io/badge/dependencies-0-22c55e?style=flat-square" alt="Zero dependencies" /> <img src="https://img.shields.io/badge/platform-macOS-64748b?style=flat-square" alt="macOS" /> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT license" /></a></p>

**[⬇ Install](#quick-start)** · [Screenshots](#screenshots) · [Extensions](#extensions) · [Writing extensions](docs/writing-extensions.en.md) · [Docs](#docs)

<a href="README.md">简体中文</a> · <b>English</b>

</div>

> This is a personal, unofficial project. It has nothing to do with T3 Tools, Inc. and isn't endorsed by them. Installing it copies the official T3 Code on your Mac and changes the copy; the official app stays as it is.

## Screenshots

![Settings → Extensions: installed extensions](docs/installed.png)

| Desk pets | Edge glow |
|---|---|
| ![Desk pets](https://github.com/ZiHao256/t3x-desk-pets/raw/main/docs/pets.gif) | ![Edge glow](https://github.com/ZiHao256/t3x-edge-glow/raw/main/docs/edge-glow.png) |
| **Effort slider** | **Antigravity usage via CLI** |
| ![Effort slider](https://github.com/ZiHao256/t3x-effort-slider/raw/main/docs/effort-slider.png) | ![Antigravity usage via CLI](https://github.com/ZiHao256/t3x-agy-usage/raw/main/docs/usage-panel.png) |
| **Menu bar threads** | **Menu bar threads · Usage** |
| ![Menu bar threads](https://github.com/ZiHao256/t3x-menubar/raw/main/docs/menubar.png) | ![The usage page of Menu bar threads](https://github.com/ZiHao256/t3x-menubar/raw/main/docs/usage.png) |

## Extensions

The host ships without extensions. The five extensions the author maintains each live in their own repository. Once the host is installed, install them in Settings → Extensions → Browse, or paste the repository URL into the link field there:

| Extension | What it does |
|---|---|
| Edge glow [`t3x-edge-glow`](https://github.com/ZiHao256/t3x-edge-glow) | Lights up the window edge in a matching color when an approval is needed, the agent is waiting for your answer, an error occurs, or a background run finishes |
| Effort slider [`t3x-effort-slider`](https://github.com/ZiHao256/t3x-effort-slider) | Replaces the reasoning effort list with a vertical stepped slider; higher levels make the stars brighter and faster |
| Desk pets [`t3x-desk-pets`](https://github.com/ZiHao256/t3x-desk-pets) | A pet for the current agent stands on the composer and reacts to the thread state; each subagent sends its own pet to work alongside; agents can generate new pets from a description |
| Antigravity usage via CLI [`t3x-agy-usage`](https://github.com/ZiHao256/t3x-agy-usage) | Reads Antigravity limits with the official CLI's `/usage`, without sending messages or spending tokens. T3 0.1.13 no longer reads these limits itself |
| Menu bar threads [`t3x-menubar`](https://github.com/ZiHao256/t3x-menubar) | A threads panel in the macOS menu bar: the icon shows the most urgent status, with a capsule when threads wait for your approval or answer. Click to list threads from every environment, hover for the last reply, click to open. Also shows limits, cost and tokens |

![Browse: community extensions on GitHub with the t3code-extension topic](docs/browse.png)

Community extensions are GitHub repositories with the `t3code-extension` topic. There is also an example extension, `examples/hello-badge`, which demonstrates installation and doubles as a template for writing extensions.

## Quick start

Requirements: the official T3 Code (Beta) in `/Applications`, and Node.js 22 or later. Each host version supports exactly one T3 version:

| T3 Code | Use |
|---|---|
| 0.1.13 | The latest `main` |
| 0.1.12 | [v0.5.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.5.0) (`git clone --branch v0.5.0 …`) |
| 0.1.11 | [v0.1.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.1.0) (`git clone --branch v0.1.0 …`) |

```sh
git clone https://github.com/ZiHao256/t3code-extensions && cd t3code-extensions
node install.cjs install             # shares ~/.t3 with the official app; the two can't run at the same time
node install.cjs install --isolated  # or: separate data, can run alongside the official app
```

The installed app is `~/Applications/T3 Code Extensions.app`. After that, you can update the host from the top of Settings → Extensions. To have a coding agent install it, or for the install steps, uninstalling and switching from older versions, see [Install and update](docs/install.en.md).

## Docs

- **[Install and update](docs/install.en.md)**: a prompt for installing with an agent, what installation does, updating in the app, uninstalling, switching from older versions or T3 Code Enhancer
- **[Usage](docs/usage.en.md)**: scopes, Installed, Browse, local extensions and Refresh on the Settings → Extensions page
- **[Writing extensions](docs/writing-extensions.en.md)**: `plugin.json`, the `host` API, slots, putting agents to work, background extensions, menu bar icons, reading T3 internals, notifications and the clipboard
- **[Publishing extensions and third-party marketplaces](docs/publishing.en.md)**: publishing from your own GitHub repository, how update checks work, the registry format
- **[How it works and limitations](docs/architecture.en.md)**: where the patches go, signing, and how it relates to the official app
- **[Resource usage](docs/performance.en.md)**: measured CPU and memory compared with the official app
- **[Development](docs/development.en.md)**: running the tests, regenerating the registry, changing the host API

## Notes and license

- T3 Code is a project of T3 Tools, Inc. This is a personal project that has nothing to do with them and isn't endorsed by them.
- This repository doesn't distribute T3 Code: installation copies your local official app, and the repository only keeps a few minified code snippets in `lib/patch.cjs` to locate the patch points.
- Released under the [MIT license](LICENSE).
- This project takes part in and recognizes the [LINUX DO community](https://linux.do).
