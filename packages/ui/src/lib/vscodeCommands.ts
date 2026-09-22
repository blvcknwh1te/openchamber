/**
 * Command ids the shared UI asks the VS Code extension host to run. The host
 * rewrites the `openchamber.` prefix into the fork's `openchamberBnw.` namespace,
 * so the ids are kept in the upstream form here.
 */
export const VSCODE_COMMANDS = {
  openTableViewer: 'openchamber.openTableViewer',
  closeTableViewer: 'openchamber.closeTableViewer',
} as const;
