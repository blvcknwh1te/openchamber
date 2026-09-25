/**
 * The live compaction notice has to reach the transcript in the shape it already
 * renders from, without touching the notice component, the message list, or the
 * turn projection: a `compaction` part on a user row plus the assistant message
 * flagged `summary` that carries the streaming text. This test drives the sync
 * snapshot that produces those rows into the turn projection the transcript
 * renders, and checks the notice is visible while the summary still streams.
 */
import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Event, Part, UserMessage } from '@opencode-ai/sdk/v2/client';

import { applyDirectoryEvent } from '@/sync/event-reducer';
import { buildSessionMessageRecordsSnapshot } from '@/sync/sync-context';
import { INITIAL_STATE, type State } from '@/sync/types';

import { getCompactionPart, isUserPromptMessage } from '../lib/messageDisplayNormalization';
import { findCompactionContext } from '../lib/turns/compactionContext';
import { projectTurnRecords } from '../lib/turns/projectTurnRecords';

const SESSION_ID = 'ses_1';
const COMPACTION_MESSAGE_ID = 'msg_compact';
const PERSISTED_SUMMARY_MESSAGE_ID = 'msg_compact_summary';

let eventSequence = 0;
/** A unique relay id, so no test can be rescued by duplicate-event filtering. */
const eventId = () => `evt_${++eventSequence}`;

const compactionStarted = (): Event => ({
    id: eventId(),
    type: 'session.next.compaction.started',
    properties: { timestamp: 10, sessionID: SESSION_ID, messageID: COMPACTION_MESSAGE_ID, reason: 'auto' },
});

const compactionDelta = (text: string): Event => ({
    id: eventId(),
    type: 'session.next.compaction.delta',
    properties: { timestamp: 11, sessionID: SESSION_ID, messageID: COMPACTION_MESSAGE_ID, text },
});

const compactionUserMessage: UserMessage = {
    id: COMPACTION_MESSAGE_ID,
    sessionID: SESSION_ID,
    role: 'user',
    time: { created: 10 },
    agent: 'compaction',
    model: { providerID: 'provider', modelID: 'model' },
};

const compactionNoticePart: Part = {
    id: 'prt_compact',
    sessionID: SESSION_ID,
    messageID: COMPACTION_MESSAGE_ID,
    type: 'compaction',
    auto: true,
};

/** What OpenCode persists once the compaction is stored. */
const persistedCompaction = (summary: string): Event[] => [
    {
        id: eventId(),
        type: 'message.updated',
        properties: { sessionID: SESSION_ID, info: compactionUserMessage },
    },
    {
        id: eventId(),
        type: 'message.part.updated',
        properties: { sessionID: SESSION_ID, part: compactionNoticePart, time: 12 },
    },
    {
        id: eventId(),
        type: 'message.updated',
        properties: {
            sessionID: SESSION_ID,
            info: {
                id: PERSISTED_SUMMARY_MESSAGE_ID,
                sessionID: SESSION_ID,
                role: 'assistant',
                time: { created: 10, completed: 12 },
                parentID: COMPACTION_MESSAGE_ID,
                modelID: 'model',
                providerID: 'provider',
                mode: 'compaction',
                agent: 'compaction',
                path: { cwd: '/repo', root: '/repo' },
                summary: true,
                cost: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            } satisfies AssistantMessage,
        },
    },
    {
        id: eventId(),
        type: 'message.part.updated',
        properties: {
            sessionID: SESSION_ID,
            part: {
                id: 'prt_persisted_summary',
                sessionID: SESSION_ID,
                messageID: PERSISTED_SUMMARY_MESSAGE_ID,
                type: 'text',
                text: summary,
            },
            time: 12,
        },
    },
];

const promptMessage: UserMessage = {
    id: 'msg_user',
    sessionID: SESSION_ID,
    role: 'user',
    time: { created: 1 },
    agent: 'build',
    model: { providerID: 'provider', modelID: 'model' },
};

const promptPart: Part = {
    id: 'prt_user',
    sessionID: SESSION_ID,
    messageID: promptMessage.id,
    type: 'text',
    text: 'do the thing',
};

const answerMessage: AssistantMessage = {
    id: 'msg_answer',
    sessionID: SESSION_ID,
    role: 'assistant',
    time: { created: 2 },
    parentID: promptMessage.id,
    modelID: 'model',
    providerID: 'provider',
    mode: 'build',
    agent: 'build',
    path: { cwd: '/repo', root: '/repo' },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
};

const promptDelivery = (): Event[] => [
    { id: eventId(), type: 'message.updated', properties: { sessionID: SESSION_ID, info: promptMessage } },
    { id: eventId(), type: 'message.part.updated', properties: { sessionID: SESSION_ID, part: promptPart, time: 1 } },
    { id: eventId(), type: 'message.updated', properties: { sessionID: SESSION_ID, info: answerMessage } },
];

/** A session mid-turn: one prompt, one answer still streaming. */
function streamingSessionState(): State {
    return {
        ...INITIAL_STATE,
        message: { [SESSION_ID]: [promptMessage, answerMessage] },
        part: { [promptMessage.id]: [promptPart], [answerMessage.id]: [] },
        session_status: {},
    };
}

function applyAll(current: State, events: readonly Event[]): State {
    return events.reduce((state, event) => {
        const draft = { ...state };
        applyDirectoryEvent(draft, event);
        return draft;
    }, current);
}

describe('live compaction notice', () => {
    test('a streaming compaction delta is visible in the turn before the session goes idle', () => {
        const state = applyAll(streamingSessionState(), [
            compactionStarted(),
            compactionDelta('The history was rewritten.'),
        ]);
        // Nothing settled yet: the notice cannot be waiting for session.idle.
        expect(state.session_status[SESSION_ID]).toBeUndefined();

        const messages = buildSessionMessageRecordsSnapshot(state, SESSION_ID).list;
        const { turns } = projectTurnRecords(messages);

        expect(turns).toHaveLength(1);
        const [turn] = turns;
        // The notice joins the turn in flight instead of replacing its prompt.
        expect(turn?.noticeMessages.map((message) => message.info.id)).toEqual([COMPACTION_MESSAGE_ID]);
        expect(turn?.userMessage.info.id).toBe(promptMessage.id);

        const notice = turn?.noticeMessages[0];
        expect(notice && getCompactionPart(notice)?.type).toBe('compaction');
        expect(notice && isUserPromptMessage(notice, { planModeEnabled: false })).toBe(false);

        // The streaming text reaches the notice the same way the persisted
        // summary does, so opening it shows what the model now holds.
        expect(findCompactionContext(messages, COMPACTION_MESSAGE_ID)).toMatchObject({
            summary: 'The history was rewritten.',
        });
    });

    test('the notice hands over to the persisted compaction without changing place', () => {
        const state = applyAll(streamingSessionState(), [
            compactionStarted(),
            compactionDelta('streamed'),
            ...persistedCompaction('The persisted summary.'),
        ]);

        const messages = buildSessionMessageRecordsSnapshot(state, SESSION_ID).list;
        const { turns } = projectTurnRecords(messages);

        // One notice, one summary: the live row gave way to the persisted one.
        expect(turns[0]?.noticeMessages.map((message) => message.info.id)).toEqual([COMPACTION_MESSAGE_ID]);
        expect(messages.filter((message) => getCompactionPart(message) !== undefined)).toHaveLength(1);
        expect(findCompactionContext(messages, COMPACTION_MESSAGE_ID)).toMatchObject({
            summary: 'The persisted summary.',
        });
    });

    test('the authoritative message for the notice replaces the live row it shares an ID with', () => {
        const state = applyAll(streamingSessionState(), [
            compactionStarted(),
            compactionDelta('streamed'),
            { id: eventId(), type: 'message.updated', properties: { sessionID: SESSION_ID, info: compactionUserMessage } },
        ]);

        const messages = buildSessionMessageRecordsSnapshot(state, SESSION_ID).list;

        // The notice is on screen once, from the row the server owns.
        expect(messages.filter((message) => message.info.id === COMPACTION_MESSAGE_ID)).toHaveLength(1);
        expect(messages.some((message) => message.info.summary === true)).toBe(false);
    });

    test('a compaction delta that arrives on the global stream reaches the turn', async () => {
        const { createEventRoutingIndex, handleEvent } = await import('@/sync/sync-context');
        const { ChildStoreManager } = await import('@/sync/child-store');

        const childStores = new ChildStoreManager();
        const store = childStores.ensureChild('/repo', { bootstrap: false });
        const routingIndex = createEventRoutingIndex();
        const deliver = (directory: string, event: Event) =>
            handleEvent(directory, event, childStores, routingIndex, 'test-runtime');

        // The session's own messages index it under its directory.
        for (const event of promptDelivery()) {
            deliver('/repo', event);
        }

        // The compaction carries no directory of its own: the relay delivers it
        // on the global stream, and the session is what places it.
        deliver('global', compactionStarted());
        deliver('global', compactionDelta('The history was rewritten.'));

        const messages = buildSessionMessageRecordsSnapshot(store.getState(), SESSION_ID).list;
        const { turns } = projectTurnRecords(messages);

        expect(turns[0]?.noticeMessages.map((message) => message.info.id)).toEqual([COMPACTION_MESSAGE_ID]);
        expect(findCompactionContext(messages, COMPACTION_MESSAGE_ID)).toMatchObject({
            summary: 'The history was rewritten.',
        });
    });
});
