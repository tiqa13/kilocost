# KiloCost

Total costs for Kilo Code sessions.

Unofficial VS Code companion that shows the **total token cost per project** for [Kilo Code](https://kilo.ai) sessions. Kilo's UI only shows cost per session; every new session starts at $0.

KiloCost reads Kilo's local session database (`$HOME/.local/share/kilo/kilo.db`) strictly read-only (WAL-safe, built-in `node:sqlite`) and aggregates `cost` across all sessions of the current project — including child sessions under the workspace path. The running total appears in the status bar; clicking it opens a webview panel with a per-session, per-model and per-day breakdown.

## How it works

- **Read-only**: the SQLite file is opened with `readOnly: true` and never modified; Kilo keeps writing while the extension reads.
- **Project attribution**: sessions whose `directory` is the workspace root or below it (path-aware prefix), which also covers Agent Manager child sessions.
- **Refresh**: `fs.watch` on the database and its WAL with debounce, plus refresh on open and a manual `KiloCost: Refresh` command.
- **Currency**: costs are stored in USD. `kilocost.currency` converts via live ECB reference rates (`eurofxref-daily.xml`, cached daily). This is the only network request in the extension, and only when you switch away from USD — session cost data never leaves your machine. Set `kilocost.fetchRates: false` to keep zero network I/O (falls back to USD).
- **Schema drift**: queries are version-guarded against `kilo.db` schema changes; drift surfaces as a clear status state instead of a crash.

## Privacy

All Kilo session data stays local. Network is used only for the optional ECB exchange-rate lookup described above (disabled by `kilocost.fetchRates: false`). `KiloCost: Toggle Hidden` blanks the amount for onlookers.

## Status

Planning/scaffolding. See [PLAN.md](PLAN.md) for milestones, [DECISIONS.md](DECISIONS.md) for design decisions, and [DATA_MODEL.md](DATA_MODEL.md) for the verified `kilo.db` schema.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Kilo-Org or Anaconda. "Kilo" is a trademark of its respective owner.
