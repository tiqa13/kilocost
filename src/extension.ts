import * as vscode from "vscode";
import { KiloDb, ModelSum, OpenResult, TokenAggRow, openDb, configuredDbPath } from "./db.js";
import { DbWatcher } from "./refresh.js";
import { Panel, PanelData, RootData } from "./panel.js";
import { ensureRates } from "./rates.js";
import { getDisplay, setDisplay } from "./format.js";
import { loadPricing } from "./pricing.js";
import { computeTypeCosts, mergeTypeCosts, TypeCosts } from "./costs.js";
import { Snapshot, StatusBar } from "./status.js";

let ctxRef: vscode.ExtensionContext | null = null;
let db: KiloDb | null = null;
let watcher: DbWatcher | null = null;
let bar: StatusBar | null = null;
let output: vscode.OutputChannel | null = null;
let lastData: PanelData | null = null;
const SESSION_ROW_LIMIT = 200;

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

async function refresh(force: boolean): Promise<void> {
  if (!bar || !ctxRef) return;
  const previous = db;
  const result: OpenResult = openDb();
  previous?.dispose();
  db = null;
  restartWatcher();

  const display = await ensureRates(ctxRef, force);
  setDisplay(display.currency, display.usdToDisplay, display.note);

  if (result.state === "missing" || result.state === "locked") {
    setSnapshot({
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
    setSnapshot({
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
  const roots: RootData[] = [];
  const pricing = loadPricing();
  let mergedCosts: TypeCosts = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, unknown: 0, unpriced: [] };
  for (const root of folderRoots()) {
    const t = opened.total(root);
    total += t.cost;
    sessions += t.sessions;
    const perModel = opened.perModel(root);
    mergeModels(models, perModel);
    const tokenRows = opened.modelTokenSums(root);
    const typeCosts = computeTypeCosts(tokenRows, pricing);
    mergedCosts = mergeTypeCosts(mergedCosts, typeCosts);
    const sessionTypeCosts = new Map<string, TypeCosts>();
    const bySid = new Map<string, TokenAggRow[]>();
    for (const r of opened.sessionTokenSums(root)) {
      if (!r.sid) continue;
      const arr = bySid.get(r.sid) ?? [];
      arr.push(r);
      bySid.set(r.sid, arr);
    }
    for (const [sid, arr] of bySid) {
      sessionTypeCosts.set(sid, computeTypeCosts(arr, pricing));
    }
    roots.push({
      root,
      total: t.cost,
      today: opened.today(root),
      sessions: t.sessions,
      models: perModel,
      days: opened.perDay(root),
      rows: opened.sessionList(root, SESSION_ROW_LIMIT),
      rowLimit: SESSION_ROW_LIMIT,
      typeCosts,
      sessionTypeCosts,
    });
  }
  const top = [...models.values()].sort((a, b) => b.cost - a.cost);
  const snapshot: Snapshot = {
    state: "ok",
    dbPath: opened.dbPath,
    appVersion: opened.appVersion,
    totalCost: total,
    sessions,
    top,
    typeCosts: mergedCosts,
  };
  bar.show(snapshot);
  if (Panel.current) {
    Panel.current.update({ snapshot, roots, hidden: bar.hidden });
  } else {
    lastData = { snapshot, roots, hidden: bar.hidden };
  }
}

function setSnapshot(snapshot: Snapshot): void {
  bar?.show(snapshot);
  if (Panel.current) {
    Panel.current.update({ snapshot, roots: [], hidden: bar?.hidden ?? false });
  } else {
    lastData = { snapshot, roots: [], hidden: bar?.hidden ?? false };
  }
}

function restartWatcher(): void {
  watcher?.stop();
  watcher = null;
  try {
    watcher = new DbWatcher(configuredDbPath(), () => void refresh(false));
    watcher.start();
  } catch {
    watcher = null;
  }
}

async function debugInfo(): Promise<void> {
  await refresh(false);
  const channel = ensureOutput();
  channel.clear();
  channel.appendLine(`KiloCost debug — ${configuredDbPath()}`);
  const d = getDisplay();
  channel.appendLine(`display currency: ${d.currency}, factor ${d.usdToDisplay}, ${d.note || "USD native"}`);
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
    const list = db.sessionList(root);
    channel.appendLine(`  session rows fetched: ${list.length}`);
  }
  channel.show(true);
}


export function activate(context: vscode.ExtensionContext): void {
  ctxRef = context;
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
      ctxRef = null;
      Panel.current = null;
    },
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("kilocost.refresh", () => void refresh(true)),
    vscode.commands.registerCommand("kilocost.toggleHidden", () => {
      bar?.toggleHidden();
      if (lastData) {
        lastData.hidden = bar?.hidden ?? false;
        if (Panel.current) Panel.current.update(lastData);
      }
    }),
    vscode.commands.registerCommand("kilocost.debugInfo", () => void debugInfo()),
    vscode.commands.registerCommand("kilocost.showPanel", () => {
      if (!lastData) void refresh(false);
      Panel.createOrReveal(context.extensionUri, lastData);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh(false)),
  );
  void refresh(false);
}

export function deactivate(): void {
  watcher?.stop();
  db?.dispose();
}
