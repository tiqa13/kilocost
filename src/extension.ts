import * as vscode from "vscode";
import { KiloDb, ModelSum, OpenResult, openDb, configuredDbPath } from "./db.js";
import { DbWatcher } from "./refresh.js";
import { Snapshot, StatusBar } from "./status.js";

let db: KiloDb | null = null;
let watcher: DbWatcher | null = null;
let bar: StatusBar | null = null;
let output: vscode.OutputChannel | null = null;

function ensureOutput(): vscode.OutputChannel {
  if (!output) output = vscode.window.createOutputChannel("KiloCost");
  return output;
}

function folderRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) =>
    f.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, ""),
  );
}

function mergeModels(target: Map<string, ModelSum>, additions: ModelSum[]): void {
  for (const m of additions) {
    const key = `${m.modelId}|${m.providerId ?? ""}|${m.variant ?? ""}`;
    const existing = target.get(key);
    if (existing) {
      existing.cost += m.cost;
      existing.sessions += m.sessions;
    } else {
      target.set(key, { ...m });
    }
  }
}

function refresh(): void {
  if (!bar) return;
  const previous = db;
  const result: OpenResult = openDb();
  previous?.dispose();
  db = null;
  restartWatcher();

  if (result.state === "missing" || result.state === "locked") {
    bar.show({
      state: result.state,
      dbPath: result.dbPath,
      detail: result.detail,
      totalCost: 0,
      sessions: 0,
      top: [],
    });
    return;
  }
  if (result.state === "drift") {
    bar.show({
      state: "drift",
      dbPath: result.dbPath,
      appVersion: result.appVersion,
      detail: `missing session columns: ${result.missing.join(", ")}`,
      totalCost: 0,
      sessions: 0,
      top: [],
    });
    return;
  }

  const opened = new KiloDb(result.dbPath, result.db, result.appVersion);
  db = opened;
  let total = 0;
  let sessions = 0;
  const models = new Map<string, ModelSum>();
  for (const root of folderRoots()) {
    const t = opened.total(root);
    total += t.cost;
    sessions += t.sessions;
    mergeModels(models, opened.perModel(root));
  }
  const top = [...models.values()].sort((a, b) => b.cost - a.cost);
  bar.show({
    state: "ok",
    dbPath: opened.dbPath,
    appVersion: opened.appVersion,
    totalCost: total,
    sessions,
    top,
  });
}

function restartWatcher(): void {
  watcher?.stop();
  watcher = null;
  try {
    watcher = new DbWatcher(configuredDbPath(), () => refresh());
    watcher.start();
  } catch {
    watcher = null;
  }
}

function debugInfo(): void {
  refresh();
  const channel = ensureOutput();
  channel.clear();
  channel.appendLine(`KiloCost debug — ${configuredDbPath()}`);
  if (!db) {
    channel.appendLine("db not available after refresh (missing/locked/drift) — see status bar");
    channel.show(true);
    return;
  }
  channel.appendLine(`Kilo app version: ${db.appVersion ?? "?"}`);
  const roots = folderRoots();
  if (roots.length === 0) channel.appendLine("no workspace folders");
  for (const root of roots) {
    const t = db.total(root);
    channel.appendLine(`root ${root}: ${t.sessions} sessions, total ${t.cost.toFixed(6)} USD, today ${db.today(root).toFixed(6)} USD`);
    for (const m of db.perModel(root)) {
      channel.appendLine(`  model ${m.modelId} (${m.providerId ?? "?"})${m.variant ? ` [${m.variant}]` : ""}: ${m.sessions} sessions, ${m.cost.toFixed(6)} USD`);
    }
    for (const d of db.perDay(root)) {
      const day = new Date(d.dayUtcStartMs);
      channel.appendLine(`  day ${day.toISOString().slice(0, 10)}: ${d.sessions} sessions, ${d.cost.toFixed(6)} USD`);
    }
    const list = db.sessionList(root);
    channel.appendLine(`  session rows fetched: ${list.length}`);
  }
  channel.show(true);
}

export function activate(context: vscode.ExtensionContext): void {
  bar = new StatusBar(context);
  context.subscriptions.push({
    dispose: () => {
      watcher?.stop();
      watcher = null;
      db?.dispose();
      db = null;
      output?.dispose();
      output = null;
      bar = null;
    },
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("kilocost.refresh", () => refresh()),
    vscode.commands.registerCommand("kilocost.toggleHidden", () => bar?.toggleHidden()),
    vscode.commands.registerCommand("kilocost.debugInfo", debugInfo),
    vscode.commands.registerCommand("kilocost.showPanel", () => {
      void vscode.commands.executeCommand("kilocost.debugInfo");
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
  );
  refresh();
}

export function deactivate(): void {
  watcher?.stop();
  db?.dispose();
}
