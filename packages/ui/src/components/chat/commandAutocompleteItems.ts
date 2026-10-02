import { fuzzyMatch } from '@/lib/utils';

/**
 * The kinds of entry the `/` picker can show. They are one explicit union
 * rather than a pair of booleans, so a new discovery source (rules) is added in
 * one place instead of every `isSkill` check drifting apart.
 */
export const COMMAND_AUTOCOMPLETE_KINDS = ['command', 'skill', 'rule'] as const;

export type CommandAutocompleteKind = typeof COMMAND_AUTOCOMPLETE_KINDS[number];

/** Section order in the picker: commands, then skills, then rules. */
export const COMMAND_AUTOCOMPLETE_KIND_ORDER: readonly CommandAutocompleteKind[] = COMMAND_AUTOCOMPLETE_KINDS;

export interface CommandAutocompleteSearchItem {
  name: string;
  description?: string;
  searchAliases?: string[];
  isBuiltIn?: boolean;
  /** The entry's kind. Absent means the default, `command`. */
  kind?: CommandAutocompleteKind;
  /** Legacy alias for `kind === 'skill'`; kept while callers migrate. */
  isSkill?: boolean;
}

/** Resolves an entry's kind, accepting the legacy `isSkill` flag. */
export function commandAutocompleteKindOf(item: CommandAutocompleteSearchItem): CommandAutocompleteKind {
  if (item.kind) return item.kind;
  return item.isSkill ? 'skill' : 'command';
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

/** A filtered list plus whether its kinds should be broken up by headers. */
export interface CommandAutocompleteGrouping<T> {
  items: T[];
  sections: boolean;
}

/**
 * Order for the unified `/` picker: commands first, then skills, then rules.
 * Section headers are worth showing only when the query matched more than one
 * kind; a single-kind result keeps its own order, where a lone header says
 * nothing.
 */
export function groupCommandAutocompleteItems<T extends CommandAutocompleteSearchItem>(
  items: T[],
): CommandAutocompleteGrouping<T> {
  const groups = COMMAND_AUTOCOMPLETE_KIND_ORDER.map((kind) =>
    items.filter((item) => commandAutocompleteKindOf(item) === kind),
  );
  const filledGroups = groups.filter((group) => group.length > 0);
  if (filledGroups.length <= 1) {
    return { items, sections: false };
  }

  return { items: filledGroups.flat(), sections: true };
}

/**
 * Precedence is local command, discovered skill, OpenCode skill-command,
 * discovered rule, then custom/plugin command. Identity matches
 * session.command's case-sensitive lookup.
 */
export function mergeCommandAutocompleteItems<T extends CommandAutocompleteSearchItem>(
  builtIns: T[],
  commands: T[],
  skills: T[],
  rules: T[] = [],
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
  addItems(rules, () => 2);
  return merged;
}

/**
 * The independent discovery passes behind the palette. They answer separately:
 * commands come from the commands store, skills from the skills store, rules
 * from the rules store, and no request knows about the others.
 */
const COMMAND_AUTOCOMPLETE_SOURCES = ['commands', 'skills', 'rules'] as const;

export type CommandAutocompleteSource = typeof COMMAND_AUTOCOMPLETE_SOURCES[number];

/** `pending` means "not answered yet", so the palette has no full list to show. */
export type CommandAutocompleteSourceStatus = 'pending' | 'ready' | 'failed';

/** How each discovery pass answered, keyed by source. */
export interface CommandAutocompleteReadiness {
  commands: CommandAutocompleteSourceStatus;
  skills: CommandAutocompleteSourceStatus;
  rules: CommandAutocompleteSourceStatus;
}

export function createCommandAutocompleteReadiness(): CommandAutocompleteReadiness {
  return { commands: 'pending', skills: 'pending', rules: 'pending' };
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
 * True once every source has answered, including answering with a failure: a
 * failed source also settles the list, it does not keep the palette waiting
 * forever.
 */
export function isCommandAutocompleteReady(readiness: CommandAutocompleteReadiness): boolean {
  return COMMAND_AUTOCOMPLETE_SOURCES.every((source) => readiness[source] !== 'pending');
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
  /** Loads the rules active for the palette's directory. */
  loadRules: () => Promise<boolean>;
}

/**
 * Runs every discovery pass and reports how each one answered.
 *
 * The palette needs the whole set of commands, skills and rules, and the
 * requests are independent — rendering whichever finished first is what made
 * the list look empty or partial. A source that answers with a failure is asked
 * once more, so one transient error cannot leave the list partial for as long
 * as the palette stays open. All loaders report failure as `false`, so this
 * never rejects.
 */
export async function loadCommandAutocompleteSources(
  loaders: CommandAutocompleteSourceLoaders,
): Promise<CommandAutocompleteReadiness> {
  const load = (source: CommandAutocompleteSource): Promise<boolean> =>
    source === 'commands' ? loaders.loadCommands()
      : source === 'skills' ? loaders.loadSkills()
        : loaders.loadRules();
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
