import * as vscode from "vscode";
import { setDisplay, getDisplay } from "./format.js";

export interface RateBundle {
  date: string;
  rates: Record<string, number>;
}

const ENDPOINT = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const CACHE_KEY = "kilocost.ecb.rates";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(ctx: vscode.ExtensionContext): RateBundle | null {
  const c = ctx.globalState.get<RateBundle>(CACHE_KEY);
  return c && c.rates && typeof c.rates.USD === "number" ? c : null;
}

async function fetchFresh(timeoutMs = 10000): Promise<RateBundle> {
  const res = await fetch(ENDPOINT, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/xml" },
  });
  if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
  const xml = await res.text();
  const rates = {} as Record<string, number>;
  const dateMatch = xml.match(/<Cube time='(\d{4}-\d{2}-\d{2})'/);
  for (const match of xml.matchAll(/<Cube currency='([A-Z]{3})' rate='([\d.]+)'\/>/g)) {
    rates[match[1]] = Number.parseFloat(match[2]);
  }
  if (!dateMatch || !rates.USD) throw new Error("ECB feed parse failed");
  return { date: dateMatch[1], rates };
}

export interface DisplayState {
  currency: string;
  usdToDisplay: number;
  note: string;
}

export async function ensureRates(
  ctx: vscode.ExtensionContext,
  force: boolean,
): Promise<DisplayState> {
  const cfg = vscode.workspace.getConfiguration("kilocost");
  const wanted = cfg.get<string>("currency", "USD").toUpperCase();
  const fetchEnabled = cfg.get<boolean>("fetchRates", true);

  if (wanted === "USD") {
    return { currency: "USD", usdToDisplay: 1, note: "" };
  }
  if (!fetchEnabled) {
    return { currency: "USD", usdToDisplay: 1, note: "rate fetch disabled (kilocost.fetchRates: false) — showing USD" };
  }

  let bundle = readCache(ctx);
  if (!bundle || bundle.date !== todayUtc() || force) {
    try {
      const fresh = await fetchFresh();
      bundle = fresh;
      await ctx.globalState.update(CACHE_KEY, fresh);
    } catch {
      /* fall back to cached below */
    }
  }
  if (!bundle) {
    return { currency: "USD", usdToDisplay: 1, note: "no exchange rates available — showing USD" };
  }
  const cur = bundle.rates[wanted];
  if (typeof cur !== "number" || !(cur > 0)) {
    return { currency: "USD", usdToDisplay: 1, note: `currency ${wanted} not in ECB rate set — showing USD` };
  }
  const factor = cur / bundle.rates.USD;
  return {
    currency: wanted,
    usdToDisplay: factor,
    note: `ECB reference rates ${bundle.date}`,
  };
}

export function currentDisplay(): DisplayState {
  return getDisplay();
}
