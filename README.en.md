[简体中文](README.md) | **English**

# T3 Code Extensions

Adds an **extension host** and an **extension marketplace** to [T3 Code](https://github.com/pingdotgg/t3code): an "Extensions" page appears under "Appearance" in the settings navigation, where you can turn extensions on and off, configure them, and install them from the marketplace or a link.

![Settings → Extensions: installed extensions](docs/installed.png)

> An unofficial project, not affiliated with T3 Code or its team. It copies your installed official T3 Code and patches the copy; the official app itself is untouched. Only **T3 Code (Beta) on macOS** is supported for now, and each version supports exactly one T3 version:
>
> | T3 Code | Use |
> |---|---|
> | 0.1.13 | The latest `main` |
> | 0.1.12 | [v0.5.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.5.0) (`git clone --branch v0.5.0 …`) |
> | 0.1.11 | [v0.1.0](https://github.com/ZiHao256/t3code-extensions/releases/tag/v0.1.0) (`git clone --branch v0.1.0 …`) |

## Extensions

The host ships without extensions. The four extensions the author maintains each live in their own repository. Once the host is installed, install them in Settings → Extensions → Browse (or paste the repository URL into the link field there):

| Extension | What it does |
|---|---|
| Edge glow [`t3x-edge-glow`](https://github.com/ZiHao256/t3x-edge-glow) | Lights up the window edge when an approval is needed (amber), the agent is waiting for your answer (blue), an error occurs (red), or a background run finishes (green). Motion: power saving / mixed / 30 fps |
| Effort slider [`t3x-effort-slider`](https://github.com/ZiHao256/t3x-effort-slider) | Replaces the reasoning effort list in the model panel with a vertical stepped slider (highest level at the top, level names next to the ticks); higher levels make the stars brighter and faster, and the top level adds a flowing nebula. Star motion: follow the level / static / off |
| Desk pets [`t3x-desk-pets`](https://github.com/ZiHao256/t3x-desk-pets) | Pets for the current agent stand on the composer and react to the thread state. They swell as the context fills up, squash while T3 compacts history and pop back afterwards. Each subagent sends its own pet to work alongside, and it high-fives when done. Every pet can be dragged on its own, and dropping one onto another makes them interact; entrances and exits missed while the window was in the background or on another thread replay when you come back. Right-click a pet for a T3-style menu: switch pet, say hi, quiet mode, desk pet settings, hide; after hiding, right-click the model picker in the composer to bring them back. Settings let you choose a pet per agent and edit the pet library; you can also pick a harness, model and thread and have an agent generate a new pet from a description or reference images, preview every animation, ask for revisions and import it (uses `host.agent`). Built in: Codex, Clawd, Moffy and the whale girl Dafeiyu (a community fan character; credits and license are in the extension's README) |
| Antigravity usage via CLI [`t3x-agy-usage`](https://github.com/ZiHao256/t3x-agy-usage) | Reads the Antigravity limits in the usage panel with the official CLI's `/usage` command: each instance uses its own sign-in, no message is sent and no tokens are spent, and no token is read and no Google API is called directly (T3 0.1.13 no longer reads Antigravity limits itself, so without this extension the panel has none). Its settings show each instance's last read, read again on demand, and choose which limits the panel shows. A background extension (see "Background extensions" below) |

![Browse: community extensions on GitHub with the t3code-extension topic](docs/browse.png)

| Desk pets | Edge glow |
|---|---|
| ![Desk pets](https://github.com/ZiHao256/t3x-desk-pets/raw/main/docs/pets.gif) | ![Edge glow](https://github.com/ZiHao256/t3x-edge-glow/raw/main/docs/edge-glow.png) |
| **Effort slider** | **Antigravity usage via CLI** |
| ![Effort slider](https://github.com/ZiHao256/t3x-effort-slider/raw/main/docs/effort-slider.png) | ![Antigravity usage via CLI](https://github.com/ZiHao256/t3x-agy-usage/raw/main/docs/usage-panel.png) |

There is also an example extension, `examples/hello-badge` (shows the agent and thread state in the bottom-right corner). It is listed in the marketplace to demonstrate installation and doubles as a template for writing extensions.

## Install

Requirements: `/Applications/T3 Code (Beta).app` is the official 0.1.13 (for other versions see the table above), and Node.js 22 or later.

### Install with an agent

Paste this to Claude Code, Codex or another coding agent:

```text
Install T3 Code Extensions (https://github.com/ZiHao256/t3code-extensions) on this Mac.
1. Check the prerequisites: /Applications/T3 Code (Beta).app exists (read CFBundleShortVersionString from its Contents/Info.plist) and node -v is 22 or later.
2. Pick the version from the table at the top of that README: T3 Code 0.1.13 uses the main branch, 0.1.12 uses the v0.5.0 tag, 0.1.11 uses the v0.1.0 tag. For any other version, stop and tell me.
3. Clone the repository to ~/t3code-extensions (or update an existing checkout to that version) and run npm test there. If it fails, stop and show me the output.
4. Ask me whether to share data with the official app or use separate data (--isolated, can run alongside the official app). For shared data, remind me to quit T3 Code first and wait for my confirmation, then run node install.cjs install (add --isolated for separate data).
5. Run node install.cjs status, show me the output, then open ~/Applications/T3 Code Extensions.app.
Do not use sudo and do not modify the official app in /Applications.
```

### Install manually

```sh
node install.cjs install             # shares ~/.t3 (threads, projects, settings) with the official app; the two can't run at the same time
node install.cjs install --isolated  # separate data and port 3775; can run alongside the official app
node install.cjs status
node install.cjs uninstall           # quit the app first
```

The installed app is `~/Applications/T3 Code Extensions.app`. Installation verifies the official signature → copies the app → patches it (each target file is checked against the original 0.1.13 hash first, and `node --check` checks the syntax after patching) → updates the asar integrity values → re-signs it locally. Auto-update is turned off, because it would replace the patched files.

**Updating T3 Code Extensions**: T3's own auto-update is replaced by this repository's. About 10 seconds after launch it checks the latest Release once (one GitHub API call, plus one more when there's a new version) and tells you when there's a new version; click "Update" at the top of Settings → Extensions:
- The new version downloads inside the app. If the official app in Applications isn't the T3 version the new release targets, that version's official package (about 230 MB) is downloaded too, its official signature is verified, and it replaces the official app. If the official app is running, is newer, or macOS blocks the change (you may see "prevented from modifying apps"; allow it under System Settings → Privacy & Security → App Management), it's left alone and the downloaded package is used for the install.
- Once downloaded, the app quits, reinstalls the same way as before (with or without `--isolated`) and reopens; the result is shown on the next launch. If the install fails you keep the previous version. The log is at `~/Library/Caches/t3code-extensions/update.log`.

**Upgrading from an older version with bundled extensions**: quit the app, run `node install.cjs uninstall`, then `install` again (with `--isolated` if you used it; uninstalling keeps your data). Edge glow, Effort slider and Desk pets no longer ship with the host:
- If you installed a newer version with "Check for updates" before, it is still under Installed; click Refresh to update it if it is out of date.
- Reinstall the others from Browse. Their settings and data are still there (don't click Remove first: removing deletes the data).
- Local pets in `local-pets/` are no longer merged in; upload them again with "Add desk pet" in the desk pet settings.

**Switching from T3 Code Enhancer**: quit Enhancer, run `node macos.cjs uninstall` in the old repository (threads are in `~/.t3` and are not affected), then run `node install.cjs install` here. The two can coexist; with shared data, only one can be open at a time.

## Usage

Settings → Extensions:

- "Applying settings for [project] on [environment]" at the top is T3's own scope picker. With a specific project or environment selected, the switches only affect threads there (project > environment > global; a scope without its own setting shows "Inherited" and can be reset). This only controls visibility: an extension's code loads if it is on in any scope, and the extension's own settings are shared everywhere.
- **Installed**: installed extensions. Toggle, Settings, Remove, and refresh (GitHub sources check for updates; local extensions re-read their folder).
- **Browse**:
  - Community extensions: GitHub repositories with the `t3code-extension` topic, sorted by stars. The first 30 are listed by default; find the rest by searching. They are marked "Community" and pinned to a commit when installed. Card descriptions come from `description` / `locales` in `plugin.json` on the repository's default branch and follow the UI language; if that can't be read, the GitHub repository description is shown.
  - You can also enter a GitHub repository URL, a `plugin.json` link or a third-party marketplace's `index.json` link, or upload a zip.
  - Every install asks you to confirm the source first.
- **Add local extension**: pick an extension folder; after changing the code, click refresh on its card to re-read it (for development; environments that can't remember folders fall back to a one-time import).
- **Refresh**: checks every updatable extension and T3 Code Extensions itself for updates, and refreshes the community list. Nothing is checked automatically when the page opens: without signing in to GitHub, each outgoing IP gets only 60 API calls per hour (one check uses about 3) and about 10 searches per minute. Shared proxy exits are often used up by others; in that case you'll see when the limit resets.

## Writing extensions

```
my-ext/
  plugin.json
  web.js          # can be several files, concatenated in order
  styles.css
  assets/…        # images and other binary assets
```

```json
{
  "id": "my-ext",
  "apiVersion": 1,
  "name": "My extension",
  "version": "1.0.0",
  "description": "…",
  "author": "…",
  "locales": { "zh": { "name": "我的扩展", "description": "…" } },
  "repository": "https://github.com/me/my-ext",
  "permissions": ["ui"],
  "entries": { "web": ["web.js"], "styles": ["styles.css"] },
  "assets": ["assets/icon.webp"]
}
```

`apiVersion`: `6` if you use `host.server` or the background `t3x.handle` / `t3x.lang`; `5` if you use `host.agent` or `host.outputs`; `4` with a background script (`entries.server`); `3` if you use `host.dom` or `host.confirm()`; `2` if you use the settings panel's `Input` / `Select` family, `host.openSettings()` or `host.contextMenu()`; `1` if you use only the other APIs. The host refuses to install extensions whose apiVersion is newer than its own.

`repository` is optional: the extension's GitHub repository. The Details link on its card points here.

`locales` is optional: `name` and `description` in the other language (`en` or `zh`). The settings page shows them according to T3's UI language.

The fields follow T3's draft plugin format (the `plugin.json` in [#40222](https://github.com/pingdotgg/t3code/pull/40222)) where possible, to make a later migration easier. Differences: `web.js` is not an ES module. It runs as the body of `function (host) { … }` (T3's CSP allows inline scripts but not `eval` or `blob:` modules), and it can `return` a cleanup function at the top level, which is called when the extension is disabled.

`host` provides:

| API | Description |
|---|---|
| `host.React`, `host.h` | T3's own React and `createElement` |
| `host.register(slot, Component)` | Mounts a component into a slot; returns an unregister function |
| `host.settings(Component)` | The extension's settings panel; `ui` in its props holds T3's native `Section` / `Row` / `Switch` / `Button` / `Input` / `Select` / `SelectTrigger` / `SelectValue` / `SelectPopup` / `SelectItem` |
| `host.storage.get/set/subscribe/use(key, fallback)` | The extension's own persistent storage (IndexedDB); `use` is a React hook. Once the extension is disabled, `set` is rejected, including for async work that comes back after a reload, upgrade or uninstall |
| `host.files.list/text/url(path)` | Files in the extension package; `url` gives an asset's data URL |
| `host.style(css)` | Adds styles, removed automatically when the extension is disabled |
| `host.openSettings()` | Opens Settings → Extensions at this extension's settings |
| `host.contextMenu(items, { x, y })` | Shows a T3-style context menu and returns the chosen item's `id` (`null` if none). Items: `{ id, label, detail?, icon?, checked?, disabled?, separatorBefore?, children? }`; `icon` must be one of T3's built-in names (such as `settings`) |
| `host.confirm(message, { variant? })` | Shows T3's own confirmation dialog and returns `Promise<boolean>` (use `if (await host.confirm(…))`). The line in `message` that ends with a question mark is the title, and the other lines are the description; with `variant: "destructive"` the confirm button is red |
| `host.dom.composer()`, `host.dom.modelPicker(target)` | The main chat view's composer shell; `modelPicker` returns the picker when `target` is inside the main composer's model picker (side chat pickers don't count), otherwise `null`. Use these instead of querying T3's DOM yourself: when T3 changes, the host is updated and extensions don't need to change |
| `host.chat.last()` | The thread state from the most recent chat view render (the provider list is available in Settings too) |
| `host.agent` | Starts threads and sends messages with the agents you configured in T3; requires `"permissions": ["agent"]`. See "Putting agents to work" below |
| `host.outputs.dir()`, `host.outputs.read(path)` | The extension's own output folder `<T3 data folder>/t3x-out/<id>/`. `dir()` returns the absolute path and creates the folder if needed; `read("job/sheet.png")` reads a file in it and returns `null` if it doesn't exist, otherwise `{ bytes, size, modified }`. Regular files only: no `..` in the path, symlinks are not followed, hard links are not read, and each file can be at most 32 MB. If the file's size changes while it is being read (it is still being written), `read` throws; read again later |
| `host.server.call(name, data?)` | Calls a function this extension's background script registered with `t3x.handle(name, fn)` and returns its result; only extensions with a background script have it. See "Background extensions" below |
| `host.lang()`, `host.useLang()` | The current UI language: `"zh"` when T3 is in Chinese, `"en"` for every other language. `useLang` is a React hook that re-renders when the language changes |
| `host.t(chinese, english)` | Picks one by the current UI language; call it while rendering, after calling `host.useLang()` once in the component |
| `host.onDispose(fn)` | Called when the extension is disabled |

Slots:

| slot | Mode | Props the component receives |
|---|---|---|
| `chat.overlay` | Every extension renders | `threadKey`, `awaiting` (`"approval"`/`"input"`/`null`), `working`, `error`, `runStatus`, `providerInstanceId`, `driver`, `providers`, `model`, `subagents`, `context` (context usage: `usedTokens`, `maxTokens`, `usedPercentage`, `autoCompactThreshold`; `null` when unavailable), `compacting` (history is being compacted), `embedded` (true in side chat) |
| `composer.effort` | The last enabled extension replaces the native level list | `label`, `steps[{id,label,description,isDefault}]`, `activeIndex`, `defaultIndex`, `disabled`, `select(index)` |

An error in an extension's component only affects that extension: its overlay isn't rendered, `composer.effort` falls back to the native list, and the error shows on the extension's row. For colors, use T3's theme variables (`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, etc.); `html.dark` means dark mode.

### Putting agents to work

Extensions that declare `"apiVersion": 5` and `"permissions": ["agent"]` can use `host.agent` to put the agents you configured to work; the install dialog and the card show "Agent". Messages go through the same path as T3's composer: threads appear in the sidebar, and you follow progress and approvals in the thread. It only covers the environment of the current thread:

| `host.agent` | Description |
|---|---|
| `providers()` | Harnesses (T3 provider instances): `{ instanceId, driver, name, enabled, status, runtimeModes, models: [{ id, name, isDefault }] }` |
| `useThreads()` | React hook; the visible threads: `{ environmentId, threadId, projectId, title, instanceId, model, runtimeMode, interactionMode, running, lastError, lastRunCompletedAt, archived, needs }`; `needs` is what the thread is waiting on you for: `"approval"`, `"input"` or `null` (host 0.5.0 and later) |
| `useProjects()` | React hook; projects: `{ environmentId, projectId, title, scratch }`, where `scratch` is "No project" |
| `useSend()` | React hook that returns `send(req)`. `req.target` is `{ threadId }` (an existing thread: it keeps its own harness and runtime mode and is queued after the running turn) or `{ newThread: { projectId, title } }`. The other fields are `instanceId`, `model`, `runtimeMode` (`approval-required` / `auto-accept-edits` / `auto` / `full-access`; for new threads, and it must be in the harness's `runtimeModes`), `text`, and `images?: [{ name, dataUrl }]` (PNG / JPEG / WebP / GIF, up to 8, 10 MB each). Returns `Promise<{ environmentId, threadId }>`; throws if T3 doesn't accept it, the environment changed after rendering, or the extension is disabled |
| `open({ environmentId, threadId })` | Navigates to the thread |

For jobs that produce files: get the output folder with `host.outputs.dir()`, tell the agent in the message to write there, then read the files back with `host.outputs.read()` (you can poll for a result file the agent writes last). If the agent runs in a sandbox, writing that folder may need your approval in the thread. The output folder is on the machine running the desktop app, so use an agent in the local environment; an agent in a remote environment writes to the same path on the remote machine, which can't be read here. The output folder is removed when the extension is uninstalled.

### Background extensions

When `entries.server` points to an `.mjs` file, it runs in T3's backend (Node) and can read and write files and run programs with your user permissions. The manifest must declare `"apiVersion": 4` and `"permissions": ["server"]`; the install dialog and the card show "Background". The background script is a single ES module (it can't import other files from the extension package) that exports `activate(t3x)`, which can return a cleanup function called when the extension is disabled. When the same version is disabled and enabled again, `activate` is called again on the same module instance (top-level module state is kept). If activation doesn't finish within 10 seconds, loading fails:

```js
export function activate(t3x) {
  t3x.usage.registerSource({
    driver: "antigravity",
    read: async (ctx) => ({ windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent: 12.5, resetsAt: "2026-12-01T00:00:00Z", windowDurationMins: 10080 }] }),
  });
}
```

| `t3x` | Description |
|---|---|
| `id`, `version` | The extension's id and version |
| `dataDir` | The extension's own data folder (not guaranteed to exist); deleted when the extension is uninstalled, kept when it is disabled or upgraded |
| `log(...args)` | Writes to T3's backend log |
| `lang()` | The current UI language, `"zh"` or `"en"` (same as `host.lang()`); after a switch, the next call returns the new value |
| `handle(name, fn)` | Handles `host.server.call(name, data)` from the window: the value `fn(data)` returns (or resolves to) is the result, and if it throws, the window gets the same message. Returns a function that unregisters it; handlers are removed automatically when the extension is disabled |
| `usage.registerSource({ driver, read })` | Takes over usage reading for a provider; only `antigravity` is supported for now (T3 0.1.13 no longer reads its limits itself, so without an extension the panel has none). The result of `read(ctx)` appears in T3's native usage panel. If the first read fails, or the enabled background extension didn't load, the panel shows why; once a read has succeeded, a later failure keeps the last limits read, following T3's own rule. The host tags each window with the models it limits, using the rule T3 0.1.12 used to decide whether a limit is exhausted (`exhaustedUsageWindow`): the window `id` prefix `gemini-` / `claude-` / `gpt-` / `3p-` is the quota pool (`3p` is shared by Claude and GPT) and only limits models of that family, while an unrecognized pool or model is limited by every full window (model aliases count too, such as the default model's `antigravity-default`; ids not in the current model list are limited only by unrecognized pools); the tags are redone when the model list changes. Signing out, a sign-in being required, or T3 confirming the CLI is missing (the status changes to not installed, not the check it defers) clears the limits and stops reading; disabling the extension clears the limits right away, enabling or upgrading it reads again (queued behind a read still in progress, at most until that one times out), and a read that was in progress when the extension was disabled or replaced is discarded. `ctx`: `instanceId`, `profileDirectory` (T3's config folder for this instance), `authMethod`, `executablePath` (the CLI path T3 resolved), `environment`. Return `{ windows: [{ id, label, kind: "session"/"weekly"/"monthly"/"other", usedPercent, resetsAt?, windowDurationMins? }] }` and throw on errors (the message shows in the panel, under the same rule); no result within 60 seconds counts as a failure. The host starts one read at a time per Antigravity instance (separate instances read independently), but a timeout only stops waiting: the extension's `read` can't be stopped and may still be running when the next read starts, so the extension has to handle overlapping calls. Only one extension can take over a given provider |

The window and the background script talk through `host.server.call` ↔ `t3x.handle`, so an extension can add its own settings, status and buttons without waiting for new host APIs:

```js
// server.mjs
export function activate(t3x) {
  let hidden = [];
  t3x.handle("setHidden", (ids) => (hidden = ids));
  t3x.handle("status", () => ({ hidden, lang: t3x.lang() }));
}
// web.js (in the settings panel)
const status = await host.server.call("status");
```

Arguments and results must be JSON (arguments up to 256 KB, results up to 4 MB); no result within 50 seconds counts as a failure. The host fills in the extension id from the caller, so an extension can only reach its own background script. The channel is a local socket that T3's backend opens at `<T3 data folder>/t3x-server/rpc.sock`, in a folder only your user can enter.

When a background extension is enabled, disabled or upgraded, the window hands its code to Electron's main process, which writes it to `<T3 data folder>/t3x-server/`; T3's backend notices the change and reloads it without a restart. Only a T3 backend started by this app loads them: when the official T3 Code opens the same data, background extensions don't run and the official app is unaffected.

Background permission isn't a "ceiling" for UI extensions: UI extensions live in T3's window along with the host and can already call T3's own APIs (including opening a terminal and typing into it), so they can run programs with your permissions too. The "Background" note in the dialog describes what the extension does; it is not isolation.

## Publishing extensions

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

## How it works and limitations

- The UI patch opens only three hooks: the chat view hands the thread state to `chat.overlay`; the reasoning level list goes to `composer.effort`; and Settings gains an "Extensions" page (one change each to the route table, the navigation group and name, and the navigation icon; the page component is appended to the appearance settings module, and its header reuses T3's project/environment scope picker). The host runtime is appended to the end of T3's `ThreadRouteView` module, where the chat view lives (`_chat` imports it statically; see `lib/patch.cjs` and `host/`).
- `host.agent` uses the T3 thread command imported at the top of that module (`startTurn`, the one the composer uses to send) and the thread and project list hooks; the tests check that they really are those.
- Background extensions need four more patches (`lib/patch-server.cjs`): the preload gives the main window an entry point that can be claimed only once (the host claims it first, so UI extensions can't get it; syncing background scripts and reading extension output folders both go through it); the main process validates background scripts and writes them to disk; and T3's backend loads them and wires usage reading back into the Antigravity provider (T3 0.1.13 removed its own reader; the patch follows 0.1.12's approach: it reads only when an extension has taken over, after a passing health check and when a session starts, without blocking either and one read at a time, and discards a read in progress on sign-in or sign-out). The last one patches `runtimeLayer`: it adds a switch to the managed provider that all T3 providers share (T3 normally lets only health check results change the published limits, and with the switch on, whenever there are limits to show or clear, Antigravity's limits are published together with its sign-in state and model list without waiting for a health check in progress; without a usage extension it publishes the T3 way) and re-tags Antigravity windows with `modelIds` after `ProviderRegistry` merges saved models. Other providers leave the switch off and are unaffected. The tests run these sequences against the real provider, managed provider and `ProviderRegistry` from the official app.
- The UI language follows T3. T3's source text is English, and its translation function looks up Chinese at render time. "Extensions / 扩展" in the navigation and search relies on one patch at that translation function's entry point; the Extensions page and the extensions pick Chinese or English by `<html lang>`, and every other language shows English.
- It depends on variable names in 0.1.13's minified code, so every T3 update needs re-adapting (only this repository changes, not the extensions). The original file hashes are checked before patching, and a mismatch refuses the install instead of producing a broken app.
- The app is ad-hoc signed locally, without official signing, notarization or the Hardened Runtime: the official entitlements depend on the official provisioning profile, and an ad-hoc signed app that carries them doesn't launch.
- The `--isolated` copy registers the same `t3code://` link as the official app. With both open, the callback of a web sign-in such as T3 Connect may go to the other app; close the other one before signing in.
- T3 is building an official plugin system (an experimental PR, not merged yet). Once it lands, the plan is to migrate these extensions to official plugins and retire this host.

## Development

```sh
npm test               # pure functions, the example extension compiled and activated in the host wrapper, patches applied to the official 0.1.13, asar read back, registry hashes
node tests/verify.cjs "/path/to/T3 Code (Beta).app"  # if your local official app isn't 0.1.13, point the patch checks at a 0.1.13 app
node lib/build.cjs     # regenerate registry/index.json
```

This repository contains only the host (patches, the `host` API, the settings page, the marketplace) and the example extension. Each extension is developed, tested and released in its own repository following "Publishing extensions" above; the host doesn't need to change for them.

To change the host API, add the API here first, bump `API_VERSION` in `host/pure.js` and release, then have the extensions that use the new API set `apiVersion` to the new value.

## Community

This project takes part in and recognizes the [LINUX DO community](https://linux.do).

## License

MIT. T3 Code is a project of T3 Tools Inc. This repository doesn't distribute T3 Code (installation copies your local official app); it only keeps a few minified code snippets in `lib/patch.cjs` to locate the patch points.
