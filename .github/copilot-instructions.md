# Copilot instructions for Inventory MVP v2

Summary
- Small single-page frontend (no build). ES modules using `type="module"` in `index.html`.
- Modules: **db.js** (domain + localStorage), **auth.js** (session + RBAC), **ui.js** (DOM + event bindings), **scanner.js** (camera barcode scanning), **app.js** (bootstrap).

Quick architecture notes
- Data is persisted in `localStorage` under key `INV_MVP_V2`; sessions use `sessionStorage` key `INV_MVP_SESSION_V2`.
- Domain operations live in `js/db.js` (addWarehouse, addProduct, postTransaction, fefoOut, import/export, reset).
- UI expects many DOM elements by id (see `index.html`) and refreshes via `renderAll()` in `js/ui.js`.
- Barcode scanning uses the browser `BarcodeDetector` API (Chrome) via `js/scanner.js`; camera requires HTTPS or localhost.

Important conventions & behaviors to preserve
- Lots are unique per product by `productId + lotNo` (see `getOrCreateLot`).
- FEFO behavior: when committing an OUT and `lotNo` is empty, the UI uses `fefoOut(...)` to consume earliest expiring lots.
- Transaction types: `IN`, `OUT`, `ADJUST`.
  - `IN`/`OUT`: qty must be non-zero integer; `OUT` prevents negative balances.
  - `ADJUST`: sets absolute qty to given value (can be 0).
- `postTransaction` and `fefoOut` write `stockTransactions` and update `stockBalances` (balances with qty === 0 are removed).
- Time fields are ISO strings (e.g., `createdAt`, `updatedAt`, `ts`). `uid()` uses `crypto.randomUUID()` fallback.

APIs & code examples
- Add product: `addProduct({ name: 'X', barcode: '012', unit: 'box' }, actor)` (`actor` from `auth.currentUser()`).
- Post transaction: `postTransaction({ type:'IN', warehouseId, productId, lotNo, expDate, qty, note }, actor)`.
- FEFO out: `fefoOut({ warehouseId, productId, qtyOut, note }, actor)` returns an array of created transactions.
- Import/export: `exportDbJson()` / `importDbJson(text)`; import expects keys: `warehouses, products, lots, stockBalances, stockTransactions, users, meta`.

Testing / running notes
- No build system or tests in repo. Open `index.html` (or run a static server: `python -m http.server 8000` or `npx serve`) to use app.
- There is a smoke test page at `test/date-smoke.html` to verify expiration date normalization and to run a simple migration on existing lots.
- Camera scanning requires HTTPS or `localhost` and a browser with `BarcodeDetector` support; UI provides messages when unsupported.

Warnings & guardrails for code edits
- Many functions throw errors for invalid inputs (e.g., non-integer qty, insufficient stock, invalid schema on import). Preserve those checks when refactoring.
- `ui.js` binds directly to specific element IDs—rename carefully and update `index.html` and references.
- Changing data shape (meta.version) may require migration of persisted `localStorage` data.

Files to inspect when making changes
- `index.html` — DOM structure and IDs used by `ui.js`.
- `js/db.js` — domain rules and persistence (core logic to preserve).
- `js/ui.js` — rendering and event wiring (UI/UX behavior like FEFO when lot empty).
- `js/auth.js` — fake users and `can()` action checks (actions: `MASTER_WRITE`, `TX_WRITE`, `RESET`, `IO`).
- `js/scanner.js` — camera initialization and BarcodeDetector usage (stop/start logic).

If you need me to expand any section (examples, edge cases, or add tests/CI instructions), tell me which part is unclear and I will iterate. ✅
