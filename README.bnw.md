# OpenChamber BNW (personal fork)

OpenChamber BNW is a personal fork of [OpenChamber](https://github.com/openchamber/openchamber). Upstream builds the product; this fork adds a set of quality-of-life changes for everyday VS Code use and keeps a separate extension id so it can run next to the original extension.

It tracks upstream `main` and merges upstream releases. The current base is upstream v1.23.0 with `@opencode-ai/sdk` 1.18.30. Fork builds are versioned `1.23.0-bnw.N`.

## Install (VS Code)

Download the latest `openchamber-bnw-<version>.vsix` from [Releases](https://github.com/blvcknwh1te/openchamber/releases/latest), then in VS Code open Extensions -> the `...` menu -> Install from VSIX, pick the file, and reload the window.

The extension id is `blacknwhite.openchamber-bnw`. It installs alongside the original `fedaykindev.openchamber`. Commands, view containers, and when-clauses use the `openchamberBnw.*` prefix, so the two extensions do not collide.

## What differs from upstream

### Separate identity

- Extension id, display name, command ids, view containers, and when-clauses use the `openchamberBnw.*` namespace. The shared UI still emits `openchamber.*` command ids, so the extension host remaps them to the `openchamberBnw.*` prefix.
- `repository` and `qna` point at this fork.

### Themes and user CSS in VS Code

- Custom themes from `~/.config/openchamber/themes` load in the VS Code runtime.
- `~/.config/openchamber/custom.css` is injected into every webview and applied after the theme.
- Editing a theme file or `custom.css` on disk applies without reloading: the host watches the files and pushes the update to open webviews.
- Chat spacing, tool colors, and font sizes live in `custom.css`. The horizontal chat padding is the `--chat-inline-pad` variable, and the user message row uses the `chat-user-row` class plus `--chat-user-row-bg`.

### Reload and restart

- A reload button in the chat tab toolbar and sidebar, and a Reload command in the tab context menu. It reloads the webviews and restarts the managed OpenCode server.
- Automation trigger: creating, changing, or removing `~/.config/openchamber/reload.signal` runs the same reload, so a script or agent can trigger it without the UI. In web and desktop the existing `POST /api/config/reload` is the HTTP equivalent.
- Changing `opencode.json` or `opencode.jsonc` (global or project) restarts the managed OpenCode server, deferred until no turn is active.
- Plugins are declared through the `plugin` array in the global config, because OpenCode 1.18.x does not scan the global `plugins/` folder.

### Chat behavior

- Thinking is expanded by default. An explicit off setting keeps it collapsed, including during streaming.
- The Reload command is localized for French and Turkish.
- Links and paths in messages are underlined and clickable. A file opens in the editor at the referenced line and column; a directory reveals in the file explorer.
- Paths written as plain text, not only inline code, become links. Windows paths with backslashes and spaces are recognized. A path becomes a link only when it exists.
- URLs written inside inline code are clickable too.
- Fixed a Windows case bug: the workspace folder came back as `d:\...` while the UI normalized it to `D:\...`, so every path probe failed with 403 and file links stayed dead.

### Permission descriptions

- Shell commands in the permission card get a one-line description from the configured small model, so you can see what a command does before approving it. It reuses the session-title small-model endpoint and is skipped when OpenCode already provides a description.

## Diagnostics

Set `OPENCHAMBER_FILEREF_DEBUG=1` in the environment and restart VS Code to log file and directory link resolution probes to `~/.config/openchamber/fileref-debug.log`. It is off by default.

## Development

Build the VSIX from `packages/vscode`:

```bash
bun install
cd packages/vscode
bun run package
```

## Credit and license

MIT, same as upstream. All credit for OpenChamber goes to the upstream project and its contributors. This fork only carries the changes listed above.
