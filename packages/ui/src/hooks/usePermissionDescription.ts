import * as React from 'react';
import { describeShellCommand, getCachedPermissionDescription } from '@/lib/permissionDescription';

export const usePermissionDescription = (input: {
  permissionId: string;
  command: string;
  enabled: boolean;
  directory?: string;
  sessionID?: string;
  locale?: string;
}): string | null => {
  const { permissionId, command, enabled, directory, sessionID, locale } = input;
  const [text, setText] = React.useState<string | null>(
    () => getCachedPermissionDescription(permissionId) ?? null,
  );

  React.useEffect(() => {
    if (!enabled || !command.trim()) {
      setText(null);
      return;
    }

    const cached = getCachedPermissionDescription(permissionId);
    if (cached) {
      setText(cached);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setText(null);

    void describeShellCommand({
      permissionId,
      command,
      directory,
      sessionID,
      locale,
      signal: controller.signal,
    }).then((result) => {
      if (!cancelled && result) {
        setText(result);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [permissionId, command, enabled, directory, sessionID, locale]);

  return text;
};
