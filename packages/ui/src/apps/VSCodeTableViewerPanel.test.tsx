import React, { act } from 'react';
import { describe, expect, test } from 'bun:test';
import { plugin } from 'bun';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { createRoot } from 'react-dom/client';

// Bun does not implement Vite's asset-query imports; keep the real asset URL so
// the markdown renderer and its worker client stay untouched.
plugin({
  name: 'table-panel-worker-url',
  setup(build) {
    build.onLoad({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(pathToFileURL(path.split('?')[0]).href)};`,
      loader: 'js',
    }));
  },
});

const { I18nProvider } = await import('@/lib/i18n');
const { VSCodeTableViewerPanel } = await import('./VSCodeTableViewerPanel');

// The panel renders host-supplied markdown only, so it never reads files; the
// files API still needs to exist because the runtime provider wraps it. That
// provider spreads the whole api object, so every key has to be a real value
// instead of a throwing getter.
const runtimeApis = {
  runtime: { platform: 'web', isDesktop: false, isVSCode: true },
  files: {
    listDirectory: async () => { throw new Error('the table panel must not list directories'); },
    search: async () => { throw new Error('the table panel must not search files'); },
    createDirectory: async () => { throw new Error('the table panel must not create directories'); },
  },
  terminal: {},
  git: {},
  settings: {},
  permissions: {},
  notifications: {},
  tools: {},
  vscode: {},
} as unknown as Parameters<typeof VSCodeTableViewerPanel>[0]['apis'];

const TABLE = ['| one | two |', '| --- | --- |', '| 1 | 2 |'].join('\n');

const DOM_GLOBAL_NAMES = [
  'window', 'document', 'navigator', 'localStorage', 'customElements',
  'Node', 'NodeList', 'Element', 'HTMLElement', 'SVGElement', 'HTMLAnchorElement',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'ResizeObserver', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT',
] as const;

describe('VSCodeTableViewerPanel', () => {
  test('renders the host markdown table without hitting the error boundary', async () => {
    const windowInstance = new Window({ url: 'https://localhost/' });
    const savedGlobals: Record<string, unknown> = {};
    for (const name of DOM_GLOBAL_NAMES) {
      savedGlobals[name] = (globalThis as Record<string, unknown>)[name];
      (globalThis as Record<string, unknown>)[name] =
        (windowInstance as unknown as Record<string, unknown>)[name] ?? true;
    }
    (globalThis as Record<string, unknown>).window = windowInstance;
    (globalThis as Record<string, unknown>).document = windowInstance.document;
    (windowInstance as unknown as Record<string, unknown>).__OPENCHAMBER_TABLE_MARKDOWN__ = TABLE;

    const originalConsoleError = console.error;
    const consoleErrors: string[] = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(
        args
          .map((value) => (value instanceof Error ? value.stack ?? value.message : String(value)))
          .join(' '),
      );
    };

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <I18nProvider>
            <VSCodeTableViewerPanel apis={runtimeApis} />
          </I18nProvider>,
        );
      });

      expect(consoleErrors).toEqual([]);
      expect(container.querySelector('table')).not.toBeNull();
    } finally {
      console.error = originalConsoleError;
      await act(async () => root.unmount());
      container.remove();
      for (const name of DOM_GLOBAL_NAMES) {
        (globalThis as Record<string, unknown>)[name] = savedGlobals[name];
      }
      await windowInstance.happyDOM.close();
    }
  });
});
