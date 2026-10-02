# Crypto Portfolio Analytics

Portfolio analytics over an imported crypto trade history: holdings, weighted-average cost basis,
realized and unrealized P&L, allocation, and a filterable transaction explorer.

All figures derive from the supplied `trades.csv` and `prices.csv`. There is no live exchange or
market-price integration, by design.

- **Live app:** https://crypto-portfolio-analytics-delta.vercel.app
- **Price snapshot in the dataset:** `2026-03-31T23:59:59Z` (displayed in the UI header)

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm test             # 67 tests — calculation engine, import boundary, supplied-dataset cross-check
npm run check        # typecheck + lint + tests (the one command to validate the whole submission)
npm run build        # production build
npm start            # serve the production build
```

**Requirements:** Node.js ≥ 20. `npm run verify` additionally needs Python 3 (used only to
regenerate the independent cross-check fixture — not needed to run the app or the tests).

### Environment variables

**None.** The app reads the bundled CSVs from `data/` and holds no secrets, API keys, or database
credentials. There is nothing to configure and no `.env` file to create. If a future version adds a
live price feed, the key would belong in a server-only environment variable read inside a route
handler, never in a `NEXT_PUBLIC_*` variable.

### Loading and resetting the sample data

The supplied data loads automatically on first visit — no action needed.

| Action | How |
| --- | --- |
| Re-import / replace trades | **Import CSV**, or drop a `.csv` anywhere on the Trade data panel |
| Restore the supplied data | **Reset to sample** button |

The original files are kept at both `data/` (read by the app) and `docs/data/` (pristine copies, as
received). `docs/assessment.pdf` is the specification this was built against.

To see the validation path, import a deliberately broken file:

```bash
printf 'trade_id,timestamp,exchange,symbol,side,quantity,price_usd,fee_usd\nTRD-1,2025-10-01T09:00:00Z,Binance,BTC,BUY,1,100,0\nTRD-1,bad-date,Kraken,XRP,SHORT,-1,0,-5\n' > /tmp/bad.csv
```

---

## Architecture

```
┌─ Client (browser) ─────────────────────────────────────────────┐
│  Dashboard.tsx          owns active dataset + request lifecycle │
│  KpiCards · HoldingsTable · Charts · TransactionExplorer        │
│  format/               rounds for display — the ONLY rounding   │
└────────────────────────────────┬───────────────────────────────┘
                                 │ typed HTTP contract (api-contract.ts)
┌─ Server (Next.js route handlers / RSC) ─────────────────────────┐
│  app/page.tsx           computes the first snapshot during SSR   │
│  api/portfolio  GET     supplied dataset, replayed and valued    │
│  api/import     POST    validate uploaded CSV → full snapshot    │
│  store/dataset.ts       reads + caches the bundled CSVs          │
└────────────────────────────────┬───────────────────────────────┘
┌─ Domain (pure, framework-free) ────────────────────────────────┐
│  csv/parse.ts      RFC-4180 reader                              │
│  csv/validate.ts   zod schemas + all validation rules           │
│  domain/engine.ts  weighted-average cost-basis replay           │
│  domain/money.ts   Decimal context (40 digits, ROUND_HALF_UP)   │
│  domain/types.ts   data contracts                               │
└─────────────────────────────────────────────────────────────────┘
```

### Data flow

1. A request hits `app/page.tsx` (a server component). It calls `loadSeedDataset()`, which reads
   both CSVs, validates them, and replays them through the engine.
2. The resulting snapshot is passed to `<Dashboard>` as props, so **the first paint already contains
   real figures** — no loading spinner on initial visit, no client round-trip for data already known
   on the server.
3. An import POSTs the file to `/api/import`. The server validates and replays it, then returns the
   complete new snapshot. The client swaps its state only on success.
4. **Reset** re-fetches `GET /api/portfolio`, which always reflects the bundled files.

### Why the calculation lives on the server

Every monetary operation happens in `src/lib/domain`, invoked only from server code. The client
receives finished figures and formats them. This keeps one implementation of the rules, makes the
engine testable without a DOM, and means a UI change cannot alter a number.

### Why there is no database

The engine is a pure function of (trades, prices). Persisting an import would add a stateful
dependency without changing any output, so the server stays stateless: `GET /api/portfolio` always
returns the supplied dataset, and an imported dataset lives in client state for the session.

The tradeoff is explicit: **an imported file is not persisted across a page reload.** On a
serverless host an in-memory server cache would be worse than useless — it would appear to work,
then silently serve stale or missing data depending on which instance handled the request. If
persistence were required, the fix is a real store (Postgres/SQLite) keyed by session, not
process memory.

---

## Calculation approach

Weighted-average cost basis, replayed per asset in ascending timestamp order.

**BUY** — the fee is capitalized into cost basis, so it raises average cost:

```
cost added   = quantity × price + fee
quantity    += quantity
cost basis  += cost added
average cost = cost basis / quantity
```

**SELL** — the fee reduces proceeds; average cost of the remainder is unchanged:

```
net proceeds = quantity × price − fee
cost removed = average cost (before the sale) × quantity
realized P&L += net proceeds − cost removed
quantity    −= quantity
cost basis  −= cost removed
```

**Full close** — when quantity reaches zero, quantity, cost basis, and average cost are reset to
zero, so a later BUY starts a fresh position instead of blending with the closed cycle.

**Valuation**

```
current value   = quantity × current price
unrealized P&L  = current value − cost basis
total P&L       = realized + unrealized
allocation      = asset current value / portfolio current value
```

### Documented decisions

**1. Exactly-closing sells consume the exact remaining basis.**
On a full close, `cost removed` is the entire remaining cost basis rather than
`average cost × quantity`. The two are algebraically identical but not numerically: average cost is
a division, so for a basis of 301 over 3 units, `avg × 3` lands on `300.999…9` and leaks a residue
into realized P&L. A test caught this as `27.0000000000000000000000000000000000001` instead of `27`
(`tests/engine.test.ts` → "realizes an exact figure on a full close whose average cost does not
terminate"). Consuming the exact basis is both the intended semantics — the spec already requires a
closed position to reset to zero — and the economically correct result: over a complete buy→close
cycle, realized P&L must equal net proceeds minus the cost actually paid.

**2. Ties in the trade history are broken by `trade_id`.**
Timestamp is the primary sort key. Without a tiebreaker, two trades on the same instant would
replay in file order, so re-importing the same rows in a different order could produce different
realized P&L. A test asserts shuffled input produces an identical snapshot.

**3. Holdings are scoped per asset, not per asset-and-exchange.**
The spec defines cost basis per asset, so a Coinbase BUY can fund a Binance SELL. Exchange is
retained on every transaction and is filterable, but it does not partition cost basis.

**4. A missing price is surfaced, never treated as zero.**
If a held asset has no price in the snapshot, its `currentValue`, `unrealizedPnl`, and `allocation`
are `null`, it is excluded from portfolio value, and the UI shows a "Valuation is incomplete"
banner. Realized P&L remains exact. A *closed* position with no price is valued at zero, which is
correct rather than unknown. (The supplied dataset prices all five assets, so this path is covered
by tests rather than visible in the demo.)

### Precision and rounding

| Concern | Decision |
| --- | --- |
| Numeric type | `decimal.js` `Decimal`, **40 significant digits**, `ROUND_HALF_UP` (`src/lib/domain/money.ts`) |
| Transport | Decimal **strings** in every API payload and domain type — never JS `number` |
| Rounding | **Only at display**, in `src/lib/format` |
| Charts | `toChartNumber` converts to `number` at 2 dp — purely visual, nothing flows back |

`number` is avoided because IEEE-754 cannot represent decimal fractions such as `0.00715` exactly,
and 200 sequential `+=` operations accumulate that error into cost basis, then into average cost,
then into every downstream total. 40 digits is sized for the widest real case in the dataset — a
CKB position of ~10⁶ units at ~10⁻³ with 8 decimal places needs roughly 20 significant digits — and
leaves generous headroom.

Display precision adapts to magnitude so a sub-cent asset is not flattened to `$0.01`: prices use
2–8 decimals depending on size, quantities 2–8, USD amounts always 2.

---

## Correctness: how to verify it yourself

The numbers are checked three independent ways, not merely asserted against themselves.

**1. Hand-computed unit tests.** Every expectation in `tests/engine.test.ts` is derived from the
spec and stated in a comment next to the assertion, including all seven required cases: multiple
BUYs at different prices, BUY fees in average cost, partial SELLs, SELL fees deducted from
proceeds, full close then re-BUY, short-position rejection, and invalid/duplicate CSV rows.

**2. A second, independent implementation.** `scripts/verify_independent.py` re-implements the
specification from scratch in Python using `decimal.Decimal`, reads the same CSVs, and emits
`scripts/expected.json`. `tests/real-data.test.ts` asserts the TypeScript engine matches it
**exactly, at 40 significant digits**, for every asset and every total. A bug would have to be
reproduced identically in two separately written implementations to pass.

```bash
npm run verify && npm test   # regenerate the fixture, then compare
```

**3. Invariants on the supplied dataset.**

- headline totals equal the sum of the holdings rows the UI renders
- `averageCost × quantity == costBasis` per asset
- allocations sum to exactly 1
- total fees equal a direct sum of the raw CSV fee column (`$2708.86`)
- no negative quantity or cost basis
- shuffled input produces an identical snapshot

### Expected figures for the supplied dataset

| Metric | Value |
| --- | --- |
| Portfolio value | $60,620.89 |
| Cost basis | $59,969.24 |
| Realized P&L | −$5,052.96 |
| Unrealized P&L | +$651.65 |
| Total P&L | −$4,401.31 |
| Total fees | $2,708.86 |

The dataset closes out and reopens every one of the five assets twice, so the hardest branch in the
engine is exercised by the real data, not only by synthetic fixtures.

---

## Validation rules

An import is **all-or-nothing**. Every row is checked and *all* issues are collected before anything
is returned, so a rejected file leaves the previously loaded dataset fully intact. Each issue
reports the source line, the column, and the offending value.

| Rule | Behaviour |
| --- | --- |
| Required columns present | reports every missing column at once |
| `trade_id` unique | names the line of the first occurrence |
| Timestamps valid | strict ISO-8601 with timezone; rejects impossible dates |
| Exchange / symbol / side supported | error lists the allowed values |
| Quantity, price > 0 | rejects `0`, negatives, `NaN`, `Infinity`, blanks |
| Fee ≥ 0 | rejects negatives |
| SELL never exceeds holdings | dry-runs the replay using the engine's own ordering and arithmetic |
| Well-formed CSV | wrong column count, empty file, header-only; tolerates CRLF and a UTF-8 BOM |

The short-position check reuses `compareTrades` and `Decimal` from the engine rather than
reimplementing them, so the validator cannot disagree with the calculation it guards.

---

## Product and UX notes

- **Dashboard:** portfolio value, cost basis, realized, unrealized, total P&L, total fees — each
  with a one-line explanation of how it is derived.
- **Holdings table:** all ten required columns, plus trade count and fees per asset. Closed
  positions stay visible so the realized column reconciles with the dashboard.
- **Charts:** allocation by current value (donut) and realized vs unrealized P&L by asset (grouped
  bars with an explicit zero reference line). Both are driven by the same `positions` array as the
  table, and each is paired with a text table that carries the same data.
- **Transaction explorer:** search, asset/exchange/side filters, inclusive UTC date range, sortable
  timestamp/gross value/fee, pagination at 25/50/100. Shows every CSV column plus gross value, and
  a running gross/fee total for the current filter.
- **Accessibility:** signed figures always carry an explicit `+`/`−`, so profit and loss never
  depend on colour alone. Tables use `<caption>`, scoped headers, and `aria-sort`; pagination is a
  labelled `<nav>` with a live region; focus is visible throughout; charts have text equivalents;
  `prefers-reduced-motion` is respected.
- **Responsive:** single column on mobile with horizontally scrollable tables; multi-column from
  `sm`/`lg` upward.
- **States:** first load is server-rendered with real data; import shows a validating spinner and a
  receipt of what was kept versus replaced; a rejected import shows a per-line error report and
  keeps the current dataset; a failed load shows a retry; missing prices show a warning banner;
  empty filter results and an empty dataset each have their own message.
- **Language and theme:** English, Vietnamese, Chinese, Japanese, and Korean, plus light and dark.
  These are presentation only. Calculation strings in validation errors stay English so test
  assertions do not depend on the active locale.
- **Filtering is client-side.** With ~200 rows already in memory, a round-trip per keystroke would
  add latency and code for no benefit. The boundary that matters — money arithmetic and validation —
  stays on the server.

---

## Deployment

The app is a standard Next.js application with no external services, no database, and no secrets,
so it deploys as-is.

```bash
npx vercel --prod     # or: connect the repository in the Vercel dashboard
```

One deployment-specific detail worth knowing: the seed CSVs are read with `node:fs` at request
time, and Next's bundler cannot infer a runtime-constructed path. `next.config.ts` therefore
declares them explicitly:

```ts
outputFileTracingIncludes: { '/api/**/*': ['./data/*.csv'] }
```

Without that, the deployed function 500s with `ENOENT` while working perfectly in local dev.

No authentication is used, so no test credentials are required.

---

## Assumptions

1. `prices.csv` is a single snapshot; if rows disagreed on `as_of`, the latest instant wins and is
   the one displayed. A duplicate price for one symbol is rejected as ambiguous rather than
   silently last-write-wins.
2. Timestamps are UTC and are displayed in UTC. Rendering in local time would shift trade dates
   across day boundaries and misstate the history.
3. Cost basis is per asset across exchanges (see decision 3 above).
4. Either supplied file can be dropped on the importer. `trades.csv` replaces the history and is
   valued with the snapshot currently on screen. `prices.csv` replaces the valuation snapshot and
   is applied to the history currently on screen. Uploading one does not discard the other. Reset
   restores both bundled files.
5. Fees are already denominated in USD, as the column name states.
6. The data never creates a short position, as stated in the spec; the app nonetheless rejects one
   rather than trusting the input.

## Limitations

- An imported file is not persisted across a reload (see "Why there is no database").
- No authentication or multi-user separation — out of scope.
- A price upload is a single snapshot, matching the supplied `prices.csv`. It is not a price history.
- No FIFO/LIFO/HIFO alternatives; the spec mandates weighted average.
- No time-series P&L chart, because the dataset provides only one price snapshot. Historical
  portfolio value cannot be derived from execution prices alone without assuming no price movement
  between trades, which would be misleading.
- Fee treatment follows the spec, not any particular tax jurisdiction.

## Future improvements

1. **Persistence** — Postgres with a session-scoped dataset, enabling import history and reload
   survival.
2. **Per-exchange cost-basis view** — a toggle between asset-level and asset-and-exchange lots,
   which matters for jurisdictions that track lots per venue.
3. **Historical valuation** — accept a price time series and chart portfolio value over time.
4. **Property-based tests** — generate random valid histories and assert invariants (basis never
   negative, realized + unrealized reconciles, average cost stable across sells) across thousands
   of cases rather than hand-picked ones.
5. **Virtualized table** — pagination is sufficient at 200 rows; a windowed list would be needed
   beyond ~10k.
6. **Streaming import** — parse large files incrementally instead of reading the whole body.
7. **CSV/JSON export** of the computed holdings for downstream reconciliation.

---

## Project layout

```
src/
  app/
    page.tsx                  server component: builds the first snapshot
    layout.tsx  globals.css
    api/portfolio/route.ts    GET  supplied dataset
    api/import/route.ts       POST validate + replay an upload
  components/                 presentation only, no money arithmetic
  lib/
    domain/{engine,money,types}.ts   pure calculation core
    csv/{parse,validate}.ts          import boundary
    store/dataset.ts                 server-only CSV access + cache
    format/index.ts                  display rounding
    api-contract.ts                  shared HTTP types
tests/
  engine.test.ts      hand-computed rule coverage
  import.test.ts      validation boundary
  real-data.test.ts   cross-check vs the Python implementation + invariants
scripts/
  verify_independent.py   second implementation of the spec
  expected.json           its output, used as a test fixture
data/                     CSVs read by the app
docs/                     assessment.pdf + pristine CSV copies
AI_WORKFLOW.md            AI coding-agent workflow write-up
```

---

## SUBMISSION

- **Repository:** https://github.com/iamphamduytuan/crypto-portfolio-analytics
- **Live app:** https://crypto-portfolio-analytics-delta.vercel.app
- **Test credentials:** not applicable — no authentication
- **Run the full check:** `npm run check`
