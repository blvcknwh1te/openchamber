/**
 * Session statuses that mean the agent is still producing output. The session
 * status record is optional per session, so a missing record reads as idle.
 */
export const isWorkingSessionStatus = (status: { type?: string } | undefined): boolean => {
  const type = status?.type ?? 'idle';
  return type === 'busy' || type === 'retry';
};
