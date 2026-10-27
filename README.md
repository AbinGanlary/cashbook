# CashBook

A desktop petty-cash and imprest accounting app. It keeps a cash/bank ledger, turns a month (or any date range) into a locked expense claim, reconciles the bank statement against the ledger, and can share its data between PCs on the same network.

Built with **React 19 + Vite + Tailwind 4** on the front end and **Tauri 2 (Rust)** for the desktop shell and an embedded LAN sync server.

<!-- Add screenshots here: docs/screenshots/dashboard.png, summary.png, brs.png -->

## Features

- **Ledger** – Payments, Receipts, Contra (cash ⇄ bank) and Ratification entries with running cash and bank balances. Amount fields accept sums like `(200+300+200)`.
- **Budget codes** – annual limits per account code, with a warning when a payment would exceed one.
- **Claims / bills** – generating a bill for a period stamps serial numbers on its expenses and locks them. Entries added later with a back-dated date stay editable, so a locked bill never changes.
- **Summary letter** – replenishment summary reconciled to the imprest amount, including signed previous/pending claims.
- **Bank reconciliation (BRS)** – per-bill statement with uncleared cheques and bank-side items, draft → locked → re-open workflow, yearly history grid, Excel export.
- **Vendor bill summary** – vendors with batches of dated bills and line items, printable.
- **Petty cash vouchers** – numbered vouchers with amount in words (Indian lakh/crore system), optional posting to the ledger, custom letterhead.
- **Branding** – set your organization name in *Settings*; it appears on every printed statement and export.
- **Backup & restore** – full JSON backup, CSV and Excel export, dark mode, and a *Load Sample Data* button to try it with a demo ledger.
- **LAN sync** – one PC hosts, others connect with an IP and PIN; changes are pushed live over WebSockets.

## Architecture

```
React UI (App.jsx + lazy modules)
 ├─ localStorage      main ledger: transactions, bills, BRS, codes, settings, previous claims
 ├─ IndexedDB         vendor bills and vouchers (one isolated DB per module)
 └─ useCashbookSync   optional: mirrors the six main keys to the LAN host

Tauri shell (Rust)
 └─ axum server (host mode only)
     ├─ SQLite: key → JSON blob table
     ├─ REST   GET /api/data, GET|PUT /api/data/:key   (X-Cashbook-Pin header)
     └─ WS     /ws?pin=…  broadcasts each change to connected clients
```

Design notes:

- **Bill locking by creation time.** Transaction ids are creation timestamps. A transaction is locked when its date falls in a generated bill's period *and* its id is not later than the bill's generation time. Rebuilding a historical bill therefore reproduces exactly what was billed.
- **Sync is last-write-wins** per data key, with a JSON comparison to avoid echo loops between clients. On first connect, the user is warned before local data is replaced by the host's.
- **Network settings and letterhead stay local** to each machine and are never synced or exported.
- **Per-module IndexedDB** helper (`src/utils/idb.js`) keeps modules independent.

## Getting started

Prerequisites: Node 20+, and for the desktop build the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust, WebView2 on Windows).

```bash
npm install
npm run dev            # web preview at http://localhost:5173 (LAN sync needs the desktop app)
npx tauri dev          # desktop app
npx tauri build        # installer
```

Server tests: `cd src-tauri && cargo test`.

Open *Settings → Load Sample Data* for a demo ledger.

> The Excel export loads SheetJS from a CDN, so it needs an internet connection.

## Security note

LAN sync uses a shared PIN over plain HTTP. Use it on a trusted network only.

## License

MIT
