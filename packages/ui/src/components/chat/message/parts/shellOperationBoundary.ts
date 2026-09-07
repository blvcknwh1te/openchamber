const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'cmd', 'terminal', 'shell_command']);

type ShellOperationInitiator = 'agent' | 'user';

export type ShellOperationBoundary = {
    initiator: ShellOperationInitiator;
    verification: 'unverified';
    boundary: 'outside-managed-boundary';
};

export const getShellOperationBoundary = (
    toolName: string,
    initiator: ShellOperationInitiator,
): ShellOperationBoundary | null => {
    if (!SHELL_TOOL_NAMES.has(toolName.trim().toLowerCase())) return null;

    return {
        initiator,
        verification: 'unverified',
        boundary: 'outside-managed-boundary',
    };
};
