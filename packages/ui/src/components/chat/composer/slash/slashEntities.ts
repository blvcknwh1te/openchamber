/**
 * The composer's slash entities: `/command` and `/skill` as one list.
 *
 * Commands and skills were two registries with two pickers, two scanners and
 * two insert rules, although to the user they are one construct: a slash name
 * that resolves to a definition file. They are joined here, once, for both the
 * picker and the send-time context.
 */

import type { Command } from '@/stores/useCommandsStore';
import type { DiscoveredSkill } from '@/stores/useSkillsStore';

export type SlashEntityKind = 'command' | 'skill';

export interface SlashEntity {
    kind: SlashEntityKind;
    name: string;
    description?: string;
    /** The file that defines the entity; absent for built-ins without one. */
    filePath?: string;
    /** Badge shown next to the name. */
    source?: string;
    scope?: string;
}

export interface SlashEntitySources {
    skills: readonly DiscoveredSkill[];
    commands: readonly Command[];
}

/**
 * A name claimed by both kinds stays a command: the command palette has always
 * outranked the inline skill picker, and a `/name` that is both must not change
 * meaning depending on which picker opened.
 */
export const buildSlashEntities = ({ skills, commands }: SlashEntitySources): SlashEntity[] => {
    const entities: SlashEntity[] = [];
    const claimed = new Set<string>();

    for (const command of commands) {
        if (claimed.has(command.name)) continue;
        claimed.add(command.name);
        entities.push({
            kind: 'command',
            name: command.name,
            description: command.description,
            filePath: command.mdPath ?? undefined,
            source: command.source,
            scope: command.scope,
        });
    }

    for (const skill of skills) {
        if (claimed.has(skill.name)) continue;
        claimed.add(skill.name);
        entities.push({
            kind: 'skill',
            name: skill.name,
            description: skill.description,
            filePath: skill.path,
            source: skill.source,
            scope: skill.scope,
        });
    }

    return entities;
};
