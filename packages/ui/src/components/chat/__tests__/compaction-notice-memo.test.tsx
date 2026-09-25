/**
 * The notice row is memoised, and its own message does not change while the
 * compaction summary streams: the summary lives in a different row, and the
 * `compaction` part on this row was written before it. Only `compactionContext`
 * carries the growing text. If the memo comparison ignored that prop, the row
 * would keep the first snapshot it rendered - a span instead of a button when
 * the first delta had not landed yet, or a dialog frozen on the text of the
 * click. This test keeps the memo honest by re-rendering the very same row with
 * a new context only.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { Part, UserMessage } from '@opencode-ai/sdk/v2';

import type { ChatMessageEntry } from '../lib/turns/types';
import type { CompactionContext } from '../lib/turns/compactionContext';

mock.module('sonner', () => ({
    toast: { dismiss: () => undefined, error: () => undefined, info: () => undefined, success: () => undefined },
}));

const passthrough = ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children);

mock.module('@/components/ui/dialog', () => ({
    Dialog: ({ children, open }: React.PropsWithChildren<{ open: boolean }>) => (open ? passthrough({ children }) : null),
    DialogContent: passthrough,
    DialogTitle: passthrough,
}));

mock.module('@/contexts/useThemeSystem', () => ({
    useThemeSystem: () => ({ currentTheme: undefined }),
    useOptionalThemeSystem: () => undefined,
}));

mock.module('@/components/chat/message/MessageBody', () => ({
    default: () => null,
}));

mock.module('@/components/chat/MarkdownRenderer', () => ({
    SimpleMarkdownRenderer: ({ content }: { content: string }) =>
        React.createElement('div', { 'data-testid': 'summary-body' }, content),
}));

const { default: ChatMessage } = await import('../ChatMessage');
const { I18nProvider } = await import('@/lib/i18n');

const CREATED_AT = Date.UTC(2024, 4, 17, 9, 30);

/** The row the compaction wrote: a service part, no user text on the bubble. */
const noticePart: Part = {
    id: 'msg_compaction-compaction',
    messageID: 'msg_compaction',
    sessionID: 'ses_1',
    type: 'compaction',
    auto: true,
} as Part;

const noticeEntry: ChatMessageEntry = {
    info: {
        id: 'msg_compaction',
        sessionID: 'ses_1',
        role: 'user',
        time: { created: CREATED_AT },
        agent: 'compaction',
        model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts: [noticePart],
};

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

/** Re-renders the same row object, so only the context is a new value. */
const renderRow = async (compactionContext: CompactionContext) => {
    await act(async () => {
        root.render(
            <I18nProvider>
                <ChatMessage message={noticeEntry} compactionContext={compactionContext} />
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

describe('compaction notice row', () => {
    test('becomes a button when the summary arrives, though the row itself never changed', async () => {
        await renderRow(context(null));
        expect(noticeButton()).toBeNull();

        await renderRow(context('The history was rewritten'));
        expect(noticeButton()).not.toBeNull();
    });

    test('an open dialog follows the summary as it grows', async () => {
        await renderRow(context('First delta'));
        await click(noticeButton() as Element);
        expect(summaryText()).toBe('First delta');

        await renderRow(context('First delta and the second one'));
        expect(summaryText()).toBe('First delta and the second one');
    });
});
