import { filterSyntheticParts } from '@/lib/messages/synthetic';
import { normalizeParts } from '../message/partUtils';
import type { ChatMessageEntry } from './turns/types';

export const hasCompactionPart = (message: ChatMessageEntry): boolean => {
    return message.parts.some((part) => {
        const type = (part as { type?: unknown } | null | undefined)?.type;
        return type === 'compaction';
    });
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
