# KiloCost

Total costs for Kilo Code sessions.

Unofficial VS Code companion that shows the **total token cost per project** for [Kilo Code](https://kilo.ai) sessions.

Kilo's UI only shows cost per session; every new session starts at $0. KiloCost reads Kilo's local session database (`~/.local/share/kilo/kilo.db`) read-only and aggregates `cost` across all sessions of the current project, shown in the status bar with a per-session/per-model breakdown panel.

## Status

Early scaffolding. Planned:

- Status bar item: project total cost, refresh via bundled sqlite3 CLI (read-only, WAL-safe)
- Webview panel: session list, per-model and per-day breakdown
- Version-guarded queries against `kilo.db` schema drift
- Publish to VS Code Marketplace + Open VSX

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Kilo-Org or Anaconda. "Kilo" is a trademark of its respective owner. All data stays local; nothing is sent over the network.
