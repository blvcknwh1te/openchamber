# UI source control

## Repository binding authority

`repository-binding.ts` owns binding reads and their lifecycle for the shared UI.
Editors, GitView, PullRequestSection, walkthrough, sidebar discovery and provider
pickers use this owner. MobileChangesSurface mounts the same binding settings;
it does not keep another binding snapshot. Network operation planning still
performs its own fresh safety reads through RuntimeAPIs, outside this UI owner.

- Demand is keyed by runtime identity and exact directory. Only an authoritative
  repository ID joins worktree scopes. Equal paths on different runtimes never
  share state.
- `idle`, `loading`, `ready`, `stale` and `error` distinguish an unresolved read, an actual
  request, successful empty binding and failure. Refresh failure retains the last
  complete `read` as stale, along with the original Error and its metadata.
- `contexts` grants provider-read demand only while the owner read is ready and
  the selected association's readiness is `ready` with a matching approved fetch
  fingerprint. Aggregate `needs-attention` does not suppress healthy siblings.
  Consumers also check the existing exact-account auth selector. Retained
  binding or account metadata does not authorize provider requests or stale
  provider results after authority is lost.
  Pending picker reads check the captured hook's `isCurrent` before publishing,
  so binding or runtime invalidation rejects completions before React cleanup.
- PR-status arbitration owns status demand only. It cannot accept, reject or
  suppress the binding snapshot used by an editor.
- PR, walkthrough and branch-diff surfaces take provider identity and the primary
  remote from the first ready committed binding context. Repository default
  branches and remote-qualified base hints are accepted only from that remote;
  another configured remote is not reinterpreted through the selected binding.
  Provider capability loading or failure grants no create or merge support.
  Failure remains distinct from an authoritative unsupported result and requires
  an explicit Retry.
- Concurrent reads of a directory share one promise. Mounted consumers subscribe
  to that directory, not a global collection. There is no binding polling timer.
  Retry is explicit; a failed read does not restart itself on render or remount.
  Releasing the last subscriber marks complete data stale; new demand refreshes
  it without discarding the previous snapshot.
- Provider and transport editors capture a mutation scope before sending the
  existing API intent. It includes runtime generation, directory, expected
  repository ID and expected revision. `setMutationResult` rejects mismatched
  repositories and non-advancing or obsolete results, then publishes accepted
  results to all known scopes for that repository. Call `release` in `finally`.
- Reads return committed state, including newer mutation results. A worktree's
  first in-flight read also overlays a newer result already known for its
  repository. Conflict reconciliation waits for older reads, then starts one
  shared fresh read. It never retries a write. A successful reconciliation updates
  all known aliases, including mounted PR and picker consumers.
- Subscribers, pending reads and pending mutations pin their entries. Rendering
  only reads snapshots and never creates or evicts entries. One deferred cleanup
  pass retains at most 64 idle directory entries; live entries may exceed that
  soft limit. Repository indexes disappear with their last directory entry.
- `runtimeEndpointReset.ts` resets the owner before the new runtime is used.
  Generations reject late reads and mutation results even when a later switch
  returns to the same runtime key. No binding data is persisted.

The owner consumes the existing `SourceControlAPI.repositoryBinding`, provider
mutation and confirmed reset, plus `GitAPI.configureTransportBinding`,
`GitAPI.removeTransportBinding`, and `GitAPI.configureAuxiliaryBinding` results. Web, Electron, VS Code,
hosted mobile and Capacitor keep their existing adapters and unsupported/error
behavior. UI sharing does not replace server authorization or CAS enforcement.

Shared account removal requires an exact credential account ID; the web adapter
rejects omitted or padded IDs before transport. Provider mutation receipts expose the
server-derived provider-user identity as `actor.providerAccountId`; request
contexts continue to carry only exact credential and binding authority.

The [binding contract](../../../../web/server/lib/source-control/DOCUMENTATION.md)
defines capability readiness and persisted v1 conversion. `boundGitNetworkOperation`
checks the selected remote's readiness and exact saved fetch/push fingerprints,
not aggregate binding state. Requests carry the current repository config revision;
the binding retains its approved endpoints for independent repair. Provider contexts
and cache keys retain the single overall CAS revision, so stale contexts require a
fresh owner read even when another capability caused the revision change.

## Anonymous transport

Transport and clone selectors expose anonymous HTTPS as read-only in every locale, without a repeated confirmation modal. SSH URLs disable the anonymous option. Clone URL changes clear the transport selection; transport editor endpoint changes clear the pending selection. Publish destinations label and disable anonymous grants, and shared request builders reject anonymous push, sync publication and remote deletion before calling the planner. Shared binding and network parsers retain the anonymous tag, never a verified actor or System marker. The connected OpenChamber server remains the authorization owner; clone still reports retained-checkout binding failure as finish-setup rather than success.

## Managed SSH onboarding

`ManagedSshCredentials.tsx` serves Git Settings, repository transport, and clone selection through the optional `GitAPI.managedSshCredentials` operation. It starts no inventory, discovery, import, or provider authentication on mount. Explicit inventory returns safe labels, public fingerprints and opaque managed references. Explicit discovery returns short-lived opaque candidates from the connected server. Ready candidates show their exact fingerprint, require a keyboard/touch-capable confirmation checkbox, and keep Import disabled until confirmation. Import selects the returned managed credential in the current local draft when a selector is present, but never saves a repository grant, binds a provider, or changes author identity. Transport Save or clone execution remains the separate authorization action.

Reads distinguish failure from empty success. Failed operations retain data but disable stale inventory selection; explicit buttons remain available for retry. Typed expiry, source-change, mismatch, unavailable, and capacity rejections tell the user to rediscover or repair host state. Runtime-will-change and unmount invalidate pending inventory, discovery, and import results. Runtime changes clear candidates, confirmation, and selection without loading the new host automatically.

The connected OpenChamber server owns discovery and imported copies for web, Electron and both mobile clients. The UI explains that discovery is limited to immediate private-key files in the server user's approved `~/.ssh`, with no recursion, symlink, SSH config, or agent inspection. It points passphrase-protected and agent-only users to explicit unverified System transport. VS Code omits the server inventory capability; its transport is always the user's system Git. All onboarding and error copy is translated in all 11 locales. The [Git module](../../../../web/server/lib/git/DOCUMENTATION.md#exact-ref-transport-authority) owns candidate lifetime, verification, storage, protocol enforcement, rollback, and provisioning constraints.

## Committed repository context

`SourceControlBindingSettings.tsx` renders the shared GitView and mobile Changes
summary from the binding owner, never from editor selections. It shows exact
provider and instance, each remote's committed transport and readiness, the
current author, and executor class. Managed HTTPS transport presentation comes
only from the exact revision-pinned credential projection in the binding read;
it includes provider, normalized instance, source, username and provider-user
identity. Managed SSH shows only the verified public fingerprint. Missing,
stale or omitted presentation says the managed credential is unavailable while
the opaque grant reference remains internal. The summary neither reads nor
refreshes the client account store, and it never uses account IDs, credential
IDs, key paths or tokens as labels. Failed reads retain explicitly stale context,
not an authoritative empty binding. The Git view does not render the strip in
VS Code, where the webview projects repository remotes as a ready System
binding and offers no binding configuration.

One Configure repository action opens the standard Dialog. Its private draft
lifetime ends on close or runtime/directory scope change. The provider, transport,
and checkout hydration editors in `RepositoryBindingEditors.tsx` reuse the binding owner;
opening the dialog adds no account refresh loop. Saves remain independent,
explicit actions. Removing a provider association uses the existing exact-target
mutation, not whole-binding deletion or credential removal. A transport Remove
action exists only for the selected remote's committed grant and sends repository,
binding/config revision, remote, and exact fetch/push fingerprint authority. It
preserves provider associations, sibling and auxiliary grants, credentials, and
Git state. System setup keeps
its explicit unverified consent; managed and anonymous choices add no routine
confirmation popup. A separate destructive reset section removes every binding
reference only after confirmation. It does not remove credentials, Git remotes or
configuration, worktree content, or author identity. Draft edits and cancellation
do not mutate. Both operations apply only their returned committed read; stale
conflicts perform one fresh owner read without retrying the mutation. Account and
profile inventories remain in Git Settings.

Checkout repair first runs `checkout-hydration` against a user-selected ready parent fetch remote. The immutable public plan exposes bounded repository-relative submodule/LFS paths and redacted endpoints, never raw URLs, absolute paths, or credential references. Failed hydration stays visible through `GitOperationStatus`. The user selects one discovered endpoint, explicitly chooses System, anonymous HTTPS, managed HTTPS account, or managed SSH key, and saves or removes only that grant through the narrow CAS API. Retry plans a new inspection; it never reclones the retained repository. Missing `git-lfs` has a specific install-and-retry warning. Runtime and directory changes clear all repair drafts, and late mutation results reconcile through the captured binding owner scope.

Mobile mounts an author editor inside the same dialog. It reads existing
profiles through the current GitAPI only while open, submits the selected ID
with `setGitIdentity(directory, profileId)`, then calls the Git store's
`fetchIdentity`. It neither writes profiles nor derives transport from legacy
profile fields. Runtime/unmount guards reject late profile reads and author
application completions. Signing behavior remains with the existing author API.
An empty inventory routes to the existing mobile Settings action, or the desktop
Settings dialog outside dedicated mobile. These dynamic repository controls do
not add Settings search entries.

## Unresolved Git operations

`git-operation-recovery.ts` owns the shared pending-operation guard. The bound
network helpers check writable storage and reserve the runtime/repository scope
before planning, persist the returned reference before execution, and check
durability again immediately before dispatch. A failed reference write may leave
an unexecuted server plan, but never starts its Git process. Planning itself does
not mutate the repository. No recovery path plans or executes an operation. This
includes checkout hydration: a restored reference is queried by ID and never
resumed automatically.

The versioned `sessionStorage` record contains at most 64 references. Each holds
the operation ID and kind, server runtime identity, repository ID, and SHA-256
digests of the client runtime key and immutable public target. New records also
hold a digest of the server's durable public target form. It contains no
endpoint URLs, directories, transport credentials or actors, output, error
messages, or result history. Clone uses a null repository ID, not a fabricated
repository or System transport. An unresolved clone conservatively blocks other
clones on that runtime; existing-repository guards use the real repository ID.
The second target digest uses the same public-safe form as durable server
recovery: it omits force-lease SHAs and strips SCP usernames while retaining
endpoint fingerprints, so a restarted operation still matches the marker that
guarded it. The original exact target digest remains authoritative while those
fields are present and keeps existing version-1 references readable.
For the same terminal-only recovery case, HTTP operation tracking accepts the
durable omission of a verified actor; runtime identity, operation ID, transport
mode and verification, endpoint fingerprints, refs, and all non-redacted target
fields must still match.
Anonymous clone/read transport and retained-checkout partial results keep their
existing contracts.

References survive panel unmount and page reload within the same browser tab.
New tabs and separate webview storage contexts are independent. Unavailable or
malformed session storage fails closed. Plain HTTP LAN clients do not need
SubtleCrypto: the recovery owner uses a local FIPS 180-4 SHA-256 fallback when
that API is absent. Native and fallback paths hash the same TextEncoder UTF-8
bytes and produce identical lowercase hex, so v1 references need no migration
and unknown markers remain matched rather than discarded.

These hashes are equality/storage-redaction fingerprints, not authentication,
encryption, a MAC, or tamper-proof storage. They keep literal runtime and Git URLs
out of the record; an unsalted hash does not promise secrecy against guessing.
Recovery independently compares the exact server runtime ID and platform,
repository ID, operation ID and kind, and immutable target fingerprint before
accepting GET or clearing a marker. Runtime adapters and the backend still own
authentication and authorization. The fallback is private to this owner and is
not used for credentials, pairing, signatures, or relay crypto. Existing cache
fingerprints use a different algorithm and cannot match persisted v1 hashes;
preserving SHA-256 avoids a dual-format migration that could strand old guards.

The owner never evicts unresolved references, including other runtimes' entries,
to make room. Capacity rejects new plans. Writes are synchronous, and removals
re-read storage after asynchronous target verification so an intervening write
cannot erase another operation.

`useGitOperationRecovery` resolves the current repository before matching saved
references. Hydration shows unavailable/reconciling state and blocks conflicting
actions. A saved marker is uncertainty, never evidence of a running process or
completed step. Only GET of the original ID can restore live status, with the
captured runtime identity and target checked before accepting it. Mount and
browser-online recovery coalesce overlapping reads; there is no polling timer.
Runtime changes reject late reconciliation and never send old IDs through the
new endpoint. Cancel requires a verified active snapshot on the captured scope.

Known terminal results remove the marker only after the removal is durable.
Removal failure leaves the blocker in place and exposes storage recovery.
`outcome-unknown`, failed reads, authentication failures, and `NOT_FOUND` after a
server restart retain the reference. The UI exposes the ID, Refresh, and external
repository/remote inspection guidance. It does not offer a forget-and-retry
waiver: System Git credential acknowledgement does not establish an unknown
transfer's outcome. Full terminal feedback and the local-commit notice remain
mounted-view state, not persisted history.

`git-operation-recovery.test.ts` covers storage failures, reload, capacity,
runtime isolation, unknown/missing outcomes, and anonymous clone references.
`useGitOperationRecovery.test.ts` covers actual React unmount/remount, read-only
hydration, scoped controls and durable guards. These tests do not prove behavior
after browser storage is explicitly cleared or a webview is replaced with a new
storage context.

## Tests

`repository-binding.test.ts` covers deferred failure, successful empty, concurrent
demand, mutation overlays, aliases, scope invalidation, conflict reconciliation
and retention. The 100-consumer regression permits one initial request and no
additional requests or notifications for 10,000 warm snapshot reads.
`useProviderBindingEditor.test.ts` exercises actual React lifecycle and scoped
mutation intents. Binding cases in `sourceControlOAuthPolling.test.tsx` cover
provider/transport controls, localized retry, CAS fields and runtime switching.
These tests do not validate a packaged runtime, real credentials or browser paint.

`SourceControlBindingSettings.test.tsx` covers committed safe credential presentation,
unavailable native metadata, executor classes, anonymous/System display, all-locale
copy, and the actual author callback's local-only API calls and stale-runtime
guard. Editor intent tests remain in `sourceControlOAuthPolling.test.tsx`.
