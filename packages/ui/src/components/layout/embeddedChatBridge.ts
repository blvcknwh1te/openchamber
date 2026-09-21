import { getRuntimeBearerTokenSync, getRuntimeExtraHeadersSync } from '@/lib/runtime-auth';
import { getRuntimeApiBaseUrl, getRuntimeKey } from '@/lib/runtime-switch';
import { getActiveRelayDescriptor } from '@/lib/relay/runtime-tunnel';
import type { ThemeMode } from '@/types/theme';

import {
  EMBEDDED_RUNTIME_BOOTSTRAP_REQUEST,
  EMBEDDED_RUNTIME_BOOTSTRAP_RESPONSE,
  EMBEDDED_VISIBILITY_REQUEST,
  EMBEDDED_VISIBILITY_UPDATE,
  type EmbeddedSessionChatSettingsBootstrap,
  type EmbeddedSessionChatThemeBootstrap,
  type EmbeddedSessionRuntimeBootstrap,
} from './contextPanelEmbeddedChat';

/**
 * Parent side of the embedded session-chat protocol. Any surface can host a
 * session chat iframe (the context panel docks several, the subtask dialog
 * shows one); they all have to answer the same handshake, so the message shapes
 * and the responder live here instead of being copied per host.
 */

export const EMBEDDED_THEME_SYNC = 'openchamber:theme-sync';
export const EMBEDDED_THEME_SYNC_REQUEST = 'openchamber:theme-sync-request';
export const EMBEDDED_CHAT_SETTINGS_SYNC = 'openchamber:chat-settings-sync';
export const EMBEDDED_CHAT_SETTINGS_REQUEST = 'openchamber:chat-settings-request';
export const EMBEDDED_CYCLE_THEME_REQUEST = 'openchamber:cycle-theme-request';

/** Frames a host currently has mounted, keyed by a host-local frame id. */
export type EmbeddedChatFrames = ReadonlyMap<string, HTMLIFrameElement>;

export const postToEmbeddedChatFrames = (
  frames: EmbeddedChatFrames,
  message: unknown,
  targetOrigin?: string,
): void => {
  const origin = targetOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  for (const frame of frames.values()) {
    frame.contentWindow?.postMessage(message, origin);
  }
};

export const buildEmbeddedThemeSyncMessage = (theme: EmbeddedSessionChatThemeBootstrap) => ({
  type: EMBEDDED_THEME_SYNC,
  payload: {
    themeMode: theme.mode,
    lightThemeId: theme.lightThemeId,
    darkThemeId: theme.darkThemeId,
    currentTheme: theme.currentTheme,
  },
});

export const buildEmbeddedChatSettingsSyncMessage = (
  settings: EmbeddedSessionChatSettingsBootstrap,
) => ({
  type: EMBEDDED_CHAT_SETTINGS_SYNC,
  payload: settings,
});

export const buildEmbeddedVisibilityMessage = (visible: boolean) => ({
  type: EMBEDDED_VISIBILITY_UPDATE,
  payload: { visible },
});

/** Order the in-chat theme toggle cycles through. */
export const EMBEDDED_CHAT_THEME_MODE_ORDER: readonly ThemeMode[] = ['light', 'dark', 'system'];

export const getNextEmbeddedChatThemeMode = (current: ThemeMode): ThemeMode => {
  const index = EMBEDDED_CHAT_THEME_MODE_ORDER.indexOf(current);
  return EMBEDDED_CHAT_THEME_MODE_ORDER[(index + 1) % EMBEDDED_CHAT_THEME_MODE_ORDER.length];
};

export const buildEmbeddedRuntimeBootstrap = (): EmbeddedSessionRuntimeBootstrap => {
  const runtimeKey = getRuntimeKey();
  return {
    apiBaseUrl: getRuntimeApiBaseUrl(),
    clientToken: getRuntimeBearerTokenSync(),
    localOrigin: typeof window !== 'undefined' && typeof window.__OPENCHAMBER_LOCAL_ORIGIN__ === 'string'
      ? window.__OPENCHAMBER_LOCAL_ORIGIN__
      : '',
    runtimeHeaders: getRuntimeExtraHeadersSync(),
    relayHostId: runtimeKey.startsWith('host:') ? runtimeKey.slice('host:'.length) : '',
    relay: getActiveRelayDescriptor() ?? undefined,
  };
};

export interface EmbeddedChatFrameMessageContext {
  data: unknown;
  sourceWindow: WindowProxy | null;
  origin: string;
  frames: EmbeddedChatFrames;
  /** Frame key the host currently shows; every other frame reports hidden. */
  visibleFrameKey: string | null;
  theme: EmbeddedSessionChatThemeBootstrap;
  settings: EmbeddedSessionChatSettingsBootstrap;
  onCycleTheme: () => void;
}

/**
 * Answers a `message` event from an embedded session chat. Messages from frames
 * the host does not own are ignored, so a page can host several hosts without
 * them answering each other's iframes.
 */
export const handleEmbeddedChatFrameMessage = (context: EmbeddedChatFrameMessageContext): void => {
  const { data, sourceWindow, origin, frames, visibleFrameKey, theme, settings, onCycleTheme } = context;
  const sourceFrame = Array.from(frames.entries()).find(([, frame]) => frame.contentWindow === sourceWindow);
  if (!sourceFrame || !sourceWindow) {
    return;
  }

  const message = data as { type?: unknown; requestId?: unknown } | null;
  const type = message?.type;

  if (type === EMBEDDED_VISIBILITY_REQUEST) {
    sourceWindow.postMessage(buildEmbeddedVisibilityMessage(sourceFrame[0] === visibleFrameKey), origin);
    return;
  }

  if (type === EMBEDDED_RUNTIME_BOOTSTRAP_REQUEST) {
    if (typeof message?.requestId !== 'string' || !message.requestId) {
      return;
    }

    sourceWindow.postMessage({
      type: EMBEDDED_RUNTIME_BOOTSTRAP_RESPONSE,
      requestId: message.requestId,
      payload: buildEmbeddedRuntimeBootstrap(),
    }, origin);
    return;
  }

  if (type === EMBEDDED_THEME_SYNC_REQUEST) {
    postToEmbeddedChatFrames(frames, buildEmbeddedThemeSyncMessage(theme), origin);
    return;
  }

  if (type === EMBEDDED_CHAT_SETTINGS_REQUEST) {
    postToEmbeddedChatFrames(frames, buildEmbeddedChatSettingsSyncMessage(settings), origin);
    return;
  }

  if (type === EMBEDDED_CYCLE_THEME_REQUEST) {
    onCycleTheme();
  }
};
