import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { Session } from '@opencode-ai/sdk/v2';
import { I18nProvider } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import type { SessionNode } from '../types';
import { SessionUsageCostBadge } from './SessionUsageCostBadge';
import { resolveSessionNodeUsageTotals } from './sessionUsageTotals';

const here = dirname(fileURLToPath(import.meta.url));
const rowSource = readFileSync(join(here, 'SessionNodeItem.tsx'), 'utf-8');
const badgeSource = readFileSync(join(here, 'SessionUsageCostBadge.tsx'), 'utf-8');

let browser: Window;
let root: Root;
let host: HTMLElement;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  browser = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  descriptors.clear();
});

const buildSession = (id: string, cost?: number): Session => {
  const session: Session = {
    id,
    slug: id,
    projectID: 'project-1',
    directory: '/repo',
    title: id,
    version: '1.0.0',
    time: { created: 1, updated: 2 },
  };
  if (cost !== undefined) session.cost = cost;
  return session;
};

const buildNode = (session: Session, children: SessionNode[] = []): SessionNode => ({
  session,
  children,
  worktree: null,
});

const renderBadge = async (cost: number | null, showLeadingDivider = false) => {
  await act(async () => root.render(
    <I18nProvider>
      <SessionUsageCostBadge cost={cost} showLeadingDivider={showLeadingDivider} />
    </I18nProvider>,
  ));
};

describe('session usage cost badge', () => {
  test('prints the session spend as money, not as a token count', async () => {
    await renderBadge(4.74);
    const badge = host.querySelector('[role="img"]');
    expect(badge?.textContent).toBe('$4.74');
    expect(badge?.getAttribute('aria-label')).toBe('Cost: $4.74');
    expect(badge?.getAttribute('title')).toBe('Cost: $4.74');
    expect(badge?.querySelector('use')?.getAttribute('href')).toBe('#oc-bar-chart-2');
    // A token chip would print a compact suffix such as `151.3M`; money never does.
    expect(/\d\s?[KM]\b/.test(badge?.textContent ?? '')).toBe(false);
  });

  test('follows the shared money formatter for sub-cent totals', async () => {
    await renderBadge(0.0042);
    expect(host.querySelector('[role="img"]')?.textContent).toBe(formatMoney(0.0042));
  });

  test('renders nothing when the session reports no cost', async () => {
    await renderBadge(0);
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.textContent).toBe('');

    await renderBadge(null);
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.textContent).toBe('');

    await renderBadge(Number.NaN);
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.textContent).toBe('');
  });

  test('separates the spend from the model name only when a model precedes it', async () => {
    await renderBadge(1.5, true);
    expect(host.querySelector('[role="img"]')?.textContent).toBe('·$1.50');

    await renderBadge(1.5, false);
    expect(host.querySelector('[role="img"]')?.textContent).toBe('$1.50');
  });

  test('prints the whole subtree spend, sub-sessions included', async () => {
    const child = buildNode(buildSession('child', 2));
    const parent = buildNode(buildSession('parent', 0.5), [child]);
    const total = resolveSessionNodeUsageTotals(parent, new Map());

    await renderBadge(total.cost);
    expect(host.querySelector('[role="img"]')?.textContent).toBe('$2.50');
  });
});

describe('session row wires the spend into the model metadata slot', () => {
  test('every row metadata slot renders the cost chip right after the model badge', () => {
    const modelBadges = rowSource.match(/\{lastModelBadge\}/g) ?? [];
    const chipsAfterModel = rowSource.match(/\{lastModelBadge\}\s*\n\s*\{sessionCostBadge\}/g) ?? [];

    expect(modelBadges.length).toBeGreaterThan(0);
    expect(chipsAfterModel).toHaveLength(modelBadges.length);
  });

  test('the row metadata divider is the middle dot, not a pipe', () => {
    expect(rowSource).toContain("flex-shrink-0 text-muted-foreground/40\">·</span>");
  });

  test('the row has no token chip left and gates the slot on cost', () => {
    expect(rowSource).not.toContain('SessionUsageTokensBadge');
    expect(rowSource).not.toContain('sessionTokensUsed !== null');
    expect(rowSource).toContain('showSessionCost || renderContext');
    expect(badgeSource).not.toContain('formatCompactTokens');
    // The row tooltip keeps its own token line untouched.
    expect(rowSource).toContain("t('sessions.sidebar.session.tooltip.tokens'");
  });
});
