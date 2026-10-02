import { describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

mock.module('@/contexts/useThemeSystem', () => ({
  useThemeSystem: () => ({
    currentTheme: {
      metadata: { variant: 'dark' },
      colors: { surface: { foreground: '#ffffff' } },
    },
  }),
}));

const { ProjectHeaderIdentity } = await import('./sortableItems');

const renderIdentity = async (isActiveProject: boolean): Promise<string> => {
  const windowInstance = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: windowInstance,
    document: windowInstance.document,
    navigator: windowInstance.navigator,
    Node: windowInstance.Node,
    Element: windowInstance.Element,
    HTMLElement: windowInstance.HTMLElement,
    Event: windowInstance.Event,
    MouseEvent: windowInstance.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <ProjectHeaderIdentity id="project-a" projectLabel="project" isActiveProject={isActiveProject} />,
      );
    });
    return host.innerHTML;
  } finally {
    await act(async () => root.unmount());
  }
};

describe('ProjectHeaderIdentity active project marker', () => {
  test('marks the active project label and adds the accent bar', async () => {
    const markup = await renderIdentity(true);
    expect(markup).toContain('data-active-project="true"');
    expect(markup).toContain('data-active-project-marker="true"');
    expect(markup).toContain('text-primary');
  });

  test('leaves an inactive project unmarked and on the default label color', async () => {
    const markup = await renderIdentity(false);
    expect(markup).not.toContain('data-active-project=');
    expect(markup).not.toContain('data-active-project-marker');
    expect(markup).toContain('text-foreground');
    expect(markup).not.toContain('text-primary');
  });
});
