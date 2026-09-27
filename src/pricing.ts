import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ModelPrice {
  input: number;       // USD per 1M tokens
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type PricingMap = Map<string, ModelPrice>;

function stripJsonComments(src: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inString) {
      out += c;
      if (escaped) { escaped = false; }
      else if (c === "\\") { escaped = true; }
      else if (c === "\"") { inString = false; }
      i++;
      continue;
    }
    if (c === "\"") { inString = true; out += c; i++; continue; }
    if (c === "/" && c2 === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function candidateFiles(): { file: string; src: string | null }[] {
  const dir = process.env.KILO_CONFIG_HOME
    ? path.resolve(process.env.KILO_CONFIG_HOME)
    : path.join(os.homedir(), ".config", "kilo");
  const names = ["kilo.json", "kilo.jsonc"];
  return names.map((n) => {
    const file = path.join(dir, n);
    try {
      return { file, src: fs.readFileSync(file, "utf8") };
    } catch {
      return { file, src: null };
    }
  });
}

/** Collect provider.<id>.models.<id>.cost blocks from Kilo config files. */
export function loadPricing(): PricingMap {
  const map: PricingMap = new Map();
  for (const { src } of candidateFiles()) {
    if (!src) continue;
    let cfg: unknown;
    try {
      cfg = JSON.parse(stripJsonComments(src));
    } catch {
      continue;
    }
    const providers = (cfg as { provider?: Record<string, { models?: Record<string, { cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number } }> }> }).provider;
    if (!providers) continue;
    for (const providerId of Object.keys(providers)) {
      const models = providers[providerId]?.models;
      if (!models) continue;
      for (const modelId of Object.keys(models)) {
        const c = models[modelId]?.cost;
        if (!c) continue;
        const num = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
        map.set(`${providerId}|${modelId}`, {
          input: num(c.input),
          output: num(c.output),
          cacheRead: num(c.cache_read),
          cacheWrite: num(c.cache_write),
        });
      }
    }
  }
  return map;
}
