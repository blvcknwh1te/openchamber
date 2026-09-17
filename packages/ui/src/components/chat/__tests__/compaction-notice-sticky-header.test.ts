/**
 * Regression: the "Context compacted" notice used to be pinned in the sticky
 * transcript header. A compaction opens a turn so the assistant summary stays
 * parented to it, and the header takes a turn's opening message as the prompt
 * the user wrote - so while reading history the header showed the service
 * notice in place of the prompt the turn belongs to.
 *
 * The notice is a transcript row. It keeps opening the turn, and it is never the
 * prompt the header pins.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Part, UserMessage } from '@opencode-ai/sdk/v2';

import { isUserPromptMessage } from '../lib/messageDisplayNormalization';
import { projectTurnRecords } from '../lib/turns/projectTurnRecords';
import type { ChatMessageEntry } from '../lib/turns/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const messageListSource = readFileSync(join(__dirname, '..', 'MessageList.tsx'), 'utf-8');

const compactionPart = (messageID: string): Part => ({
    id: `${messageID}-compaction`, messageID, sessionID: 'session', type: 'compaction', auto: false,
});

const promptPart = (messageID: string, text: string): Part => ({
    id: `${messageID}-text`, messageID, sessionID: 'session', type: 'text', text,
});

const userMessage = (id: string, parts: Part[]): ChatMessageEntry => ({
    info: {
        id, sessionID: 'session', role: 'user', time: { created: 1 },
        agent: 'build', model: { providerID: 'provider', modelID: 'model' },
    } satisfies UserMessage,
    parts,
});

const projectTurn = (message: ChatMessageEntry) => {
    const turn = projectTurnRecords([message]).turns[0];
    if (!turn) {
        throw new Error('expected the transcript message to open a turn');
    }
    return turn;
};

describe('sticky transcript header', () => {
    test('a compaction notice opens a turn that carries no prompt', () => {
        const notice = projectTurn(userMessage('msg-compact', [compactionPart('msg-compact')]));

        expect(notice.turnId).toBe('msg-compact');
        expect(isUserPromptMessage(notice.userMessage, { planModeEnabled: false })).toBe(false);
    });

    test('an ordinary user message opens a turn that carries its prompt', () => {
        const prompt = projectTurn(userMessage('msg-1', [promptPart('msg-1', 'Fix the sticky header')]));

        expect(isUserPromptMessage(prompt.userMessage, { planModeEnabled: false })).toBe(true);
    });

    test('MessageList pins the header only through that decision', () => {
        const headerProp = /stickyUserHeader=\{([^}]*)\}/.exec(messageListSource)?.[1] ?? '';

        expect(headerProp).toContain('turnPinsUserPrompt');
        expect(messageListSource).toContain('turnPinsUserPrompt = React.useMemo');
        expect(messageListSource).toContain('() => isUserPromptMessage(turn.userMessage, { planModeEnabled })');
    });
});
