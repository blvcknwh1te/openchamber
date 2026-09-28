import { describe, expect, test } from 'bun:test';

const { resolveMobileBackAction } = await import('./settingsMobileBack');

describe('resolveMobileBackAction', () => {
  test('hides the control outside the mobile layout', () => {
    expect(resolveMobileBackAction({ isMobile: false, stage: 'nav', canClose: true })).toBe('hidden');
    expect(resolveMobileBackAction({ isMobile: false, stage: 'page-content', canClose: true })).toBe('hidden');
  });

  test('steps one level up from a Settings subpage', () => {
    expect(resolveMobileBackAction({ isMobile: true, stage: 'page-sidebar', canClose: true })).toBe('previous');
    expect(resolveMobileBackAction({ isMobile: true, stage: 'page-content', canClose: true })).toBe('previous');
    expect(resolveMobileBackAction({ isMobile: true, stage: 'page-content', canClose: false })).toBe('previous');
  });

  test('closes Settings from the root when a close handler exists', () => {
    expect(resolveMobileBackAction({ isMobile: true, stage: 'nav', canClose: true })).toBe('close');
  });

  test('renders nothing at the root without a way to leave Settings', () => {
    expect(resolveMobileBackAction({ isMobile: true, stage: 'nav', canClose: false })).toBe('hidden');
  });
});
