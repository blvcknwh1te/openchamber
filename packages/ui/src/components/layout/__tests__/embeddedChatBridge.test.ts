/**
 * The embedded session chat protocol is shared by the context panel tabs and
 * the subtask dialog, so the responder is covered directly instead of through
 * either host.
 */
import { describe, expect, test } from 'bun:test';

import {
  EMBEDDED_CHAT_SETTINGS_REQUEST,
  EMBEDDED_CYCLE_THEME_REQUEST,
  EMBEDDED_THEME_SYNC_REQUEST,
  buildEmbeddedThemeSyncMessage,
  buildEmbeddedVisibilityMessage,
  getNextEmbeddedChatThemeMode,
  handleEmbeddedChatFrameMessage,
} from '../embeddedChatBridge';
import {
  EMBEDDED_RUNTIME_BOOTSTRAP_REQUEST,
  EMBEDDED_RUNTIME_BOOTSTRAP_RESPONSE,
  EMBEDDED_VISIBILITY_REQUEST,
  EMBEDDED_VISIBILITY_UPDATE,
} from '../contextPanelEmbeddedChat';
import { getDefaultTheme } from '@/lib/theme/themes';

const ORIGIN = 'http://127.0.0.1:3000';

type PostedMessage = { target: FakeWindow; message: Record<string, unknown>; origin: string };

class FakeWindow {
  readonly posts: PostedMessage[] = [];
  readonly postMessage = (message: unknown, origin: string) => {
    this.posts.push({ target: this, message: message as Record<string, unknown>, origin });
  };
}

const createFrame = (frameWindow: FakeWindow) => ({ contentWindow: frameWindow }) as unknown as HTMLIFrameElement;

const buildContext = (options: {
  frames: Map<string, HTMLIFrameElement>;
  source: FakeWindow;
  visibleFrameKey?: string | null;
  onCycleTheme?: () => void;
}) => ({
  data: undefined as unknown,
  sourceWindow: options.source as unknown as WindowProxy,
  origin: ORIGIN,
  frames: options.frames,
  visibleFrameKey: options.visibleFrameKey ?? null,
  theme: { mode: 'dark' as const, lightThemeId: 'light', darkThemeId: 'dark', currentTheme: getDefaultTheme(true) },
  settings: { allowPromptingSubagentSessions: false },
  onCycleTheme: options.onCycleTheme ?? (() => undefined),
});

describe('embedded chat frame bridge', () => {
  test('reports the requesting frame as visible only when it is the visible one', () => {
    const visible = new FakeWindow();
    const hidden = new FakeWindow();
    const frames = new Map([
      ['tab-a', createFrame(visible)],
      ['tab-b', createFrame(hidden)],
    ]);

    handleEmbeddedChatFrameMessage({
      ...buildContext({ frames, source: visible, visibleFrameKey: 'tab-a' }),
      data: { type: EMBEDDED_VISIBILITY_REQUEST },
    });
    handleEmbeddedChatFrameMessage({
      ...buildContext({ frames, source: hidden, visibleFrameKey: 'tab-a' }),
      data: { type: EMBEDDED_VISIBILITY_REQUEST },
    });

    expect(visible.posts).toEqual([{ target: visible, message: buildEmbeddedVisibilityMessage(true), origin: ORIGIN }]);
    expect(hidden.posts).toEqual([{ target: hidden, message: buildEmbeddedVisibilityMessage(false), origin: ORIGIN }]);
    expect(buildEmbeddedVisibilityMessage(true).type).toBe(EMBEDDED_VISIBILITY_UPDATE);
  });

  test('ignores messages from windows the host does not own', () => {
    const owned = new FakeWindow();
    const stranger = new FakeWindow();
    const frames = new Map([['tab-a', createFrame(owned)]]);

    handleEmbeddedChatFrameMessage({
      ...buildContext({ frames, source: stranger, visibleFrameKey: 'tab-a' }),
      data: { type: EMBEDDED_VISIBILITY_REQUEST },
    });

    expect(owned.posts).toHaveLength(0);
    expect(stranger.posts).toHaveLength(0);
  });

  test('answers the runtime bootstrap request with the active runtime payload', () => {
    const frame = new FakeWindow();
    const frames = new Map([['tab-a', createFrame(frame)]]);

    handleEmbeddedChatFrameMessage({
      ...buildContext({ frames, source: frame }),
      data: { type: EMBEDDED_RUNTIME_BOOTSTRAP_REQUEST, requestId: 'request-1' },
    });

    expect(frame.posts).toHaveLength(1);
    expect(frame.posts[0].message.type).toBe(EMBEDDED_RUNTIME_BOOTSTRAP_RESPONSE);
    expect(frame.posts[0].message.requestId).toBe('request-1');
    expect(frame.posts[0].origin).toBe(ORIGIN);
  });

  test('skips the bootstrap request that carries no request id', () => {
    const frame = new FakeWindow();
    const frames = new Map([['tab-a', createFrame(frame)]]);

    handleEmbeddedChatFrameMessage({
      ...buildContext({ frames, source: frame }),
      data: { type: EMBEDDED_RUNTIME_BOOTSTRAP_REQUEST },
    });

    expect(frame.posts).toHaveLength(0);
  });

  test('broadcasts theme and settings to every hosted frame on request', () => {
    const first = new FakeWindow();
    const second = new FakeWindow();
    const frames = new Map([
      ['tab-a', createFrame(first)],
      ['tab-b', createFrame(second)],
    ]);
    const context = buildContext({ frames, source: first });
    const themeMessage = buildEmbeddedThemeSyncMessage(context.theme);

    handleEmbeddedChatFrameMessage({ ...context, data: { type: EMBEDDED_THEME_SYNC_REQUEST } });
    handleEmbeddedChatFrameMessage({ ...context, data: { type: EMBEDDED_CHAT_SETTINGS_REQUEST } });

    expect(first.posts.map((post) => post.message.type)).toEqual(['openchamber:theme-sync', 'openchamber:chat-settings-sync']);
    expect(second.posts.map((post) => post.message.type)).toEqual(['openchamber:theme-sync', 'openchamber:chat-settings-sync']);
    expect(first.posts[0].message).toEqual(themeMessage);
  });

  test('cycles the theme in the fixed order on request', () => {
    const frame = new FakeWindow();
    const frames = new Map([['tab-a', createFrame(frame)]]);
    let cycles = 0;

    handleEmbeddedChatFrameMessage({
      ...buildContext({ frames, source: frame, onCycleTheme: () => { cycles += 1; } }),
      data: { type: EMBEDDED_CYCLE_THEME_REQUEST },
    });

    expect(cycles).toBe(1);
    expect(getNextEmbeddedChatThemeMode('light')).toBe('dark');
    expect(getNextEmbeddedChatThemeMode('dark')).toBe('system');
    expect(getNextEmbeddedChatThemeMode('system')).toBe('light');
  });
});
