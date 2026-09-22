import { describe, expect, test } from 'bun:test';

import type { Command } from '@/stores/useCommandsStore';
import type { DiscoveredSkill } from '@/stores/useSkillsStore';
import { buildSlashEntities } from '../slashEntities';

const command = (name: string, mdPath: string | null = null): Command => ({ name, mdPath });

const skill = (name: string, path: string): DiscoveredSkill => ({
    name,
    path,
    scope: 'user',
    source: 'opencode',
});

describe('buildSlashEntities', () => {
    test('keeps commands and skills in one list', () => {
        const entities = buildSlashEntities({
            commands: [command('ship', '/repo/.opencode/command/ship.md')],
            skills: [skill('explore', '/s/explore/SKILL.md')],
        });

        expect(entities.map((entity) => [entity.kind, entity.name])).toEqual([
            ['command', 'ship'],
            ['skill', 'explore'],
        ]);
    });

    test('a name claimed by both kinds stays a command', () => {
        const entities = buildSlashEntities({
            commands: [command('deploy')],
            skills: [skill('deploy', '/x/SKILL.md')],
        });

        expect(entities).toHaveLength(1);
        expect(entities[0].kind).toBe('command');
    });

    test('carries the definition file, and leaves it absent for built-ins', () => {
        const entities = buildSlashEntities({
            commands: [command('ship', '/repo/ship.md'), command('init')],
            skills: [skill('explore', '/s/explore/SKILL.md')],
        });

        expect(entities.find((entity) => entity.name === 'ship')?.filePath).toBe('/repo/ship.md');
        expect(entities.find((entity) => entity.name === 'init')?.filePath).toBeUndefined();
        expect(entities.find((entity) => entity.name === 'explore')?.filePath).toBe('/s/explore/SKILL.md');
    });
});
