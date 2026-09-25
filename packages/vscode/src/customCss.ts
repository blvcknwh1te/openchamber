import * as fs from 'fs';
import * as vscode from 'vscode';
import { OPENCHAMBER_CUSTOM_CSS_PATH, OPENCHAMBER_USER_CONFIG_DIR } from './customAssetsPaths';

// [OC-PATCH: custom-css] Действиями в настройках общего UI управляют эти
// команды. Текст шаблона принадлежит UI (`packages/ui/src/lib/customCss.ts`),
// хост решает только, куда его положить — это тот же файл, который читают
// HTML-инъекция webview и живой watcher. Аргумент приходит из webview строкой
// (контракт `packages/ui/src/lib/api/types.ts`), поэтому хост разбирает его на
// этой границе в доменный `CustomCssTemplate`: пустой шаблон и шаблон больше
// лимита отбрасываются целиком, так что сломанный мост не может записать в
// файл то, чего пользователь не присылал.
/** Совпадает с лимитом читателя в `webviewHtml.ts`. */
const MAX_CUSTOM_CSS_BYTES = 512 * 1024;

/** Аргумент команд custom.css: текст шаблона, который прислал общий UI. */
export type CustomCssTemplateArgument = string;

/**
 * Проверенный текст шаблона: непустой и не больше лимита читателя. Значение
 * этого типа создаёт только `decodeCustomCssTemplate`, поэтому писатели ниже
 * больше не проверяют сырой аргумент.
 */
export type CustomCssTemplate = string;

/**
 * Разбирает аргумент команды на границе ввода-вывода. Отсутствующий, пустой
 * или превышающий лимит шаблон отбрасывается как невалидный; строковое
 * представление задаёт контракт моста (`template: string`), поэтому здесь
 * разбирается содержимое, а не представление.
 */
export const decodeCustomCssTemplate = (
  argument: CustomCssTemplateArgument | undefined,
): CustomCssTemplate | null => {
  if (argument === undefined) {
    return null;
  }
  if (argument.trim().length === 0 || Buffer.byteLength(argument, 'utf8') > MAX_CUSTOM_CSS_BYTES) {
    return null;
  }
  return argument;
};

/** Разобранный аргумент команды либо доменная ошибка «шаблон не прислан». */
const requireCustomCssTemplate = (argument: CustomCssTemplateArgument | undefined): CustomCssTemplate => {
  const template = decodeCustomCssTemplate(argument);
  if (template === null) {
    throw new Error('custom.css template is required');
  }
  return template;
};

/** Create `custom.css` from `template` when it is missing, then reveal it in the editor. */
export const openCustomCssInEditor = async (template: CustomCssTemplate): Promise<void> => {
  fs.mkdirSync(OPENCHAMBER_USER_CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(OPENCHAMBER_CUSTOM_CSS_PATH)) {
    fs.writeFileSync(OPENCHAMBER_CUSTOM_CSS_PATH, template, 'utf8');
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(OPENCHAMBER_CUSTOM_CSS_PATH));
  await vscode.window.showTextDocument(document, { preview: false });
};

/** Overwrite `custom.css` with `template`, discarding the user's edits. */
export const resetCustomCssFile = async (template: CustomCssTemplate): Promise<void> => {
  fs.mkdirSync(OPENCHAMBER_USER_CONFIG_DIR, { recursive: true });
  await fs.promises.writeFile(OPENCHAMBER_CUSTOM_CSS_PATH, template, 'utf8');
};

export const registerCustomCssCommands = (context: vscode.ExtensionContext): void => {
  context.subscriptions.push(
    vscode.commands.registerCommand('openchamberBnw.openCustomCss', async (argument: CustomCssTemplateArgument | undefined) => {
      await openCustomCssInEditor(requireCustomCssTemplate(argument));
    }),
    vscode.commands.registerCommand('openchamberBnw.resetCustomCss', async (argument: CustomCssTemplateArgument | undefined) => {
      await resetCustomCssFile(requireCustomCssTemplate(argument));
    }),
  );
};
