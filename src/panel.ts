import * as vscode from "vscode";
import type { DaySum, ModelSum, SessionRow } from "./db.js";
import type { Snapshot } from "./status.js";
import type { TokenTotals, TypeCosts } from "./costs.js";
import { compact, getCurrency, getRateNote, money } from "./format.js";

export interface RootData {
  root: string;
  total: number;
  today: number;
  sessions: number;
  models: ModelSum[];
  days: DaySum[];
  rows: SessionRow[];
  rowLimit: number;
  /** per-token-type derived costs for this root (USD basis). */
  typeCosts: TypeCosts | null;
  /** total token counts per type for this root. */
  tokens?: TokenTotals | null;
  /** derived costs per session id for the sessions table. */
  sessionTypeCosts?: Map<string, TypeCosts>;
  /** "provider/model" -> human readable price line. */
  modelPrices?: Record<string, string>;
}

export interface PanelData {
  snapshot: Snapshot;
  roots: RootData[];
  hidden: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dayLabel(dayUtcStartMs: number): string {
  return new Date(dayUtcStartMs).toLocaleDateString("en-GB");
}

function num(n: number | null): string {
  return n === null ? "–" : compact(n);
}

function ts(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

export class Panel {
  static current: Panel | null = null;

  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    Panel.current = this;
    this.panel.onDidDispose(() => {
      if (Panel.current === this) Panel.current = null;
      this.panel.dispose();
    });
  }

  static createOrReveal(extensionUri: vscode.Uri, data: PanelData | null): void {
    if (Panel.current) {
      Panel.current.panel.reveal(vscode.ViewColumn.One);
      if (data) Panel.current.update(data);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "kilocost.panel",
      "KiloCost",
      vscode.ViewColumn.One,
      { enableScripts: false },
    );
    const instance = new Panel(panel);
    instance.update(data ?? emptyPanelData());
    void extensionUri;
  }

  update(data: PanelData): void {
    this.panel.webview.html = buildHtml(data);
  }
}

function emptyPanelData(): PanelData {
  return {
    snapshot: { state: "missing", dbPath: "", totalCost: 0, sessions: 0, top: [] },
    roots: [],
    hidden: false,
  };
}

function buildHtml(data: PanelData): string {
  const s = data.snapshot;
  const head = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src none\">",
    "<style>",
    ":root { color-scheme: light dark; }",
    "body { font-family: var(--vscode-font-family); margin: 16px; }",
    "h1 { font-size: 1.6em; } h2 { font-size: 1.2em; margin-top: 24px; }",
    "table { border-collapse: collapse; margin: 8px 0; }",
    "th, td { padding: 4px 10px; text-align: left; vertical-align: top; }",
    "th { border-bottom: 1px solid var(--vscode-panel-border, #888); }",
    "td.num, th.num { text-align: right; }",
    "p.muted, .muted { opacity: 0.7; }",
    "span.cost { opacity: 0.9; font-size: 0.92em; }",
    ".totals { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 12px; }",
    ".totals .box { border: 1px solid var(--vscode-panel-border, #888); padding: 10px 14px; min-width: 120px; }",
    ".totals .box .v { font-size: 1.2em; font-weight: bold; }",
    "</style></head><body>",
  ].join("");

  const parts: string[] = [head];
  parts.push("<h1>KiloCost</h1>");

  if (data.hidden) {
    parts.push("<p class=\"muted\">Costs are hidden. Run \"KiloCost: Toggle Hidden\" to reveal them.</p>");
    parts.push("</body></html>");
    return parts.join("\n");
  }

  if (s.state !== "ok") {
    const label = s.state === "missing"
      ? "Kilo session database not found."
      : s.state === "locked"
      ? "Kilo session database is locked."
      : "Schema drift — expected columns missing in kilo.db.";
    parts.push(`<p>${esc(label)}</p>`);
    parts.push(`<p class="muted">${esc(s.detail ?? s.dbPath)}</p>`);
    parts.push("</body></html>");
    return parts.join("\n");
  }

  parts.push("<div class=\"totals\">");
  parts.push(`<div class="box"><span class="v">${esc(money(s.totalCost))}</span><br>project total<br>${s.sessions} sessions</div>`);
  const todaySum = data.roots.reduce((acc, r) => acc + r.today, 0);
  parts.push(`<div class="box"><span class="v">${esc(money(todaySum))}</span><br>today</div>`);
  if (s.tokens) {
    const tokTotal = s.tokens.input + s.tokens.output + s.tokens.reasoning + s.tokens.cacheRead + s.tokens.cacheWrite;
    parts.push(`<div class="box"><span class="v">${esc(compact(tokTotal))}</span><br>total tokens<br>${esc(compact(s.tokens.input))} in · ${esc(compact(s.tokens.output + s.tokens.reasoning))} out · ${esc(compact(s.tokens.cacheRead + s.tokens.cacheWrite))} cache</div>`);
  }
  parts.push("</div>");
  parts.push(`<p class="muted">Kilo v${esc(s.appVersion ?? "?")} · ${esc(s.dbPath)} · read-only</p>`);
  if (getCurrency() !== "USD" || getRateNote()) {
    const cur = getCurrency();
    const note = getRateNote();
    parts.push(`<p class="muted">Costs displayed in ${esc(cur)}${note ? ` · ${esc(note)}` : ""}.</p>`);
  }

  if (data.roots.length === 0) {
    parts.push("<p class=\"muted\">No workspace folder open.</p>");
  }
  for (const r of data.roots) {
    parts.push(`<h2>${esc(r.root)}</h2>`);
    parts.push(modelTable(r.models));
    parts.push(dayTable(r.days));
    parts.push(typeCostTable(r));
    parts.push(sessionTable(r.rows, r.rowLimit, r.sessionTypeCosts));
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

function typeCostTable(r: RootData): string {
  const c = r.typeCosts;
  if (!c) return "";
  const t = r.tokens;
  const tokCell = (v: number | undefined): string => `<td class="num">${v === undefined ? "" : compact(v)}</td>`;
  const row = (label: string, tokens: number | undefined, v: number): string =>
    `<tr><td>${esc(label)}</td>${tokCell(tokens)}<td class="num">${esc(money(v))}</td></tr>`;
  const knownSum = c.input + c.output + c.reasoning + c.cacheRead + c.cacheWrite;
  const rows = [
    row("Input", t?.input, c.input),
    row("Output", t?.output, c.output),
    row("Reasoning", t?.reasoning, c.reasoning),
    row("Cache read", t?.cacheRead, c.cacheRead),
    row("Cache write", t?.cacheWrite, c.cacheWrite),
  ];
  if (c.unknown > 0.000001) rows.push(row("Unknown pricing", undefined, c.unknown));
  const residual = r.total - knownSum - c.unknown;
  if (Math.abs(residual) > 0.000001) rows.push(row("Residual (stored vs derived)", undefined, residual));
  const totalTokens = t
    ? t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite
    : undefined;
  rows.push(row("Total", totalTokens, knownSum + c.unknown + (residual > 0.000001 ? residual : 0)));
  const unpricedNote = c.unpriced.length > 0
    ? `<p class="muted">No local pricing for: ${esc(c.unpriced.slice(0, 8).join(", "))}${c.unpriced.length > 8 ? " \u00b7 " + (c.unpriced.length - 8) + " more" : ""}. Add \"cost\" blocks in ~/.config/kilo/kilo.jsonc.</p>`
    : "";
  return `<h3>Cost per token type</h3><table><tr><th>Type</th><th class="num">Tokens</th><th class="num">Cost</th></tr>${rows.join("")}</table>${unpricedNote}`;
}
function modelTable(models: ModelSum[]): string {
  if (models.length === 0) return "";
  const rows = models.map((m) => {
    const variant = m.variant ? ` (${esc(m.variant)})` : "";
    return `<tr><td>${esc(m.modelId)}${variant}<br><span class="muted">${esc(m.providerId ?? "?")}</span></td>` +
      `<td class="num">${esc(money(m.cost))}</td><td class="num">${m.sessions}</td></tr>`;
  }).join("");
  return `<h3>Per model</h3><table><tr><th>Model</th><th class="num">Cost</th><th class="num">Sessions</th></tr>${rows}</table>`;
}

function dayTable(days: DaySum[]): string {
  if (days.length === 0) return "";
  const rows = days.map((d) =>
    `<tr><td>${dayLabel(d.dayUtcStartMs)}</td><td class="num">${esc(money(d.cost))}</td><td class="num">${d.sessions}</td></tr>`)
    .join("");
  return `<h3>Per day</h3><table><tr><th>Day</th><th class="num">Cost</th><th class="num">Sessions</th></tr>${rows}</table>`;
}

function sessionTable(rows: SessionRow[], limit: number, costs?: Map<string, TypeCosts>): string {
  const body = rows.map((r) => {
    const title = esc(r.title ?? r.id);
    const parent = r.parent ? " \u21a9" : "";
    const c = costs && costs.get(r.id);
    const derived = c !== undefined;
    const cache = (r.tokensCacheRead ?? 0) + (r.tokensCacheWrite ?? 0);
    const costLine = (v: number | undefined): string => (v === undefined ? "" : `<br><span class="muted cost">${esc(money(v))}</span>`);
    const inT = r.tokensInput, outT = r.tokensOutput, reT = r.tokensReasoning, caT = r.tokensCacheRead;
    const cell = (tok: number | null, val: number | undefined): string =>
      `<td class="num">${tok === null ? "\u2013" : num(tok)}${tok === null ? "" : costLine(val)}</td>`;
    return `<tr><td>${title}${parent}<br><span class="muted">${ts(r.timeCreated)} \u2192 ${ts(r.timeUpdated)}</span></td>`
      + `<td class="num">${esc(money(r.cost ?? 0))}</td>`
      + cell(inT, c?.input)
      + cell(outT, c?.output)
      + cell(reT, c?.reasoning)
      + cell(caT, c ? c.cacheRead + c.cacheWrite : undefined)
      + `</tr>`;
  }).join("");
  const note = rows.length >= limit ? `<p class="muted">Showing newest ${limit} sessions.</p>` : "";
  const legend = `<p class="muted">Cost line below token counts: derived from Kilo config prices; \u2013 = tokens/costs not recorded.</p>`;
  return `<h3>Sessions</h3><table><tr><th>Session</th><th class="num">Cost</th><th class="num">In</th><th class="num">Out</th><th class="num">Reasoning</th><th class="num">Cache</th></tr>${body}</table>${legend}${note}`;
}