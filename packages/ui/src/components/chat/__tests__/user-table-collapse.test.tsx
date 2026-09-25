/**
 * A large markdown table in a user message must collapse to a few rows instead
 * of filling the transcript (and, with the sticky prompt header on, the header
 * itself).
 *
 * `line-clamp-2` cannot do that: a table is not a line box, so the clamp class
 * list bounds the decorated table wrapper (`[data-markdown="table-wrapper"]`,
 * built by `decorateTables` in `chat/markdown/decorate.ts`) instead, and that
 * wrapper is what reports the clip to the click-to-expand affordance.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import type { Part } from '@opencode-ai/sdk/v2';

// Geometry happy-dom cannot compute. The stub below writes it onto the decorated
// table wrapper so the collapse measurement can be exercised without a layout
// engine; `clientHeight`/`scrollHeight` are 0 for every element otherwise.
const tableGeometry = { clientHeight: 0, scrollHeight: 0 };

// The clamp is a class-list contract, so the stub keeps the real renderer's two
// relevant properties: the caller's `className` lands on a wrapper that contains
// the decorated table shape (wrapper > horizontal scroll > table).
const markdownRendererStub = () => ({
    SimpleMarkdownRenderer: ({ className }: { className?: string }) => {
        const wrapperRef = React.useRef<HTMLDivElement>(null);

        React.useEffect(() => {
            const wrapper = wrapperRef.current;
            if (!wrapper) return;
            Object.defineProperty(wrapper, 'clientHeight', { value: tableGeometry.clientHeight, configurable: true });
            Object.defineProperty(wrapper, 'scrollHeight', { value: tableGeometry.scrollHeight, configurable: true });
        }, []);

        return (
            <div className={className} data-testid="markdown-root">
                <div
                    ref={wrapperRef}
                    data-markdown="table-wrapper"
                    className="group my-4 flex w-fit max-w-full flex-col space-y-2"
                >
                    <div className="overflow-x-auto rounded-lg border border-border/80 bg-[var(--surface-elevated)]">
                        <table data-markdown="table">
                            <tbody>
                                <tr>
                                    <td>alpha</td>
                                    <td>1</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    },
});

mock.module('@/components/chat/MarkdownRenderer', markdownRendererStub);
mock.module('../MarkdownRenderer', markdownRendererStub);
mock.module('@/hooks/useEffectiveDirectory', () => ({ useEffectiveDirectory: () => undefined }));

const { I18nProvider } = await import('@/lib/i18n');
const { useUIStore } = await import('@/stores/useUIStore');
const { default: UserTextPart } = await import('../message/parts/UserTextPart');

const TABLE_CLAMP_CLASSES = [
    "[&_[data-markdown='table-wrapper']]:max-h-28",
    "[&_[data-markdown='table-wrapper']]:overflow-hidden",
    "[&_[data-markdown='table-wrapper']]:mask-b-from-60%",
];

const __dirname = dirname(fileURLToPath(import.meta.url));

const tablePart = (): Part => ({
    id: 'part-table',
    messageID: 'message-table',
    sessionID: 'session',
    type: 'text',
    text: [
        '| name | value |',
        '| --- | --- |',
        '| alpha | 1 |',
        '| beta | 2 |',
        '| gamma | 3 |',
        '| delta | 4 |',
        '| epsilon | 5 |',
    ].join('\n'),
});

describe('collapsed user message tables', () => {
    let root: Root;
    let container: HTMLDivElement;
    let restore: () => void;

    beforeEach(() => {
        const win = new Window({ url: 'http://localhost' });
        const globals = {
            window: win,
            document: win.document,
            navigator: win.navigator,
            HTMLElement: win.HTMLElement,
            Element: win.Element,
            SVGElement: win.SVGElement,
            Node: win.Node,
            NodeList: win.NodeList,
            MutationObserver: win.MutationObserver,
            requestAnimationFrame: win.requestAnimationFrame.bind(win),
            cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
            getComputedStyle: win.getComputedStyle.bind(win),
            ResizeObserver: class {
                observe() { return undefined; }
                unobserve() { return undefined; }
                disconnect() { return undefined; }
            },
            IS_REACT_ACT_ENVIRONMENT: true,
        };
        const previous = Object.keys(globals).map(
            (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
        );
        for (const [name, value] of Object.entries(globals)) {
            Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        }
        restore = () => {
            for (const [name, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        };

        tableGeometry.clientHeight = 0;
        tableGeometry.scrollHeight = 0;
        useUIStore.setState({ collapsibleUserMessages: true });

        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        restore();
        useUIStore.setState({ collapsibleUserMessages: true });
    });

    const renderPart = async (messageExpanded?: boolean): Promise<HTMLElement> => {
        await act(async () => root.render(
            <I18nProvider>
                <UserTextPart
                    part={tablePart()}
                    messageId="message-table"
                    isMobile={false}
                    messageExpanded={messageExpanded}
                />
            </I18nProvider>,
        ));

        const markdownRoot = container.querySelector<HTMLElement>('[data-testid="markdown-root"]');
        if (!markdownRoot) {
            throw new Error('expected the markdown renderer to mount');
        }
        return markdownRoot;
    };

    const clampedBox = (markdownRoot: HTMLElement): HTMLElement => {
        const box = markdownRoot.parentElement;
        if (!box) {
            throw new Error('expected the markdown root to sit inside the clamped message box');
        }
        return box;
    };

    test('clamps the decorated table wrapper while the message is collapsed', async () => {
        const markdownRoot = await renderPart();
        const classList = markdownRoot.className;

        for (const clampClass of TABLE_CLAMP_CLASSES) {
            expect(classList).toContain(clampClass);
        }
        expect(clampedBox(markdownRoot).className).toContain('line-clamp-2');
        // The clamp selector is only useful while the element it names is a real
        // descendant of the element carrying the class list.
        expect(markdownRoot.querySelector('[data-markdown="table-wrapper"]')).not.toBeNull();
    });

    test('drops the clamp once the message is expanded', async () => {
        const markdownRoot = await renderPart(true);
        const classList = markdownRoot.className;

        for (const clampClass of TABLE_CLAMP_CLASSES) {
            expect(classList).not.toContain(clampClass);
        }
        expect(clampedBox(markdownRoot).className).not.toContain('line-clamp-2');
    });

    test('does not clamp when collapsible user messages are disabled', async () => {
        useUIStore.setState({ collapsibleUserMessages: false });

        const markdownRoot = await renderPart();
        const classList = markdownRoot.className;

        for (const clampClass of TABLE_CLAMP_CLASSES) {
            expect(classList).not.toContain(clampClass);
        }
    });

    test('keeps the expand affordance while the clamped table overflows', async () => {
        tableGeometry.clientHeight = 112;
        tableGeometry.scrollHeight = 420;

        const markdownRoot = await renderPart();

        // The clamped box itself does not overflow — the table wrapper inside it
        // does — so the affordance has to come from the wrapper measurement.
        expect(clampedBox(markdownRoot).scrollHeight).toBe(0);
        expect(clampedBox(markdownRoot).className).toContain('cursor-pointer');
    });

    test('hides the expand affordance while the table fits the clamp', async () => {
        tableGeometry.clientHeight = 112;
        tableGeometry.scrollHeight = 112;

        const markdownRoot = await renderPart();

        expect(clampedBox(markdownRoot).className).not.toContain('cursor-pointer');
    });

    test('the clamp targets the attribute the table decorator writes', () => {
        const decorateSource = readFileSync(
            join(__dirname, '..', 'markdown', 'decorate.ts'),
            'utf-8',
        );

        expect(decorateSource).toContain("wrapper.setAttribute('data-markdown', 'table-wrapper')");
        for (const clampClass of TABLE_CLAMP_CLASSES) {
            expect(clampClass).toContain("[data-markdown='table-wrapper']");
        }
    });
});
