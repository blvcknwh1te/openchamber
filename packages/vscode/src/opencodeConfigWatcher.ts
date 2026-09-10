import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const DEBOUNCE_MS = 1200;
const CONFIG_FILE_NAMES = ['opencode.json', 'opencode.jsonc'];

// [OC-PATCH: opencode-config-live] opencode reads its config at instance
// bootstrap and never reloads it, so external edits to opencode.json(c) were
// invisible until a manual "Reload OpenCode". Watch the global and per-project
// config files and restart the managed server on change (same semantics as
// the web "Reload OpenCode" button, debounced).
export class OpenCodeConfigWatcher {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onConfigChanged: () => Promise<void>,
  ) {}

  start(): void {
    const bases = new Set<string>([
      path.join(os.homedir(), '.config', 'opencode'),
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    ]);
    const fire = () => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.onConfigChanged().catch(() => undefined);
      }, DEBOUNCE_MS);
    };
    for (const base of bases) {
      for (const fileName of CONFIG_FILE_NAMES) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, fileName));
        watcher.onDidCreate(fire);
        watcher.onDidChange(fire);
        watcher.onDidDelete(fire);
        this.watchers.push(watcher);
        this.context.subscriptions.push(watcher);
      }
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;
  }
}
