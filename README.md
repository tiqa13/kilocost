# KiloCost

Total costs for Kilo Code sessions.

Unofficial VS Code companion that shows the **total token cost per project** for [Kilo Code](https://kilo.ai) sessions. Kilo's UI only shows cost per session; every new session starts at $0. KiloCost adds up the running total per project and breaks it down per token type.

## Features

- **Status bar total** — accumulated cost of all sessions of the current project, updated in near-real-time. Click to open the breakdown panel.
- **Breakdown panel** — totals, per-model, per-day and newest-session tables.
- **Cost per token type** — input / output / reasoning / cache read / cache write, derived from your local Kilo pricing config; each session also shows its derived cost below the token counts.
- **Currency** — stored costs are USD; convert to any currency via live ECB reference rates.
- **Privacy** — `KiloCost: Toggle Hidden` blanks the amount for onlookers.
- **Robust** — read-only access, version-guarded queries; schema drift surfaces as a clear status state instead of a crash.

## How it works

- **Read-only**: the SQLite file (`$HOME/.local/share/kilo/kilo.db`) is opened with `readOnly: true` and never modified; Kilo keeps writing while the extension reads.
- **Project attribution**: sessions whose `directory` is the workspace root or below it (path-aware prefix), which also covers Agent Manager child sessions.
- **Refresh**: `fs.watch` on the database and its WAL files with debounce, plus refresh on workspace change and a manual `KiloCost: Refresh` command.
- **Currency**: `kilocost.currency` converts via live ECB reference rates (`eurofxref-daily.xml`, cached daily). This is the only network request in the extension, and only when you switch away from USD — session cost data never leaves your machine.
- **Pricing**: per-token-type costs read the `cost` blocks from `~/.config/kilo/kilo.jsonc` (input/output/cache rates per provider/model). Models without local pricing (e.g. hosted free tiers) are listed as unpriced.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `kilocost.currency` | `USD` | Currency to display, e.g. `EUR`, `TRY`, `JPY`. |
| `kilocost.fetchRates` | `true` | If `false`, no network request is made; all non-USD display falls back to USD. |
| `kilocost.databasePath` | `""` | Override the path to `kilo.db` if your Kilo data lives elsewhere. |

Commands: `KiloCost: Open Breakdown Panel`, `KiloCost: Refresh Costs`, `KiloCost: Toggle Hidden`, `KiloCost: Debug Info`.

## Privacy

All Kilo session data stays local. Network is used only for the optional ECB exchange-rate lookup described above.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Kilo-Org or Anaconda. "Kilo" is a trademark of its respective owner.
