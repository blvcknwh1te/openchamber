# План реалізації repository-level source control accounts

## Статус і мета

Реалізацію погоджених пакетів 1-8 і final integrated validation завершено 2026-09-07. Поточний release gate складається з [customer acceptance](#9-acceptance-і-контроль-виконання), а не з додаткового corrective implementation scope. External credential, native-runtime і live LFS/SSH acceptance blockers наведені окремо від code completion. Automated validation підтверджує combined implementation, але не замінює production journeys у runtime та credential environments, яких немає в цій workspace.

Цей документ пов'язує [модель source control accounts](./SOURCE_CONTROL_ACCOUNT_MODEL.md) з реалізованими contracts у `packages/ui`, `packages/web`, `packages/vscode`, `packages/electron` і `packages/mobile` та з pending customer acceptance.

Мета: кожна дія з GitHub, GitLab або Git через елементи OpenChamber використовує account, repository, remote, branch і runtime, які користувач бачить до виконання. Зміна account в іншому вікні або runtime не повинна змінювати вже запущену операцію.

## Межа гарантій

OpenChamber гарантує routing лише для власних UI/API/Git operations.

Довільна команда `git push`, яку користувач або local agent запускає у звичайному terminal чи shell tool, використовує системний Git context. OpenChamber не може назвати або обмежити цей account без окремого mediated Git boundary у OpenCode. До появи такого boundary UI має позначати agent shell transport як `system` і `unverified`.

Electron використовує in-process web server. Для source control йому не потрібен окремий IPC або Git backend. Hosted mobile та Capacitor виконують Git на підключеному OpenChamber server, а не на телефоні.

План не додає dependencies, не записує account bindings у `.git/config`, не змінює remotes заради account routing і не визначає provider account за commit email.

## Прийняті архітектурні рішення

### Окремий binding store

Version-2 `source-control-bindings.json` зберігається в `OPENCHAMBER_DATA_DIR`. Він містить лише account і credential references, repository identity, revisions та несекретні metadata.

GitHub tokens залишаються в `github-auth.json`. GitLab tokens залишаються в `source-control-auth.json`. Це зменшує міграційний ризик і не копіює secrets між stores.

Writes серіалізовані, atomic, mode `0600` і compare-and-swap за revision. Read/check/write transactions використовують cross-process snapshot lock. Malformed або unsupported storage працює fail-closed і не перезаписується наступною mutation.

### Repository identity

Server визначає repository через realpath canonical Git common directory. Основний checkout і linked worktrees отримують один repository ID.

Binding не записується в `.git/config` і не зберігається в client-owned `ProjectEntry`. Переміщений або замінений repository потребує нового resolve й підтвердження binding.

### Розділені identities

Реалізація зберігає окремо:

| Identity | Власник | Призначення |
| --- | --- | --- |
| Provider account | GitHub/GitLab auth module | Issues, PR/MR, comments, CI, merge |
| Transport credential | Git operation runtime | Clone, fetch, pull, push, LFS, submodules |
| Commit profile | Git identity module | Author, email, signing |
| Runtime | Runtime connection | Машина, де виконуються API і Git operations |

Provider token може бути джерелом managed HTTPS credential, але binding зберігає окремий transport reference. Рівність provider і transport accounts не є обов'язковою.

### Явний operation context

Provider read отримує:

```text
runtime
repositoryId
provider
instance
accountId
bindingRevision
primaryRemote
```

Mutation додатково отримує:

```text
idempotencyKey
expected target
expected repository/config revision
```

Server не приймає client repository coordinates як авторитетні. Він повторно визначає repository і target із directory та Git remotes.

Client runtime key використовується лише для stale-response rejection. Server не довіряє йому як authorization input і сам є власником runtime namespace.

### Transport selection та execution modes

`managed` використовує operation-scoped credential broker або конкретний SSH key. Ambient helpers і AskPass вимикаються.

`system` зберігає системний credential helper, SSH config і SSH agent. Transport завжди має status `unverified`. Користувач підтверджує цей ризик один раз для repository та повторно лише після зміни transport-relevant config, наприклад remote URL, credential helper або SSH command. Звичайна зміна branch чи upstream не повторює acknowledgement.

`anonymous` призначений лише для read operations над public endpoints. Він не успадковує credential helpers, AskPass, SSH agent, SSH config або repository-local auth settings. Push і remote deletion відхиляються до spawn.

`Choose transport` не є executable mode і не записується як remote binding. Відсутність запису для конкретного remote означає `needs-selection`; будь-яка network operation для цього remote завершується до planning. Provider account, commit profile і local read-only Git при цьому залишаються доступними незалежно.

### Runtime parity

| Runtime | Provider API | Git transport | Binding owner | Intentional boundaries |
| --- | --- | --- | --- | --- |
| Web | Повна підтримка | `managed`, explicit `system`, `anonymous` HTTPS read/clone | Active OpenChamber server | Anonymous publish відхиляється до planning |
| Electron local | Через in-process web server | `managed`, explicit `system`, `anonymous` HTTPS read/clone через local server | Local in-process server | Renderer не володіє Git process або credentials |
| Electron remote | Через remote server | `managed`, explicit `system`, `anonymous` HTTPS read/clone через selected server | Selected remote server | Credentials належать selected server host |
| Hosted mobile | Через selected server | `managed`, explicit `system`, `anonymous` HTTPS read/clone через selected server | Selected server | Git не виконується на client device |
| Capacitor | Через connected server | Як web server, включно з anonymous HTTPS read/clone | Connected server | Без local Git або local credential ownership |
| VS Code | Explicit unsupported | `managed`, explicit `system`, anonymous HTTPS fetch/pull для existing repository | VS Code workspace runtime | Provider API, clone, contributor destinations, auxiliary configuration і checkout/submodule/LFS hydration explicit unsupported |

`anonymous` є intentional credential-free mode, а не fallback до System. Server-backed runtimes підтримують його для HTTPS fetch, pull і clone; VS Code підтримує fetch і pull лише для existing repositories. Push, remote deletion і anonymous push leg у Sync відхиляються до transfer. VS Code provider API не proxy-иться через OpenCode: issues, change requests, CI та provider account operations повертають stable explicit unsupported до появи окремого extension-host provider runtime.

## Цільові контракти

### Repository binding v2

```ts
interface RepositorySourceControlBinding {
  repositoryId: string
  revision: number
  configRevision: string
  providers: ProviderBinding[]
  remotes: RemoteTransportBinding[]
  auxiliary: AuxiliaryTransportBinding[]
  state: 'bound' | 'needs-attention'
}
```

Це conceptual public shape, а не копія persisted JSON schema. Version-2 `source-control-bindings.json` зберігає references і redacted endpoint metadata; response-only credential presentation не записується назад у store.

`ProviderBinding` містить normalized provider, instance, immutable credential account ID, approved fetch endpoint і capability readiness. Provider-user identity залишається окремою actor/presentation identity.

`RemoteTransportBinding` окремо описує exact fetch і push endpoints, `managed`, `system` або `anonymous` mode, optional opaque credential reference та readiness. Новий managed HTTPS save створює revision-pinned `ocgit:v2` reference; managed SSH presentation повертає verified public fingerprint без key path.

`AuxiliaryTransportBinding` описує independent `submodule` або `lfs` grant для exact discovered endpoint. Parent transport credential не успадковується навіть для same-host endpoint. Provider, remote і auxiliary records мають власну readiness; aggregate `state` є лише UI summary і не блокує healthy sibling capability.

### Binding і capability lifecycle

```text
UI read: idle | loading | ready | stale | error
capability readiness: ready | account-unavailable | confirmation-required | config-changed
transport record absent: needs-selection
runtime capability absent: unsupported
```

Fetch failure не перетворюється на authoritative empty binding. Попередній complete binding зберігається зі `stale`/error status. Authority перевіряється за readiness конкретного provider, remote або auxiliary grant, а не за aggregate binding state.

### Git operation lifecycle

```text
planned
running
succeeded
partial
conflicted
failed
cancelled
outcome-unknown
```

`outcome-unknown` використовується, якщо connection втрачено після відправлення mutation і server не може довести результат. Така mutation не повторюється автоматично.

> **Історичний статус фаз 0-9.** Розділи нижче зберігають початкову послідовність проєктування та acceptance criteria. Вони superseded як execution status розділом [Погоджений план виправлень](#погоджений-план-виправлень) і поточним ledger; future-tense формулювання тут не означають незавершений implementation scope.

## Фаза 0. Baseline і test fixtures

### Зміни

1. Зафіксувати поточні provider route, auth-store, cache, Git push fallback і worktree behaviors тестами до зміни контрактів.
2. Додати reusable temporary provider server для GitHub/GitLab responses без реальної мережі.
3. Додати temporary Git topology: bare `origin`, `upstream`, contributor fork, clone і linked worktree.
4. Додати fake credential helper, AskPass, SSH executable і LFS executable, які записують лише контрольовані test markers.
5. Заборонити fixture logs з token-like payloads.

### Acceptance criteria

- Тести відтворюють current global account selection і implicit push fallback.
- Один fixture створює два accounts одного provider та один repository, доступний обом.
- Git fixtures працюють без GitHub/GitLab credentials і зовнішньої мережі.

## Фаза 1. Repository identity та binding storage

### Server changes

Додати focused modules у `packages/web/server/lib/source-control/`:

- `repository-identity.js` для common-directory identity, normalized remotes і config revision;
- `binding-storage.js` для versioned persistence та compare-and-swap;
- `binding-service.js` для resolve, get, set, delete і account-removal reconciliation;
- `url-redaction.js` для display URLs та Git error redaction.

Оновити:

- `packages/web/server/lib/source-control/routes.js`;
- `packages/web/server/lib/opencode/feature-routes-runtime.js`;
- `packages/web/server/lib/git/service.js`;
- `packages/web/server/lib/git/routes.js`.

### Routes

```text
GET    /api/source-control/repository-context?directory=...
GET    /api/source-control/binding?directory=...
PUT    /api/source-control/binding
DELETE /api/source-control/binding
```

`PUT` і `DELETE` вимагають expected revision. `409` повертає current authoritative binding, а не plain error string.

### Migration

- Existing auth stores не змінюються.
- Existing projects починають без persisted binding.
- Якщо є рівно один verified account із доступом до resolved repository, server повертає suggested binding. UI просить підтвердження перед persistence.
- Якщо accounts кілька, state дорівнює `needs-selection`.
- Existing account-agnostic PR/context caches не мігруються й видаляються під час hydration.
- Видалення account не видаляє binding. Binding переходить у `needs-attention`.

### Tests

- Missing file створює empty v1 state.
- Valid empty state відрізняється від read failure.
- Malformed JSON і unsupported version не перезаписуються.
- Atomic write має mode `0600`.
- Failed write зберігає попередній valid snapshot.
- Lower або duplicate revision не перезаписує новіший record.
- Два concurrent writers отримують один commit і один conflict.
- Main checkout та linked worktree мають один repository ID.
- Symlink path не створює другий binding.
- Case normalization перевіряється на case-insensitive fixture platform.
- Bare repository отримує stable identity або explicit unsupported result.
- Missing, moved або path-replaced repository не успадковує старий binding.
- Raw remote URL залишається server-internal.
- URL із `user:token@host` повертається redacted.

## Фаза 2. Account inventory та OAuth hardening

### Server changes

1. Додати lookup provider credential за immutable account ID.
2. Припинити використання current account у нових source-control routes.
3. Залишити legacy activation лише доки всі callers не мігровані.
4. Представляти CLI identity як окремий ephemeral account із verified user ID.
5. Додати in-memory OAuth flow registry із opaque flow ID, instance, expiry і one-time completion.
6. На provider `401` позначати exact account як invalid і переводити його bindings у `needs-attention`. Видалення account залишається окремою user action.

OAuth flow не переживає server restart. UI починає новий flow замість спроби завершити його на іншому runtime.

### Stable account IDs

- GitHub OAuth account: normalized instance плюс numeric provider user ID.
- GitLab OAuth/PAT account: existing normalized origin плюс numeric provider user ID.
- CLI account: provider, instance, source `cli` та verified provider user ID.
- Login і token prefix не використовуються як нові stable IDs.

### Tests

- Два accounts одного instance повертаються без tokens.
- Однакові usernames на різних instances не конфліктують.
- Login rename не змінює account ID.
- OAuth/PAT token перевіряється до storage.
- Invalid credential позначає лише account, який спричинив `401`, і не видаляє його metadata.
- Network failure не видаляє account і не виглядає як disconnected.
- CLI account перевіряється при кожній bound operation.
- Зміна active user у `gh` або `glab` переводить CLI binding у `needs-attention`.
- Flow ID працює лише на originating runtime та instance.
- Raw device code не повертається як public flow identity.
- Expired, reused або unknown flow ID відхиляється.
- Runtime switch відкидає stale UI completion.
- Server restart втрачає flow без збереження partial credential.
- Redirect під час probe, OAuth або verify відхиляється.

## Фаза 3. Account-scoped provider reads і caches

### Shared contracts

Оновити:

- `packages/ui/src/lib/source-control/types.ts`;
- `packages/ui/src/lib/api/types.ts`;
- `packages/web/src/api/source-control.ts`;
- `packages/web/src/api/github.ts`;
- `packages/vscode/webview/api/source-control.ts`.

Кожен provider read отримує explicit source-control context. Legacy GitHub client або мігрує на provider-neutral API, або завершує роботу з missing-binding error. Він не використовує active account fallback.

### Server provider changes

Оновити:

- `packages/web/server/lib/github/auth.js`;
- `packages/web/server/lib/github/octokit.js`;
- `packages/web/server/lib/github/routes.js`;
- `packages/web/server/lib/github/pr-status.js`;
- `packages/web/server/lib/github/repo/fork-detection.js`;
- `packages/web/server/lib/gitlab/routes.js`;
- `packages/web/server/lib/gitlab/resources.js`.

Cache key містить runtime owner, provider, normalized instance, account ID, repository identity та operation dimensions. Raw token не використовується як cache key.

### Client stores

Оновити:

- `useSourceControlAuthStore` для account inventory та binding lifecycle;
- `useGitHubPrStatusStore` для account/revision-scoped keys;
- `useChangeRequestContextStore` для account/revision-scoped keys;
- runtime reset для скасування stale loads.

PR walkthrough також має отримати account context через `lib/walkthrough`, `useWalkthroughStore` і server `walkthrough/pull-request.js`. Running jobs, source keys, progress і generated cache не можуть змішувати accounts.

### Tests

- Один private repository, два accounts, різні permissions і responses.
- Account A result ніколи не читається з key account B.
- Binding revision change створює новий request identity.
- Stale response після account або runtime switch відкидається.
- Failed authoritative read зберігає попередні data й показує error.
- Successful empty response очищає лише свій account/repository scope.
- `403` і `404` не стирають unrelated repository state.
- Account removal інвалідовує лише його cache namespace.
- PR, issue, CI, comments, branches, fork metadata та walkthrough jobs мають account scope.
- Persisted old PR/context cache не гідратується як authoritative data.
- Background discovery запитує лише bound account, а не всі connected accounts.
- VS Code повертає stable `unsupported`, а не порожній success або proxy fallback.

## Фаза 4. Safe provider mutations

### Mutation contract

Create/update/ready/merge/comment mutations вимагають:

- account ID;
- repository ID;
- binding revision;
- resolved target;
- idempotency key.

Server перед mutation повторно перевіряє account existence, repository access, remote topology і binding revision.

### Idempotency

Додати bounded durable mutation record store. Record не містить token або response body із private content.

- Exact in-flight duplicate приєднується до першої operation.
- Exact completed duplicate повертає попередній terminal result.
- Той самий key з іншими inputs повертає conflict.
- Після restart server звіряє provider або remote state перед повтором.
- Якщо результат неможливо довести, status дорівнює `outcome-unknown` і автоматичного retry немає.

### Target validation

- Explicit project має належати resolved local fork/upstream network.
- Merge target, PR head/base і current binding показуються в preflight.
- Mutation ніколи не використовує first remote fallback.
- Cache invalidation обмежується affected account і repository.

### Tests

- Missing account, binding або revision відхиляється до provider call.
- Stale revision повертає `409` із current binding.
- Account changed after form open не змінює actor.
- Remote changed after preflight зупиняє mutation.
- Arbitrary target outside fork network відхиляється.
- Double click виконує один provider request.
- Reconnect replay повертає той самий result.
- Reused key із different target відхиляється.
- Restart replay reconciles completed mutation.
- Unknown outcome не виконується вдруге.
- Failed mutation не інвалідує unrelated cache.
- Successful mutation інвалідує status, context, pull list і history потрібного account scope.
- Merge/ready/update result повертає фактичний acting account і target.

## Фаза 5. Git operation engine та managed transport

### Shared Git contracts

Додати до `GitAPI`:

```text
planNetworkOperation
executeNetworkOperation
getNetworkOperation
cancelNetworkOperation
```

Plan містить operation ID, repository ID, config revision, exact remote endpoint, source ref, destination refspec, transport mode, credential reference та runtime identity. Public plan містить лише redacted URLs.

### Server modules

Додати у `packages/web/server/lib/git/`:

- `network-operation-plan.js`;
- `network-operation-registry.js`;
- `credential-broker.js`;
- `network-operations.js`;
- Git-specific `redaction.js`.

Clone переходить із `fs/routes.js` до Git operation service. Legacy `/api/fs/clone` тимчасово делегує новому service.

### Managed HTTPS

- Встановити `GIT_TERMINAL_PROMPT=0`.
- Очистити inherited `GIT_ASKPASS`, `SSH_ASKPASS` і `SSH_ASKPASS_REQUIRE`.
- Вимкнути ambient credential helpers у command scope.
- Передати broker лише opaque one-operation nonce.
- Відповідати лише exact protocol, host, port і allowed path.
- Вимкнути cross-host redirects для credentialed operations.
- Не додавати token у URL, args, logs або public result.

### Managed SSH

- Перший реліз підтримує explicit private-key path із verified public fingerprint.
- Використати command-scoped `GIT_SSH_COMMAND` та `IdentitiesOnly=yes`.
- Shared SSH agent без вибору конкретного key залишається `system/unverified`.
- Host-key verification використовує системний `known_hosts`; bypass за замовчуванням заборонений.

### System mode

- Зберегти системний Git helper, wrapper, SSH config і agent.
- Не називати provider account transport account.
- Показати persistent `unverified` status.
- Попросити acknowledgement при першому publish та після transport-relevant config revision change.

### Explicit target rules

- Push завжди має remote, local source ref і destination ref.
- Branch без upstream відкриває target chooser.
- Detached HEAD не дозволяє push без explicit source/destination.
- Force використовує `force-with-lease` та expected remote SHA, якщо UI не надає окрему небезпечну дію.
- Config і remote URL повторно звіряються безпосередньо перед spawn.

### Cancellation і results

- Registry зберігає process handle до spawn completion.
- Cancel і timeout завершують process tree.
- Result повертає completed steps, actor/transport metadata та terminal state.
- Connection loss не запускає автоматичний повтор push.

### Tests

- Managed environment очищає всі ambient helper/AskPass variables.
- Fake helper отримує запит лише для allowed endpoint.
- Host, port, protocol або path mismatch не отримує credential.
- Redirect не отримує credential.
- Token не з'являється в stdout, stderr, exception, HTTP response або logs.
- Managed SSH викликає exact key і `IdentitiesOnly=yes`.
- Інші keys не використовуються як fallback.
- System mode зберігає user helper і повертає `unverified`.
- Config revision change між plan і execute повертає conflict.
- Remote rename або URL replacement зупиняє operation.
- Branch without upstream і detached HEAD не вибирають `origin` автоматично.
- Explicit push відправляє лише заданий refspec.
- Cancellation завершує child process і очищає broker nonce.
- Timeout повертає `cancelled` або `outcome-unknown` за фактичним process state.
- Duplicate operation ID не запускає другий process.
- Clone failure видаляє лише incomplete directory, створений цією operation.
- Clone в existing/non-empty path відхиляється без cleanup user data.

## Фаза 6. Sync, forks, worktrees, submodules і LFS

### Atomic orchestration

Перенести UI sequence fetch/status/pull/status/push із `GitView.tsx` і `MobileChangesSurface.tsx` у runtime operation executor.

Sync plan має окремі fetch і push targets. Result повертає status кожного кроку: `succeeded`, `skipped`, `conflicted`, `failed` або `cancelled`.

### Fork і worktree safety

- Contributor PR worktree отримує provenance `contributor-fork`.
- Push вимкнений, доки користувач не вибере exact destination.
- Fetch remote і push remote не вважаються однаковими.
- Existing unmanaged remote не перезаписується. Collision повертає chooser/conflict.
- Binding належить common directory й автоматично діє у linked worktrees.
- Repository-controlled hooks і setup commands у contributor checkout потребують окремого trust confirmation.

### Submodules

- Parse `.gitmodules` до recursive initialization.
- Resolve relative URL за правилами Git.
- Створити endpoint decision для кожного submodule.
- Parent credential не передається іншому host.
- Partial result зберігається per submodule.

### Git LFS

- Detect LFS filters, pointer files і `.lfsconfig`.
- Resolve effective LFS endpoint окремо від Git remote.
- Інший endpoint потребує окремого binding.
- LFS process використовує operation registry, cancellation і redaction.
- Відсутній `git-lfs` повертає actionable status, а не generic clone failure.

### Tests

- Sync fetches `upstream` і pushes exact `origin` target.
- Fetch success плюс pull conflict не запускає push.
- Fetch/pull success плюс push failure повертає `partial`, не success.
- Cancellation між кроками не запускає наступний крок.
- Contributor worktree не має implicit push destination.
- Own fork і contributor fork не змішуються.
- Existing unmanaged `pr-owner` remote не перезаписується.
- Linked worktrees читають одну binding revision.
- Binding update не змінює branch, worktree, remotes або `.git/config`.
- Untrusted checkout не запускає hooks/setup без confirmation.
- Same-host submodule використовує explicit allowed path.
- Cross-host submodule не отримує parent credential.
- Один failed submodule не стирає completed sibling results.
- Relative submodule URL resolves against correct parent remote.
- LFS over HTTPS із SSH Git remote використовує окремий endpoint decision.
- LFS credential і errors не потрапляють у logs.

## Фаза 7. UI та Settings

### Settings information architecture

Залишити GitHub, GitLab і commit profiles на сторінці Git. Provider sections показують connected accounts, credential sources, connect, re-authenticate і remove. Credentials одного verified provider user групуються в одну account presentation без зміни їхніх IDs або actions. Позначки global `active` видаляються після міграції callers.

Repository binding є dynamic control для active repository у Git panel. Він не відображається у global Settings і не індексується Settings search. Provider account inventories, connect actions і commit profiles залишаються searchable Settings controls.

Використати `SettingsPageLayout`, `SettingsSection`, `SettingsFieldRow`, `SettingsStackedField` та standard settings selects. Layout реагує на settings container через `@xl` і `@3xl`, не viewport breakpoints.

Основні UI owners:

- `components/sections/git-identities/GitPage.tsx`;
- `components/sections/openchamber/GitHubSettings.tsx`;
- `components/sections/openchamber/GitLabSettings.tsx`;
- `components/layout/Header.tsx`;
- `components/views/GitView.tsx`;
- `components/views/git/PullRequestSection.tsx`;
- `components/views/git/SyncActions.tsx`;
- `components/session/IssuePickerDialog.tsx`;
- `components/session/ChangeRequestPickerDialog.tsx`;
- `apps/MobileChangesSurface.tsx`;
- `lib/settings/metadata.ts`, `lib/settings/search.ts` і всі locale dictionaries.

### Git UI

Показувати компактний context:

```text
Provider: GitHub @work
Push: Work SSH key
Author: Boris <boris@company.com>
Runs on: Office Mac
```

Routine managed push не відкриває confirmation dialog. Dialog або chooser потрібен лише для missing binding, first-use чи changed unverified system transport, changed target, contributor fork або force action. Стабільна дозволена різниця між provider і transport accounts залишається видимою, але не відкриває modal перед кожним push.

Mutation dialog показує acting account, repository і target branch. Error states розрізняють disconnected, unavailable, needs-selection, needs-attention, unsupported, conflict і outcome-unknown.

### Localization і accessibility

- Додати semantic keys у всі locale dictionaries.
- Не використовувати English placeholders у non-English dictionaries.
- Account, target і runtime announcements мають accessible labels.
- Keyboard і touch можуть відкрити account/target chooser.
- Focus повертається до action після successful chooser або до invalid field після conflict.
- Status не передається лише кольором.

### UI tests

- Zero, one і multiple account states.
- Suggested binding потребує confirmation.
- Needs-attention після account removal.
- Runtime switch очищає stale flow і binding request ownership.
- Old account response не перемальовує current repository.
- Managed push без warning у stable configuration.
- System mode показує one-time acknowledgement, але не modal на кожен push.
- Contributor fork завжди показує exact target chooser.
- Stale mutation conflict оновлює context без автоматичного retry.
- Mobile phone, tablet і desktop layouts не ховають acting account.
- Keyboard navigation, focus order, screen-reader labels і touch targets.
- Settings search registry, anchors та runtime availability збігаються.
- Усі locale dictionaries мають однаковий набір нових keys.

## Фаза 8. VS Code Git parity

### Changes

- Розширити `RuntimeAPIs.git` contract у webview adapter і extension bridge.
- Передати `ExtensionContext` до Git runtime для `SecretStorage` та persisted binding metadata.
- Прибрати різницю, де fetch використовує built-in Git API, а fallback push використовує інший credential context.
- Managed network operations виконувати одним spawned-Git path.
- Додати Git-specific abort messages і process-tree termination.
- Provider API залишити explicit unsupported до окремої реалізації.

### Tests

- Web і VS Code serialization мають однаковий operation contract.
- Bridge timeout запускає cancel, а не лише відхиляє Promise.
- Extension restart відновлює binding metadata, але не active processes.
- Secret payload зберігається тільки в `SecretStorage`.
- Workspace A і B не ділять binding або credential references.
- Multi-root workspace resolve виконується для exact repository.
- Built-in Git extension credentials не використовуються в managed mode.
- Unsupported provider API залишається explicit і не потрапляє в generic proxy.

### Архітектура VS Code runtime

- `GitRuntimeCoordinator` створюється один раз під час activation extension і передається всім webview та panel bridge contexts. Окремі webviews не створюють власні operation registries або credential stores.
- Webview Git adapter лише серіалізує shared contracts, перевіряє response shape, відкидає stale runtime responses і надсилає explicit cancel при caller abort або bridge timeout. Secret payload ніколи не перетинає webview bridge.
- Extension-host Git runtime окремо володіє repository resolution, binding persistence, transport credentials, operation planning, in-memory registry та spawned processes. `bridge.ts` залишається thin dispatcher.
- Repository context і binding CRUD підтримуються незалежно від provider API. GitHub/GitLab auth, issues, change requests та інші provider routes залишаються explicit unsupported, доки для них не з'явиться окремий extension-host runtime.
- Transport-only credential management належить `RuntimeAPIs.git`, а не provider API. Managed HTTPS token або SSH secret зберігається через `ExtensionContext.secrets`; binding містить лише opaque workspace-scoped credential reference.
- Binding metadata, revisions, workspace namespace та System Git acknowledgements зберігаються у `ExtensionContext.workspaceState`. Active plans, processes, cancellation listeners і broker nonces існують лише в пам'яті.
- Repository ID походить із canonical Git common directory. Exact requested directory спочатку звіряється з owning workspace folder, тому linked worktrees можуть ділити repository binding, а repositories у multi-root workspace не можуть випадково ділити authority.
- Built-in VS Code Git API можна використовувати для local read/UI operations. `push`, `fetch`, `pull`, `sync`, `clone` та checkout hydration після cutover виконуються лише через один spawned-Git network path.

### Безпечна послідовність впровадження

1. Зафіксувати regression tests для поточних status, diff, stage, commit, branch, stash, merge, rebase, worktree, push, pull і fetch flows до зміни routing.
2. Створити activation-scoped `GitRuntimeCoordinator` і передати його через `BridgeContext`, не змінюючи поточні Git handlers. Перевірити, що всі sidebar, editor і agent-manager webviews отримують той самий runtime instance.
3. Додати exact workspace/repository resolver та read-only repository context. На цьому етапі він може працювати як shadow validation, але не змінює remotes, Git config, credentials або результат existing operations.
4. Додати versioned binding store у `workspaceState`, transport-only credential vault у `SecretStorage` і CAS mutation contract. Migration не копіює secrets у metadata та не створює binding без explicit user confirmation.
5. Додати Settings path, який дозволяє створити System Git binding без provider account і окремо provision managed HTTPS або explicit-key SSH credential. Provider UI та routes залишаються disabled; transport credential не надає provider API capabilities.
6. Додати planner, in-memory registry, operation-scoped credential broker, redaction і process-tree cancellation за internal capability gate. Дозволені shadow checks обмежуються planning/validation; network mutation не можна виконувати одночасно legacy і new paths.
7. Провести contract parity tests між web та VS Code для plan, execute, get і cancel, включно з terminal states, sync step results, stale revisions, timeout і outcome-unknown. До cutover новий executor не є user-visible default.
8. Атомарно переключити `planNetworkOperation`, `executeNetworkOperation`, `getNetworkOperation` і `cancelNetworkOperation` на extension host. Одночасно змусити compatibility `gitPush`, `gitPull` і `gitFetch` делегувати тому самому coordinator, щоб fetch і push не мали різних credential contexts.
9. Після cutover видалити network використання `Repository.fetch()`, `Repository.pull()` і direct spawned fallback із `gitService`. Local Git operations та repository discovery залишити без змін.
10. Увімкнути managed transport лише після packaged VSIX smoke test. Contributor worktrees, submodule/LFS hydration або інша capability залишаються explicit unsupported, доки весь відповідний flow не має authority, cancellation, cleanup і tests; partial routing у legacy path заборонений.
11. Провести rollback rehearsal на workspace з persisted System, HTTPS і SSH bindings. Відключення new executor не видаляє metadata чи secrets, не повторює uncertain mutation і не повертає implicit provider, remote або credential fallback.

### Критерії завершення Phase 8

- Поточні local Git features у VS Code зберігають поведінку: status, diff, staging, commit, history, branches, stash, merge, rebase і ordinary worktrees проходять regression suite до та після cutover.
- System Git push, pull і fetch залишаються доступними після explicit binding; UI постійно показує `unverified`, а acknowledgement повторюється лише після transport-relevant config revision change.
- Managed HTTPS і SSH ніколи не використовують built-in VS Code Git credentials, ambient credential helpers, inherited AskPass, SSH agent або інший key як fallback. Operation-scoped broker/AskPass дозволений лише з exact endpoint policy та одноразовим nonce.
- Усі network operations використовують exact remote endpoint і destination refspec; source ref обов'язковий для transfer operations, але відсутній у remote deletion. Branch without upstream, detached HEAD або кілька remotes не запускають implicit `origin` чи first-remote fallback.
- Binding read/set/delete має CAS semantics. Зміна repository ID, binding revision, config revision, remote fingerprint або credential reference між plan і execute завершує operation conflict до spawn.
- `SecretStorage` містить secret payload, а `workspaceState`, bridge messages, logs, errors, operation snapshots і webview state містять лише opaque references та redacted metadata.
- Workspace A і B мають різні binding та credential-reference namespaces. Multi-root request для repository B не може resolve repository A через active editor, first workspace folder або first Git repository.
- Усі OpenChamber webviews ділять один operation registry. Duplicate execute не запускає другий process; cancel до spawn, під час transfer і між sync steps має deterministic terminal result.
- Caller abort і bridge timeout надсилають Git-specific cancel. Unix process group або Windows process tree завершується з bounded escalation, broker nonce та temporary key material очищаються.
- Extension restart відновлює bindings і доступність credential references, але не active operation state. Невідомий старий operation ID повертає `NOT_FOUND`, а push із невідомим outcome не повторюється автоматично.
- Failure одного repository або credential не очищає binding, status або operation result іншого repository. Failed authoritative read не перетворюється на missing/empty success.
- Source-control provider API у VS Code повертає стабільний explicit unsupported contract до generic proxy. Transport-only credential support не рекламує issues, change requests, CI або provider account capabilities.
- Extension Development Host і packaged VSIX проходять однакові push, fetch, pull, remote-delete, sync, cancellation, restart і multi-root scenarios на temporary repositories без зовнішніх credentials.
- Focused VS Code suites, package test, type-check, lint, build, dead-code inspection і security canary tests проходять. Manual smoke test підтверджує, що жоден token, private key content або credential-bearing URL не з'явився в Output, Developer Tools чи operation UI.
- Rollback не змінює Git config/remotes, не видаляє versioned binding metadata або secrets і не відновлює silent legacy fallback. Якщо new runtime недоступний після cutover, mutation завершується explicit unavailable/unsupported error.

## Фаза 9. Agent policy та audit trail

### Перша реалізація

- Audit source-control operations, запущені через OpenChamber UI.
- Записувати authoritative `initiator: user`, executor kind, runtime, repository ID, provider account ID, transport reference, target, timestamps і result для managed UI operations.
- Не записувати tokens, private paths до secret payloads, stdout зі credentials або private provider response bodies.
- Agent shell operations позначати `outside-managed-boundary`, якщо їх неможливо провести через Git operation service.
- Не приймати `initiator` із renderer, webview, HTTP body або іншого client-controlled input. Поточний runtime не має managed agent source-control action, тому не заявляє agent identity або self-action enforcement.

### Майбутній enforcement

Повне repository-scoped enforcement для local agents починається лише після появи OpenCode capability, яка дає OpenChamber контрольований Git tool або окремий process credential boundary та trusted session/agent initiator signal. До цього не можна заявляти branch-level isolation для довільних shell commands.

Після появи цієї capability managed agent action отримує host-issued короткоживучу authority, прив'язану до session, agent і repository. Лише тоді audit розрізняє `user` та `agent`, а agent не може approve або merge власний change request без окремої user confirmation. Client-provided identity без такої authority не є допустимою проміжною реалізацією.

### Tests

- Managed UI audit завжди записує server-owned `initiator: user` і відхиляє невідому або client-injected identity.
- Duplicate/replayed operation створює один logical audit record.
- Redaction видаляє token-like values і URL userinfo.
- Account, runtime і target відповідають immutable snapshot.
- Shell operation без managed boundary не отримує verified badge.
- Retention bounds не видаляють active operations.

Future capability tests, які не блокують поточний Release C до появи trusted OpenCode boundary:

- Audit result відрізняє host-authenticated user та agent initiator.
- Agent-created PR не може бути approved/merged тією самою managed agent action без окремої user confirmation.
- Replay або runtime switch не переносить agent authority між session, repository чи runtime.

## Traceability критичних edge cases

| Edge case | Фаза | Мінімальна автоматична перевірка |
| --- | --- | --- |
| Різні fetch і push remotes | 5, 6 | Integration test перевіряє exact endpoints і refspecs |
| `origin`, `upstream` і fork remotes | 3, 6 | Resolver та sync tests не вибирають first remote |
| Contributor PR worktree | 6, 7 | Push disabled до explicit destination |
| Shared Git config у worktrees | 1, 6 | Common-directory binding і unmanaged remote collision tests |
| Clone до binding | 5, 7 | Preflight вимагає runtime/transport, cleanup test не видаляє user data |
| Revoked token або SSO | 2, 3 | Exact account стає invalid, binding стає `needs-attention` |
| Settings change під час operation | 3, 4, 5 | Generation/revision test відкидає mutable current state |
| Parallel operations | 4, 5 | Separate IDs, snapshots, cancellation і terminal results |
| Runtime switch | 2, 3, 5 | Stale OAuth/read/operation completion не commit-иться |
| System mode із кількома credentials | 5, 7 | `unverified` та one-time acknowledgement tests |
| SSH agent із кількома keys | 5 | Managed mode приймає лише explicit key; agent лишається system mode |
| Cross-host submodule або LFS | 6 | Parent credential не видається іншому endpoint |
| Credential у remote URL | 1, 5 | Canary secret відсутній у DTO, logs і errors |
| Unknown provider host | 1, 3 | Provider API повертає unsupported без GitHub fallback |
| Partial або cancelled network operation | 5, 6 | Step result не перетворюється на success |
| Branch без upstream або detached HEAD | 5, 7 | Target chooser required, `origin` не підставляється |
| Provider і transport accounts різні | 5, 7 | Mismatch видимий і не змінюється автоматично |
| Stale merge/PR form | 4, 7 | `409` refresh без retry іншим account |
| Cached private data іншого account | 3 | Cache-key isolation та stale-response rejection |
| OAuth completion після runtime switch | 2, 7 | Flow/runtime/instance mismatch відхиляється |
| Remote/config змінені після preflight | 4, 5 | Pre-spawn revision check повертає conflict |
| Redirect або credential query іншого host | 5 | Broker не повертає secret |
| Duplicate mutation після timeout/reconnect | 4 | Idempotency replay або `outcome-unknown`, без другого call |

## Gates між фазами

Історичний phase gate вимагав завершення кожної фази до початку наступної:

1. Нові focused tests проходять разом із nearby regression tests.
2. Affected package suite, type-check і lint проходять.
3. Oxlint проходить для створених або substantially rewritten TS/JS files.
4. `dead-code` report перевірено, якщо змінювалися files, exports або contracts.
5. Owning `DOCUMENTATION.md` описує фактичну поведінку цієї фази.
6. Partial failure, rollback і user-visible error перевірені окремо від happy path.
7. Наступна фаза не починається з відомим account leak, silent fallback або destructive retry defect.

Історична release decomposition: Release A охоплював фази 0-4, Release B фази 5-7, а Release C фази 8-9. Ця decomposition більше не є поточним execution ledger. Trusted agent identity і self-action enforcement залишаються окремою future capability після появи OpenCode Git/process boundary.

## Повна automated validation matrix

### Focused UI tests

```bash
bun test packages/ui/src/stores/useSourceControlAuthStore.test.ts
bun test packages/ui/src/stores/useChangeRequestContextStore.test.ts
bun test packages/ui/src/stores/useGitHubPrStatusStore.test.ts
bun test packages/ui/src/lib/source-control/identity.test.ts
bun test packages/ui/src/components/session/ChangeRequestPickerDialog.test.ts
bun test packages/ui/src/lib/walkthrough/api.test.ts
bun test packages/ui/src/stores/useWalkthroughStore.test.ts
bun test packages/ui/src/lib/runtime-auth.test.ts
bun test packages/ui/src/lib/runtime-fetch.test.ts
bun test packages/ui/src/lib/runtime-switch.test.ts
bun test packages/ui/src/apps/mobileConnections.test.ts
```

Нові binding, preflight і Settings component tests запускати тим самим isolated `bun test <file>` pattern.

### Focused web tests

```bash
bun run --cwd packages/web test -- src/api/source-control.test.ts
bun run --cwd packages/web test -- src/api/git.test.ts
bun run --cwd packages/web test -- server/lib/source-control
bun run --cwd packages/web test -- server/lib/github
bun run --cwd packages/web test -- server/lib/gitlab
bun run --cwd packages/web test -- server/lib/git
bun run --cwd packages/web test -- server/lib/walkthrough
bun run --cwd packages/web test -- server/lib/ui-auth/ui-auth.test.js
bun run --cwd packages/web test -- server/lib/opencode/core-routes.test.js
bun run --cwd packages/web test -- server/lib/opencode/lifecycle.test.js
```

Server JS не покривається TypeScript compiler. Focused route, process, persistence та integration tests обов'язкові.

### Focused VS Code tests

```bash
bun test packages/vscode/webview/api/source-control.test.ts
bun test packages/vscode/src/bridge-git-runtime.test.js
bun test packages/vscode/src/bridge-git-special-runtime.test.js
bun test packages/vscode/src/bridge-git-process-runtime.test.js
```

`bridge-git-process-runtime.test.js` є новим suite із фази 8. До його додавання цей рядок не запускається. Також додати focused suites для bindings, SecretStorage, operation cancellation і workspace isolation.

### Electron tests

```bash
bun test packages/electron/runtime-request-headers.test.mjs
node --test packages/electron/startup-url-selection.test.mjs
bun run --cwd packages/electron test
```

Electron-specific source code не має змінюватися без реальної native потреби. Якщо main/preload змінено, додатково запустити `bun run --cwd packages/electron test:architecture`.

### Package suites

Після кожної фази запускати affected package suites:

```bash
bun run --cwd packages/ui test
bun run --cwd packages/web test
bun run --cwd packages/vscode test
```

### Static checks

```bash
bun run type-check:ui
bun run type-check:web
bun run vscode:type-check
bun run type-check:electron
bun run type-check:mobile

bun run lint:ui
bun run lint:web
bun run --cwd packages/vscode lint
bun run lint:electron
bun run lint:mobile
```

Для кожного створеного або substantially rewritten TypeScript/JavaScript file:

```bash
bunx oxlint <changed-paths>
```

Не запускати Oxlint на всьому repository заради цієї зміни й не виправляти unrelated backlog.

Через нові modules, exports і shared contracts:

```bash
bun run dead-code
```

Команда non-blocking, тому report потрібно переглянути вручну.

### Builds

```bash
bun run build:ui
bun run build:web
bun run vscode:build
bun run mobile:build
```

Final cross-workspace gate:

```bash
bun run type-check
bun run lint
bun run test
bun run build
```

Root build не package-ить Electron. Electron packaging потрібен лише якщо змінилися packaged web assets, main/preload або release behavior:

```bash
bun run electron:build
```

### Documentation

Оновити після відповідних фаз:

- `packages/web/server/lib/source-control/DOCUMENTATION.md`;
- `packages/web/server/lib/github/DOCUMENTATION.md`;
- `packages/web/server/lib/gitlab/DOCUMENTATION.md`;
- `packages/web/server/lib/git/DOCUMENTATION.md`;
- `packages/ui/src/stores/DOCUMENTATION.md`;
- `packages/ui/src/sync/DOCUMENTATION.md`;
- `packages/vscode/src/DOCUMENTATION.md`;
- `packages/electron/README.md` лише якщо зміниться Electron ownership;
- `packages/mobile/README.md` лише якщо зміниться mobile runtime contract.

`bun run docs:validate` не перевіряє root `docs` або package `DOCUMENTATION.md`, але його слід запустити, якщо зміни торкнуться `packages/docs`.

## Manual validation matrix

Використовувати isolated `OPENCHAMBER_DATA_DIR`, temporary repositories і throwaway provider accounts. Не тестувати destructive scenarios на робочих repositories.

### Accounts та providers

- GitHub: два accounts на `github.com`, один із write і один лише з read access.
- GitLab.com: два accounts.
- Self-managed GitLab: один OAuth або PAT account.
- Однаковий username на GitLab.com і self-managed instance.
- Revoke token, remove SSO grant і змінити CLI active user під час відкритого UI.
- Переконатися, що UI не показує tokens і server logs не містять credentials.

### Repository topology

- Один `origin`.
- Окремі fetch і push URLs.
- `origin` як own fork та `upstream` як canonical repository.
- Contributor fork worktree.
- Кілька remotes різних providers або instances.
- Branch без upstream.
- Detached HEAD.
- Linked worktrees.
- Symlink path.
- Nested repository.
- Submodule same-host і cross-host.
- SSH Git remote плюс HTTPS LFS endpoint.

### Operations

- Clone public/private repository у new path.
- Clone failure, cancellation і retry.
- Fetch, pull, push і sync з однаковими та різними remotes.
- Pull conflict і partial sync.
- Double click, browser refresh і reconnect під час mutation.
- Runtime switch під час OAuth, provider read і Git operation.
- Remote URL change між preflight та execute.
- Account removal після відкриття merge dialog.
- Cancel operation до spawn, під час network wait і між sync steps.
- Restart server після provider mutation із невідомим client outcome.

### UI surfaces

- Desktop browser wide і narrow Settings pane.
- Mobile browser phone і tablet widths.
- Capacitor iOS і Android проти remote server.
- Electron HMR та bundled UI.
- VS Code Extension Development Host і packaged VSIX.
- Header, Git view, PR/MR section, issue picker, change-request picker, walkthrough і worktree dialog.
- Keyboard-only, touch і screen reader smoke test.
- Light, dark і high-contrast themes.
- Long account names, long self-managed hostnames і translated strings.

### Runtime commands

Web development і packaged server:

```bash
bun run dev:web:hmr
bun run build:web
bun run start:web
```

Electron:

```bash
bun run electron:dev
bun run electron:dev:bundled
```

VS Code:

```bash
bun run vscode:dev
bun run vscode:build
bun run vscode:package
```

Mobile:

```bash
bun run mobile:build
bun run mobile:sync
bun run mobile:build:ios:simulator
bun run mobile:build:android:debug
```

## Performance checks

Source-control polling must remain proportional to bound repositories, not connected accounts. Adding a second account не повинно подвоювати background requests.

### Contract

- Background discovery limit залишається 50 directories.
- Один due directory виконує один provider status path для bound account.
- Hidden Settings і закриті choosers не запускають polling.
- Account-scoped caches мають count/TTL bounds та targeted invalidation.
- Runtime switch очищає active request ownership без scanning unrelated namespaces на кожен render.

### Tests і measurement

- Operation-count test: 50 directories із двома accounts не створюють удвічі більше provider calls.
- Repeated refresh deduplicates identical account/repository request.
- Unrelated account mutation не re-render-ить усі Git rows.
- Cache eviction не видаляє watched entries.
- Long-running test перевіряє bounded cache та idempotency records.

Якщо polling, watchers або Git/PR stores змінюються, виміряти production build до й після:

```bash
bun run build:ui
bun run build:web
bun run profile:idle -- --url http://127.0.0.1:4599 --expand-projects --output artifacts/source-control-before
bun run profile:idle -- --url http://127.0.0.1:4599 --expand-projects --baseline artifacts/source-control-before --budget-cpu 5
```

Перевірити frame liveness, workload execution і однаковий fixture scale. Не робити performance claims лише за unit tests.

## Security review checklist

- Tokens не присутні в URL, args, renderer state, localStorage, logs, errors або audit records.
- Managed helper відповідає лише exact endpoint і active operation nonce.
- Provider target server-side resolved і належить repository network.
- OAuth flow має origin runtime, instance, expiry та one-time completion.
- Account removal не активує інший account для existing binding.
- Provider і Git caches включають account та runtime identity.
- Remote pages не отримують Electron local privileges.
- Capacitor connection token не використовується як provider credential.
- VS Code secrets зберігаються лише в `SecretStorage`.
- Mutations перевіряють revision та idempotency до external call.
- Unknown outcome не повторюється автоматично.
- Redaction перевірена canary token у stdout, stderr, HTTP і persisted records.
- Managed SSH не вимикає host-key verification.
- System mode ніколи не отримує verified account label.

## Rollout history і rollback

### Historical rollout sequence (superseded)

1. Ship binding storage і read-only repository context без зміни existing behavior.
2. Migrate provider reads на explicit account context.
3. Увімкнути safe provider mutations і видалити header/global activation UX.
4. Ship Git operation planning у `system` mode без зміни credential ownership.
5. Увімкнути managed HTTPS та explicit-key SSH.
6. Перенести sync, clone і worktree network flows на operation engine.
7. Увімкнути advanced submodule/LFS та audit behavior.

### Current rollback rules

- Rollback code не видаляє newer binding store.
- Older code може ігнорувати binding file, але не повинен його переписувати.
- Provider auth files залишаються у своїх existing formats, тому OAuth/PAT credentials переживають rollback.
- Failed binding migration не змінює Git config, remotes або auth stores.
- Feature disable повертає UI до explicit System Git, але не повертає global provider fallback для mutation.
- Persisted data version підвищується лише при реальній schema change.

## Definition of done

Статус packages 1-8: implementation criteria нижче відображені у фактичних owning contracts, а final integrated validation завершено 2026-09-07. Загальний Definition of Done залишається відкритим до customer acceptance у недоступних external credential і native runtime environments.

### Implementation criteria: complete

- Усі OpenChamber provider reads і mutations використовують explicit credential account ID; provider-user actor identity зберігається окремо.
- Provider/client caches із private data мають account, repository, binding revision і runtime scope.
- Git push, clone, fetch, pull, remote branch deletion і sync через OpenChamber мають explicit targets.
- Managed transport не використовує ambient credentials; anonymous HTTPS read не використовує credentials взагалі.
- System transport чесно показується як unverified.
- Worktrees використовують common-repository binding; contributor forks не отримують implicit push.
- Runtime switch, stale OAuth, account removal і config changes працюють fail-closed.
- Duplicate provider mutation не виконується двічі; partial і unknown outcomes не показуються як success.
- Web, Electron, mobile та VS Code мають documented intentional behavior, включно з explicit unsupported VS Code capabilities.
- Нові UI strings для реалізованих flows присутні в усіх locale dictionaries.
- Owning documentation описує фактичну реалізацію.

### Pending release closure

- Manual customer journeys у VS Code після повернення розширення до поведінки `main` (див. "Рішення щодо VS Code"); web, Electron, hosted/Capacitor mobile закриті у третій сесії.
- External credential і live LFS scenarios, перелічені в current execution ledger.

## Поточна integrated validation, 2026-09-07

- Root tests пройшли: scripts `1/1` files, UI `320/320` files, VS Code `35/35` files, Electron `17/17` files, web `204/204` files і `2737` tests passed (`2` skipped).
- Root `type-check`, ESLint, production build і docs validation пройшли. Docs validator перевірив `460` pages і `46` sidebar links. Production build зберігає existing large-chunk warnings.
- `dead-code` report перевірено як non-blocking audit. Repository-wide unused-file/export/type backlog залишається видимим і не маскувався.
- Поточний source backend завантажено з explicit `packages/web/dist` на loopback і LAN. Compact repository context та configure dialog перевірено на desktop і mobile viewports без runtime errors; screenshot capture був недоступний через `UnknownVizError`.
- У disposable `test-repo-1` explicit GitHub provider confirmation і System/unverified transport consent перевели exact binding у `ready`. Реальний Fetch через operation engine завершив steps `validated` і `transferred` без Push або remote mutation.
- Same-ID GET після server restart відновив redacted terminal snapshot зі станом `succeeded`, exact repository/binding/config revisions і remote fingerprint. Binding та identity responses не містили raw credentials, private key paths або `sshCommand`.
- Тимчасовий listener `4179` зупинено після acceptance.

## Рішення щодо VS Code, 2026-09-07 (четверта сесія)

Замовник вирішив: розширення VS Code не отримує нового Git/provider функціоналу. VS Code сам керує Git і провайдерами, тому extension host повернуто до поведінки `main` (`c36d9120a`), а shared UI отримує від webview лише те, чого вимагає його контракт.

- Видалено з `packages/vscode/src`: координатор мережевих операцій, credential broker із `SecretStorage`, native-діалоги логіна/пароля/SSH-ключа, зберігання author-профілів у `workspaceState`, snapshot SSH-ключів, аудит операцій, source-control bridge, provisioner, redaction helper і їхні тести (близько 6800 рядків). `gitService.ts`, `bridge.ts`, `bridge-git-runtime.ts`, `bridge-git-process-runtime.ts`, `extension.ts`, panel providers, `tsconfig.json`, l10n bundles і CHANGELOG розширення відповідають `main`. Мертві `api:github/*` cases у `bridge.ts` прибрано, бо webview більше не має GitHub-адаптера. Залишено лише script-free CSP bootstrap-документ у `ChatViewProvider` (фікс діагностики порожнього webview, не стосується Git).
- Webview (`packages/vscode/webview/api`): `git-remotes.ts` читає `api:git/remotes`, прибирає userinfo з URL і проєктує remotes як `bound` binding, де кожен remote є готовим System-transport grant. `git.ts` реалізує `planNetworkOperation`/`executeNetworkOperation`/`getNetworkOperation`/`cancelNetworkOperation` у пам'яті webview і мапить виконання на стандартні `api:git/push|pull|fetch|remote-branches`; помилка bridge стає `failed` зі `TRANSPORT_FAILED`, sync записує step results. Author-профілі зберігаються у webview `localStorage` (на `main` вони жили лише в пам'яті webview-store і губилися при reload). Provider-операції, contributor destinations (`{ kind: 'ordinary' }`), clone, hydration, worktrees з `changeRequestSource`/`ensureRemoteUrl` і конфігурація transport/auxiliary bindings лишаються unsupported і не доходять до OpenCode proxy.
- Shared UI: `GitView` не рендерить repository binding strip у VS Code; `RepositoryBindingEditors` і `SourceControlBindingSettings` втратили VS Code-гілки native provisioning; `GitTransportBindingIntent` знову вимагає `credentialAccount` для HTTPS і `sshCredentialId` для SSH. Осиротілі locale-ключі (`gitView.context.runsOn/extensionHost/connectedServer` та інші) вичищено окремим проходом.
- Документація: `packages/vscode/src/DOCUMENTATION.md` (розділ "Git in the webview"), `packages/ui/src/lib/source-control/DOCUMENTATION.md`, `packages/ui/src/stores/DOCUMENTATION.md`, `packages/web/server/lib/git/DOCUMENTATION.md`, `packages/web/server/lib/source-control/DOCUMENTATION.md`.
- Валідація: `packages/vscode` type-check, lint, `bun run build`, webview tests `5/5`; `packages/ui` type-check, lint, ізольовані тести `sections/openchamber`, `views`, `lib/source-control`; `packages/web` type-check, lint, `vitest` `2742 passed / 1 skipped`; `dead-code` перевірено. Ручні VS Code journeys (Extension Development Host, VSIX) з попередніх сесій втратили силу і потребують повторення з замовником: push/pull/fetch/sync через системний git, worktrees, author-профілі.

## Вичистка гілки, 2026-09-07 (четверта сесія)

Прохід по всьому діффу гілки на сміття, орфанд-файли та мертвий код. Правило: видаляти лише те, що доведено не має споживачів; не переписувати живі шляхи запитів.

### Видалено

- **Shared UI.** Клієнтські фасади `deleteRemoteBranch`, `getRemoteUrl`, `discoverGitCredentials` разом з їхніми HTTP-функціями, методами `GitAPI` та типами: гілка перевела видалення remote-гілки на planned-operation lifecycle, сервер відповідає на легасі-маршрут `409`, а сторінку імпорту креденшелів прибрано. Мертвий network-operation фасад у `gitApi.ts` (`planNetworkOperation`, `executeNetworkOperation`, `getNetworkOperation`, `cancelNetworkOperation`, `listContributorDestinations`) - усі виклики йдуть через ін'єктований `Pick<GitAPI, ...>`. Шість легасі-типів `GitHubPullRequest*Input/Result` від видаленого `GitHubAPI`. Опційні `getDefaultGitIdentityId`/`setDefaultGitIdentityId`, які не реалізує жоден адаптер. Поля `discoveredCredentials`/`getUnimportedCredentials` та `identitiesLoading` у сторах.
- **Локалі.** 66 осиротілих ключів у всіх 11 словниках (726 рядків), включно з `gitView.context.runsOn/extensionHost/connectedServer`, `header.github.*`, `settings.gitIdentities.editor.field.*`.
- **Сервер, Git.** Чотири мертві функції `service.js` (`pull`, `push`, `fetch`, `deleteRemoteBranch`, 223 рядки) та недосяжні тіла їхніх маршрутів: gate `rejectLegacyNetworkOperation` завжди відповідає першим. `platform: 'vscode'` і `label` у durable operation store. Гілка `resolvedProfile?.global === true`, яку жоден resolver не повертає. Fallback на `contributorProvenance.read` у списку worktrees.
- **Сервер, GitHub.** 403 рядки недосяжних тіл мутацій `/pr/create|update|merge|ready`: кожен маршрут зареєстрований лише на канонічному шляху, тому перший рядок завжди повертає `runCanonicalMutation`.
- **Формати, яких не існує на диску.** Перевірено фактичні data-dir користувача: усі файли `version: 2`, жодного посилання `ocgit:v1:https`. Тому видалено: v1-HTTPS та семичастинні v2 credential references, v1/v2 формати `git-system-push-acknowledgements.json`, v1→v2 конверсію `source-control-bindings.json` разом з version-параметром валідатора, v1-міграцію `source-control-auth.json`. Усі парсери тепер fail-closed на будь-яку іншу версію.

### Виправлено

- `identity-storage.js` більше не експортував `createProfile`/`updateProfile`/`deleteProfile`, які `routes.js` дістає через `await import('./index.js')`. Кожен POST/PUT/DELETE `/api/git/identities` кидав `TypeError` і повертав 400. Тести цього не ловили, бо мокали `./index.js`. Експорти відновлено.
- Дублікати замінено спільними хелперами `identity.ts`: побудова списку managed-акаунтів (три копії), ключ локалі для джерела креденшела (п'ять копій), `useOpenSourceControlSettings` (чотири копії).
- `GitLabSettings` більше не показує захардкоджені `OAuth`/`PAT`/`glab CLI`; бейдж shell-межі більше не показує `outside-managed-boundary` як текст для користувача; `ContributorDestinationDialog` називається Publish, як і дія, що його відкриває; прикріплений GitLab MR у чаті показується як `MR !12`, а не `PR #12`.
- Тести на регекс по вихідному коду замінено або видалено: `GitIdentityEditorDialog.test.ts`, частини `GitHubSettings.auth.test.ts` і `GitHubIntegrationDialog.auth.test.ts`. Тест парсера change-request перенесено до модуля, який він тестує.

### Свідомо не чіпав

- Прапорець `canonical` у восьми read-маршрутах `github/routes.js` і `canonicalReads` у `gitlab/resources.js`/`repo.js` завжди істинні, тож їхні альтернативні гілки мертві. Це близько 30 умов усередині живих обробників запитів; згортання їх - рефакторинг, а не вичистка, і ризик регресії переважає виграш. Залишено як follow-up.
- Дубльована плумбінг-логіка сховищ (атомарний запис, черга записів, валідатори `isPlainObject`/`isString`/`exactKeys`) повторюється у дев'яти модулях. Консолідація зачіпає fail-closed шляхи читання; окремий follow-up.
- `binding-service.set` і `parseRemotes` не мають продакшн-споживача, але `set` використовується як seed у тестах. Follow-up разом з переписуванням цих тестів на `store.compareAndSwap`.

### Валідація

Root `type-check`, `lint`, `test` і `build`. Web-набір `204` файли. `dead-code` порівняно посимвольно до і після: `394` -> `366` записів, жодного нового мертвого експорту від цієї вичистки.

## Customer acceptance evidence, 2026-09-07 (друга сесія)

Середовище перевірено перед виконанням matrix. Доступні: два реальні GitHub OAuth accounts в isolated store (`bskostiuk` з write scope; `deatheros` має лише `pull` на `bskostiuk-org/test-repo-1`), Xcode 26.6 з iOS Simulator, VS Code 1.136.1 і VSIX 1.20.0 від 2026-09-05, встановлений `/Applications/OpenChamber.app` 1.22.2. Відсутні: `glab` і будь-який `gitlab.com` account в isolated store, `git-lfs`, Android SDK/emulator, Windows або remote extension host. Ambient SSH key автентифікується на GitHub як робочий account і для тестів не використовувався.

Виконано на source backend з explicit `packages/web/dist`, isolated `OPENCHAMBER_DATA_DIR`, `OPENCODE_BINARY` з packaged app і loopback `127.0.0.1:4179`:

- Web (Chromium browser pane): Configure dialog перевів `origin` з System на managed HTTPS з `bskostiuk` (binding revision 5). Binding response містив лише opaque `ocgit:v2` reference і presentation (username, provider-user ID), без token. Publish `refs/heads/main -> origin:refs/heads/main` (`git_f8aeb5ab-…`) завершився `failed` після steps `validated`, `authenticated` з redacted `TRANSPORT_FAILED: Repository not found`; remote залишився порожнім. Клік поза Publish dialog показав toast "Publication cancelled. No Git transfer started." без створення operation.
- Причина failure зовнішня: organization `bskostiuk-org` має GitHub OAuth App access restrictions. Provider API повертає 403 з цим поясненням для OpenChamber OAuth app, а Git повертає "Repository not found". Те саме для read-only `deatheros` (managed fetch `git_181441bd-…`: steps `validated`, `authenticated`, state `failed`). Write-vs-read-only permission matrix на цьому fixture закрити неможливо до approval OpenChamber OAuth app в організації або переходу на disposable repository у personal namespace.
- Anonymous HTTPS на private repository (revision 6, без `credentialId`): fetch `git_951705dd-…` завершився `failed` після лише `validated` з `fatal: unable to get password from user`; credential prompt і ambient helper не використовувались.
- Authority checks: `repo/upstream` з account, який не є bound (`github.com#12375795`), повернув `409 SOURCE_CONTROL_BINDING_CONTEXT_MISMATCH`; stale `bindingRevision=4` повернув `409 SOURCE_CONTROL_BINDING_STALE` з current record. Observation без зміни коду: provider 403 від upstream route повертається як HTTP 500 з provider message (без token), а PR panel показує лише "Available when the current branch can open a pull request".
- Audit (`source-control-audit.json`, mode 0600) містить по одному record на operation з exact `providerAccountId`, opaque credential reference або `anonymous`, endpoint fingerprint, error code і steps; без token, userinfo або paths. Server log не містить token-like strings.
- Restart: після реального restart server GET для чотирьох operation IDs повернув persisted snapshots зі `state: failed`, steps, transport mode і original `runtimeIdentity`; binding revision 7 збережено. Restored snapshot не містить optional `actor.login`; provider account залишається в audit record.
- Capacitor iOS (iPhone 17 Pro simulator, WKWebView, touch через simctl HID): app перепідключено з dev instance `127.0.0.1:3902` на isolated `4179` через Instances → add by address. Changes surface показала committed provider, managed transport `@deatheros`, author і executor "Connected OpenChamber server". Fetch from origin з телефону створив `git_8179aa4e-…` на connected server і показав картку Failed зі steps і redacted error. Hosted mobile у Safari simulator показав той самий context і dialog.
- Знайдено і виправлено implementation defect: у WebKit (Capacitor і Safari) `DialogHeader` усередині scrolling column popup стискався до висоти title, і description малювався поверх першого поля Configure dialog (accessibility frames: description і "Source control account" на одному y=128). Виправлення: `shrink-0` на shared `DialogHeader` у `packages/ui/src/components/ui/dialog.tsx`; Chromium поведінки не змінює, бо там flex item не стискається нижче content. Після rebuild Safari і переінстальований Capacitor app показують коректний stack (description y=128, перше поле y=221); desktop Chromium перевірено без змін. Validation: `type-check:ui`, `lint:ui`, isolated tests для `src/components/ui` і `src/components/sections/openchamber` (10/10 files), `build:web`, `mobile:build:ios:simulator`. `oxlint` для `dialog.tsx` показує два pre-existing type-assertion findings поза зміненим рядком. CHANGELOG `[Unreleased]` отримав user-facing bullet.
- Observations без зміни коду: compact context на 402pt phone займає ліву половину ширини поруч із кнопкою configure; на Capacitor верх dialog розташований під Dynamic Island, бо safe-area padding для dialog застосовується лише в `display-mode: standalone`.
- Listener `4179`, `serve-sim` stream і тимчасова зміна keyboard list у simulator зупинені/повернуті. Push, remote mutation, LFS і SSH не виконувались.

## Customer acceptance evidence, 2026-09-07 (третя сесія: повна matrix)

Fixtures створені за дозволом користувача і є disposable: GitHub `deatheros/openchamber-acc-rw` (`bskostiuk` push), `-ro` (`bskostiuk` pull), `-lfs` (6 MiB LFS object, write deploy key); gitlab.com `bskostiuk/openchamber-acc-rw` (`deatheros` Developer), `-ro` (`deatheros` Reporter), `-lfs`, fork `deatheros/openchamber-acc-rw`; локальний GitLab CE у Docker як другий instance, переведений на `https://localhost:8930` через mkcert (CA у login keychain, `NODE_EXTRA_CA_CERTS` для server), з користувачами `openchamber-test` (Owner) і `openchamber-reader` (Reporter). Isolated store містить GitHub OAuth x2, gitlab.com PAT x2, localhost PAT x2. Токени використовувались лише через shell-підстановку без виводу; `git-lfs`, `glab`, `mkcert` встановлені.

Виконано через operation API, web UI, packaged Electron (CDP) і Capacitor iOS Simulator:

- GitHub write: managed clone (binding revision 1), provider association, publish з `configureUpstream`, fetch, відхилення non-fast-forward, `--force-with-lease`, видалення remote branch, stale revision → `409 STALE_BINDING`, sync (fetch+pull+push усі `succeeded`), PR create (draft) → ready → squash merge підтверджені через `gh`.
- GitHub read-only (`bskostiuk` pull): clone і fetch ok; push відхилено (`Write access to repository not granted`); PR list ok; PR create дозволений GitHub для author; merge відхилено (`GITHUB_MUTATION_REJECTED`); update власного PR ok. Незв'язаний account на binding → `409 SOURCE_CONTROL_BINDING_CONTEXT_MISMATCH`.
- Interrupted push: 48 MiB commit, cancel під час transfer → `outcome-unknown` з `OUTCOME_UNKNOWN`, remote branch відсутній, recovery fetch ok.
- gitlab.com: clone обома accounts, Owner publish, Reporter fetch ok і push `403`, Developer push ok при provider association іншого account (transport `deatheros`, provider `bskostiuk`, revisions 2→3 незалежні), MR create/ready/merge, Reporter MR create `403`. Same-instance ізоляція підтверджена.
- Другий GitLab instance: Git plane приймає лише HTTPS (http loopback clone → `INVALID_REQUEST`, хоча instance normalization дозволяє http loopback для provider API). Після переходу на HTTPS: clone Owner і Reporter, Reporter push відхилено, Owner push ok, per-instance MR status ізольований, підміна identity → `409`, cross-instance account при clone → `400`. Git Settings показує три GitLab instances (недоступний http instance показує "Operation failed" і зберігає last-successful accounts).
- Managed SSH: discover (3 ключі, passphrase key `encrypted-or-unverifiable`), import deploy key, inventory ready, clone через SSH з actor `ssh-key` fingerprint, без залишків operation key snapshots; fetch по SSH ok.
- LFS: managed clone → `partial` + `authorization-required` для `info/lfs`; після auxiliary grant hydration завантажила 6 MiB об'єкт; managed push з новими LFS-об'єктами виконав upload (audit record `lfs-upload`) і публікацію, об'єкти завантажуються у свіжий clone на GitHub; на gitlab.com push без grant → `AUTHENTICATION_REQUIRED` без публікації refs, з grant → upload + publish, GitLab віддає об'єкт.
- Restart recovery: усі failed/succeeded operations відновлені після restart із original runtime identity.
- Capacitor iOS: Instances → add by address на isolated server, Changes context для GitHub і GitLab repositories, Fetch з телефону (GitLab, `deatheros`) `succeeded`, індикатор sync ↓2, dialog Choose sync targets з exact destination. Hosted mobile у Safari: context і Configure dialog.
- Packaged Electron: `bun run electron:build` дав adhoc-signed DMG/ZIP/app (notarization пропущена без Apple credentials). Запуск з isolated data dir: backend `runtime=desktop` 1.20.0, renderer `openchamber-ui://` з desktop bridge, Git panel context, Configure dialog (suggested provider account потребує підтвердження), перемикання project через input events, PR panel показує GitLab MR (`open on gitlab`, mergeable, squash).

Виявлені й виправлені дефекти (focused tests, package type-check/lint, live re-run):

1. GitLab адаптер передавав `draft` як параметр API, якого GitLab не має; MR не ставав draft, а `ready` шле порожній edit → сирий `400`. Тепер draft виражається префіксом заголовка, ready знімає префікс і idempotent.
2. git-lfs запитує credentials для repository path без `/info/lfs`; exact-match lease broker відхиляв запит, і git-lfs мовчки виходив з кодом 2. Lease для LFS тепер приймає похідний repository path (`gitLfsCredentialEndpointAliases`).
3. LFS publication будував grant plan без top-level `directory`, тому auxiliary authority падала з `INVALID_GIT_TRANSPORT_CONTEXT`.
4. Real git-lfs vitest fixture мав суперечливий сервер (`authenticated: true` і 401 на upload), через що тест зависав до timeout при встановленому git-lfs; fixture приведено до GitLab-подібної моделі з перевіркою авторизації upload.
5. WebKit: заголовок shared dialog стискався і накладався на перше поле (shrink-0 на DialogHeader).

Cleanup цього раунду (source-control scope): спільні helpers `getSourceControlProviderLabel`, `getChangeRequestReferencePrefix`, `formatChangeRequestReference`, `formatSourceControlAccountLabel` замінили дубльовані ternaries і label-шаблони; MR номери у PR panel, sidebar і work status показують `!N` для GitLab (branch PR summary отримав `provider`); видалено мертвий `GitHubAPI` surface (types, VS Code webview adapter, 18 disabled bridge cases) і `SourceControlAPI.me` без callers; знято telemetry-only GitHub auth subscription у SessionSidebar; дедуплікований блок dialogs у MobileChangesSurface. Validation: type-check/lint ui, web, vscode; isolated UI tests 84/84 files у зачеплених директоріях; web adapter 70 tests; VS Code 35/35 files; oxlint показує лише pre-existing findings поза авторськими рядками.

Спостереження без змін коду: compact provider line не показує login bound account (видно лише у Configure dialog); manual checkout-hydration planning для SSH parent без `.lfsconfig` повертає `INVALID_REQUEST`; `bootstrap-status` пише failed/UNKNOWN blocker для будь-якого repository без запису; managed SSH import повертає `candidate-expired` для невідомого candidate ID; provider 403 з `repo/upstream` мапиться у HTTP 500; PR panel має заголовок "Pull request" і для GitLab. Залишкові дублікати за межами цього раунду: provider fork у web client adapter (GitHub нормалізація на клієнті, GitLab на сервері), три парсери remote URL, dual-mounted GitHub routes із path sniffing, VS Code coordinator як друга реалізація binding service, GitHub-only "Start from issue/PR".

Не виконано: VS Code Extension Development Host і VSIX journeys (VSIX 1.20.0 зібраний, потрібен інтерактивний оператор), Android (немає SDK/emulator), Windows/remote extension host, фізичний iOS-пристрій. Fixtures і локальний GitLab збережені для повторних прогонів.

## Історичний release status, 2026-09-05 (superseded)

Історичні результати automated validation від 2026-09-05. Подальший архітектурний review виявив незавершені flows і регресії, тому ці результати не є release signoff:

- Workspace tests пройшли: scripts `1/1` files, UI `307/307` files, VS Code `34/34` files, Electron `17/17` files, web `197/197` files і `2328` tests passed (`1` skipped).
- Усі workspace package type-checks і ESLint checks пройшли без errors або warnings.
- Root build і docs validation пройшли; docs validator перевірив `460` pages і `46` sidebar links.
- Focused anti-slop validation пройшла для нових operation helper, VS Code coordinator та web audit storage. Wider anti-slop report усе ще містить established findings у legacy parser, Git service і великих UI files; їх не маскували та не mass-fix-или в цьому cutover.
- `dead-code` report перевірено. Він не позначив нові source-control files або exports; repository-wide established unused-export backlog залишається non-blocking.
- Production web build завантажено з explicit current `packages/web/dist` на desktop, tablet і hosted-mobile viewports. Git Settings показала GitHub, GitLab, repository source-control та identity sections, а mobile Changes перевірено на dirty repository з великою file list без horizontal clipping або console errors. Smoke daemon зупинено.
- Focused Git operation tests підтверджують exact refs/endpoints, acknowledgement, stale-authority rejection, audit redaction/lifecycle, clone, upstream configuration і remote deletion для web/shared UI/VS Code paths.
- Post-validation regression audit закрив дві mutation-boundary прогалини: GitHub merge тепер передає validated head SHA у provider write, а web/mobile/VS Code commit fail-closed без обох repository-local identity fields незалежно від global Git config.
- Додаткові behavioral tests підтверджують remote-delete-before-local-removal ordering, VS Code sync з різними fetch/push remotes, partial push/upstream-configuration results, `outcome-unknown` після interrupted push і fail-closed execution без spawn після credential revocation.
- Git UI regression audit додатково забезпечив settlement усіх mobile revert-all operations до authoritative refresh, worktree removal до архівації linked sessions і immediate plus delayed reconciliation для PR/MR mutations з `outcome-unknown`. Git Settings знову використовує container breakpoints і shared capped control widths.
- Clone dialog заздалегідь показує System Git credential boundary; worktree remote deletion використовує один OpenChamber confirmation surface замість послідовного custom і native confirmation. Mobile Git controls отримали повноширинне responsive компонування, а clone URL та identity controls мають accessible names.
- Performance capture підтвердив stable idle CPU (`0.57%` до `0.50%`), unchanged fetch count (`15`) і bounded source-control discovery/cache behavior. Heap comparison не використовується як release claim через великий DOM cleanup у capture.

На дату цього historical snapshot release signoff ще потребував external manual account matrix, яку неможливо було виконати без додаткових throwaway credentials:

- другий `gitlab.com` account для same-instance account isolation;
- GitHub write account і окремий read-only account для permission/fail-closed scenarios.

Trusted agent initiator, repository-scoped shell credential isolation і self-approve/self-merge enforcement не блокують цей Release C. Вони є окремою future capability з prerequisite у вигляді host-authenticated OpenCode Git/process boundary, як визначено у фазі 9.

## Історичний corrective release D: explicit transport onboarding та account presentation (superseded)

Цей corrective snapshot пояснює причину пакетів 1-8, але більше не описує їхній поточний стан. Поточний status визначає [Execution ledger](#execution-ledger).

Manual account-matrix testing 2026-09-06 виявило розрив між transport authority і onboarding UI. Підтвердження provider account автоматично створювало System binding для всіх remotes, а VS Code підставляв System до першої взаємодії з transport selector. Це порушувало вимогу explicit selection, хоча downstream network planner і system acknowledgement працювали fail-closed.

### Інваріанти corrective release

1. Новий або existing repository без remote transport запису має стан `needs-selection` для network actions. Local status, diff, stage, commit, branch і history не блокуються.
2. Вибір provider account не створює, не змінює і не видаляє transport credential. Вибір transport не змінює provider account або commit profile.
3. Кожна binding mutation використовує exact authoritative revision. `409 STALE_BINDING` оновлює видимий context і не повторює mutation автоматично.
4. Operation capture містить immutable references на provider account, remote transport, commit profile і runtime. Пізніша зміна Settings не змінює вже запущену operation.
5. Existing version-1 System bindings без metadata про explicit selection не вважаються підтвердженим onboarding choice. Migration переводить їх у `needs-attention` або просить повторний explicit save без зміни Git config чи remotes.
6. UI групує OAuth, PAT і CLI credentials одного verified provider user під одним account presentation, але зберігає окремі credential IDs, source labels, validity і remove/re-authenticate actions.
7. Refresh зберігає останній successful account inventory і показує loading/error окремо. Fetch failure не малює порожній disconnected state.

### Послідовність реалізації

1. Прибрати обидва implicit System defaults. Provider-only binding зберігає `remotes: []`; VS Code вимагає interaction з transport selector. Додати regression tests, що network configuration не викликається до вибору.
2. Перенести active-repository account, remote, transport, author і runtime controls зі сторінки global Git Settings у Git panel. Settings залишає inventories для provider accounts, transport credentials і commit profiles. Dynamic repository controls не індексуються Settings search.
3. Додати host-owned `configureTransportBinding` для web runtime. Browser передає intent і account/credential reference; server сам resolve-ить remote endpoint, provision-ить managed HTTPS reference та виконує CAS update. Raw token, key path і authoritative URL не повертаються в UI.
4. Додати `anonymous` до shared operation contract, web executor, VS Code coordinator та audit schemas. Anonymous read очищає всі ambient auth paths; anonymous publish відхиляється до process spawn. `unselected` залишається відсутнім remote record і ніколи не потрапляє в executor.
5. Додати strict persisted migration та rollback behavior. Revision tombstones, unrelated providers/remotes/auxiliary grants і valid credentials зберігаються. Failed migration або write залишає попередній valid snapshot authoritative.
6. Переробити GitHub/GitLab account rows: одна primary identity row на provider user, secondary credential-source rows, стабільні controls під час refresh, token-free error states і однаковий visual hierarchy у desktop/mobile Settings.
7. Додати compact repository context у desktop Git view та mobile Changes: provider account, fetch/push transport, author, execution runtime і binding revision/error state. Довгі usernames, hosts і translated labels не повинні ховати network-action guard.
8. Перевірити web, Electron-through-web, hosted/Capacitor mobile та VS Code окремо. Unsupported capability повертає explicit result; жоден runtime не повертається до implicit System або first-remote fallback.

### Historical vertical slice 1 status, 2026-09-06 (superseded)

- Реалізацію розпочато з видалення implicit System transport під час provider confirmation.
- VS Code transport selector тепер починається з `Choose transport`, якщо selected remote не має binding; save не викликає host configuration до explicit choice.
- Existing explicit managed/System records і CAS conflict refresh не змінюються.
- На момент цього snapshot anonymous execution, web managed credential provisioning та versioned migration були наступними slices. Поточний ledger supersede-ить цей стан.

### Historical vertical slice 2 status, 2026-09-06 (superseded)

- GitHub і GitLab credentials тепер групуються для presentation за provider, normalized instance та immutable provider user ID. Кожен OAuth, PAT або CLI credential зберігає exact account ID, source status і власну remove, disable або re-authenticate action.
- Active-repository provider і transport controls перенесено з Git Settings у desktop Git panel та mobile Changes. Author selection залишається в Git header, а runtime та author context залишаються видимими під repository controls.
- Dynamic repository controls видалено з Settings search. GitHub/GitLab account inventories, connect actions і commit profiles залишаються на Git Settings page.
- Desktop використовує вже завантажений authoritative binding demand і не додає другий repository-binding request. Mobile замінив старий read-only context load на self-owned repository control load.

## Погоджений план виправлень

Цей розділ замінює попередню послідовність corrective slices. Основна модель залишається незмінною: repository-level binding, незалежні provider/transport/author/runtime identities, exact targets, immutable operation snapshots, CAS та explicit System без managed fallback. Довільний agent shell залишається поза managed boundary.

Статус плану: packages 1-8 implementation complete, package 9 customer acceptance pending. P0 і P1 нижче зберігають початкову risk classification, а не позначають незавершені частини.

| Пакет | Пріоритет | Власники | Завершення |
| --- | --- | --- | --- |
| 1. Незалежність identities | P0 | Binding service/storage, web Git service, VS Code gitService, repository controls | Author/API/remote changes не змінюють незалежну authority |
| 2. Revisions і persistence | P0 | Repository resolvers, binding/auth/acknowledgement/mutation/audit stores | Routine Git config не ламає binding; upgrade і concurrent writes без втрати даних |
| 3. Managed isolation | P0 | Web network executor, credential broker/resolver, VS Code coordinator/process runtime | Уся operation використовує exact credential без ambient обходів |
| 4. Git targets | P0 | Shared request builders, SyncActions, branch dialogs, Git/mobile handlers, runtime planners | Fetch незалежний від tracking; Publish/Sync мають exact targets |
| 5. Operation recovery | P0 | Shared operation lifecycle, mutation executor/audit, VS Code coordinator | Partial/unknown/restart results збережені без сліпого повтору |
| 6. Repository/auth state | P1 | Shared source-control state, consumers, runtime bootstrap | Один committed binding state; failure не є empty/loading forever |
| 7. Onboarding і UI | P1 | Runtime transport provisioning, Git panel, account inventory, mobile author flow | Новий repository налаштовується через UI без terminal/JSON |
| 8. Clone/worktree/hydration | P1 | Clone dialog/executor, worktree service, contributor policy, submodule/LFS discovery | Checkout готовий до наступної operation; repair не втрачає checkout |
| 9. Customer acceptance | Release gate | Усі owning runtimes | Наскрізні journeys перевірені в реальному UI та runtime |

Погоджений порядок інтеграції був `1 -> 2 -> 6 -> 7 -> 4 -> 3 -> 5 -> 8 -> 9`. Packages 1-8 тепер implementation complete; package 9 залишається release gate. Shared-contract cutover вимагав atomic integration із consumers і migrations замість UI-only workaround.

### 1. Незалежність identities

- Зберегти один repository binding і одну CAS revision. Перевіряти залежності конкретної operation замість загальної заборони всього repository через один `needs-attention`.
- Local status/diff/stage потребує лише repository; commit потребує local author; API потребує exact provider credential; network Git потребує exact endpoint grant; auxiliary transfer потребує власний grant.
- Author application змінює лише name/email та intentional signing settings. Legacy profile transport fields зберігаються до migration, але не застосовуються через author selector.
- Provider edit/remove змінює лише конкретний association. Remote edit/remove змінює лише вибраний grant. Sibling providers/remotes/auxiliary grants зберігаються.
- Повне скидання binding має окрему назву і confirmation наслідків.
- Contributor creation використовує explicit transport selection, не виводить network permission з provider API account.
- Gate: revoked API credential не блокує незалежний SSH grant; застосування author не змінює SSH/helper config у web та VS Code.

### 2. Revisions і persistence

- Binding revision визначає порядок явних змін OpenChamber. Endpoint fingerprint визначає дозволений destination. Effective transport revision визначає релевантні auth/config умови. Branch/ref/SHA належать operation snapshot.
- Прибрати hash усього common Git config як довготривалу валідність binding. Author/upstream changes не відкликають provider/transport grants.
- Reads повідомляють реальний drift і reason. Provider-only save не переавторизовує transport після remote replacement.
- Binding mutations перевіряють expected repository ID і revision. Stale mutation повертає conflict без auto-retry.
- System acknowledgement охоплює підтверджений endpoint та релевантний transport context; ambient account залишається unverified.
- Versioned migration переводить implicit System grants у selection/attention без втрати незалежних provider associations. Valid legacy acknowledgement не дає authority, але дозволяє нове explicit confirmation.
- Missing, malformed і unreadable storage мають різні результати. Failed migration/write зберігає попередній valid файл.
- Read/check/write transactions для спільного data directory потребують cross-process exclusion; atomic rename і instance-local Promise queue самі не є достатньою CAS гарантією.
- Gate: перший push із configureUpstream не ламає наступний Fetch; remote replacement потребує explicit repair; concurrent writers та upgrade не втрачають records.

### 3. Managed isolation

- Гарантія охоплює transfer, integration, hooks/filters і LFS, а не тільки parent fetch/push subprocess.
- VS Code HTTPS нейтралізує effective repository-local HTTP/auth settings та includes за web precedent.
- VS Code SSH копіює key в operation-owned snapshot, перевіряє його fingerprint і використовує лише snapshot; cleanup виконується на всіх terminal paths.
- Managed integration не запускає ambient credential-bearing hooks/filters. LFS upload є explicit authorized step замість вимкненого pre-push hook.
- Anonymous є credential-free read mode, не перейменований System. Unsupported capability явна в кожному runtime.
- Gate: ambient helper/header/agent або заміна selected key не змінюють виконуваний managed credential.

### 4. Git targets

- Розділити preconditions Fetch, Pull, Publish і Sync у shared builders. Tracking не є publishing authority.
- Fetch працює для явно вибраного remote без upstream поточної branch, включно з detached HEAD.
- Existing branch без upstream відкриває Publish chooser з exact remote/destination branch.
- Sync має незалежні fetch/integration і push targets; `upstream/main` не підставляється як push destination для fork workflow.
- VS Code fetch-ить один раз, pin-ить отриманий SHA та інтегрує локально без другого network pull.
- ConfigureUpstream після successful push має окремий partial-result failure. PR indicators використовують binding, не heuristic origin preference.
- Contributor chooser і planner використовують одну destination policy.
- Gate: no-upstream publication і upstream-to-fork sync працюють без implicit target selection.

### 5. Operation recovery

- Shared UI зберігає operation ID, captured context, stable error code і completed steps. Helpers не стирають terminal result до `void` або generic Error.
- Після disconnect отримувати стан тієї самої operation; не створювати нову для з'ясування результату. Expose cancellation для supported operations.
- Розрізняти not-started, completed-local і unknown-remote outcomes. Зберігати completed steps на всіх exception paths.
- Provider replay після restart зберігає originating audit runtime; strict immutable target/account checks залишаються.
- VS Code activation завершує abandoned planned records і чесно класифікує interrupted executions без відновлення процесів або auto-retry.
- Gate: timeout/restart/partial sync залишає зрозумілий result і безпечну наступну дію.

### 6. Repository/auth state

- Один shared UI owner repository binding, незалежний від PR demand arbitration. Scope: runtime/repository із directory resolve та generation guards.
- Consumers отримують committed binding, loading/error/stale state, refresh і вузькі mutations. Successful mutation публікує одну revision та invalidates dependent contexts.
- Кожен read/save/delete/OAuth/PAT completion перевіряє captured runtime і repository/directory. Draft не переноситься між scopes або remotes.
- Auth refresh failure зберігає last-successful inventory як stale, а не disconnected empty. Runtime change запускає один destination bootstrap.
- Capability failure має retry; його не трактують як unsupported або відсутність connection methods.
- Gate: Git/PR/pickers бачать одну revision; немає forever-loading або account попереднього runtime.

### 7. Onboarding і UI

- Host-owned transport configuration для web/Electron/connected mobile незалежно від provider account. Initial selection: Choose transport; System потребує explicit unverified confirmation.
- Managed UI передає intent та opaque references, не raw secrets/authoritative URLs.
- Git panel показує compact committed context, editor відкривається для setup/repair. Draft позначений окремо; routine managed operation не додає confirmation dialog.
- Credential options розрізняють source та instance. Summary показує credential label або SSH fingerprint без неправдивого verified provider username.
- Executor label походить із runtime ownership; mobile Git виконується на connected server, VS Code Git на extension host.
- Missing capability має конкретний repair action; mobile отримує author application flow. Inventories залишаються в Settings; dynamic repository controls не індексуються там.
- Gate: новий користувач налаштовує repository без terminal/JSON; configured panel не перетворюється на постійну Save/Remove форму.

### 8. Clone/worktree/hydration

- Transport вибирається до clone. Після успішного checkout exact selection переноситься в binding revision 1.
- Binding persistence failure зберігає checkout та дозволяє finish-setup без повторного clone. Cleanup видаляє лише operation-owned incomplete data.
- LFS discovery bounded/incremental; невеликі sample/count limits не забороняють звичайні repositories. Live download/upload залишаються acceptance gate, а не незавершеним implementation item.
- Local worktree спочатку визначає потребу hydration; parent endpoint не потрібен для суто local checkout.
- Auxiliary authorization failure повідомляє конкретний redacted endpoint і шлях до explicit grant. Parent credentials не успадковуються автоматично.
- Contributor fetch має explicit transport authority; destination policy однакова в chooser та executor.
- Gate: clone приводить до repository, готового до наступного Fetch/Commit/Publish; hydration repair не втрачає completed checkout.

### 9. Acceptance і контроль виконання

Перед production edit додавати regression case, який відтворює відповідний failure. Кожна завершена частина має focused tests, owning documentation і review. Shared contract changes додатково проходять cross-workspace compilation/build та serialization checks за root guide.

- Fresh setup і upgrade старого binding; provider-only і transport-only repository.
- Два credentials одного user; різні accounts для API/Git із різними permissions.
- Existing repository -> explicit transport -> Fetch -> author -> Commit -> first Publish -> repeated Sync без binding repair.
- No-upstream, detached Fetch, upstream/fork targets; author/upstream changes після binding.
- Revocation і remote replacement; runtime/directory switches під час reads/mutations.
- Clone, великий non-LFS repository, local/contributor worktrees, submodules і LFS download/upload.
- Partial/unknown outcomes, disconnect, server/extension restart і audited replay.
- Реальні web, Electron, hosted/Capacitor mobile і VS Code flows. Viewport resize не замінює mobile-runtime перевірку.
- Keyboard/touch, narrow panels, long account/instance names та всі locales.

Subagents отримують неперетинні ownership scopes і конкретний test gate. Coordinator перевіряє їхні diffs через читання файлів, інтегрує contracts і запускає спільні checks. Повідомлення агента про успіх не означає завершення всього пакета.

### Execution ledger

| Частина | Стан | Фактичний implementation scope / залишок |
| --- | --- | --- |
| Packages 1-8 overall | **Implementation and integrated validation complete** | Owning docs описують combined contracts. Focused/package/workspace/build/security integration gate закрито evidence від 2026-09-07 |
| 1. Independent identities і readiness | Реалізовано | Provider credential, provider-user actor, parent transport, auxiliary transport і author identity розділені. Кожен provider/remote/auxiliary grant має власну readiness; aggregate binding state не забирає authority у healthy sibling |
| 2. v2 persistence, revisions і locks | Реалізовано | Version-2 binding parser/conversion, endpoint-specific readiness, public topology revision, private transport revision, CAS, tombstones, atomic mode-`0600` writes, cross-process snapshot locks і provider execution locks мають fail-closed/manual orphan-recovery contract |
| 3. Exact credentials і managed isolation | Реалізовано | Exact immutable credential ID і revision pin-яться в `ocgit:v2`; provider-user identity не замінює credential authority. Managed HTTPS broker, managed SSH operation snapshot/fingerprint, System unverified boundary та anonymous credential-free HTTPS isolation не мають ambient fallback |
| 4. Exact Git targets | Реалізовано | Remote Fetch не залежить від upstream; Push, Pull, remote deletion і Sync використовують exact remotes/full refs, а Sync має independent fetch і push authority. Anonymous publish відхиляється до planning |
| 5. Durable registries/records і operation recovery | Реалізовано | Provider mutation claim registry та audit records durable; cross-process execution lock не дозволяє іншому daemon reconcile live work. VS Code audit відновлює terminal/abandoned state. Web Git execution registry intentional process-local, а shared `sessionStorage` pending-operation marker зберігає original ID і блокує blind retry після reload/restart/`NOT_FOUND` |
| 6. Shared repository/auth state | Реалізовано | Один runtime/directory-scoped binding owner публікує committed revision, stale/error state та narrow mutation results. Auth refresh зберігає last-successful inventory; generation guards відкидають stale runtime/repository completions |
| 7. Onboarding, auxiliary/SSH і UI | Реалізовано | Git panel/mobile Changes показують committed provider, exact credential presentation або SSH fingerprint, remote readiness, anonymous/System state, author і executor class. Transport, managed SSH inventory/discovery/import, exact auxiliary grant repair, reset і mobile author flows є explicit та independent; provider account rows групують presentation без злиття credential IDs |
| 8. Clone, hydration і worktree recovery | Реалізовано | Clone вимагає transport до planning, переносить exact grant у revision 1 і зберігає completed checkout як repairable `partial` при binding/hydration failure. Durable shared worktree-bootstrap store, local-first inspection, exact auxiliary submodule/LFS grants і retry без reclone зберігають checkout та completed steps |
| VS Code intentional boundaries | Реалізовано як explicit unsupported | Existing-repository `managed`/`system` network operations і anonymous HTTPS fetch/pull належать extension host. Provider API, clone, contributor destinations, auxiliary configuration, checkout hydration і submodule/LFS hydration повертають stable unsupported і не потрапляють у generic proxy або ambient fallback |
| Customer acceptance | Pending (VS Code, Android, Windows, real device) | Web, packaged Electron, hosted mobile і Capacitor iOS journeys, GitHub write/read-only matrix, gitlab.com same-instance isolation, second GitLab instance, managed SSH, LFS download/upload, interrupted push і restart recovery виконані 2026-09-07 (див. [третя сесія](#customer-acceptance-evidence-2026-09-07-третя-сесія-повна-matrix)). Відкрито: VS Code EDH/VSIX з оператором, Android, Windows/remote host, фізичний пристрій |

#### Acceptance blockers, separate from code completion

- External credentials: organization `bskostiuk-org` має OAuth App access restrictions, тому обидва реальні GitHub accounts (write `bskostiuk`, read-only `deatheros`) отримують 403/"Repository not found" через OpenChamber OAuth app. Потрібен approval app в організації або disposable repository у personal namespace. Другий `gitlab.com` account відсутній; `glab` не встановлено.
- Native runtimes: hosted mobile і Capacitor iOS journeys виконані у simulator 2026-09-07; Android SDK/emulator відсутні. Packaged Electron і VS Code Extension Development Host/VSIX потребують інтерактивного оператора desktop UI (в цьому середовищі немає автоматизації native windows), а mac packaging вимагає signing/notarization credentials. Windows або remote extension host недоступні.
- Live LFS/SSH: `git-lfs` не встановлено; для live managed SSH потрібен disposable provider-registered key, бо ambient key належить робочому account. Fake child responses або browser-only fixtures не закривають цей gate.
- Interrupted live Push і unknown-outcome recovery залежать від того самого GitHub write access.

Ці acceptance blockers залишають release signoff відкритим. Вони не означають незавершений code scope, якщо final validation не виявить implementation defect.

#### Historical Package 7 UI evidence, 2026-09-06 (superseded status)

- Змінено лише `SourceControlBindingSettings.tsx`, локальний `RepositoryBindingEditors.tsx`, context integration у GitView/MobileChangesSurface, locales, tests і документацію. Network handlers, stores, API/server contracts, GitHeader та inventories не змінювалися. Git commands, dependency changes і live credential mutations не виконувалися.
- Summary читає committed binding owner. Dialog містить окремі draft editors; close/scope change скидає незбережені selections. Remove provider association зберігає exact-target semantics existing hook. System consent залишився explicit; managed/anonymous не отримали додаткових confirmation popups.
- Mobile читає existing profiles через поточний GitAPI та застосовує лише `setGitIdentity(directory, profileId)` із `fetchIdentity` store action. Немає нового profile persistence або global transport inference. Signing fields не переписуються UI.
- `bun run type-check:ui`, `bun run lint:ui` та focused oxlint для обох context components і нового test file пройшли. Окремі Bun runs: context 8, editor/OAuth 28, provider hook 18, binding owner 14, author profiles 15 tests. `bun run dead-code` виконано; report містить unrelated unused entries, але не нові context components/exports.
- Isolated Chrome CDP запускав actual shared component і primitives з inert RuntimeAPIs. Перевірено Enter-to-open, touch option selection, Escape cancel, незмінність summary під час draft provider/remote/transport changes, cancel/setup без provider/transport writes, local author apply, empty-profile Settings route та scope-change close. За два runtimes: два binding reads, два auth inventory/status bootstraps; dialog reopening не додав binding/account requests. Усі 11 locales на 320, 390 і 768px без horizontal overflow. Початковий overflow provider field на 320px виправлено й перевірено повторно. Тимчасові scripts: `package7-context-preview.mjs`, `package7-context-preview.tsx`, `package7-context-browser.mjs` у pre-approved OpenCode temp directory.
- Історичні межі цього snapshot: binding API тоді не надавав credential display label, SSH fingerprint або executor hostname, а browser fixture не був web/Electron/VS Code/hosted-mobile/Capacitor end-to-end acceptance. Пізніша implementation додала safe credential presentation та SSH fingerprint projection, тому перше обмеження superseded. Реальні credentials, native dialogs/touch, backend grants, signing і customer acceptance не були перевірені цим snapshot. Shared browser-panel screenshot capture повернув `UnknownVizError`; CDP interaction і layout assertions пройшли.
