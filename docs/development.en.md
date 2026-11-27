[← Back to README](../README.en.md) · [简体中文](development.md) | **English**

# Development

```sh
npm test               # pure functions, the example extension compiled and activated in the host wrapper, patches applied to the official 0.1.13, asar read back, registry hashes
node tests/verify.cjs "/path/to/T3 Code (Beta).app"  # if your local official app isn't 0.1.13, point the patch checks at a 0.1.13 app
node lib/build.cjs     # regenerate registry/index.json
```

This repository contains only the host (patches, the `host` API, the settings page, the marketplace) and the example extension. Each extension is developed, tested and released in its own repository following [Publishing extensions](publishing.en.md); the host doesn't need to change for them.

To change the host API, add the API here first, bump `API_VERSION` in `host/pure.js` and release, then have the extensions that use the new API set `apiVersion` to the new value.
