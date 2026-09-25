/** `explore` -> `Explore`: the capitalization a task card has always used. */

export const SUBAGENT_TYPE_DEFAULT = 'subagent';

export const formatSubagentTypeLabel = (subagentType: unknown): string => {
    const value = typeof subagentType === 'string' ? subagentType.trim() : '';
    const agentType = value.length > 0 ? value : SUBAGENT_TYPE_DEFAULT;
    return agentType.charAt(0).toUpperCase() + agentType.slice(1);
};
