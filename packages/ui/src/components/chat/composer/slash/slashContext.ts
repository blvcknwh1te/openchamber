/**
 * What the model is told about the slash entities a message references.
 *
 * The previous instruction listed skill names and asked the model to call the
 * skill tool. A name alone tells the model little about the user's intent, and
 * commands were not described at all, so `выполни /ship` reached the model as
 * plain text. Naming the file that defines the entity keeps the reference next
 * to the user's own words.
 */

import type { SlashMention } from './slashMentions';

const describeMention = ({ entity }: SlashMention): string => {
    const label = `/${entity.name}`;
    if (entity.filePath) {
        return `- \`${label}\` is a ${entity.kind} defined in \`${entity.filePath}\`; read that file before acting on it.`;
    }

    const description = entity.description ? `: ${entity.description}` : '';
    return `- \`${label}\` is a built-in ${entity.kind} without a definition file${description}.`;
};

/** Instructions for the entities named in one message, or null when there are none. */
export const buildSlashMentionsContext = (mentions: readonly SlashMention[]): string | null => {
    if (mentions.length === 0) return null;

    return [
        'The user referenced these slash entities in their message. Treat each one as the user meant it, in the context of the surrounding text:',
        ...mentions.map(describeMention),
    ].join('\n');
};
