import { describe, expect, test } from 'bun:test';
import type { I18nKey } from '@/lib/i18n/store';
import { buildSettingsSearchResults } from './search';

const t = (key: I18nKey): string => key;

const runtimeCtx = {
  isVSCode: false,
  isWeb: true,
  isDesktop: false,
  isMobile: false,
  isDesktopLocalOrigin: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isWindowsArm64: false,
};

describe('settings search', () => {
  test('finds the Claude Code third-party integration', () => {
    const results = buildSettingsSearchResults({
      query: 'claude',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.third-party.opencode-claude')).toBe(true);
  });

  test('finds third-party integrations by OpenChamber npm package names', () => {
    const results = buildSettingsSearchResults({
      query: '@openchamber/opencode-cursor',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.third-party.opencode-cursor-oauth')).toBe(true);
  });

  test('keeps repository controls out of Settings search and indexes account connection controls', () => {
    const results = buildSettingsSearchResults({
      query: 'source control account',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'git.source-control-account')).toBe(false);
    expect(results.some((result) => result.id.includes('github.com#'))).toBe(false);

    const connectResults = buildSettingsSearchResults({
      query: 'connect account',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });
    expect(connectResults.some((result) => result.id === 'git.github-connect')).toBe(true);
    expect(connectResults.some((result) => result.id === 'git.gitlab-connect')).toBe(true);
  });

  test('keeps repository transport and provider controls out of VS Code Settings search', () => {
    const vscodeCtx = { ...runtimeCtx, isVSCode: true, isWeb: false };
    const transportResults = buildSettingsSearchResults({
      query: 'transport',
      runtimeCtx: vscodeCtx,
      t,
      getPageTitle: (page) => page,
    });
    const accountResults = buildSettingsSearchResults({
      query: 'account',
      runtimeCtx: vscodeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(transportResults.some((result) => result.id === 'git.repository-transport')).toBe(false);
    expect(accountResults.some((result) => result.id === 'git.github-account')).toBe(false);
    expect(accountResults.some((result) => result.id === 'git.gitlab-account')).toBe(false);
  });
});
