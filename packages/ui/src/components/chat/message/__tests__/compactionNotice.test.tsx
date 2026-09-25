/**
 * Opening the compaction summary is not a privilege of a settled turn.
 *
 * The notice row appears in the transcript as soon as the live projection emits
 * it, and the summary beside it keeps growing while the compaction streams. The
 * notice has to be a button from the first non-empty delta, and the dialog it
 * opens has to show the text as it stands now - not the text that was there when
 * the click happened. Both halves are pinned here.
 *
 * The dialog primitive is stubbed the way the other dialog tests in this repo
 * stub it; the keyboard and outside-press behaviour belong to the shared
 * `@/components/ui/dialog` the subtask dialog uses too, and the source check at
 * the bottom pins that this notice goes through that same primitive instead of
 * growing a pattern of its own.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { CompactionPart } from '../../lib/messageDisplayNormalization';
import type { CompactionContext } from '../../lib/turns/compactionContext';

mock.module('sonner', () => ({
    toast: { dismiss: () => undefined, error: () => undefined, info: () => undefined, success: () => undefined },
}));

mock.module('@/components/chat/MarkdownRenderer', () => ({
    SimpleMarkdownRenderer: ({ content }: { content: string }) =>
        React.createElement('div', { 'data-testid': 'summary-body' }, content),
}));

const passthrough = ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children);

mock.module('@/components/ui/dialog', () => ({
    // Mirrors the primitive's contract: it paints its content while `open` and
    // reports a dismissal (Escape, outside press, close button) through
    // `onOpenChange`. The notice has to honour both halves.
    Dialog: ({ children, open, onOpenChange }: React.PropsWithChildren<{
        open: boolean;
        onOpenChange?: (open: boolean) => void;
    }>) => (open
        ? React.createElement(
            React.Fragment,
            null,
            children,
            React.createElement('button', {
                type: 'button',
                'data-testid': 'dialog-dismiss',
                onClick: () => onOpenChange?.(false),
            }),
        )
        : null),
    DialogContent: passthrough,
    DialogTitle: passthrough,
}));

const { CompactionNotice } = await import('../CompactionNotice');
const { I18nProvider } = await import('@/lib/i18n');

const here = dirname(fileURLToPath(import.meta.url));
const noticeSource = readFileSync(join(here, '..', 'CompactionNotice.tsx'), 'utf-8');

const dialogSource = readFileSync(
    join(here, '..', '..', '..', '..', 'components', 'ui', 'dialog.tsx'),
    'utf-8',
);

/** The live compaction notice: a service part on the row the compaction wrote. */
const liveCompactionPart: CompactionPart = {
    id: 'msg_compaction-compaction',
    messageID: 'msg_compaction',
    sessionID: 'ses_1',
    type: 'compaction',
    auto: true,
};

const CREATED_AT = Date.UTC(2024, 4, 17, 9, 30);

const context = (summary: string | null): CompactionContext => ({
    before: 120_000,
    after: 8_000,
    summary,
});

let browser: Window;
let root: Root;
let host: HTMLElement;

beforeEach(() => {
    browser = new Window({ url: 'http://localhost' });
    for (const [key, value] of Object.entries({
        window: browser,
        document: browser.document,
        navigator: browser.navigator,
        HTMLElement: browser.HTMLElement,
        Element: browser.Element,
        Node: browser.Node,
        MouseEvent: browser.MouseEvent,
        getComputedStyle: browser.getComputedStyle.bind(browser),
        IS_REACT_ACT_ENVIRONMENT: true,
    })) {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    await browser.happyDOM.close();
});

const renderNotice = async (compactionContext: CompactionContext) => {
    await act(async () => {
        root.render(
            <I18nProvider>
                <CompactionNotice part={liveCompactionPart} createdAt={CREATED_AT} context={compactionContext} />
            </I18nProvider>,
        );
    });
};

const click = async (element: Element) => {
    await act(async () => {
        element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }) as unknown as Event);
    });
};

const noticeButton = () => host.querySelector('button[data-compaction-notice]');
const summaryText = () => document.querySelector('[data-testid="summary-body"]')?.textContent ?? null;

describe('compaction notice while the summary streams', () => {
    test('turns into a button on the first non-empty summary, without waiting for the turn to settle', async () => {
        // The compaction record exists, but its first delta has not landed yet.
        await renderNotice(context(null));
        expect(noticeButton()).toBeNull();
        expect(summaryText()).toBeNull();

        await renderNotice(context('Part of the history'));
        const button = noticeButton();
        expect(button).not.toBeNull();
        expect(button?.getAttribute('type')).toBe('button');
    });

    test('a click on that button opens the summary body', async () => {
        await renderNotice(context('Part of the history'));
        expect(summaryText()).toBeNull();

        await click(noticeButton() as Element);
        expect(summaryText()).toBe('Part of the history');
    });

    test('keeps the open dialog on the latest delta instead of freezing on the first snapshot', async () => {
        await renderNotice(context('First delta'));
        await click(noticeButton() as Element);
        expect(summaryText()).toBe('First delta');

        await renderNotice(context('First delta and the second one'));
        expect(summaryText()).toBe('First delta and the second one');
    });

    test('a dismissal from the dialog closes it and leaves the notice in place', async () => {
        await renderNotice(context('A summary worth keeping'));
        await click(noticeButton() as Element);
        expect(summaryText()).toBe('A summary worth keeping');

        // What the dialog primitive reports when Escape lands or the pointer goes
        // down outside.
        await click(document.querySelector('[data-testid="dialog-dismiss"]') as Element);
        expect(summaryText()).toBeNull();
        expect(noticeButton()).not.toBeNull();

        await click(noticeButton() as Element);
        expect(summaryText()).toBe('A summary worth keeping');
    });

    test('the summary body is the dialog\u2019s only scroll container', () => {
        // The shared dialog popup already ships `overflow-y-auto`; the subtask
        // dialog avoids a second scrollbar by making the body the single scroller,
        // and the notice follows the same shape.
        expect(noticeSource).toContain("from '@/components/ui/dialog'");
        expect(noticeSource).toContain('overflow-hidden overflow-y-hidden');
        expect(noticeSource).toContain('min-h-0 flex-1 overflow-y-auto');
        expect(dialogSource).toContain('overflow-y-auto');
    });
});
