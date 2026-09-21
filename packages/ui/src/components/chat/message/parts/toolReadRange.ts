/**
 * Line range a `read` tool call covers. Without it a read row looks like the
 * whole file was read, so the offset/limit pair is surfaced next to the path.
 */
export interface ToolReadRange {
    offset?: number;
    limit?: number;
}

type ToolStateLike = {
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
} | undefined;

const readPositiveInt = (value: unknown): number | undefined => {
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
        return undefined;
    }

    const truncated = Math.trunc(numeric);
    return truncated > 0 ? truncated : undefined;
};

export const getToolReadRange = (state: ToolStateLike): ToolReadRange => {
    const input = state?.input;
    const metadata = state?.metadata;

    const offset = readPositiveInt(input?.offset)
        ?? readPositiveInt(input?.line)
        ?? readPositiveInt(metadata?.offset)
        ?? readPositiveInt(metadata?.line);
    const limit = readPositiveInt(input?.limit) ?? readPositiveInt(metadata?.limit);

    return { offset, limit };
};

export const formatToolReadRange = (range: ToolReadRange): string | null => {
    const { offset, limit } = range;
    if (!offset && !limit) {
        return null;
    }

    const start = offset ?? 1;
    if (limit) {
        return `[${start}-${start + limit - 1}]`;
    }

    return `[${start}-]`;
};
