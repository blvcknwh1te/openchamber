import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { DEFAULT_CUSTOM_CSS, getCustomCssPath } from './customCss';
import type { VSCodeBootstrapConfig } from './vscodeBootstrap';

/**
 * The sample the repository ships at `config/openchamber/custom.css` documents
 * the fork's defaults; the template written into the user's file has to keep
 * covering it so a fresh install and the documented sample agree.
 */
const SHIPPED_SAMPLE_URL = new URL('../../../../config/openchamber/custom.css', import.meta.url);

const declaredProperties = (css: string): Map<string, string> => {
  const declarations = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
};

/**
 * `getCustomCssPath` читает путь только из глобального `window` (см.
 * `vscodeBootstrap.ts`), поэтому тест подставляет bootstrap-конфиг на время
 * проверки и убирает его сразу после, как это делал прежний тест.
 */
const withInjectedBootstrap = <Result>(bootstrap: VSCodeBootstrapConfig, run: () => Result): Result => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __VSCODE_CONFIG__: bootstrap },
  });
  try {
    return run();
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
};

describe('default custom.css template', () => {
  test('keeps the fork default horizontal chat padding', () => {
    expect(declaredProperties(DEFAULT_CUSTOM_CSS).get('--chat-inline-pad')).toBe('2.75em !important');
  });

  test('documents the user message row background variable', () => {
    expect(declaredProperties(DEFAULT_CUSTOM_CSS).has('--chat-user-row-bg')).toBe(true);
  });

  test('covers every variable the shipped sample sets, with the same values', () => {
    const sample = declaredProperties(readFileSync(SHIPPED_SAMPLE_URL, 'utf8'));
    const template = declaredProperties(DEFAULT_CUSTOM_CSS);

    expect(sample.size).toBeGreaterThan(0);
    for (const [name, value] of sample) {
      expect(template.get(name)).toBe(value);
    }
  });

  test('keeps its comments in Russian, like the shipped sample', () => {
    expect(/[\u0400-\u04FF]/.test(DEFAULT_CUSTOM_CSS)).toBe(true);
  });
});

describe('resolved custom.css path', () => {
  test('is unknown outside the VS Code webview', () => {
    expect(getCustomCssPath()).toBeNull();
  });

  test('reads the path the extension host injects', () => {
    const hostPath = '/home/user/.config/openchamber/custom.css';
    expect(withInjectedBootstrap({ customCssPath: hostPath }, getCustomCssPath)).toBe(hostPath);
  });

  test('rejects an injected path that is only whitespace', () => {
    expect(withInjectedBootstrap({ customCssPath: '   ' }, getCustomCssPath)).toBeNull();
  });

  test('rejects an injected path that is not a string', () => {
    expect(withInjectedBootstrap({ customCssPath: 42 }, getCustomCssPath)).toBeNull();
  });
});
