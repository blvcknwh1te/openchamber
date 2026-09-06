import { isDesktopShell, isVSCodeRuntime } from '@/lib/desktop';
import { isCapacitorApp } from '@/lib/platform';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import type { SettingsSurface } from './registry';

/** The request header that tells the server which surface kind a client is. */
export const SETTINGS_SURFACE_HEADER = 'x-openchamber-surface';

/**
 * Which surface kind this client is, for the registry's per-surface profile
 * fields: a change made here is stored for this kind only. The phone app and
 * the hosted mobile shell are one kind — both are "the phone" to the user.
 */
export const getSettingsSurface = (): SettingsSurface => {
  try {
    if (isVSCodeRuntime()) return 'vscode';
    if (isDesktopShell()) return 'desktop';
    if (isCapacitorApp() || isMobileSurfaceRuntime()) return 'mobile';
  } catch {
    // The detectors read `window.location` and friends; outside a real
    // browser document (tests, SSR-like shells) the plain web kind applies.
  }
  return 'web';
};
