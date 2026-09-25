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
- Chat spacing, tool colors, and font sizes live in `custom.css`. The variables that are worth touching:
  - `--chat-inline-pad` — horizontal padding of the chat columns (messages, composer, container).
  - `--chat-user-message-bg` — the user bubble itself.
  - `--chat-user-row-bg` — the full-width strip the user bubble sits on, so you can paint that band without touching the app canvas.
  - `--background` — the app canvas, including the chat background.
  - `--foreground`, `--muted-foreground`, `--surface-muted-foreground` — answer text and secondary text.
  - `--tools-title`, `--tools-description`, `--tools-icon` — tool and thinking rows.
  - `--chat-divider` — dividers, including the one before a turn result.
  - `--markdown-heading1`, `--markdown-heading2`, `--markdown-heading3` — headings inside answers.

### Settings

- Appearance has `custom.css` actions: Open / create writes the fork template when the file is missing and reveals it in the editor; Reset to defaults overwrites the file with that template. Reset has no undo, so keep a copy of anything you care about.
- A back button sits in the settings header next to the search box. It walks back through the pages you visited and closes Settings once there is nothing left to go back to — the X is still there for closing outright.

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
- Home-anchored paths (`~/...`) are recognized too: the leading `~` is kept in the token and expanded against the resolved home directory before the existence probe, instead of being mistaken for an absolute `/...` path. When the home directory is not known yet, the reference stays unlinked rather than resolving to a bogus path.
- A path with a line reference (`file.ts:12` or `file.ts:12:3`) opens the editor at that line and column. The position is re-read from the link text on click, so it survives the pre-resolved path stored during annotation.
- URLs written inside inline code are clickable too.
- Fixed a Windows case bug: the workspace folder came back as `d:\...` while the UI normalized it to `D:\...`, so every path probe failed with 403 and file links stayed dead.
- A directory link opens the directory itself instead of revealing it inside its parent window. The same fix applies to "Open in File Explorer" in the files view and sidebar.
- Paths outside the workspace stay clickable: existence probes are allowed outside the workspace root, while content reads remain restricted to it. This makes links such as the OpenCode log under the home directory work.
- Link checks recover: a rejected or unreachable probe is no longer remembered as "file missing", and a "missing" answer is re-checked, so a link appears once the file exists even if the first check ran before it was written.
- The per-message link budget counts links, not candidates. A message holds far more path-shaped tokens than real references, and spending the budget on those left every later path unlinked. A link also stays granted while its text is unchanged, so a repeated annotation pass no longer drops or re-probes it.
- A reference resolves when the opened folder sits inside the repository or the repository inside the opened folder, and a path without an extension is searched as a directory as well, so `packages/ui/...` and folder references link in both cases.
- The automatic compaction summary is no longer rendered as an assistant answer. Compaction itself is unchanged, and the summary stays in the session.
- The "Context compacted" notice appears while the summary streams, instead of only after the turn settles.
- Older history stays reachable in the VS Code webview. A session whose messages were already materialized (realtime events, a send confirmation) no longer marks itself as fully loaded while OpenCode coverage is still unknown, so the initial page is fetched, the real cursor is registered, and scrolling up loads older messages again.
- A streaming answer aligns to the top: when a new answer starts streaming, its first line pins to the top of the viewport and the text grows downward, instead of the view chasing the bottom. The first manual scroll releases the pin and following the live edge works again.
- A large markdown table in a user message collapses to a few rows with a soft bottom fade — in the sticky header too — and expands by clicking the message like any other truncated text.

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
