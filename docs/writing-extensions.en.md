[← Back to README](../README.en.md) · [简体中文](writing-extensions.md) | **English**

# Writing extensions

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

`apiVersion`: `8` if you use `host.t3` or `host.system`; `7` if you use `host.tray`, `host.agent.replies` or `host.agent.useUsage`; `6` if you use `host.server` or the background `t3x.handle` / `t3x.lang`; `5` if you use `host.agent` or `host.outputs`; `4` with a background script (`entries.server`); `3` if you use `host.dom` or `host.confirm()`; `2` if you use the settings panel's `Input` / `Select` family, `host.openSettings()` or `host.contextMenu()`; `1` if you use only the other APIs. The host refuses to install extensions whose apiVersion is newer than its own.

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
| `host.tray` | Puts an icon in the macOS menu bar that opens a menu or a popover the extension draws; requires `"permissions": ["tray"]`. See "Menu bar" below |
| `host.t3` | Reads T3's own data directly (the atoms behind threads, environments, settings, …); requires `"permissions": ["t3-internals"]`. See "T3 internal data" below |
| `host.system` | System notifications, writing to the clipboard and opening links in the browser; requires `"permissions": ["system"]`. See "System capabilities" below |
| `host.lang()`, `host.useLang()` | The current UI language: `"zh"` when T3 is in Chinese, `"en"` for every other language. `useLang` is a React hook that re-renders when the language changes |
| `host.t(chinese, english)` | Picks one by the current UI language; call it while rendering, after calling `host.useLang()` once in the component |
| `host.onDispose(fn)` | Called when the extension is disabled |

Slots:

| slot | Mode | Props the component receives |
|---|---|---|
| `chat.overlay` | Every extension renders | `threadKey`, `awaiting` (`"approval"`/`"input"`/`null`), `working`, `error`, `runStatus`, `providerInstanceId`, `driver`, `providers`, `model`, `subagents`, `context` (context usage: `usedTokens`, `maxTokens`, `usedPercentage`, `autoCompactThreshold`; `null` when unavailable), `compacting` (history is being compacted), `embedded` (true in side chat) |
| `composer.effort` | The last enabled extension replaces the native level list | `label`, `steps[{id,label,description,isDefault}]`, `activeIndex`, `defaultIndex`, `disabled`, `select(index)` |

An error in an extension's component only affects that extension: its overlay isn't rendered, `composer.effort` falls back to the native list, and the error shows on the extension's row. For colors, use T3's theme variables (`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, etc.); `html.dark` means dark mode.

## Putting agents to work

Extensions that declare `"apiVersion": 5` and `"permissions": ["agent"]` can use `host.agent` to put the agents you configured to work; the install dialog and the card show "Agent". Messages go through the same path as T3's composer: threads appear in the sidebar, and you follow progress and approvals in the thread. It only covers the environment of the current thread:

| `host.agent` | Description |
|---|---|
| `providers()` | Harnesses (T3 provider instances): `{ instanceId, driver, name, enabled, status, runtimeModes, models: [{ id, name, isDefault }] }` |
| `useThreads(opts?)` | React hook; the visible threads in the current environment (from host 0.8.0, pass `{ allEnvironments: true }` for every environment): `{ environmentId, threadId, projectId, title, instanceId, model, runtimeMode, interactionMode, running, lastError, lastRunCompletedAt, archived, needs }`; `needs` is what the thread is waiting on you for: `"approval"`, `"input"` or `null` (host 0.5.0 and later). Host 0.8.0 and later also give `branch`, `runStatus` (`preparing` / `queued` / `starting` / `running` / `waiting` / `idle` …), `lastRunStatus` (`completed` / `failed` / `interrupted` …), `runStartedAt`, `limitResetAt` (when a hit usage limit resets), `updatedAt` and `lastVisitedAt` (when you last opened it), all ISO strings or `null`, `pinned`, and what the T3 sidebar sorts and groups by: `createdAt`, `pinOrderKey` and `activeOrderKey` (order keys, `null` when unset), `unsettledAt` (when it was unsettled), `settled` (you settled it in T3), `snoozedUntil` (when a snooze ends) and `child` (a subagent, side chat or workflow step, or delegated from a thread that still exists; the T3 sidebar doesn’t list these) |
| `useProjects(opts?)` | React hook; projects in the current environment (`{ allEnvironments: true }` for every environment): `{ environmentId, projectId, title, scratch }`, where `scratch` is "No project" |
| `useSend()` | React hook that returns `send(req)`. `req.target` is `{ threadId }` (an existing thread: it keeps its own harness and runtime mode and is queued after the running turn) or `{ newThread: { projectId, title } }`. The other fields are `instanceId`, `model`, `runtimeMode` (`approval-required` / `auto-accept-edits` / `auto` / `full-access`; for new threads, and it must be in the harness's `runtimeModes`), `text`, and `images?: [{ name, dataUrl }]` (PNG / JPEG / WebP / GIF, up to 8, 10 MB each). Returns `Promise<{ environmentId, threadId }>`; throws if T3 doesn't accept it, the environment changed after rendering, or the extension is disabled |
| `replies(threads)` | The last finished agent reply of each thread (host 0.8.0 and later, apiVersion 7). Pass threads from `useThreads()`; returns `Promise<{ [threadId]: { text, at } }>`, where `text` is at most 2000 characters and `at` is an ISO time. Only threads in the local environment can be read; threads in remote environments, deleted threads and threads without a reply are left out |
| `useUsage(range, { environmentIds? })` | React hook; the data behind T3's usage page (host 0.8.0 and later, apiVersion 7). `range` is `"24h"`, `"7d"`, `"30d"` or `"90d"`. Without `environmentIds` it reads the environment of the current thread; with them (host 0.8.0 and later, apiVersion 8) it reads those environments and merges them with the rules of T3's usage page (records that several environments scan are counted once, and `sources` has one entry per provider); `refreshing` is true while some environment is still loading, environments that fail are skipped, and the status is `"error"` only when all of them fail; returns `{ status, refreshing, summary, error }`, where `status` is `"loading"`, `"ready"`, `"error"` or `"unavailable"` (the environment isn't known yet). Like T3's usage page, the query includes the model filter set in T3's settings for this environment. `summary` is `{ sinceDay, untilDay, sinceTime, untilTime, timeZone, readAt, buckets, sources }`. For 24h, `sinceTime` and `untilTime` are the queried window (it moves forward every 5 minutes; `untilTime` is exclusive), and buckets start at `sinceTime` and are 60 minutes each; for other ranges both are `null`. Each bucket totals one day (one hour for 24h, with `hourStart`), one provider (`claude`, `codex`, `grok`, `cursor`, `opencode`, `antigravity`, `pi` or `muse`) and one model: `uncachedInput`, `cacheRead`, `cacheWrite`, `output` and `reasoning` tokens, `costUsd` and `cacheSavingsUsd` (estimated with the prices set in T3), `sessions` (sessions in that bucket; one session can appear in several buckets, so don't add them up), and `unpriced` (whether some records have no price). `sources` lists the usage sources read, as `{ provider, status, distinctSessions }`; for the session total, add up `distinctSessions` of the sources whose `status` isn't `"missing"` |
| `open({ environmentId, threadId })` | Navigates to the thread |

For jobs that produce files: get the output folder with `host.outputs.dir()`, tell the agent in the message to write there, then read the files back with `host.outputs.read()` (you can poll for a result file the agent writes last). If the agent runs in a sandbox, writing that folder may need your approval in the thread. The output folder is on the machine running the desktop app, so use an agent in the local environment; an agent in a remote environment writes to the same path on the remote machine, which can't be read here. The output folder is removed when the extension is uninstalled.

## Menu bar

Extensions that declare `"apiVersion": 7` and `"permissions": ["tray"]` can use `host.tray` to put an icon in the macOS menu bar (host 0.8.0 and later); the install dialog and the card show "Menu bar". Clicking it opens either a native menu (`items`) or a popover the extension draws with React (`popover`). Each extension gets one icon. It is removed when the extension is disabled or uninstalled, or when the T3 window is closed or reloaded:

| `host.tray` | Description |
|---|---|
| `set({ title?, tooltip?, icon?, template?, items?, popover? })` | Shows or updates the icon. `title` is the text next to the icon (up to 40 characters). `icon` is the path of a PNG in the extension's `assets`, or a PNG data URL the extension draws itself (for example a status pill drawn on a canvas). It is shown as a 2x image (36×36 pixels show as 18 points); at most 64 KB, 512 pixels wide and 64 pixels high. `template` defaults to `true`, which makes the icon a template image that follows the menu bar's light or dark look; set it to `false` for colored images. At least one of `title` and `icon` is required. `items` has up to 60 entries: `{ id, label, detail?, tooltip?, disabled?, separatorBefore? }`; `detail` is a smaller second line, `tooltip` shows on hover (up to 1000 characters), and `disabled` entries work as group headings. `popover` is `{ width, height }` (width 240–560, height 60–760). With it, clicking the icon opens or closes the popover and right-clicking shows the `items` menu; without it, clicking opens the menu. The popover size is whatever the last `set` or `resize` gave, so pass the current size with every `set` |
| `Popover` | Component: `h(host.tray.Popover, null, content)` draws the content in the popover. The content stays in T3's React tree, so hooks and `host.agent` work as usual. The popover copies the T3 window's style sheets and theme (light or dark); the page background is transparent, so the extension draws its own rounded corners, border and background. It draws nothing until `set` has been called with `popover` |
| `usePopover()` | React hook: `{ open, close({ focusWindow? }), resize({ width, height }) }`. `open` tells whether the popover is open; `close({ focusWindow: true })` closes it and brings the T3 window to the front (use it when opening a thread). The popover closes when it loses focus or on Esc (unless the extension handles Esc and calls `preventDefault`) |
| `onSelect(fn)` | When a menu item is clicked, the T3 window is brought to the front and then `fn(itemId)` is called. Returns a function that cancels it; cancelled automatically when the extension is disabled |
| `clear()` | Removes the icon and the popover |

Keyboard events in the popover go to the popover's own `document` (get it from an element's `ownerDocument`). The menu bar only updates while the host in the window is running: when the T3 window is closed the icon goes away too, and the extension calls `set` again when the window reopens.

## T3 internal data

Extensions that declare `"apiVersion": 8` and `"permissions": ["t3-internals"]` can use `host.t3` to read T3's own atoms directly (host 0.8.0 and later); the install dialog and the card show "T3 data". Use it for data the curated APIs (`host.agent` and friends) don't offer, without waiting for the host to add an API. The host gives only read methods and no `set`, and writes still go through the curated APIs. Read-only is a convention, not isolation: you get T3's own objects (for example, the value of `presentationsAtom` is the `Map` T3 caches), so don't mutate them, and don't pass atoms you build yourself to `get` / `subscribe`.

| `host.t3` | Description |
|---|---|
| `atoms` | T3's atom collections as they are (the outer object is frozen; the values are T3's own objects): `server` (per-environment backend data: `configValueAtom(env)`, `settingsValueAtom(env)`, `usageSummary(…)`, …), `threads` (`threadShellAtom`, `hiddenThreadKeysAtom`, …), `threadState(environmentId, threadId)` (the thread detail atom T3 reads when you open a thread: its value is a `Result` whose `value` on success is `{ status, data, error }`; `data` is an `Option`, and when it's `Some`, `value.messages` is `[{ id, role, text, runId, updatedAt, … }]`. Subscribing makes T3 fetch the thread's details, so unsubscribe when you're done), `threadStatus` (the sync state of thread data: `statusAtom`, `quietThreadAtom`), `shells` (the environment backend's shell state, `stateValueAtom(env)`), `environments` (`providersByEnvironmentAtom`: `Map<environment id, providers>`, with limits in each provider's `usageLimits`; `presentationsAtom`: `Map<environment id, { entry: { target: { _tag, label } }, connection: { phase }, serverConfig }>`; the one whose `target._tag` is `"PrimaryConnectionTarget"` is the local environment), `catalog` (`catalogValueAtom`: the registered environments). The session connection collection isn't included because it holds access tokens for remote environments |
| `get(atom)` | The atom's current value; throws after the extension is disabled |
| `subscribe(atom, fn)` | Calls `fn()` when the value changes and returns an unsubscribe function; unsubscribed automatically when the extension is disabled |
| `useAtom(atom)` | React hook that subscribes to the atom's value; returns `undefined` when `atom` is `null` |

T3's own UI components and other modules don't need the host: call `import("/assets/<file>.js")` in your extension and you get the same module instance T3 uses (the same React and atom registry). For example, the menu bar threads extension draws the Limits tab of T3's usage page with export `r` of `import("/assets/UsageLimits-Dc1W_G1R.js")`. File names carry a hash and export names are minified letters, and both change with the T3 version.

These are internal objects from T3's minified code, and their structure follows the T3 version: the host only guarantees that, on the T3 version it targets (see the table in the README), it hands over the collections above. Check T3's code for the shape of each atom's value. Expect to update your extension when T3 updates, and prefer the curated APIs when they cover what you need.

## System capabilities

Extensions that declare `"apiVersion": 8` and `"permissions": ["system"]` can use `host.system` (host 0.8.0 and later); the install dialog and the card show "System":

| `host.system` | Description |
|---|---|
| `notify({ title, body?, silent?, onClick? })` | Shows a system notification (`title` up to 200 characters, `body` up to 2000) and returns `Promise<a function that closes it>`. It uses the same mechanism as T3's own completion alerts: clicking the notification brings the T3 window to the front, then calls `onClick()` (which may be async; errors are logged to the console). Asks for permission when it hasn't been granted yet and throws when it is denied; nothing shows when notifications for T3 Code Extensions are turned off in System Settings. Notifications are closed when the extension is disabled |
| `copy(text)` | Writes text to the system clipboard (through the main process, so it also works when the T3 window isn't in front, for example from a menu bar popover) |
| `openExternal(url)` | Opens a link in the default browser; accepts only `http` and `https` (T3 0.1.13 itself allows only these two), and throws when the link can't be opened |

## Background extensions

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
