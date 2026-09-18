/**
 * Regression: the "Context compacted" notice used to open its own turn, so the
 * sticky transcript header vanished while the answers around the notice
 * scrolled by. The notice now stays inside the turn it belongs to and keeps
 * that turn's prompt header pinned.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { AssistantMessage, Part, UserMessage } from '@opencode-ai/sdk/v2';

import { projectTurnRecords } from '../lib/turns/projectTurnRecords';
import { selectTranscriptMessages } from '../lib/turns/transcriptMessages';
import type { ChatMessageEntry, TurnRecord } from '../lib/turns/types';
import TurnItem from './TurnItem';

const textPart = (messageID: string, text: string): Part => ({
    id: `${messageID}-text`, messageID, sessionID: 'session', type: 'text', text,
});

const compactionPart = (messageID: string): Part => ({
    id: `${messageID}-compaction`, messageID, sessionID: 'session', type: 'compaction', auto: true,
});

// The synthetic continuation OpenCode appends after a compaction hides itself
// in display normalization, so the turn it opens merges into the previous one.
const continuationPart = (messageID: string): Part => ({
    id: `${messageID}-text`, messageID, sessionID: 'session', type: 'text', synthetic: true,
    text: 'Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.',
});

const userMessage = (id: string, parts: Part[], createdAt: number): ChatMessageEntry => ({
    info: {
        id, sessionID: 'session', role: 'user', time: { created: createdAt },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts,
});

const assistantMessage = (
    id: string,
    parentID: string,
    parts: Part[],
    createdAt: number,
    isCompactionSummary = false,
): ChatMessageEntry => {
    const info: AssistantMessage = {
        id, sessionID: 'session', role: 'assistant', parentID,
        time: { created: createdAt, completed: createdAt },
        modelID: 'model', providerID: 'provider', mode: 'build', agent: 'build',
        path: { cwd: '/project', root: '/project' },
        cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: 'stop',
    };
    if (isCompactionSummary) {
        info.summary = true;
    }
    return { info, parts };
};

const projectTurn = (messages: ChatMessageEntry[]): TurnRecord => {
    const turn = projectTurnRecords(messages, { mergeHiddenUserTurns: { planModeEnabled: false } }).turns[0];
    if (!turn) {
        throw new Error('expected the transcript to open a turn');
    }
    return turn;
};

describe('turn notices', () => {
    let root: Root;
    let container: HTMLDivElement;
    let restore: () => void;

    beforeEach(() => {
        const win = new Window({ url: 'http://localhost' });
        const globals = {
            window: win, document: win.document, HTMLElement: win.HTMLElement,
            Element: win.Element, SVGElement: win.SVGElement, NodeList: win.NodeList,
            requestAnimationFrame: win.requestAnimationFrame.bind(win),
            cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
            getComputedStyle: win.getComputedStyle.bind(win),
            IS_REACT_ACT_ENVIRONMENT: true,
        };
        const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
        for (const [name, value] of Object.entries(globals)) {
            Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
        }
        restore = () => {
            for (const [name, descriptor] of previous) {
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
        };
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        restore();
    });

    const renderTurn = async (turn: TurnRecord, assistantContent?: React.ReactNode): Promise<(string | null)[]> => {
        // MessageList drops the compaction summary from the answer block before
        // the turn renders, so the fixture does the same.
        const renderableTurn = { ...turn, assistantMessages: selectTranscriptMessages(turn.assistantMessages) };
        const renderMessage = (rendered: ChatMessageEntry) => (
            <div key={rendered.info.id} data-fixture-message={rendered.info.id}>
                {rendered.parts
                    .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
                    .map((part) => part.text)
                    .join(' ')}
            </div>
        );

        await act(async () => root.render(
            <TurnItem turn={renderableTurn} stickyUserHeader renderMessage={renderMessage} assistantContent={assistantContent} />,
        ));

        return Array.from(container.querySelectorAll('[data-fixture-message]'))
            .map((element) => element.getAttribute('data-fixture-message'));
    };

    test('keeps the prompt as the header of the turn a compaction joined', async () => {
        const turn = projectTurn([
            userMessage('u1', [textPart('u1', 'Fix the sticky header')], 1),
            assistantMessage('a1', 'u1', [], 2),
            userMessage('u2', [compactionPart('u2')], 3),
        ]);

        const order = await renderTurn(turn);

        expect(container.querySelector('.sticky')?.textContent).toBe('Fix the sticky header');
        expect(order).toEqual(['u1', 'a1', 'u2']);
    });

    test('renders a compaction notice before the answers parented to it', async () => {
        const turn = projectTurn([
            userMessage('u1', [textPart('u1', 'prompt')], 1),
            userMessage('u2', [compactionPart('u2')], 2),
            assistantMessage('a1', 'u2', [], 3),
        ]);

        expect(await renderTurn(turn)).toEqual(['u1', 'u2', 'a1']);
    });

    test('renders a compaction notice after the answers that preceded it', async () => {
        const turn = projectTurn([
            userMessage('u1', [textPart('u1', 'prompt')], 1),
            assistantMessage('a1', 'u1', [], 2),
            userMessage('u2', [compactionPart('u2')], 3),
            assistantMessage('a2', 'u2', [], 4, true),
        ]);

        expect(await renderTurn(turn)).toEqual(['u1', 'a1', 'u2']);
    });

    test('renders every notice and the answers between them in transcript order', async () => {
        // The shape a long session produces: compaction, summary, synthetic
        // continuation, answers, another compaction - all inside one turn.
        const turn = projectTurn([
            userMessage('u1', [textPart('u1', 'prompt')], 1),
            assistantMessage('a1', 'u1', [], 2),
            userMessage('u2', [compactionPart('u2')], 3),
            assistantMessage('a2', 'u2', [], 4, true),
            userMessage('u3', [continuationPart('u3')], 5),
            assistantMessage('a3', 'u3', [], 6),
            userMessage('u4', [compactionPart('u4')], 7),
            assistantMessage('a4', 'u4', [], 8, true),
        ]);

        expect(await renderTurn(turn)).toEqual(['u1', 'a1', 'u2', 'a3', 'u4']);
    });

    test('keeps a notice in front of a collapsed live block and moves the rest after it', async () => {
        const turn = projectTurn([
            userMessage('u1', [textPart('u1', 'prompt')], 1),
            userMessage('u2', [compactionPart('u2')], 2),
            assistantMessage('a1', 'u2', [], 3),
            userMessage('u3', [compactionPart('u3')], 4),
        ]);

        const order = await renderTurn(turn, <div data-fixture-message="live" />);

        expect(order).toEqual(['u1', 'u2', 'live', 'u3']);
    });
});
