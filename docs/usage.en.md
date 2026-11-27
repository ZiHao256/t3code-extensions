[← Back to README](../README.en.md) · [简体中文](usage.md) | **English**

# Usage

Settings → Extensions:

- "Applying settings for [project] on [environment]" at the top is T3's own scope picker. With a specific project or environment selected, the switches only affect threads there (project > environment > global; a scope without its own setting shows "Inherited" and can be reset). This only controls visibility: an extension's code loads if it is on in any scope, and the extension's own settings are shared everywhere.
- **Installed**: installed extensions. Toggle, Settings, Remove, and refresh (GitHub sources check for updates; local extensions re-read their folder).
- **Browse**:
  - Community extensions: GitHub repositories with the `t3code-extension` topic, sorted by stars. The first 30 are listed by default; find the rest by searching. They are marked "Community" and pinned to a commit when installed. Card descriptions come from `description` / `locales` in `plugin.json` on the repository's default branch and follow the UI language; if that can't be read, the GitHub repository description is shown.
  - You can also enter a GitHub repository URL, a `plugin.json` link or a third-party marketplace's `index.json` link, or upload a zip.
  - Every install asks you to confirm the source first.
- **Add local extension**: pick an extension folder; after changing the code, click refresh on its card to re-read it (for development; environments that can't remember folders fall back to a one-time import).
- **Refresh**: checks every updatable extension and T3 Code Extensions itself for updates, and refreshes the community list. Nothing is checked automatically when the page opens: without signing in to GitHub, each outgoing IP gets only 60 API calls per hour (one check uses about 3) and about 10 searches per minute. Shared proxy exits are often used up by others; in that case you'll see when the limit resets.
