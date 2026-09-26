import * as vscode from "vscode";
import type { DaySum, ModelSum, SessionRow } from "./db.js";
import type { Snapshot } from "./status.js";
import { getCurrency, getRateNote, money } from "./format.js";

export interface RootData {
  root: string;
  total: number;
  today: number;
  sessions: number;
  models: ModelSum[];
  days: DaySum[];
  rows: SessionRow[];
  rowLimit: number;
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
    parts.push(sessionTable(r.rows, r.rowLimit));
  }
  parts.push("</body></html>");
  return parts.join("\n");
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

function sessionTable(rows: SessionRow[], limit: number): string {
  const body = rows.map((r) => {
    const title = esc(r.title ?? r.id);
    const parent = r.parent ? " ↩" : "";
    return `<tr><td>${title}${parent}<br><span class="muted">${ts(r.timeCreated)} → ${ts(r.timeUpdated)}</span></td>` +
      `<td class="num">${esc(money(r.cost ?? 0))}</td>` +
      `<td class="num">${r.tokensInput ?? 0} / ${r.tokensOutput ?? 0}</td></tr>`;
  }).join("");
  const note = rows.length >= limit ? `<p class="muted">Showing newest ${limit} sessions.</p>` : "";
  return `<h3>Sessions</h3><table><tr><th>Session</th><th class="num">Cost</th><th class="num">In / Out tokens</th></tr>${body}</table>${note}`;
}
