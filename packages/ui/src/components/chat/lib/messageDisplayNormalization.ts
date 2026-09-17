import type { Part } from '@opencode-ai/sdk/v2';
import { filterSyntheticParts } from '@/lib/messages/synthetic';
import { isHiddenUserMessage } from '../message/hiddenUserMessage';
import { normalizeParts } from '../message/partUtils';
import type { ChatMessageEntry } from './turns/types';

/**
 * Command texts that carry a service compaction instead of message content.
 * OpenCode stores the command as a `text` part while only the local echo exists
 * and rewrites the turn into a `compaction` part once the server takes over, so
 * both shapes are one turn on every surface. A new compaction command is added
 * here, never by comparing its text at a call site.
 */
export const COMPACTION_COMMAND_TEXTS: readonly string[] = ['/compact'];

const isCompactionPart = (part: Part): boolean => part.type === 'compaction';

const isCompactionCommandPart = (part: Part): boolean =>
    part.type === 'text' && COMPACTION_COMMAND_TEXTS.includes(part.text.trim());

/**
 * Server-written compaction part only. The transcript notice keys off this
 * marker, which the command-text shape never has.
 */
export const hasCompactionPart = (message: ChatMessageEntry): boolean => {
    return message.parts.some(isCompactionPart);
};

/**
 * Service compaction in either shape OpenCode reports it: a `compaction` part,
 * or the command text while only the local echo exists. Single source of truth
 * for "this turn is a service action, not message content".
 */
export const hasServiceCompaction = (parts: readonly Part[]): boolean => {
    return parts.some((part) => isCompactionPart(part) || isCompactionCommandPart(part));
};

/**
 * Whether a turn's opening message is a prompt the user sent, as opposed to a
 * row that opens a turn without carrying one. Two shapes are such rows: a
 * service compaction, which is kept in place so its summary stays parented, and
 * a user message whose parts survive no display normalization. The sticky
 * transcript header pins the prompt of a turn, so it asks this instead of
 * comparing content itself.
 */
export const isUserPromptMessage = (
    message: ChatMessageEntry,
    options: { planModeEnabled: boolean },
): boolean => {
    return !hasServiceCompaction(message.parts) && !isHiddenUserMessage(message, options);
};

// A compaction part is a service action, not message content: it is kept in
// place (the transcript renders it as a notice, not as text) so the turn keeps
// its boundary, and only the display role is settled here.
const normalizeCompactionCommandMessage = (message: ChatMessageEntry): ChatMessageEntry => {
    if (!hasCompactionPart(message)) {
        return message;
    }

    const info = message.info as unknown as { clientRole?: string | null | undefined };
    if (info.clientRole === 'user') {
        return message;
    }

    return {
        ...message,
        info: ({
            ...(message.info as unknown as Record<string, unknown>),
            clientRole: 'user',
        } as unknown as typeof message.info),
    };
};

const normalizeMessageParts = (message: ChatMessageEntry): ChatMessageEntry => {
    const parts = normalizeParts(message.parts);
    if (parts.length === message.parts.length) {
        return message;
    }
    return {
        ...message,
        parts,
    };
};

const normalizedMessageBySource = new WeakMap<ChatMessageEntry, ChatMessageEntry>();

export const getNormalizedMessageForDisplay = (message: ChatMessageEntry): ChatMessageEntry => {
    const cached = normalizedMessageBySource.get(message);
    if (cached) {
        return cached;
    }

    const normalizedPartMessage = normalizeMessageParts(message);
    const normalizedCompactionMessage = normalizeCompactionCommandMessage(normalizedPartMessage);
    const filteredParts = filterSyntheticParts(normalizedCompactionMessage.parts);
    const normalized = filteredParts === normalizedCompactionMessage.parts
        ? normalizedCompactionMessage
        : {
            ...normalizedCompactionMessage,
            parts: filteredParts,
        };

    normalizedMessageBySource.set(message, normalized);
    return normalized;
};
