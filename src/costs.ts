import type { TokenAggRow } from "./db.js";
import type { PricingMap } from "./pricing.js";

export interface TypeCosts {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** stored cost belonging to models with no local pricing (cannot be split). */
  unknown: number;
  /** names like "providerID/modelID" lacking local pricing. */
  unpriced: string[];
}

export interface TokenTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

const per1m = (tokens: number, price: number): number => (tokens * price) / 1_000_000;

export function computeTokenTotals(rows: TokenAggRow[]): TokenTotals {
  const t: TokenTotals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  for (const r of rows) {
    t.input += r.tokensInput;
    t.output += r.tokensOutput;
    t.reasoning += r.tokensReasoning;
    t.cacheRead += r.tokensCacheRead;
    t.cacheWrite += r.tokensCacheWrite;
  }
  return t;
}

export function mergeTokenTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

/**
 * Splits stored per-step costs into token-type buckets.
 * Each aggregation row (same model) is scaled so that the split matches the
 * stored cost exactly: protects against model price changes over time.
 */
export function computeTypeCosts(rows: TokenAggRow[], pricing: PricingMap): TypeCosts {
  const c: TypeCosts = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, unknown: 0, unpriced: [] };
  const unpriced = new Set<string>();
  for (const r of rows) {
    const key = `${r.providerId ?? ""}|${r.modelId ?? ""}`;
    const price = r.providerId && r.modelId ? pricing.get(key) : undefined;
    if (!price) {
      c.unknown += r.storedCost;
      if (r.providerId && r.modelId) unpriced.add(`${r.providerId}/${r.modelId}`);
      continue;
    }
    const wIn = per1m(r.tokensInput, price.input);
    const wOut = per1m(r.tokensOutput, price.output);
    // reasoning tokens are billed at the output rate by Kilo's cost formula.
    const wReason = per1m(r.tokensReasoning, price.output);
    const wCr = per1m(r.tokensCacheRead, price.cacheRead);
    const wCw = per1m(r.tokensCacheWrite, price.cacheWrite);
    const derived = wIn + wOut + wReason + wCr + wCw;
    if (derived > 1e-12) {
      // Scale the split to the stored amount; the ratio stays meaningful even
      // when the configured price drifted from what was billed at the time.
      const scale = r.storedCost / derived;
      c.input += wIn * scale;
      c.output += wOut * scale;
      c.reasoning += wReason * scale;
      c.cacheRead += wCr * scale;
      c.cacheWrite += wCw * scale;
    } else {
      // Tokens known but derived nothing (e.g. zero pricing) yet cost was stored.
      c.unknown += r.storedCost;
    }
  }
  c.unpriced = [...unpriced];
  return c;
}

export function mergeTypeCosts(a: TypeCosts, b: TypeCosts): TypeCosts {
  const u = new Set([...a.unpriced, ...b.unpriced]);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    unknown: a.unknown + b.unknown,
    unpriced: [...u],
  };
}
