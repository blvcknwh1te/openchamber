# Session Sidebar

Sidebar code is organized by the business object it owns. Shared contracts are
kept at this root in `types.ts` and `utils.tsx`.

- `shell/` owns sidebar chrome, navigation, search, confirmations, and switcher effects.
- `list/` owns global-first session collection, directory bootstrap demand,
  layout-owned synchronization, authoritative cleanup, and nearby-session prefetch.
- `projects/` owns project zones, grouping, ordering, scroller behavior, project
  view state, repository state, and worktree presentation.
- `sessions/` owns session rows, row actions, expansion, ownership, and activity indicators.
- `recent/` owns Recent and managed Chats activity projections.
- `folders/` owns folder DnD, bulk actions, archived folders, and folder UI.
- Root session right-click and overflow menus expose `Move to worktree`: a submenu
  listing the canonical primary and linked worktree destinations, with the current
  target disabled and a separate `New worktree...` action. Opening the submenu
  refreshes the worktree topology. Moving transfers the full idle subtree. Clean
  and non-Git sources move session-only; a dirty Git source prompts to move only
  the session, move all source changes, or cancel. Descendants move first without
  changes and roll back session-only if a later descendant fails. The root moves
  last and carries source changes once, which prevents rollback from replaying the
  transferred patch into the source.
- Failure cleanup: a worktree created for the move is removed only after a
  definite failure. When the change-carrying request fails without confirming
  its outcome, that worktree is KEPT (it may hold the only copy of the user's
  changes), both directories are refreshed authoritatively because the session
  may have moved server-side, and the toast points the user at the destination.
  Existing destinations are never removed; they get the same guidance.

`MainLayout` and `VSCodeLayout` call `useSessionListSync({ isVSCode })`
unconditionally. The hook publishes complete directory bootstrap demand,
refreshes newly added topology, coalesces control events, and performs
authoritative cleanup. Root-level `useGlobalSessionsPolling` remains the only
initial and 45-second global poller. `useSessionListSync` must not create a
second global polling lifecycle.

The global sessions cache is the complete source for active and archived
coverage. Initialized directory stores only supply sessions missing from that
cache. Live busy and retry state comes from `global-session-status`, never from
the global cache or persisted history. A failed global or directory fetch keeps
existing data; it is never treated as an authoritative empty list.

Web and desktop show managed Chats before optional Recent activity. Chats use
their shared managed root for folders and never expose worktree actions. Project
display can be all projects or one selected project. The mobile sessions sheet
(`apps/MobileSessionsSheet.tsx`) partitions the same way through
`partitionSidebarSessions` and lists Chats as a collapsible section above the
project tree, with no Recent projection. VS Code excludes worktrees and managed
Chats while keeping inline archived buckets.

VS Code's project registry mirrors the workspace folders, so the sidebar would
only ever list the folders currently open even though every session lives in the
same shared OpenCode database. `useExternalSessionProjects` therefore extends the
rendered project list with the projects `sdk.project.list()` reports and the
registry lacks, and `knownDirectories` follows that same list so those sessions
pass the directory filter and resolve an owner. A discovered project
(`external: true`) is display-only: it appears only while the global sessions
cache lists at least one session in its directory (archive included), it never
becomes the active project (`setActiveProjectIdOnly` is a no-op in VS Code), and
it stays out of Git enrichment so the sidebar does not read the status of every
repository in the database. Web and desktop keep the registry as the single
authority. Opening a session from a discovered section needs nothing extra: the
row hands its own `directory` to `setCurrentSession`, and the new-session button
passes that directory as `directoryOverride`.

The active project (`useProjectsStore.activeProjectId`) is marked in the project
header by `ProjectHeaderIdentity` (`projects/sortableItems.tsx`): a left accent
bar (`bg-primary`) plus the label switching to `text-primary`. Discovered
projects are never active, so they keep the plain header. The sticky leading
overlay reuses the same identity and applies the same marker.

In VS Code the compact list is one surface across every project, so a view
switch back to the list must not reopen a chat by itself.
`resolveMissingProjectSessionSelection` therefore preserves the selection when
the open session is rendered under any project other than the active one, while
web/desktop keep auto-substituting the active project's remembered session. The
runtime gate is `topology.isVSCode`, threaded from `SessionProjectCollection`
into `ProjectSessionSelectionEffect`; single-project mode renders only the
active project, so the gate never fires there.

Directory demand always includes known project roots and worktrees. Visibility
only changes priority. Row mounts must not start bootstrap work. Selection and
activity subscriptions stay session-scoped so a structural list update does not
make every row observe unrelated streaming updates.

Folding the whole project list is a toolbar action, not a menu-only one: the
collapse-all and expand-all buttons render in `SidebarHeader` at the start of the
right-hand control group, next to search and selection. The display-mode
dropdown keeps its own menu items for the same two actions, and both paths call
`collapseAllProjects`/`expandAllProjects` from `useSessionProjectViewState`, so
there is one way to change the state. Neither button appears in single-project
mode, where the only project cannot be folded away. The buttons are deliberately
independent of `showProjectDisplayControls` (which stays false in VS Code),
because the compact VS Code sidebar renders no display-mode menu at all.

The compact VS Code sidebar hides `SidebarHeader` entirely, so
`VSCodeProjectCollapseControls` (in `components/layout/VSCodeLayout.tsx`) renders
the same two buttons in the `VSCodeHeader` sessions view. It calls `collapseAll`/
`expandAll` on the shared `useSessionCollapseStore` directly, which is the same
state the `SessionProjectCollection` list renders from. The buttons appear only
once the sidebar has registered at least one project.

Collapsed projects are owned by `useSessionCollapseStore`, not by the hook's
component state, so both the sidebar and the VS Code header read and write the
same set. The hook (`useSessionProjectViewState`) keeps the group collapse/order
state and registers the rendered project ids with the store so `collapseAll`
works from the header.

A project header is folded when the store does not say otherwise: the sidebar
opens with every project folded except the active one, so a list spanning several
projects starts on the one being worked in. The hook derives that from the
rendered list on every pass instead of applying a default once, which is what
keeps late arrivals folded — in VS Code the workspace folder is known immediately
while projects found in the session database arrive later through sync. The
active project is always open, so switching the window moves the open header with
it and no project the user is working in can be folded.

The store records two explicit sets, and nothing else: `collapsedProjectIds` for
what the user folded by hand and `expandedProjectIds` for what they unfolded.
`expanded` wins over `collapsed` for the same id, and a hand-unfolded project
stays open across restarts. There is deliberately no "the user has made a choice"
marker: a single marker could only be set, never cleared, so one expand-all click
used to disable the default for the rest of that browser profile's life. Because
the state is derived, "expand all" and "collapse all" are absolute — they clear
the opposite set — while both keep the active project open.

`oc.sessions.projectCollapse` stays byte-compatible with the previous format (a
bare JSON string array), and its expand counterpart lives in
`oc.sessions.projectExpand`; both are written by
`stores/sessionCollapsePersistence.ts` and read back as empty when missing or
malformed. `lib/persistence.ts` no longer mirrors the collapse key: that mirror
had become a second writer of a key the sidebar owns, and in VS Code, whose
project registry carries no `sidebarCollapsed`, it always deleted what the store
had just saved.

Session menus share `SessionAiRenameMenuItem` with header tabs and the
single-session header. AI renaming uses the same leading spinner as a worktree
move; the pending operation survives closing the menu or selecting another
session. Eligibility loads only while a menu is open. See the AI session titles
section in `sync/DOCUMENTATION.md` for context selection and mutation guards.

Manual rename inputs share `components/session/sessionRenameKeyboard.ts` with
the header and mobile list. Enter explicitly submits the owning form on
keydown; Escape cancels. IME composition keys keep their text-input behavior,
and held Enter does not submit repeatedly.

## Search

Sidebar and Recent queries beginning with `ses_` match only the full session ID,
case-insensitively and ignoring surrounding whitespace. Partial IDs and typos
return no matches, without falling back to titles, directories, group labels,
or folder names. Ancestors remain as tree context for a matching child. A matched
node keeps its subtree for rendering and subtree actions. Only exact ID matches
count toward the result total.
ID search does not include archived sessions. `ArchiveView` applies the same
exact-ID rule to its own archived list. Other queries keep each view's existing
matching and ordering. Search does not fetch sessions or broaden list membership.

## Loading rules

- Always publish every known project root and worktree directory. Collapse/visibility changes priority only; they do not opt a directory out of authoritative refresh.
- Current directory and selected-session directory are `selected` demand and therefore run first.
- Expanded projects/worktrees outrank merely visible and background groups.
- The sync scheduler deduplicates, promotes, retries, and limits work. Sidebar components must not reproduce that lifecycle with mount effects.
- Hide speculative work when the sidebar/chat surface is hidden: message prefetch, Git/PR enrichment and subscriptions, search listeners, sticky-header observation, and archived-folder derivation stop. The session row tree unmounts so row-owned status, permission, unseen, and viewport subscriptions do no background work. The outer sidebar remains mounted, preserving UI state and authoritative directory refresh for an immediate reopen; deferred derived work reruns from current state when visibility returns.
- The sidebar does not subscribe its whole tree to the cross-directory live-session aggregate. Global create/structural/lifecycle snapshots drive rendered session metadata; the cached sync index only fills sessions not yet present globally and provides refresh fallback data. Row activity continues to come from the session-keyed live status index.
- Session selection does not invalidate the sidebar orchestration component. Each mounted row selects only whether its own session ID is active, while parent expansion, project selection memory, and neighbor prefetch run in small effect-only subscribers.
- Parent expansion is exclusively manual. Selecting or navigating to a subsession never expands its parent automatically. Project/worktree and `recent` trees use independent persisted context keys and receive separate stable projections, so expansion changes in one context neither invalidate nor change the other. The persisted storage key remains `v3`; older state mixed contexts and is not migrated into this contract.
- Folder membership may contain both a parent session and its descendants. Rendering treats only the highest assigned ancestors as folder roots because their normal session trees already include assigned descendants; persisted membership remains unchanged for cleanup and move semantics.
- Sidebar selection holds the clicked row's viewport position across navigation-driven sidebar updates. Wheel or touch input anywhere in the window cancels the hold immediately (`sessions/sessionRowScrollAnchor.ts` listens in the capture phase, so a row tooltip portal, the overlay scrollbar, or a sticky header cannot swallow the cancellation), and programmatic compensation never fights intentional scrolling.
- Global session subscriptions are structural: create/delete, title, share, archive, directory, parent, and slug changes invalidate the tree. Recency-only `time.updated` changes do not trigger a rebuild. The separate lifecycle rank invalidates ordering only on `settled ↔ active` transitions, with root sessions ranked among roots and child sessions only among siblings of the same parent.
- Row metadata that changes without a structural rebuild comes from a session-keyed index. The inline model badge (left of the date, and in the hover-revealed metadata of every non-touch layout) reads `sync/session-last-model.ts`, which projects the last used model from the global session cache; the row node's own `model` is only the fallback for sessions that cache does not list yet. The same slot carries the compact spend chip (`sessions/SessionUsageCostBadge.tsx`) that prints the row's already-projected `cost` through the shared `lib/money.ts`, so the row metadata reads `Model · $4.74 · date`: the chip joins the model badge through a middle-dot divider instead of taking a column of its own, and a divider is skipped whenever nothing precedes it. The chip is hidden, never zeroed or dashed, when the row reports no cost; the token figure survives in the hover tooltip only. Every row hover tooltip, including VS Code, lists project, branch, PR, model, cost, and total tokens; those two totals come from `sessions/sessionUsageTotals.ts`, which projects each session's `cost` and `tokens` out of the same cache, adds every descendant node of the row (a sub-session is a session of its own, so its spend is not in its parent's totals), and falls back to the row's record for sessions the cache does not list yet. A projection that carries no totals is not stored, so a later partial payload cannot erase spend the row already showed.
- A worktree Git still registers but whose directory is gone (`prunable` in `git worktree list`) stays in the topology with `worktreeStatus: 'missing'` and a warning icon on its group header. Its sessions remain accessible for manual movement or archiving through worktree deletion. Opening a session does not move it. The ordinary worktree delete action accepts a missing directory. Topology discovery remains event-driven, including `session-created` and server `worktree-changed` control events, with no idle polling. The server sends `worktree-changed` after its own worktree create/remove and when a status or listing request notices that a repository's worktree set changed (see `packages/web/server/lib/git/DOCUMENTATION.md`); the event names every directory of that repository the server has seen, and the sidebar refreshes each registered project among them once, bypassing the 30-second list cache. A worktree this client created and is still bootstrapping keeps its `pending`/`invalid` status through that refresh. Hosted mobile and the desktop mini chat handle the same control event through `lib/worktrees/worktreeTopologyRefresh.ts`; VS Code intentionally excludes worktree topology.
- Opening the root-session `Move to worktree` submenu force-refreshes the owning project's worktree topology so externally created worktrees appear without a full reload. While that refresh runs, the menu keeps the last known primary/linked topology visible; if the refresh fails, the stale topology remains and the load failure state stays explicit. Failure cleanup never removes or manages an existing destination worktree.
- CLI/server-created sessions use the low-frequency OpenChamber control event stream to refresh only the created session directory. The same event retriggers bounded worktree discovery so a newly created external worktree gains ownership without a view reload; it does not re-enable broad session or streaming subscriptions.
- Recent membership includes active root sessions immediately even when their last committed `time.updated` falls outside the 48-hour window. Children and archived sessions remain excluded, and inactive roots remain timestamp-based. The active-ID subscription is disabled while the sidebar is hidden and ignores retry/status detail changes, avoiding streaming-frequency rerenders.
- Structural updates rebuild grouped nodes only for projects whose local sessions, worktrees, repository state, or branch changed; unchanged project sections preserve references so memoized group/session descendants skip the update wave.
- Empty successful lists, unresolved loads, and failed loads are separate UI states. Failed groups expose Retry and retain prior data.
- Directory permission failures remain visible even when stale sessions are retained. Flat groups inspect every represented root/worktree directory; local Desktop may open the native picker for the exact failed directory, while other runtimes keep the ordinary Retry action.
- Pins and folder assignments are not pruned from the first startup snapshot or from optimistic mutations. Confirmed local deletion and routed external deletion clean immediately; a later authoritative omission after an established baseline covers missed external delete events.
- Pending-permission/question row badges fade with the same hover/menu-open rule as the date label, except on non-VS Code always-visible-actions rows, which reserve permanent padding and keep the badges shown. VS Code hover-reveals its actions over the row's right edge even under `alwaysShowActions`, so its badges keep fading (`selectRowBadgeVisibilityClass` in `sessions/sessionNodeItemUtils.ts`).


## Project action indicators

`SidebarTerminalActivity` shares terminal discovery with the action header and terminal
panel while the sidebar is visible. One server listing covers all directories, including
collapsed projects. The sidebar keeps that loop running only while a project action is
known to be running anywhere; with nothing running it lists once on mount, to pick up
runs another client started, and then stays quiet so an idle sidebar costs no polling. It preserves local mutations newer than the listing and keeps known
state on failure. Terminal discovery is separate from OpenCode session bootstrap.

`DirectoryActionIndicator` reads only its directory's terminal metadata. Output chunks and
unrelated directories do not rerender it. It displays a static `pulse` icon in `status.info`
for live project actions, including auto-discovered commands. Persisted idle tabs and ordinary
interactive terminals do not indicate activity. This indicates process activity, not server
readiness.

Grouped views show the icon on project-root and worktree headers. Flat project views show
it on the project-root header and on sessions in linked worktrees. Recent shows it on every
session with an active action in its own directory. Archived buckets do not show action
indicators. Indicators stay inside the existing row/header action-padding boundary, so
hover, keyboard focus, and always-visible action buttons move them left without hiding them.
