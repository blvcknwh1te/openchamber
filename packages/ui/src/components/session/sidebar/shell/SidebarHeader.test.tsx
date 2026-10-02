import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

// The keys are asserted as-is, so the test does not depend on any locale file.
mock.module('@/lib/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Radix needs a portal host and a real overlay stack; the buttons under test only
// render inside the trigger, so the wrappers are reduced to plain markup.
mock.module('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
}));

const { SidebarHeader } = await import('./SidebarHeader');

const COLLAPSE_ALL_LABEL = 'sessions.sidebar.header.displayMode.collapseAll';
const EXPAND_ALL_LABEL = 'sessions.sidebar.header.displayMode.expandAll';

describe('SidebarHeader collapse controls', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;
  let collapseAllCalls: number;
  let expandAllCalls: number;

  beforeEach(() => {
    windowInstance = new Window({ url: 'http://localhost/' });
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
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    collapseAllCalls = 0;
    expandAllCalls = 0;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await windowInstance.happyDOM.close();
  });

  const render = async (showProjectDisplayControls: boolean) => {
    await act(async () => {
      root.render(
        <SidebarHeader
          hideDirectoryControls={false}
          showProjectDisplayControls={showProjectDisplayControls}
          showRecentControls={showProjectDisplayControls}
          handleOpenDirectoryDialog={() => {}}
          onOpenScheduled={() => {}}
          onOpenMultiRun={() => {}}
          canOpenMultiRun
          onOpenArchive={() => {}}
          headerActionIconClass="h-4.5 w-4.5"
          headerActionButtonClass="h-6 w-6"
          isSessionSearchOpen={false}
          setIsSessionSearchOpen={() => {}}
          sessionSearchInputRef={React.createRef<HTMLInputElement>()}
          sessionSearchQuery=""
          setSessionSearchQuery={() => {}}
          hasSessionSearchQuery={false}
          searchMatchCount={0}
          collapseAllProjects={() => { collapseAllCalls += 1; }}
          expandAllProjects={() => { expandAllCalls += 1; }}
        />,
      );
    });
  };

  const buttonByLabel = (label: string) => {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`button "${label}" was not rendered`);
    return button;
  };

  const click = async (element: Element) => {
    await act(async () => {
      // happy-dom's MouseEvent is not the global DOM type, and dispatching only
      // needs the event shape.
      element.dispatchEvent(new windowInstance.MouseEvent('click', { bubbles: true }) as unknown as Event);
    });
  };

  // The compact VS Code sidebar renders no display-mode menu, which is exactly
  // why the controls must live in the toolbar itself.
  test('offers both controls without the display-mode menu', async () => {
    await render(false);

    expect(buttonByLabel(COLLAPSE_ALL_LABEL)).toBeTruthy();
    expect(buttonByLabel(EXPAND_ALL_LABEL)).toBeTruthy();
  });

  test('offers them in the desktop toolbar too', async () => {
    await render(true);

    expect(buttonByLabel(COLLAPSE_ALL_LABEL)).toBeTruthy();
    expect(buttonByLabel(EXPAND_ALL_LABEL)).toBeTruthy();
  });

  test('calls each action from its own button', async () => {
    await render(false);

    await click(buttonByLabel(COLLAPSE_ALL_LABEL));
    expect(collapseAllCalls).toBe(1);
    expect(expandAllCalls).toBe(0);

    await click(buttonByLabel(EXPAND_ALL_LABEL));
    expect(collapseAllCalls).toBe(1);
    expect(expandAllCalls).toBe(1);
  });
});
