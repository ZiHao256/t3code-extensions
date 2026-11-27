[← 返回 README](../README.md) · **简体中文** | [English](publishing.en.md)

# 发布扩展

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
