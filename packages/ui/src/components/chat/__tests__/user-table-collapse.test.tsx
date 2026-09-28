/**
 * A large markdown table in a user message must collapse to a few rows instead
 * of filling the transcript. When the message is rendered as the sticky prompt
 * header (`TurnItem` with `stickyUserHeader`), the clip must hold even with the
 * `collapsibleUserMessages` setting off and with the message expanded: the
 * header keeps a fixed height instead of growing to the full table height.
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
import type { ChatMessageEntry } from '../lib/turns/types';
import type { Part, UserMessage } from '@opencode-ai/sdk/v2';

// Geometry happy-dom cannot compute. The stub below writes it onto the decorated
// table wrapper so the collapse measurement can be exercised without a layout
// engine; `clientHeight`/`scrollHeight` are 0 for every element otherwise.
const tableGeometry = { clientHeight: 0, scrollHeight: 0 };

// The clamp is a class-list contract, so the stub keeps the real renderer's two
// relevant properties: the caller's `className` lands on a wrapper that contains
// the decorated table shape (wrapper > horizontal scroll > table). Both tests
// read the class list off that wrapper, so the testid is defensive markup, not
// the lookup contract.
const MARKDOWN_ROOT_TESTID = 'markdown-root';

const markdownRendererStub = () => ({
    // The real module's other two exports are pulled in by `MessageBody` on the
    // sticky-composition path, so the partial mock has to carry them too.
    MarkdownRenderer: () => null,
    MarkdownImageGallery: () => null,
    SimpleMarkdownRenderer: ({ className }: { className?: string }) => {
        const wrapperRef = React.useRef<HTMLDivElement>(null);

        React.useEffect(() => {
            const wrapper = wrapperRef.current;
            if (!wrapper) return;
            Object.defineProperty(wrapper, 'clientHeight', { value: tableGeometry.clientHeight, configurable: true });
            Object.defineProperty(wrapper, 'scrollHeight', { value: tableGeometry.scrollHeight, configurable: true });
        }, []);

        return (
            <div className={className} data-testid={MARKDOWN_ROOT_TESTID}>
                <div
                    className="group my-4 flex w-fit max-w-full flex-col space-y-2"
                    data-markdown="table-wrapper"
                    ref={wrapperRef}
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

// The renderer is stubbed for the whole file; the mocked module keeps the real
// renderer's export shape so `MessageBody` can import it on the sticky path.
mock.module('@/components/chat/MarkdownRenderer', markdownRendererStub);
mock.module('../MarkdownRenderer', markdownRendererStub);
mock.module('@/hooks/useEffectiveDirectory', () => ({ useEffectiveDirectory: () => undefined }));

// `MessageBody` is the real renderer in the sticky-header composition. Its code
// highlighter pulls a shiki web worker and its footer reads provider logos
// through a Vite-only asset glob; neither loads under bun test, and the sticky
// composition under test renders text only.
mock.module('@/components/chat/markdown/markdown-worker', () => ({
    resetMarkdownWorkerClientCacheForTests: () => undefined,
    highlightCodeInWorker: async () => null,
    highlightLinesInWorker: async () => null,
    getCachedHighlightedLines: () => null,
    highlightTokensInWorker: async () => null,
}));
mock.module('@/hooks/useProviderLogo', () => ({
    useProviderLogo: () => null,
}));

const { I18nProvider } = await import('@/lib/i18n');
const { useUIStore } = await import('@/stores/useUIStore');
const { default: UserTextPart } = await import('../message/parts/UserTextPart');
const { default: TurnItem } = await import('../components/TurnItem');
const { default: MessageBody } = await import('../message/MessageBody');
const { projectTurnRecords } = await import('../lib/turns/projectTurnRecords');

const TABLE_CLAMP_CLASSES = [
    "[&_[data-markdown='table-wrapper']]:max-h-28",
    "[&_[data-markdown='table-wrapper']]:overflow-hidden",
    "[&_[data-markdown='table-wrapper']]:mask-b-from-60%",
];

const __dirname = dirname(fileURLToPath(import.meta.url));

// Both suites mount React into a happy-dom document; only the collapsed-part
// suite's own fixture differs from the sticky-composition one.
const setupDom = (): (() => void) => {
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
    return () => {
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    };
};

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
        restore = setupDom();

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

        const markdownRoot = container.querySelector<HTMLElement>('[data-testid="' + MARKDOWN_ROOT_TESTID + '"]');
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

describe('sticky user prompt header tables', () => {
    let root: Root;
    let container: HTMLDivElement;
    let restore: () => void;

    beforeEach(() => {
        restore = setupDom();
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

    const tableTurn = () => {
        const textPart = tablePart();
        const info: UserMessage = {
            id: 'message-table',
            sessionID: 'session',
            role: 'user',
            time: { created: 1 },
            agent: 'build',
            model: { providerID: 'provider', modelID: 'model' },
        };
        const projection = projectTurnRecords([{ info, parts: [textPart] }]);
        const turn = projection.turns[0];
        if (!turn) {
            throw new Error('expected the fixture message to project into one turn');
        }
        return turn;
    };

    // The props the real transcript supplies before the renderer is reached.
    const renderUserMessage = (message: ChatMessageEntry) => (
        <MessageBody
            messageId={message.info.id}
            parts={message.parts}
            isUser
            isMessageCompleted
            isMobile={false}
            copiedCode={null}
            onCopyCode={() => undefined}
            expandedTools={new Set()}
            onToggleTool={() => undefined}
            onShowPopup={() => undefined}
            streamPhase="completed"
            allowAnimation={false}
        />
    );

    // The production composition: `TurnItem` wraps the user message in the
    // sticky header, `MessageBody` decides the user branch and renders the markdown.
    const renderStickyTurn = async () => {
        const turn = tableTurn();

        await act(async () => root.render(
            <I18nProvider>
                <TurnItem
                    turn={turn}
                    stickyUserHeader
                    renderMessage={renderUserMessage}
                />
            </I18nProvider>,
        ));

        const header = container.querySelector<HTMLElement>('[data-testid="sticky-user-header"]');
        const markdownRoot = header?.querySelector<HTMLElement>('[data-testid="' + MARKDOWN_ROOT_TESTID + '"]');
        if (!header || !markdownRoot) {
            throw new Error('expected the sticky user header to render the markdown renderer');
        }
        return { header, markdownRoot };
    };

    const expectStickyClamp = (markdownRoot: HTMLElement) => {
        for (const clampClass of TABLE_CLAMP_CLASSES) {
            expect(markdownRoot.className).toContain(clampClass);
        }
    };

    test('bounds the table with message collapsing disabled', async () => {
        useUIStore.setState({ collapsibleUserMessages: false });

        const { header, markdownRoot } = await renderStickyTurn();

        expectStickyClamp(markdownRoot);
        // No line clamp in the sticky header: the table wrapper is the only bound,
        // so the header cannot grow to the full table height.
        expect(markdownRoot.parentElement?.className ?? '').not.toContain('line-clamp-2');
        // The bound has to sit on the element whose height the header measures.
        expect(header.contains(markdownRoot.parentElement)).toBe(true);
    });

    test('bounds the table with message collapsing enabled', async () => {
        const { markdownRoot } = await renderStickyTurn();

        expectStickyClamp(markdownRoot);
    });

    test('bounds the table after the message is expanded', async () => {
        // Collapsing is on and the message starts collapsed, so the header
        // carries the real expand affordance: a click on the clipped markdown
        // box (`UserTextPart` -> `MessageBody` -> `messageExpanded`).
        tableGeometry.clientHeight = 40;
        tableGeometry.scrollHeight = 200;

        const { markdownRoot } = await renderStickyTurn();

        const markdownBox = markdownRoot.parentElement;
        if (!markdownBox) {
            throw new Error('expected the markdown root to sit inside the message box');
        }
        // The click path measures `scrollHeight > clientHeight` on the box before
        // expanding; happy-dom reports 0 for both, so make the box look clipped.
        Object.defineProperty(markdownBox, 'clientHeight', { value: 40, configurable: true });
        Object.defineProperty(markdownBox, 'scrollHeight', { value: 200, configurable: true });

        await act(async () => {
            markdownBox.click();
        });

        expect(markdownBox.className).not.toContain('line-clamp-2');
        expectStickyClamp(markdownRoot);
    });

    test('leaves a non-sticky user message free of the table bound', async () => {
        useUIStore.setState({ collapsibleUserMessages: false });
        const turn = tableTurn();

        await act(async () => root.render(
            <I18nProvider>
                <TurnItem
                    turn={turn}
                    stickyUserHeader={false}
                    renderMessage={renderUserMessage}
                />
            </I18nProvider>,
        ));

        expect(container.querySelector('[data-testid="sticky-user-header"]')).toBeNull();
        const markdownRoot = container.querySelector<HTMLElement>('[data-testid="' + MARKDOWN_ROOT_TESTID + '"]');
        if (!markdownRoot) {
            throw new Error('expected the regular row to render the markdown renderer');
        }
        for (const clampClass of TABLE_CLAMP_CLASSES) {
            expect(markdownRoot.className).not.toContain(clampClass);
        }
    });
});
