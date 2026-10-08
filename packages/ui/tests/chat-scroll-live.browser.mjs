// Run with: bun packages/ui/tests/chat-scroll-live.browser.mjs
//
// Drives the REAL chat scroll hook in a real Chromium page and records measured
// behaviour for the cases reported as unstable:
//   K1 opening a long session lands on the end
//   K2 a streaming answer holds its own top edge (align to top)
//   K3 the end is followed again once the answer finishes
//   K4 the "scroll to bottom" pill stays present and clickable while the top
//      edge is held
//   K5 a pointer press on an interactive card inside the answer
//   K6 returning to the end restores following, including when the list's
//      reported length is an over-estimate
//
// The hook and its helpers are the production modules; only the surrounding
// list handle, rows, and fixtures are supplied here. Every number printed is
// measured from the live layout.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
    CdpClient, createPageTarget, evaluateValue, launchChrome, reservePort, resolveChrome, wait,
} from '../../../scripts/perf/cdp.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ui = join(repo, 'packages/ui');
const uiModules = join(ui, 'node_modules');
const moduleFrom = (name) => ({ path: join(uiModules, name) });

// A source import from the project tree: the alias resolves to a path without an
// extension, which the bundler does not guess on its own.
const resolveSource = (relative) => {
    const base = join(ui, 'src', relative);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(candidate)) return candidate;
    }
    return base;
};

const fixture = `
import React from ${JSON.stringify(join(uiModules, 'react/index.js'))};
import { createRoot } from ${JSON.stringify(join(uiModules, 'react-dom/client.js'))};
import { useChatTimelineScroll } from ${JSON.stringify(join(ui, 'src/hooks/useChatTimelineScroll.ts'))};
import { resolveTimelineIsAtEnd, resolveEndReport, resolveTopPinOffset } from ${JSON.stringify(join(ui, 'src/components/chat/lib/scroll/timelineScrollAnchoring.ts'))};
import { measureMessageTop } from ${JSON.stringify(join(ui, 'src/components/chat/lib/scroll/messageAnchor.ts'))};

const CLIENT_HEIGHT = 600;
const world = {
    isWorking: true,
    answerId: null,
    streamingId: null,
    answerHeight: 0,
    tailHeight: 2400,
    reportedContentLength: undefined,
};
const listRoot = () => document.getElementById('list');
const contentRoot = () => document.getElementById('content');

// The list's own report, the way a live list computes it: from its total length.
window.measure = () => ({
    contentLength: world.reportedContentLength ?? contentRoot().scrollHeight,
    scrollLength: listRoot().clientHeight,
    scroll: listRoot().scrollTop,
});

// The rows the list would be holding: the sticky header, the answer, the tail.
const rows = () => Array.from(contentRoot().children);

// Position of a row in the scroll container's content space, measured from the
// live layout - the same quantity measureMessageTop produces for one message.
const rowTop = (node, element) => element.getBoundingClientRect().top
    - node.getBoundingClientRect().top
    + node.scrollTop;

const makeHandle = (node) => ({
    getState: () => {
        const items = rows();
        return {
            data: items,
            scroll: node.scrollTop,
            scrollLength: node.clientHeight,
            contentLength: world.reportedContentLength ?? node.scrollHeight,
            positionAtIndex: (index) => (items[index] ? rowTop(node, items[index]) : undefined),
            sizeAtIndex: (index) => items[index]?.getBoundingClientRect().height,
        };
    },
    getScrollableNode: () => node,
    scrollToEnd: () => { node.scrollTop = node.scrollHeight - node.clientHeight; },
    scrollToOffset: ({ offset }) => { node.scrollTop = offset; },
    scrollToIndex: () => {},
});

function App() {
    const [, forceRender] = React.useState(0);
    const [tick, setTick] = React.useState(0);

    window.setWorld = (patch) => {
        Object.assign(world, patch);
        forceRender((value) => value + 1);
    };
    // Growth is the signal the list gives the hook in the product.
    window.grow = (delta) => {
        world.tailHeight += delta;
        setTick((value) => value + 1);
    };

    const result = useChatTimelineScroll({
        currentSessionId: 'ses_live',
        currentSessionKey: 'ses_live',
        sessionMessageCount: 2,
        composerOverlayHeight: 0,
        sessionIsWorking: world.isWorking,
        activeStreamingMessageId: world.streamingId,
        answerAnchorMessageId: world.answerId,
    });
    window.result = result;

    // The application registers the list handle once; the hook takes its live
    // scroll element from it (registerList sets both the ref and the state).
    React.useEffect(() => {
        const node = listRoot();
        if (!node) return;
        window.result.registerList(makeHandle(node));
        return () => window.result.registerList(null);
    }, []);
    // The product's MessageList reports end crossings through these helpers, so
    // the hook's own bookkeeping runs the same way it does in the application.
    React.useEffect(() => {
        const node = result.scrollNode;
        if (!node) return;
        let reported = true;
        const onScroll = () => {
            const isAtEnd = resolveTimelineIsAtEnd(window.measure());
            if (isAtEnd === undefined) return;
            const report = resolveEndReport(reported, isAtEnd);
            if (report === null) return;
            reported = report;
            result.onIsAtEndChange(report);
        };
        node.addEventListener('scroll', onScroll, { passive: true });
        return () => node.removeEventListener('scroll', onScroll);
    }, [result.scrollNode]);

    React.useEffect(() => { result.onTimelineDataChange(); }, [tick, result]);

    const worldNow = world;
    return React.createElement('div', null,
        React.createElement('div', { id: 'list', ref: result.scrollRef, style: {
            height: CLIENT_HEIGHT + 'px', width: '800px', overflow: 'auto', overflowAnchor: 'none',
        } },
            React.createElement('div', { id: 'content', style: { display: 'flex', flexDirection: 'column' } },
                React.createElement('div', { 'data-testid': 'sticky-user-header', style: { height: '40px', flex: '0 0 auto' } }, 'user'),
                React.createElement('div', { 'data-message-id': 'msg_a', style: { height: worldNow.answerHeight + 'px', flex: '0 0 auto' } },
                    React.createElement('button', { id: 'card', style: { height: '32px' } }, 'Allow'),
                ),
                React.createElement('div', { 'data-message-id': 'msg_b', style: { height: worldNow.tailHeight + 'px', flex: '0 0 auto' } }, 'tail'),
            ),
        ),
        React.createElement('div', { id: 'probe' },
            React.createElement('span', { id: 'isTopPinned' }, String(result.isTopPinned)),
            React.createElement('span', { id: 'showScrollButton' }, String(result.showScrollButton)),
            React.createElement('span', { id: 'userOwnsScroll' }, String(result.userOwnsScroll)),
            React.createElement('span', { id: 'isPinned' }, String(result.isPinned)),
        ),
    );
}

// rAF does not tick in a headless window without a compositor; the hook's own
// work is driven by timers and observers, so time-based waits are equivalent
// here and do not depend on the window being painted.
const frames = async (count) => {
    for (let index = 0; index < count; index++) await new Promise((resolve) => setTimeout(resolve, 16));
};
// Where the answer's first pixel sits relative to the viewport top: 40 means the
// sticky header covers it exactly, which is what align to top must produce.
const answerTop = () => {
    const answer = document.querySelector('[data-message-id="msg_a"]');
    if (!answer) return null;
    return Math.round(answer.getBoundingClientRect().top - listRoot().getBoundingClientRect().top);
};
const readProbe = () => ({
    isTopPinned: document.getElementById('isTopPinned').textContent === 'true',
    showScrollButton: document.getElementById('showScrollButton').textContent === 'true',
    userOwnsScroll: document.getElementById('userOwnsScroll').textContent === 'true',
    isPinned: document.getElementById('isPinned').textContent === 'true',
    answerTop: answerTop(),
    scrollTop: listRoot().scrollTop,
    maxScroll: listRoot().scrollHeight - listRoot().clientHeight,
});
const press = (node, kind) => node.dispatchEvent(new PointerEvent(kind, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
}));

window.diag = () => {
    if (!window.result.scrollNode) return { pinned: window.result.isTopPinned, reason: 'no scroll node' };
    const measured = window.measure();
    const top = measureMessageTop(window.result.scrollNode, 'msg_a');
    const offset = resolveTopPinOffset({
        assistantTop: top ?? undefined,
        stickyHeaderHeight: 40,
        contentLength: measured.contentLength,
        scrollLength: measured.scrollLength,
    });
    return {
        pinned: window.result.isTopPinned,
        assistantTop: top,
        contentLength: measured.contentLength,
        scrollLength: measured.scrollLength,
        offset,
        stickyFound: Boolean(window.result.scrollNode.querySelector('[data-testid="sticky-user-header"]')),
    };
};

window.__errors = [];
window.addEventListener('error', (event) => { window.__errors.push(String(event.error?.stack || event.message)); });
window.addEventListener('unhandledrejection', (event) => { window.__errors.push('unhandled: ' + String(event.reason?.stack || event.reason)); });

createRoot(document.getElementById('root')).render(React.createElement(App));

// ── scenarios ──────────────────────────────────────────────────────────────
window.K1 = async () => {
    window.setWorld({ isWorking: true, answerId: null, streamingId: null, answerHeight: 0, tailHeight: 2400, reportedContentLength: undefined });
    listRoot().scrollTop = 0;
    await frames(30);
    return { ...readProbe(), expected: 'at the end' };
};

// A streaming answer: the anchor appears, the text grows downward.
window.K2 = async () => {
    window.setWorld({ isWorking: true, answerId: null, streamingId: null, answerHeight: 0, tailHeight: 2400, reportedContentLength: undefined });
    listRoot().scrollTop = 0;
    await frames(10);
    const before = readProbe();
    window.setWorld({ isWorking: true, answerId: 'msg_a', streamingId: 'msg_a', answerHeight: 900 });
    await frames(20);
    const armed = readProbe();
    window.grow(0);
    await frames(5);
    const settled = readProbe();
    return { before, armed, settled, diag: window.diag(), expected: 'viewport holds the answer top while it grows' };
};

window.K3 = async () => {
    await window.K2();
    const held = readProbe();
    // The answer finishes; later growth must move the reader again.
    window.setWorld({ isWorking: false, answerId: null, streamingId: null });
    await frames(10);
    const afterFinish = readProbe();
    window.grow(400);
    await frames(10);
    const afterGrowth = readProbe();
    return { held, afterFinish, afterGrowth, expected: 'growth after the answer moves the viewport again' };
};

window.K4 = async () => {
    await window.K2();
    await frames(10);
    const probe = readProbe();
    const clickable = document.querySelectorAll('[aria-label]').length > 0;
    return { probe, hasPill: clickable, expected: 'the pill is present and clickable while the top edge is held' };
};

window.K5 = async () => {
    await window.K2();
    const before = readProbe();
    const card = document.getElementById('card');
    press(card, 'pointerdown');
    await frames(5);
    const afterPress = readProbe();
    press(card, 'pointerup');
    window.grow(400);
    await frames(10);
    const afterGrowth = readProbe();
    return { before, afterPress, afterGrowth, expected: 'a pointer press on a card is not a reader gesture' };
};

window.K6 = async () => {
    await window.K2();
    const node = listRoot();
    node.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
    node.scrollTop = node.scrollHeight - node.clientHeight;
    await frames(5);
    const atEnd = readProbe();
    window.grow(300);
    await frames(10);
    const afterGrowth = readProbe();
    // The same return, but the list reports a total LONGER than the rows have -
    // the over-estimate a virtualized list produces while it re-measures.
    window.setWorld({ reportedContentLength: contentRoot().scrollHeight + 4000 });
    node.scrollTop = node.scrollHeight - node.clientHeight;
    await frames(5);
    const overEstimated = readProbe();
    window.grow(300);
    await frames(10);
    const overEstimatedGrowth = readProbe();
    return { atEnd, afterGrowth, overEstimated, overEstimatedGrowth, expected: 'following resumes on both returns' };
};

// The answer has finished, the session keeps working, and something lands at the
// end of the timeline (a question card, an allow prompt). The reader was left at
// the answer top by the pin: growth at the end must bring them to it.
window.K7 = async () => {
    await window.K2();
    window.setWorld({ isWorking: false, answerId: null, streamingId: null });
    await frames(10);
    const afterFinish = readProbe();
    window.setWorld({ isWorking: true });
    await frames(5);
    window.grow(200);
    await frames(10);
    const afterAction = readProbe();
    return { afterFinish, afterAction, expected: 'the new action at the end is shown' };
};

// A second answer starts while the reader is still held at the first one's top.
window.K8 = async () => {
    await window.K7();
    window.setWorld({ answerId: null, streamingId: null, answerHeight: 0 });
    await frames(5);
    window.grow(0);
    await frames(5);
    window.setWorld({ answerId: 'msg_a', streamingId: 'msg_a', answerHeight: 900 });
    await frames(20);
    const armed = readProbe();
    window.grow(200);
    await frames(10);
    const grown = readProbe();
    return { armed, grown, expected: 'the second answer holds its own top edge' };
};
`;

const build = await Bun.build({
    entrypoints: ['chat-scroll-live'],
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
        name: 'chat-scroll-live',
        setup(builder) {
            builder.onResolve({ filter: /^chat-scroll-live$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx' }));
            builder.onResolve({ filter: /^@openchamber\/ui\/(.*)$/ }, (args) => ({ path: resolveSource(args.path.replace(/^@openchamber\/ui\//, '')) }));
            builder.onResolve({ filter: /^@\/(.*)$/ }, (args) => ({ path: resolveSource(args.path.replace(/^@\//, '')) }));
            builder.onResolve({ filter: /^react$/ }, () => moduleFrom('react/index.js'));
            builder.onResolve({ filter: /^react-dom\/client$/ }, () => moduleFrom('react-dom/client.js'));
            builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => moduleFrom('react/jsx-runtime.js'));
            builder.onResolve({ filter: /^use-sync-external-store\/shim$/ }, () => ({ path: 'shim', namespace: 'react-shim' }));
            builder.onLoad({ filter: /.*/, namespace: 'react-shim' }, () => ({
                contents: `export { useSyncExternalStore } from ${JSON.stringify(join(uiModules, 'react/index.js'))};`,
                loader: 'js',
            }));
        },
    }],
});
assert.ok(build.success, build.logs.join('\n'));
const javascript = await build.outputs[0].text();

const chromePath = resolveChrome();
const profileDir = mkdtempSync(join(tmpdir(), 'openchamber-chat-scroll-'));
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
        return new URL(request.url).pathname === '/app.js'
            ? new Response(javascript, { headers: { 'Content-Type': 'application/javascript' } })
            : new Response('<!doctype html><div id="root"></div><script type="module" src="/app.js"></script>', {
                headers: { 'Content-Type': 'text/html' },
            });
    },
});
const port = await reservePort();
const chrome = launchChrome({ chrome: chromePath, port, profileDir, headless: true });
let client;
try {
    const target = await createPageTarget(port);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    const exceptions = [];
    client.on('Runtime.exceptionThrown', (event) => exceptions.push(event.exceptionDetails));
    const loaded = client.once('Page.loadEventFired');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/` });
    await loaded;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
        ready = await evaluateValue(client, 'typeof window.K1 === "function"');
        if (ready) break;
        await wait(100);
    }
    assert.ok(ready, 'The chat scroll fixture mounted');
    for (const name of ['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8']) {
        // The scenario already runs in the page; the JSON is taken there so a
        // rejected promise reports its own message instead of a bare "{}".
        const observed = await evaluateValue(client, `window.${name}().then((value) => JSON.stringify(value ?? null), (error) => 'REJECTED ' + ((error && (error.stack || error.message)) || error))`);
        console.log(`${name} ${observed}`);
    }
    const pageErrors = await evaluateValue(client, 'JSON.stringify(window.__errors ?? [])');
    console.log(`pageErrors ${pageErrors}`);
    for (const detail of exceptions) {
        const frames = (detail.stackTrace?.callFrames ?? []).slice(0, 6)
            .map((frame) => `${frame.functionName || '(anon)'}@${frame.url.split('/').pop()}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`);
        console.log(`exception ${detail.text} ${detail.exception?.description ?? ''} | ${frames.join(' <- ')}`);
    }
} finally {
    client?.socket.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
        const exited = new Promise((resolveExit) => chrome.once('exit', resolveExit));
        chrome.kill();
        await exited;
    }
    server.stop(true);
    rmSync(profileDir, { recursive: true, force: true });
}
