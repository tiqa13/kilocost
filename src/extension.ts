import * as vscode from "vscode";
import { KiloDb, OpenResult, openDb, configuredDbPath } from "./db.js";

let output = vscode.window.createOutputChannel("KiloCost");
let currentDb: KiloDb | null = null;

function debugInfo(): void {
  const result: OpenResult = openDb();
  output.clear();
  output.appendLine(`KiloCost debug - database: ${configuredDbPath()}`);
  output.appendLine(`state: ${result.state}`);
  if (result.state === "missing" || result.state === "locked") {
    output.appendLine(result.detail);
  } else if (result.state === "drift") {
    output.appendLine(`missing columns: ${result.missing.join(", ")} (app ${result.appVersion ?? "?"})`);
  } else {
    const db = new KiloDb(result.dbPath, result.db, result.appVersion);
    currentDb?.dispose();
    currentDb = db;
    output.appendLine(`app version: ${result.appVersion ?? "?"}`);
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      output.appendLine("no workspace folder - nothing to aggregate");
    }
    for (const folder of folders) {
      const root = normalizeFolder(folder);
      const totals = db.total(root);
      output.appendLine(`root ${root}: ${totals.sessions} sessions, total $${totals.cost.toFixed(4)}, today $${db.today(root).toFixed(4)}`);
      for (const m of db.perModel(root)) {
        output.appendLine(`  model ${m.modelId} (${m.providerId ?? "?"}): ${m.sessions} sessions, $${m.cost.toFixed(4)}`);
      }
    }
  }
  output.show(true);
}

function normalizeFolder(folder: vscode.WorkspaceFolder): string {
  return folder.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("kilocost.debugInfo", debugInfo),
  );
}

export function deactivate(): void {
  currentDb?.dispose();
  currentDb = null;
}
