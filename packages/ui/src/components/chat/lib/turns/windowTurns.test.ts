import { describe, expect, test } from 'bun:test';
import type { Message, Part, UserMessage } from '@opencode-ai/sdk/v2';
import { buildTurnWindowModel, updateTurnWindowModelIncremental } from './windowTurns';
import type { ChatMessageEntry } from './types';

function message({ id, role, parentID }: { id: string; role: 'user' | 'assistant' | 'system'; parentID?: string }): ChatMessageEntry {
    return {
        info: {
            id,
            role,
            ...(parentID ? { parentID } : {}),
            time: { created: 1 },
        } as Message,
        parts: [] as Part[],
    };
}

const compactionMessage = (id: string): ChatMessageEntry => ({
    info: {
        id, sessionID: 'session', role: 'user', time: { created: 1 },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts: [{ id: `${id}-compaction`, messageID: id, sessionID: 'session', type: 'compaction', auto: true }],
});

describe('windowTurns', () => {
    test('does not map assistant messages without a parent to the current turn', () => {
        const user = message({ id: 'u1', role: 'user' });
        const assistant = message({ id: 'a1', role: 'assistant' });

        const model = buildTurnWindowModel([user, assistant]);

        expect(model.messageToTurnId.get('u1')).toBe('u1');
        expect(model.messageToTurnId.has('a1')).toBe(false);
    });

    test('incremental update does not map assistant messages without a parent to the current turn', () => {
        const user = message({ id: 'u1', role: 'user' });
        const assistant = message({ id: 'a1', role: 'assistant' });
        const base = buildTurnWindowModel([user]);

        const next = updateTurnWindowModelIncremental(base, [user], [user, assistant]);

        expect(next?.messageToTurnId.get('u1')).toBe('u1');
        expect(next?.messageToTurnId.has('a1')).toBe(false);
    });

    test('maps assistant messages to their parent user turn', () => {
        const user = message({ id: 'u1', role: 'user' });
        const assistant = message({ id: 'a1', role: 'assistant', parentID: 'u1' });

        const model = buildTurnWindowModel([user, assistant]);

        expect(model.messageToTurnId.get('a1')).toBe('u1');
    });

    test('keeps a service compaction on the turn it continues', () => {
        const user = message({ id: 'u1', role: 'user' });
        const assistant = message({ id: 'a1', role: 'assistant', parentID: 'u1' });
        const compaction = compactionMessage('u2');
        const reply = message({ id: 'a2', role: 'assistant', parentID: 'u2' });

        const model = buildTurnWindowModel([user, assistant, compaction, reply]);

        expect(model.turnIds).toEqual(['u1']);
        expect(model.messageToTurnId.get('u2')).toBe('u1');
        expect(model.messageToTurnId.get('a2')).toBe('u1');
    });

    test('incremental update keeps a service compaction on the turn it continues', () => {
        const user = message({ id: 'u1', role: 'user' });
        const assistant = message({ id: 'a1', role: 'assistant', parentID: 'u1' });
        const compaction = compactionMessage('u2');
        const base = buildTurnWindowModel([user, assistant]);

        const next = updateTurnWindowModelIncremental(base, [user, assistant], [user, assistant, compaction]);

        expect(next?.turnIds).toEqual(['u1']);
        expect(next?.messageToTurnId.get('u2')).toBe('u1');
    });

    test('a service compaction that starts the transcript opens a turn', () => {
        const model = buildTurnWindowModel([compactionMessage('u1')]);

        expect(model.turnIds).toEqual(['u1']);
        expect(model.messageToTurnId.get('u1')).toBe('u1');
    });
});
