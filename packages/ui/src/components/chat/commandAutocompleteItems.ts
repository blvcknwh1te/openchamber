import { fuzzyMatch } from '@/lib/utils';

export interface CommandAutocompleteSearchItem {
  name: string;
  description?: string;
  searchAliases?: string[];
  isBuiltIn?: boolean;
  isSkill?: boolean;
}

function addSearchAliases<T extends CommandAutocompleteSearchItem>(winner: T, duplicate: T): T {
  const existingAliases = winner.searchAliases ?? [];
  const aliases = [
    ...existingAliases,
    ...(winner.name === duplicate.name ? [] : [duplicate.name]),
    ...(duplicate.description ? [duplicate.description] : []),
    ...(duplicate.searchAliases ?? []),
  ].filter((alias, index, values) => alias !== winner.description && values.indexOf(alias) === index);
  const unchanged = aliases.length === existingAliases.length
    && aliases.every((alias, index) => alias === existingAliases[index]);

  return unchanged ? winner : { ...winner, searchAliases: aliases };
}

/**
 * Precedence is local command, discovered skill, OpenCode skill-command, then
 * custom/plugin command. Identity matches session.command's case-sensitive lookup.
 */
export function mergeCommandAutocompleteItems<T extends CommandAutocompleteSearchItem>(
  builtIns: T[],
  commands: T[],
  skills: T[],
): T[] {
  const merged: T[] = [];
  const byName = new Map<string, { index: number; item: T; precedence: number }>();

  const addItems = (items: T[], getPrecedence: (item: T) => number) => {
    for (const item of items) {
      const precedence = getPrecedence(item);
      const identity = item.name;
      const existing = byName.get(identity);
      if (!existing) {
        byName.set(identity, { index: merged.length, item, precedence });
        merged.push(item);
        continue;
      }

      const winner = precedence > existing.precedence
        ? addSearchAliases(item, existing.item)
        : addSearchAliases(existing.item, item);
      merged[existing.index] = winner;
      byName.set(identity, {
        index: existing.index,
        item: winner,
        precedence: Math.max(existing.precedence, precedence),
      });
    }
  };

  addItems(builtIns, () => 3);
  addItems(commands, (item) => item.isBuiltIn ? 3 : item.isSkill ? 1 : 0);
  addItems(skills, () => 2);
  return merged;
}

/**
 * The two independent discovery passes behind the palette. They answer
 * separately: commands come from the commands store, skills from the skills
 * store, and neither request knows about the other.
 */
const COMMAND_AUTOCOMPLETE_SOURCES = ['commands', 'skills'] as const;

export type CommandAutocompleteSource = typeof COMMAND_AUTOCOMPLETE_SOURCES[number];

/** `pending` means "not answered yet", so the palette has no full list to show. */
export type CommandAutocompleteSourceStatus = 'pending' | 'ready' | 'failed';

export interface CommandAutocompleteReadiness {
  commands: CommandAutocompleteSourceStatus;
  skills: CommandAutocompleteSourceStatus;
}

export function createCommandAutocompleteReadiness() {
  return { commands: 'pending', skills: 'pending' } satisfies CommandAutocompleteReadiness;
}

/** Keeps the previous object when the answer repeats, so renders stay stable. */
export function applyCommandAutocompleteSourceResult(
  readiness: CommandAutocompleteReadiness,
  source: CommandAutocompleteSource,
  loaded: boolean,
): CommandAutocompleteReadiness {
  const status: CommandAutocompleteSourceStatus = loaded ? 'ready' : 'failed';
  return readiness[source] === status ? readiness : { ...readiness, [source]: status };
}

/**
 * True once both sources have answered, including answering with a failure:
 * a failed source also settles the list, it does not keep the palette waiting
 * forever.
 */
export function isCommandAutocompleteReady(readiness: CommandAutocompleteReadiness): boolean {
  return readiness.commands !== 'pending' && readiness.skills !== 'pending';
}

/**
 * The palette shows progress until there is something to show; an empty
 * snapshot that predates the answers is not evidence of "no commands", so it
 * must not be rendered as one. Known items stay visible while the other source
 * is still answering.
 */
export function isCommandAutocompleteLoading(
  readiness: CommandAutocompleteReadiness,
  itemCount: number,
): boolean {
  return !isCommandAutocompleteReady(readiness) && itemCount === 0;
}

function failedCommandAutocompleteSources(
  readiness: CommandAutocompleteReadiness,
): CommandAutocompleteSource[] {
  return COMMAND_AUTOCOMPLETE_SOURCES.filter((source) => readiness[source] === 'failed');
}

export interface CommandAutocompleteSourceLoaders {
  /** Loads the commands discovered for the palette's directory. */
  loadCommands: () => Promise<boolean>;
  /** Loads the skills discovered for the palette's directory. */
  loadSkills: () => Promise<boolean>;
}

/**
 * Runs both discovery passes and reports how each one answered.
 *
 * The palette needs the whole set of commands and skills, and the two requests
 * are independent — rendering whichever finished first is what made the list
 * look empty or partial. A source that answers with a failure is asked once
 * more, so one transient error cannot leave the list partial for as long as the
 * palette stays open. Both loaders report failure as `false`, so this never
 * rejects.
 */
export async function loadCommandAutocompleteSources(
  loaders: CommandAutocompleteSourceLoaders,
): Promise<CommandAutocompleteReadiness> {
  const load = (source: CommandAutocompleteSource): Promise<boolean> =>
    source === 'commands' ? loaders.loadCommands() : loaders.loadSkills();
  const answers = await Promise.all(
    COMMAND_AUTOCOMPLETE_SOURCES.map(async (source): Promise<[CommandAutocompleteSource, boolean]> =>
      [source, await load(source)],
    ),
  );
  const readiness = answers.reduce<CommandAutocompleteReadiness>(
    (next, [source, loaded]) => applyCommandAutocompleteSourceResult(next, source, loaded),
    createCommandAutocompleteReadiness(),
  );

  const failed = failedCommandAutocompleteSources(readiness);
  if (failed.length === 0) {
    return readiness;
  }

  const retried = await Promise.all(
    failed.map(async (source): Promise<[CommandAutocompleteSource, boolean]> =>
      [source, await load(source)],
    ),
  );
  return retried.reduce(
    (next, [source, loaded]) => applyCommandAutocompleteSourceResult(next, source, loaded),
    readiness,
  );
}

export function commandMatchesSearch(command: CommandAutocompleteSearchItem, query: string): boolean {
  return fuzzyMatch(command.name, query)
    || Boolean(command.description && fuzzyMatch(command.description, query))
    || Boolean(command.searchAliases?.some((alias) => fuzzyMatch(alias, query)));
}

/**
 * Narrows and orders a merged command list for the palette.
 *
 * Discovery feeds this from several sources (built-ins, OpenCode commands,
 * skills); one malformed entry must cost only itself. Entries without a usable
 * name are dropped instead of reaching lookups and sorting, so a single bad
 * record cannot blank out the whole palette.
 */
export function filterAndSortCommandItems<T extends CommandAutocompleteSearchItem>(
  items: readonly T[],
  query: string | undefined,
): T[] {
  const normalizedQuery = (query ?? '').trim();
  const named = items.filter((item) => item.name.trim().length > 0);
  const matched = normalizedQuery
    ? named.filter((item) => commandMatchesSearch(item, normalizedQuery))
    : named;
  const loweredQuery = normalizedQuery.toLowerCase();

  return [...matched].sort((left, right) => {
    const leftStarts = left.name.toLowerCase().startsWith(loweredQuery);
    const rightStarts = right.name.toLowerCase().startsWith(loweredQuery);
    if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
