import * as vscode from "vscode";
import type { ModelSum } from "./db.js";
import type { TokenTotals, TypeCosts } from "./costs.js";
import { compact, getCurrency, getRateNote, money } from "./format.js";

export interface Snapshot {
  state: "missing" | "locked" | "drift" | "ok";
  dbPath: string;
  totalCost: number;
  sessions: number;
  appVersion?: string | null;
  detail?: string;
  top: ModelSum[];
  typeCosts?: TypeCosts;
  tokens?: TokenTotals;
}

const ICON = "$(credit-card)";

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private snapshot: Snapshot | null = null;
  private hiddenState: boolean;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      "kilocost.status",
      vscode.StatusBarAlignment.Right,
      1000,
    );
    this.item.command = "kilocost.showPanel";
    this.hiddenState = ctx.globalState.get<boolean>("kilocost.hidden", false);
    ctx.subscriptions.push(this.item);
  }

  get hidden(): boolean {
    return this.hiddenState;
  }

  toggleHidden(): void {
    this.hiddenState = !this.hiddenState;
    void this.ctx.globalState.update("kilocost.hidden", this.hiddenState);
    this.render();
  }

  show(snapshot: Snapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  private render(): void {
    const snap = this.snapshot;
    if (!snap) {
      this.item.hide();
      return;
    }
    if (this.hiddenState) {
      this.item.text = `${ICON} KiloCost`;
      this.item.tooltip = "KiloCost: hidden - run \"KiloCost: Toggle Hidden\" to show costs";
      this.item.show();
      return;
    }
    if (snap.state === "ok") {
      this.item.text = `${ICON} KiloCost: ${money(snap.totalCost)}`;
      this.item.tooltip = this.tooltipFor(snap);
    } else {
      const label = snap.state === "missing"
        ? "database not found"
        : snap.state === "locked"
        ? "database locked"
        : "schema drift";
      this.item.text = `$(warning) KiloCost: ${label}`;
      this.item.tooltip = `${label}\n${snap.detail ?? snap.dbPath}\n\nRun "KiloCost: Debug Info" for details.`;
    }
    this.item.show();
  }

  private tooltipFor(snap: Snapshot): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**KiloCost** - total: **${money(snap.totalCost)}** across ${snap.sessions} session(s)\n\n`);
    for (const m of snap.top.slice(0, 4)) {
      const variant = m.variant ? ` \`${m.variant}\`` : "";
      md.appendMarkdown(`- ${m.modelId}${variant} (${m.providerId ?? "?"}): ${money(m.cost)} - ${m.sessions} sessions\n`);
    }
    md.appendMarkdown("\nKilo v" + (snap.appVersion ?? "?") + " - click to open breakdown\n");
    const tc = snap.typeCosts;
    if (tc && (tc.input > 0 || tc.unknown > 0 || tc.output > 0)) {
      const parts = [
        "in " + money(tc.input),
        "out " + money(tc.output),
        "reason " + money(tc.reasoning),
        "cache " + money(tc.cacheRead + tc.cacheWrite),
      ];
      if (tc.unknown > 0) parts.push("unknown " + money(tc.unknown));
      md.appendMarkdown("\n\nPer token type: " + parts.join(" \u00b7 "));
    }
    const tk = snap.tokens;
    if (tk) {
      md.appendMarkdown(
        "\nTokens: " + compact(tk.input) + " in \u00b7 " + compact(tk.output) + " out \u00b7 " +
        compact(tk.reasoning) + " reasoning \u00b7 " + compact(tk.cacheRead + tk.cacheWrite) + " cache",
      );
    }
    if (getCurrency() !== "USD" || getRateNote()) {
      const extra = getRateNote() ? getCurrency() + " — " + getRateNote() : getCurrency();
      md.appendMarkdown("\n\n" + extra);
    }
    return md;
  }
}
