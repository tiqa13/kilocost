import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as vscode from "vscode";

export type OpenResult =
  | { state: "missing"; dbPath: string; detail: string }
  | { state: "locked"; dbPath: string; detail: string }
  | { state: "drift"; dbPath: string; db: DatabaseSync; appVersion: string | null; missing: string[] }
  | { state: "ok"; dbPath: string; db: DatabaseSync; appVersion: string | null };

const REQUIRED = ["id", "title", "directory", "model", "cost", "time_created", "time_updated", "parent_id"];

export function configuredDbPath(): string {
  const cfg = vscode.workspace.getConfiguration("kilocost");
  const override = cfg.get<string>("databasePath", "").trim();
  const raw = override && override.length > 0
    ? override
    : path.join(os.homedir(), ".local", "share", "kilo", "kilo.db");
  return path.isAbsolute(raw) ? forwardSlash(path.normalize(raw)) : forwardSlash(raw);
}

export function forwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

export function normalizeRoot(fsPath: string): string {
  return forwardSlash(fsPath).replace(/\/+$/, "");
}

function escapeLike(p: string): string {
  return p.replace(/[%_]/g, (c) => "\\" + c);
}

function sessionMatchSql(): string {
  // VS Code reports Windows drive roots with a lowercase drive letter while
  // Kilo stores the session cwd with the drive's original case; the Windows
  // filesystem is case-insensitive, so match case-insensitively there.
  const eq = process.platform === "win32" ? "directory = ? COLLATE NOCASE" : "directory = ?";
  return `${eq} OR directory LIKE ? ESCAPE '\\'`;
}

function guardColumns(db: DatabaseSync): string[] {
  const rows = db.prepare("PRAGMA table_info(session)").all() as { name: string }[];
  const present = new Set(rows.map((r) => r.name));
  return REQUIRED.filter((c) => !present.has(c));
}

function readAppVersion(db: DatabaseSync): string | null {
  try {
    const r = db
      .prepare("SELECT version FROM session ORDER BY time_created DESC LIMIT 1")
      .get() as { version: string | null } | undefined;
    return r?.version ?? null;
  } catch {
    return null;
  }
}

export function openDb(): OpenResult {
  const dbPath = configuredDbPath();
  if (!fs.existsSync(dbPath)) {
    return { state: "missing", dbPath, detail: `file not found at ${dbPath}` };
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const missing = guardColumns(db);
    const appVersion = readAppVersion(db);
    if (missing.length > 0) {
      return { state: "drift", dbPath, db, appVersion, missing };
    }
    return { state: "ok", dbPath, db, appVersion };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { state: "locked", dbPath, detail };
  }
}

export interface DaySum { dayUtcStartMs: number; cost: number; sessions: number }
export interface ModelSum { modelId: string; providerId: string | null; variant: string | null; cost: number; sessions: number }
export interface SessionRow {
  id: string; title: string | null; model: string | null;
  cost: number | null;
  tokensInput: number | null; tokensOutput: number | null; tokensReasoning: number | null;
  tokensCacheRead: number | null; tokensCacheWrite: number | null;
  timeCreated: number; timeUpdated: number; parent: string | null;
}

export interface TokenAggRow {
  sid?: string;
  providerId: string | null;
  modelId: string | null;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  storedCost: number;
}
export class KiloDb {
  constructor(
    readonly dbPath: string,
    private readonly db: DatabaseSync,
    readonly appVersion: string | null,
  ) {}

  dispose(): void { this.db.close(); }

  private predicateArgs(root: string): [string, string] {
    return [root, `${escapeLike(root)}/%`];
  }

  total(root: string): { cost: number; sessions: number } {
    const [a, b] = this.predicateArgs(root);
    const sql = `SELECT COALESCE(SUM(cost), 0) AS cost, COUNT(*) AS sessions FROM session WHERE ${sessionMatchSql()}`;
    const r = this.db.prepare(sql).get(a, b) as { cost: number; sessions: number };
    return { cost: r.cost ?? 0, sessions: r.sessions ?? 0 };
  }

  today(root: string): number {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const [a, b] = this.predicateArgs(root);
    const sql = `SELECT COALESCE(SUM(cost), 0) AS cost FROM session WHERE ${sessionMatchSql()} AND time_created >= ?`;
    const r = this.db.prepare(sql).get(a, b, midnight.getTime()) as { cost: number };
    return r.cost ?? 0;
  }

  perModel(root: string): ModelSum[] {
    const [a, b] = this.predicateArgs(root);
    const sql = `SELECT model, SUM(COALESCE(cost, 0)) AS cost, COUNT(*) AS sessions
      FROM session WHERE ${sessionMatchSql()} GROUP BY model ORDER BY cost DESC`;
    const rows = this.db.prepare(sql).all(a, b) as { model: string | null; cost: number; sessions: number }[];
    return rows.map((r) => {
      const parsed = parseModel(r.model);
      return { ...parsed, cost: r.cost ?? 0, sessions: r.sessions ?? 0 };
    });
  }

  perDay(root: string): DaySum[] {
    const [a, b] = this.predicateArgs(root);
    const sql = `SELECT CAST(time_created / 86400000 AS INTEGER) * 86400000 AS dayUtcStartMs,
        SUM(COALESCE(cost, 0)) AS cost, COUNT(*) AS sessions
      FROM session WHERE ${sessionMatchSql()}
      GROUP BY dayUtcStartMs ORDER BY dayUtcStartMs DESC LIMIT 45`;
    const rows = this.db.prepare(sql).all(a, b) as { dayUtcStartMs: number; cost: number; sessions: number }[];
    return rows.map((r) => ({ dayUtcStartMs: r.dayUtcStartMs, cost: r.cost ?? 0, sessions: r.sessions ?? 0 }));
  }

  modelTokenSums(root: string): TokenAggRow[] {
    return this.tokenAgg(root, false);
  }

  sessionTokenSums(root: string): TokenAggRow[] {
    return this.tokenAgg(root, true);
  }

  private tokenAgg(root: string, bySession: boolean): TokenAggRow[] {
    const [a, b] = this.predicateArgs(root);
    const sidCol = bySession ? "s.id AS sid," : "";
    const sql = `SELECT ${sidCol} json_extract(m.data, '$.providerID') AS providerId,
        json_extract(m.data, '$.modelID') AS modelId,
        SUM(COALESCE(json_extract(p.data, '$."tokens"."input"'), 0)) AS tokensInput,
        SUM(COALESCE(json_extract(p.data, '$."tokens"."output"'), 0)) AS tokensOutput,
        SUM(COALESCE(json_extract(p.data, '$."tokens"."reasoning"'), 0)) AS tokensReasoning,
        SUM(COALESCE(json_extract(p.data, '$."tokens"."cache"."read"'), 0)) AS tokensCacheRead,
        SUM(COALESCE(json_extract(p.data, '$."tokens"."cache"."write"'), 0)) AS tokensCacheWrite,
        SUM(COALESCE(json_extract(p.data, '$.cost'), 0)) AS storedCost
      FROM part p
      JOIN message m ON m.id = p.message_id
      JOIN session s ON s.id = p.session_id
      WHERE ${sessionMatchSql()}
        AND json_extract(p.data, '$."type"') = 'step-finish'
      GROUP BY ${bySession ? "s.id" : ""}providerId, modelId`;;
    try {
      return this.db.prepare(sql).all(a, b) as unknown as TokenAggRow[];
    } catch {
      return [];
    }
  }
  sessionList(root: string, limit = 200): SessionRow[] {
    const [a, b] = this.predicateArgs(root);
    try {
      return this.sessionListFull(a, b, limit);
    } catch {
      return this.sessionListFallback(a, b, limit);
    }
  }

  private sessionListFull(a: string, b: string, limit: number): SessionRow[] {
    const sql = `SELECT id, title, model, cost, tokens_input AS tokensInput, tokens_output AS tokensOutput,
        tokens_reasoning AS tokensReasoning, tokens_cache_read AS tokensCacheRead, tokens_cache_write AS tokensCacheWrite,
        time_created AS timeCreated, time_updated AS timeUpdated, parent_id AS parent
      FROM session WHERE ${sessionMatchSql()} ORDER BY time_updated DESC LIMIT ?`;
    return this.db.prepare(sql).all(a, b, limit) as unknown as SessionRow[];
  }
  private sessionListFallback(a: string, b: string, limit: number): SessionRow[] {
    const sql = `SELECT id, title, model, cost, time_created AS timeCreated, time_updated AS timeUpdated, parent_id AS parent
      FROM session WHERE ${sessionMatchSql()} ORDER BY time_updated DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(a, b, limit) as unknown as {
      id: string; title: string | null; model: string | null; cost: number | null;
      timeCreated: number; timeUpdated: number; parent: string | null;
    }[];
    return rows.map((r) => ({
      ...r,
      tokensInput: null, tokensOutput: null, tokensReasoning: null, tokensCacheRead: null, tokensCacheWrite: null,
    }));
  }
}
function parseModel(raw: string | null): { modelId: string; providerId: string | null; variant: string | null } {
  if (!raw) return { modelId: "unknown", providerId: null, variant: null };
  try {
    const obj = JSON.parse(raw) as { id?: string; providerID?: string; variant?: string };
    return {
      modelId: obj.id ?? "unknown",
      providerId: obj.providerID ?? null,
      variant: obj.variant && obj.variant.length > 0 ? obj.variant : null,
    };
  } catch {
    return { modelId: raw, providerId: null, variant: null };
  }
}
