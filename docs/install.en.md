[← Back to README](../README.en.md) · [简体中文](install.md) | **English**

# Install and update

Requirements: `/Applications/T3 Code (Beta).app` is the official 0.1.13 (for other versions see [the table in the README](../README.en.md#quick-start)), and Node.js 22 or later.

## Install with an agent

Paste this to Claude Code, Codex or another coding agent:

```text
Install T3 Code Extensions (https://github.com/ZiHao256/t3code-extensions) on this Mac.
1. Check the prerequisites: /Applications/T3 Code (Beta).app exists (read CFBundleShortVersionString from its Contents/Info.plist) and node -v is 22 or later.
2. Pick the version from the table in that README: T3 Code 0.1.13 uses the main branch, 0.1.12 uses the v0.5.0 tag, 0.1.11 uses the v0.1.0 tag. For any other version, stop and tell me.
3. Clone the repository to ~/t3code-extensions (or update an existing checkout to that version) and run npm test there. If it fails, stop and show me the output.
4. Ask me whether to share data with the official app or use separate data (--isolated, can run alongside the official app). For shared data, remind me to quit T3 Code first and wait for my confirmation, then run node install.cjs install (add --isolated for separate data).
5. Run node install.cjs status, show me the output, then open ~/Applications/T3 Code Extensions.app.
Do not use sudo and do not modify the official app in /Applications.
```

## Install manually

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
