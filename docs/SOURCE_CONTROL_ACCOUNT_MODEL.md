# Модель source control accounts в OpenChamber

## Мета документа

OpenChamber має підтримувати кілька GitHub і GitLab accounts, кілька instances одного provider та роботу з локальними й віддаленими runtimes. Користувач не повинен постійно перемикати глобальний account або здогадуватися, від чийого імені виконається дія.

Цей документ описує запропоновані рішення простими словами. Для кожного рішення вказано, яку проблему воно закриває, як має працювати, звідки взята ідея та навіщо вона потрібна OpenChamber.

## Які identity потрібно розділяти

У Git workflow беруть участь кілька незалежних identities.

### Provider account

GitHub або GitLab account, від імені якого OpenChamber працює з API. Він використовується для issues, pull requests, merge requests, comments, reviews, CI status і merge.

### Git transport credential

Credential, який використовує Git для `clone`, `fetch`, `pull` і `push`. Для HTTPS це може бути token із credential helper або AskPass. Для SSH це key, SSH config або SSH agent.

### Commit identity

Ім'я, email і signing key, які записуються в commit. Вони не надають доступу до repository і не визначають account для push.

### Execution runtime

Машина, на якій виконується Git або provider API request. Це може бути локальний OpenChamber server, desktop runtime, VS Code extension host або віддалений server, до якого підключено mobile чи desktop client.

Ці identities можуть належати різним користувачам. OpenChamber не повинен автоматично вважати їх одним account.

## 1. Прив'язка provider account до repository

### Проблема

Глобальний active account впливає на всі відкриті проєкти. Якщо користувач переключив GitHub account у вікні з особистим repository, наступна API-операція в робочому repository також може використати особистий account.

### Рішення

OpenChamber запам'ятовує provider account для конкретного repository, provider та instance.

Наприклад:

```text
company/backend
GitHub github.com
Account @boris-work
```

Інший repository може одночасно використовувати `@boris-personal`. Глобального active account для source control operations більше немає.

Прив'язку потрібно зберігати на server, якому належить repository. Ключем має бути canonical Git common directory, щоб основний checkout і всі linked worktrees успадковували одну конфігурацію.

### Звідки взята ідея

JetBrains IDEs дозволяють вибрати default GitHub або GitLab account для поточного IDE project. Visual Studio також документує, що відстежує GitHub account для кожного repository.

OpenChamber має зробити прив'язку точнішою за JetBrains. Один IDE project може містити кілька Git repositories, тому account потрібно прив'язувати до конкретного repository та provider instance.

### Навіщо це OpenChamber

- Різні repositories можуть безпечно використовувати різні accounts одночасно.
- Перемикання account в одному вікні не змінює поведінку інших вікон.
- GitHub.com, GitLab.com і self-managed GitLab не змішуються.
- Worktrees отримують account основного repository без окремого налаштування.

## 2. Ізольовані Git credentials для кожної операції

### Проблема

Git може отримати credential із macOS Keychain, Git Credential Manager, `GIT_ASKPASS`, SSH agent або іншої системної конфігурації. Якщо на машині є кілька accounts одного provider, OpenChamber не може гарантувати, який із них вибере Git.

Вибір commit identity не вирішує цю проблему. Commit може містити робочий email, а push виконає особистий account.

### Рішення

Для managed transport OpenChamber створює окреме середовище для кожної Git operation.

Для HTTPS OpenChamber запускає Git через operation-scoped AskPass або credential helper, який повертає лише credential, прив'язаний до цього repository та remote.

Для SSH OpenChamber передає конкретний key або дозволений key fingerprint і використовує `IdentitiesOnly=yes`. Git не перебирає всі keys із загального SSH agent.

Token не передається в remote URL, command arguments, renderer або logs.

### Звідки взята ідея

GitHub Desktop запускає Git через власний AskPass і прибирає зовнішній `credential.helper` зі свого execution context. Це дає GitHub Desktop контроль над account, який використовується для network operations.

Офіційна документація GitHub для multiple accounts також рекомендує явно розділяти HTTPS credentials за repository path або використовувати окремі SSH keys із `IdentitiesOnly=yes`.

### Навіщо це OpenChamber

- Push не використовує випадковий account із системного credential store.
- Credentials не потрапляють у URL, UI або logs.
- Поведінка однакова на web, desktop і remote server.
- Помилка credential повертається явно замість fallback на інший account.

## 3. Remote detection лише як підказка

### Проблема

За remote URL можна визначити provider, instance і repository. Але URL часто не містить інформації про конкретний account.

Наприклад, `https://github.com/company/app.git` не говорить, чи потрібно використати особистий, робочий або service account.

### Рішення

OpenChamber аналізує remotes і пропонує найбільш імовірний provider, instance та account. Це лише рекомендація. Якщо є кілька відповідних accounts, користувач має зробити явний вибір.

Unknown host не можна автоматично вважати GitHub. Він залишається unknown, доки OpenChamber не розпізнає provider або користувач не налаштує instance.

### Звідки взята ідея

GitLab Workflow для VS Code аналізує remotes та може вибрати GitLab account для workspace. Якщо remotes відповідають різним accounts, extension показує стан `Multiple GitLab Accounts` і просить користувача вибрати account.

### Навіщо це OpenChamber

- Початкове налаштування залишається швидким.
- OpenChamber не робить небезпечних припущень.
- Self-managed GitLab instances визначаються окремо від GitLab.com.
- Repository з кількома remotes не отримує випадковий primary provider.

## 4. Незмінний контекст операції

### Проблема

Network operation може тривати довго. Поки виконується push, clone або agent task, користувач може переключити runtime, видалити account або змінити project binding.

Якщо operation читає глобальний стан кілька разів, вона може початися в одному контексті, а завершитися в іншому.

### Рішення

Перед початком операції OpenChamber створює immutable operation plan.

```text
Operation: push
Runtime: office-mac
Repository: company/backend
Remote: origin
Branch: feature/login
Provider account: @boris-work
Transport credential: work-ssh-key
```

Усі етапи операції використовують цей plan. Зміни в Settings впливають лише на наступні operations.

### Звідки взята ідея

GitHub Copilot coding agent, Cursor Cloud Agents, Codex cloud та інші hosted agents створюють окреме task environment із зафіксованим repository, branch і credential context.

### Навіщо це OpenChamber

- Account не змінюється посеред push або sync.
- Runtime switch не переносить операцію на іншу машину.
- Background tasks мають передбачувану поведінку.
- Result може точно повідомити, який context був використаний.

## 5. Managed credential і System Git/SSH

### Проблема

Частина користувачів хоче, щоб OpenChamber сам керував account routing. Інші вже мають складний `.ssh/config`, hardware keys, enterprise credential helper або власний Git wrapper.

OpenChamber не повинен ламати системну конфігурацію. Водночас він не може обіцяти, що знає account, якщо credential вибирає зовнішня система.

### Рішення

Для Git transport доступні два явні режими.

#### Managed credential

OpenChamber вибирає конкретний HTTPS credential або SSH key. Account можна перевірити й показати в UI.

#### System Git/SSH

Git використовує системний credential helper, SSH config або agent. OpenChamber показує transport method, але позначає account як `unverified`.

### Звідки взята ідея

GitHub Desktop використовує керований AskPass. VS Code, JetBrains та local coding agents переважно використовують системний Git і його credential mechanisms.

Це не готова функція одного продукту. Це висновок із двох поширених моделей, який дозволяє OpenChamber підтримати обидві без неправдивих гарантій.

### Навіщо це OpenChamber

- Простий managed mode підходить більшості користувачів.
- Досвідчені користувачі зберігають власний SSH або enterprise setup.
- UI чесно показує, коли account підтверджений, а коли ні.
- OpenChamber не плутає системний transport із provider API account.

## 6. Repository-scoped credentials для agents

### Проблема

Agent може автономно запускати shell commands. Якщо передати йому повний GitHub або GitLab token користувача, він потенційно отримає доступ до інших private repositories, branches та provider resources.

Prompt injection або помилка в команді збільшують цей ризик.

### Рішення

Agent session отримує credential лише для потрібного repository. Якщо provider дозволяє, credential також обмежується task branch та потрібними permissions.

Agent не отримує raw token у prompt, renderer або звичайних environment variables. Git operations проходять через credential broker або контрольований Git tool.

### Звідки взята ідея

GitHub Copilot coding agent працює з одним repository та обмеженою agent branch. Cursor і Codex використовують repository-scoped app installations та ізольовані task environments.

### Навіщо це OpenChamber

- Компрометація однієї agent session не відкриває всі repositories користувача.
- Agent не може випадково push у сторонній repository.
- Permissions відповідають конкретному завданню.
- Local, remote і hosted execution можуть використовувати однакову policy.

## 7. Agent не approve або merge власний change request

### Проблема

Якщо agent створює зміни, перевіряє їх і сам виконує merge, одна помилка проходить увесь workflow без незалежного рішення.

### Рішення

Agent може створити branch, commits і pull або merge request. Approve та merge потребують окремої дії користувача або окремої явно дозволеної automation policy.

UI перед merge показує repository, target branch і provider account, від імені якого буде виконано дію.

### Звідки взята ідея

GitHub Copilot coding agent не може approve або merge створений ним pull request. Це відділяє підготовку змін від остаточного рішення про їх публікацію.

### Навіщо це OpenChamber

- Людина контролює незворотну дію.
- Agent не схвалює власну роботу.
- Помилковий account або target можна побачити до merge.
- Команди можуть додати власні approval policies.

## 8. Audit trail для source control operations

### Проблема

Коли операція виконана неправильним account або проти неправильного remote, без журналу важко зрозуміти, що сталося. Git history показує commit author, але не завжди показує credential, runtime або користувача, який запустив agent.

### Рішення

Для важливих operations OpenChamber записує несекретні metadata.

```text
Initiated by: Boris
Executed by: OpenChamber agent
Provider account: @boris-work
Transport credential: work-ssh-key
Repository: company/backend
Target: origin/feature-login
Runtime: office-mac
Result: succeeded
```

Tokens, private keys і credential payloads ніколи не потрапляють у журнал.

Поточний managed UI boundary записує лише server-owned `initiator: user`. Дії через звичайний terminal або agent shell позначаються `outside-managed-boundary` і не отримують verified initiator. Приклад із agent executor вище є цільовою моделлю після появи host-authenticated OpenCode capability; client-provided `initiator` не може замінити таку capability.

### Звідки взята ідея

Copilot додає session links до agent commits і використовує signed commits. Cursor також підписує commits cloud agents. GitHub Apps залишають події в provider audit log.

OpenChamber поєднує ці підходи з локальним operation log, бо одна система може виконувати дії на різних runtimes і providers.

### Навіщо це OpenChamber

- Користувач бачить, хто і куди виконав дію.
- Помилки account routing можна розслідувати.
- Команди отримують основу для security та compliance перевірок.
- Agent actions можна відрізнити від ручних user actions.

## Як це працюватиме разом

### Підключення accounts

У Settings користувач додає GitHub і GitLab accounts. Accounts групуються за provider та instance. Глобального стану `active` немає.

```text
GitHub
  github.com
    @boris-work
    @boris-personal

GitLab
  gitlab.company.com
    @boris
```

### Відкриття repository

OpenChamber аналізує remotes і пропонує provider account. Якщо відповідний account один, користувач підтверджує його. Якщо accounts кілька, користувач вибирає потрібний.

Вибір зберігається для repository і автоматично діє в усіх його worktrees.

### Щоденна робота

Git UI показує окремі identities.

```text
Provider: GitHub @boris-work
Push: Work SSH key
Author: Boris <boris@company.com>
Runs on: Office Mac
```

Користувач не перемикає account перед кожною дією. OpenChamber використовує repository binding.

### Важливі дії

Перед push, sync, створенням або merge change request UI показує account і точний target.

```text
Push feature/login to origin
Transport: Work SSH key
Expected account: @boris-work
Runs on: Office Mac
```

Якщо account видалений, token відкликаний або binding неоднозначний, OpenChamber зупиняє операцію. Він не переходить мовчки на інший account.

### Майбутній managed agent workflow

Після появи trusted OpenCode Git/process boundary на старті agent session OpenChamber фіксує repository, branch, runtime й обмежений credential. Agent може підготувати та опублікувати branch у межах дозволів. Merge залишається окремою user action.

Після завершення audit trail показує, хто запустив session, який agent працював і який account було використано.

## Критичні edge cases

Загальне правило: managed і provider API operations працюють fail-closed. `System Git/SSH` є явним винятком із неперевіреним account, а immutable snapshot не скасовує повторну перевірку target і доступу перед mutation.

| Сценарій | Мінімальне правило поведінки |
| --- | --- |
| Fetch і push використовують різні remotes | Sync показує обидва targets та передає кожен remote явно. Один remote не підставляється замість іншого. |
| Repository має `origin`, `upstream` і fork remotes | Provider і transport binding зберігаються окремо для кожного remote. Push target завжди видно до виконання. |
| Worktree відкритий із contributor PR | За замовчуванням push вимкнений. Користувач явно вибирає contributor fork, власний fork або інший remote. |
| Кілька worktrees ділять один Git config | Binding належить canonical Git common directory. Зміна remote в одному worktree не може непомітно перезаписати unmanaged remote для всіх. |
| Clone запускається до створення binding | Перед private clone користувач вибирає runtime і transport credential. Після clone OpenChamber окремо налаштовує provider account та commit identity. |
| Account видалений, token відкликаний, SSO втрачено | Binding переходить у стан `needs attention`. Network operations зупиняються без fallback на інший account. |
| Settings змінюються під час push або agent task | Поточна operation продовжує використовувати snapshot, узятий на старті, або явно завершується помилкою. Нові Settings діють лише для наступної operation. |
| Кілька operations стартують паралельно | Кожна має власний operation ID, credential snapshot, progress і cancellation. Їхні accounts та результати не змішуються. |
| Користувач переключив local або remote runtime | Binding і credentials повторно визначаються для нового runtime. Credentials іншої машини не вважаються доступними. |
| System Git/SSH має кілька accounts або keys | UI постійно показує `unverified`. Користувач підтверджує ризик при першому publish або після зміни config, а не перед кожним push. OpenChamber не називає неперевірений account. |
| SSH agent пропонує кілька keys | Managed mode використовує конкретний key fingerprint та `IdentitiesOnly=yes`. Невідомий key не приймається як fallback. |
| Submodule або Git LFS використовує інший host | OpenChamber визначає endpoint окремо та запитує binding. Credential батьківського repository не передається іншому host автоматично. |
| Remote URL містить username або token | Server повертає лише redacted URL. Secret не потрапляє в UI, logs, cache або audit trail. |
| Unknown або unsupported provider host | Host не класифікується як GitHub чи GitLab автоматично. Provider API functions вимкнені, звичайний System Git може працювати з попередженням. |
| Network operation зависла, скасована або частково виконана | Operation має timeout і cancellation. UI показує, які кроки завершилися, та не повідомляє success для неповного sync. |
| Branch не має upstream або repository у detached HEAD | Push вимкнений до явного вибору remote і branch. OpenChamber не використовує перший remote як fallback. |
| Provider API account і Git transport account різні | Різниця дозволена, але показується перед publishing action. OpenChamber не намагається мовчки зробити accounts однаковими. |
| Account змінено після заповнення merge або PR форми | Перед mutation server повторно перевіряє immutable `accountId`, repository access і operation revision. Stale form отримує conflict, а не виконується іншим account. |
| Cached PR, issue або CI data отримані іншим account | Cache key завжди містить runtime, provider, instance, account і repository. Response з іншого binding відкидається. |
| OAuth почався на одному runtime, а завершився після runtime switch | Flow прив'язаний до runtime, provider instance і одноразового state. Новий runtime ігнорує stale result, а credential зберігає лише runtime, що почав flow. |
| Remote URL, Git config або repository змінилися після preflight | Перед spawn server повторно звіряє repository identity, config revision і resolved target зі snapshot. При розбіжності operation зупиняється. |
| Git host перенаправляє request або credential helper запитує інший URL | Managed credential broker відповідає лише для точного protocol, host і дозволеного path. Redirect або host mismatch не отримує credential та завершує operation помилкою. |
| Mutation повторено після подвійного кліку, timeout або reconnect | Кожна mutation має idempotency key, прив'язаний до account, repository, target і revision. Повторний request повертає попередній result та не виконує дію вдруге. |

## Пріоритет впровадження

Детальний поетапний план, test matrix і release gates описані в [плані реалізації](./SOURCE_CONTROL_ACCOUNT_IMPLEMENTATION_PLAN.md).

1. Repository-level provider account binding.
2. Account-scoped provider requests і caches.
3. Immutable operation context.
4. Managed HTTPS та SSH credentials без ambient fallback.
5. Явне відображення provider, transport, author і runtime в UI.
6. Після появи trusted OpenCode boundary: repository-scoped credentials та merge restrictions для agents.
7. Audit trail, cancellation, submodule і Git LFS handling.

## Джерела

- [JetBrains: Set up a GitHub account](https://www.jetbrains.com/help/idea/set-up-a-github-account.html)
- [JetBrains: Set up a GitLab account](https://www.jetbrains.com/help/idea/set-up-a-gitlab-account.html)
- [Visual Studio: Work with GitHub accounts](https://learn.microsoft.com/en-us/visualstudio/ide/work-with-github-accounts?view=vs-2022)
- [Visual Studio: Multi-repository support](https://learn.microsoft.com/en-us/visualstudio/version-control/git-multi-repository-support?view=vs-2022)
- [VS Code: Multiple GitHub accounts](https://code.visualstudio.com/updates/v1_95#_multiple-github-accounts)
- [GitLab Workflow for VS Code](https://docs.gitlab.com/editor_extensions/visual_studio_code/)
- [GitHub Desktop: Authentication](https://docs.github.com/en/desktop/installing-and-authenticating-to-github-desktop/authenticating-to-github-in-github-desktop)
- [GitHub Desktop trampoline](https://github.com/desktop/desktop/blob/development/vendor/desktop-trampoline/README.md)
- [GitHub: Managing multiple accounts](https://docs.github.com/en/account-and-profile/how-tos/account-management/managing-multiple-accounts)
- [GitHub Copilot coding agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [Cursor Cloud Agents](https://cursor.com/docs/cloud-agent)
- [OpenAI Codex cloud](https://developers.openai.com/codex/cloud)
