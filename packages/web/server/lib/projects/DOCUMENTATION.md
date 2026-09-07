# Projects

## Purpose

Server-owned storage for a project's per-user config file,
`~/.config/openchamber/projects/<projectId>.json`. The file holds two
families of keys with different writers, and this module is the only place
that writes it:

| Keys | Owner | Reached through |
|---|---|---|
| `version`, `scheduledTasks` | `project-config.js` (scheduled-task runtime) | `/api/projects/:projectId/scheduled-tasks/*` |
| `setup-worktree`, `setup-worktree-wait`, `projectActions`, `projectActionsPrimaryId`, `draftStarters`, `projectPath` | `project-setup.js` via `readProjectSetup` / `updateProjectSetup` on the same runtime | `GET/PUT /api/projects/:projectId/config` (`routes.js`) |

Notes, todos, and plans moved out of this file to `packages/web/server/lib/project-context`.

## Modules

- `project-id.js` — `createProjectIdFromPath`: the path-derived id (`path_<base64url>`) that names the file. The shared UI derives the same id (`packages/ui/src/lib/projectId.ts`); both sides must agree.
- `project-config.js` — `createProjectConfigRuntime`: raw read, atomic write, the cross-process file lock (Electron and a CLI `serve` can share one projects dir), scheduled-task normalization, and the project-setup read/update.
- `project-setup.js` — sanitizers and the client view for the setup keys. Mirrored in the VS Code extension host (`packages/vscode/src/project-setup.ts`), which owns the same file when the webview has no OpenChamber server; keep the two in sync.
- `routes.js` — the setup routes. `/api/projects` is on the JSON-body allowlist in `opencode/core-routes.js`.

## Invariants

- **Every write is a locked read-modify-write of the whole document.** Keys the writer does not own, and keys from newer builds, come back out unchanged. A setup update and a scheduled-task update never clobber each other.
- **A wrongly shaped key is a 400, not a silent drop.** `projectSetupPatchToStored` throws; the file is untouched. Values inside a well-shaped key are sanitized (trimmed, capped, deduplicated) rather than rejected.
- **The client never composes the path.** `packages/ui/src/lib/openchamberConfig.ts` speaks only HTTP; the same code serves web, desktop, VS Code, and the phone, including a phone on a remote instance.
- **`OPENCHAMBER_DATA_DIR` does not move this directory.** The projects dir hangs off `OPENCHAMBER_USER_CONFIG_ROOT` (`~/.config/openchamber`), unlike `settings.json` and friends. A scratch server started for a test still reads and writes the real project configs.
