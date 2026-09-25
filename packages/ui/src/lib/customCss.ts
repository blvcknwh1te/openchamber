import { z } from 'zod';
import { getVSCodeBootstrapConfig } from './vscodeBootstrap';

/**
 * Default content written when the user-level `custom.css` is created or reset.
 *
 * The extension host owns the file location and writes whatever the Settings
 * actions send, so this constant is the single source of truth for the template
 * and stays byte-compatible with the sample shipped in
 * `config/openchamber/custom.css` (comments stay Russian there and here).
 *
 * Only variables that components actually read belong here; see
 * `--chat-inline-pad` (horizontal chat padding) and `--chat-user-row-bg`
 * (user message row background).
 */
export const DEFAULT_CUSTOM_CSS = `/*
  Пользовательский CSS OpenChamber (VS Code webview).
  Только реально потребляемые переменные (проверено по компонентам):
  правки применяются на лету watcher'ом, либо Reload Window / кнопка refresh.
*/
:root {
  /* Горизонтальный отступ колонок чата (сообщения / инпут / контейнер) */
  --chat-inline-pad: 2.75em !important;

  /* Фон приложения и карточки пользовательского сообщения (единая переменная) */
  --background: #131516 !important;
  --chat-user-message-bg: #2a2a2b !important;

  /* Строка пользовательского сообщения (класс chat-user-row) */
  --chat-user-row-bg: #2a2a2b !important;

  /* Основной текст (ответы ассистента и текст сообщений идут от него) */
  --foreground: #f0f0f0 !important;

  /* Вторичный текст: таймстампы, подписи, мета */
  --muted-foreground: #8c8c8c !important;
  --surface-muted-foreground: #8c8c8c !important;

  /* Tool-строки и thinking: заголовок / описание / иконка */
  --tools-title: #a6a6a6 !important;
  --tools-description: #757575 !important;
  --tools-icon: #757575 !important;

  /* Разделители (в т.ч. перед итогом хода) */
  --chat-divider: #2a2a2c !important;

  /* Markdown-заголовки в тексте ответов */
  --markdown-heading1: #ffffff !important;
  --markdown-heading2: #f2f2f2 !important;
  --markdown-heading3: #e6e6e6 !important;
}
`;

/**
 * Схема границы для единственного поля bootstrap-конфига, которое принадлежит
 * этому модулю. Хост вкладывает `customCssPath` в HTML webview как JSON-строку
 * (`webviewHtml.ts`), но сам bootstrap-объект — недоверенный вход, поэтому поле
 * разбирается здесь, на границе, в доменный `CustomCssPath`. Значение
 * сохраняется дословно: отклоняется только путь из одних пробелов.
 */
const injectedCustomCssPathSchema = z.object({
  customCssPath: z.string().refine((value) => value.trim().length > 0),
});

/** Абсолютный путь пользовательского `custom.css`, который сообщил хост. */
type CustomCssPath = z.infer<typeof injectedCustomCssPathSchema>['customCssPath'];

/**
 * Разобранный путь `custom.css`, либо null на рантаймах, где такого файла нет
 * (расположение знает только хост).
 */
export const getCustomCssPath = (): CustomCssPath | null => {
  const decoded = injectedCustomCssPathSchema.safeParse(getVSCodeBootstrapConfig());
  return decoded.success ? decoded.data.customCssPath : null;
};
