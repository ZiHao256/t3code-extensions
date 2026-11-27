[← 返回 README](../README.md) · **简体中文** | [English](development.en.md)

# 开发

```sh
npm test               # 纯函数、示例扩展在宿主包装里编译激活、补丁打到官方 0.1.13、asar 读回、注册表哈希
node tests/verify.cjs "/path/to/T3 Code (Beta).app"  # 本机官方版不是 0.1.13 时，指定一个 0.1.13 的 app 跑补丁检查
node lib/build.cjs     # 重新生成 registry/index.json
```

本仓库只有宿主（补丁、`host` 接口、设置页、市场）和示例扩展。扩展各自在自己的仓库里开发、测试和发版，按[发布扩展](publishing.md)的流程走，宿主这边不用跟着改。

改宿主接口：先在本仓库加接口、提高 `host/pure.js` 的 `API_VERSION` 并发布，再让用到新接口的扩展把 `apiVersion` 改成新值。
