import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const DEBOUNCE_MS = 200;
const SIGNAL_FILE = 'reload.signal';

// [OC-PATCH: reload-signal] A control file for automation: creating, changing,
// or removing `~/.config/openchamber/reload.signal` runs the same action as the
// toolbar refresh button (reload webviews + restart managed OpenCode). This
// gives an agent or a shell command a way to trigger the reload without driving
// the VS Code UI.
export class ReloadSignalWatcher {
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onSignal: () => void,
  ) {}

  start(): void {
    const base = path.join(os.homedir(), '.config', 'openchamber');
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, SIGNAL_FILE),
    );
    const fire = () => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.onSignal();
      }, DEBOUNCE_MS);
    };
    watcher.onDidCreate(fire);
    watcher.onDidChange(fire);
    watcher.onDidDelete(fire);
    this.watchers.push(watcher);
    this.context.subscriptions.push(watcher);
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
