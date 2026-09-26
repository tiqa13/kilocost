import * as fs from "node:fs";
import * as path from "node:path";

export class DbWatcher {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dbPath: string,
    private readonly onChange: () => void,
    private readonly debounceMs = 400,
  ) {}

  start(): void {
    this.watchPath(this.dbPath);
    const dir = path.dirname(this.dbPath);
    if (fs.existsSync(dir)) {
      this.watchDir(dir);
    }
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = this.dbPath + suffix;
      if (fs.existsSync(sidecar)) this.watchPath(sidecar);
    }
  }

  private watchPath(target: string): void {
    if (this.watchers.has(target)) return;
    try {
      const watcher = fs.watch(target, { persistent: false });
      this.register(target, watcher);
    } catch { /* best-effort: file appeared/disappeared */ }
  }

  private watchDir(dir: string): void {
    if (this.watchers.has(dir)) return;
    try {
      const watcher = fs.watch(dir, { persistent: false });
      this.register(dir, watcher);
    } catch { /* directory vanished */ }
  }

  private register(key: string, watcher: fs.FSWatcher): void {
    this.watchers.set(key, watcher);
    watcher.on("change", () => this.schedule());
    watcher.on("rename", () => {
      this.schedule();
      watcher.close();
      this.watchers.delete(key);
    });
    watcher.on("error", () => {
      watcher.close();
      this.watchers.delete(key);
    });
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onChange();
    }, this.debounceMs);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
