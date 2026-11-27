[← Back to README](../README.en.md) · [简体中文](publishing.md) | **English**

# Publishing extensions

There's nothing to submit to anyone; do it all in your own GitHub repository:

1. Put `plugin.json` and the code at the repository root. The Install button in the community list only installs extensions at the root.
2. Add the `t3code-extension` topic to the repository. Once GitHub indexes it, it shows up in search (the default list shows only the 30 with the most stars).
3. To release a new version, bump `version` in `plugin.json`, tag it and publish a release.

"Check for updates" uses the address the extension was installed from:

| Installed from | Check for updates uses |
|---|---|
| `https://github.com/owner/repo` or the community list | The latest release; without releases, the latest commit on the default branch |
| `…/tree/branch[/subdir]` | The latest commit on that branch |
| `…/tree/tag[/subdir]` | Always that tag; it never moves to a newer tag on its own |

To keep several extensions in one repository, put each in a subdirectory; users install with `https://github.com/owner/repo/tree/branch-or-tag/subdir`. For subdirectory extensions to get updates, have users enter a branch URL. Branches or tags with `/` in their name (such as `release/1.0`) can't be resolved, and commit hashes can't be used in the URL directly.

Users install the files of one specific commit (`raw.githubusercontent.com/owner/repo/commit/…`), so later pushes don't affect copies already installed. The repository ID is recorded at install time: renaming the repository is fine, but if another repository takes over the old name, "Check for updates" refuses.

## Third-party marketplaces (registries)

To offer a curated, reviewed list, host a registry JSON. A marketplace is just a JSON file; `registry/index.json` is this repository's marketplace:

```json
{
  "name": "T3 extension marketplace",
  "apiVersion": 1,
  "extensions": [
    { "id": "…", "name": "…", "version": "…", "description": "…", "author": "…",
      "manifest": "../examples/…/plugin.json",
      "sha256": { "plugin.json": "…", "web.js": "…" } }
  ]
}
```

`manifest` is resolved relative to index.json and can also be a full URL. On install, every file must have a matching `sha256`, otherwise the install is refused. After changing an extension, run `node lib/build.cjs` to regenerate the registry. Wherever you host it must allow cross-origin requests (GitHub raw does by default).

SHA-256 only guarantees that you got exactly what the registry lists; **it doesn't make the code safe**: extensions run in T3 with full permissions and can read your conversations and call the local T3 services. Only install extensions you trust.
