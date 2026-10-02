# AI Workflow

**Tooling:** Cursor (agent mode) with Claude. Vitest for tests, `decimal.js` for arithmetic.

**How I work with the agent:** I design first, then prompt. Each prompt is scoped to one task, states the constraints up front, and says what the agent must *not* do. I read every diff before keeping it. Anything that touches money is verified by something other than the agent that wrote it — hand arithmetic, a second implementation, or a raw-data check.

**Division of work:**

| I did | The agent did |
| --- | --- |
| Read the spec, chose the stack, drew the module boundaries | Scaffolded the folder layout and route handlers to my design |
| Chose the numeric type, precision, rounding, and wire format | Wrote `money.ts` and the parse/format helpers to that policy |
| Wrote the engine rules and the test matrix | Implemented the engine and generated test cases from the matrix |
| Diagnosed every failing test and decided code-vs-test | Ran the standalone scripts I asked for |
| Designed the independent verification strategy | Wrote the Python cross-check to my constraints |
| Reviewed, rejected, and corrected (documented below) | Produced the first draft of UI components and this file |

---

## Example 1 — Scope and requirements

**Goal / context**

Fix the scope before any code. The brief weights AI workflow (35%) and calculation correctness (30%) far above feature count, and says "do not over-engineer."

**Prompt / faithful excerpt**

> Read `docs/assessment.pdf` and list only the hard requirements as bullet points: inputs, outputs, calculation rules, required states, and deliverables. No suggestions, no architecture. Then profile `data/trades.csv` and `data/prices.csv`: row count, symbols, exchanges, BUY/SELL split, timestamp range, whether prices are a single snapshot.

**Agent response summary**

Bullet list of requirements. Data profile: 200 trades, 5 symbols × 40, Binance 100 / Coinbase 100, 128 BUY / 72 SELL, single price snapshot at `2026-03-31T23:59:59Z`.

**Human review / verification**

I read the PDF myself and checked the list against it. Two rules I flagged as the likely places an implementation goes wrong: "a SELL never exceeds the quantity held at that point in the ordered history" and "full close followed by a new BUY." I checked the data by hand — every one of the five assets is fully closed and reopened twice. Those are hot paths, not edge cases.

**Outcome**

Scope locked: one dashboard, import/re-import, correct numbers, deployed URL. No persistence, no auth, no live prices.

---

## Example 2 — Architecture and data model

**Goal / context**

Clear FE/BE boundary, exact decimal math, re-importable data, deploy with zero setup.

**Prompt / faithful excerpt**

> Design only, no code. Next.js App Router + TypeScript + Vitest. No database — the server reads the CSVs and computes in memory. Two endpoints: `GET /api/portfolio` and `POST /api/import`. Domain logic is a pure module with no React, HTTP, or fs imports. Propose the folder layout and where the active dataset lives.

**Agent response summary**

`src/lib/domain` (pure engine), `src/lib/csv` (parse + validate), route handlers as the only callers of the domain, React components that format but never compute. For state: a module-level singleton on `globalThis` holding the active dataset.

**Human review / verification**

Kept the layering. Rejected the singleton: on Vercel each request can hit a different instance, so an upload held in process memory works locally and then silently serves stale or empty data in production. No error, wrong numbers — the worst failure mode for this task.

**Outcome**

Stateless server. `GET /api/portfolio` always re-derives from the bundled CSVs (doubles as "reset"). `POST /api/import` validates, replays, and returns the full snapshot; the client holds it for the session. Trade-off (import doesn't survive reload) documented in the README.

---

## Example 3 — Numeric policy

**Goal / context**

Decide the number type before the engine exists. CKB trades are ~10⁶ units at ~\$0.007; cost basis accumulates over 200 sequential operations. Floats are out.

**Prompt / faithful excerpt**

> `decimal.js`, 40 significant digits, `ROUND_HALF_UP`, configured in exactly one module. Every money and quantity field is a `string` in the domain types and the API contract. Parse to `Decimal` only inside the engine; format only in `src/lib/format`. Write `money.ts` with `toDecimal` / `fromDecimal`. `fromDecimal` must never emit exponent notation.

**Agent response summary**

`src/lib/domain/money.ts` as specified, with `toExpNeg` / `toExpPos` set so `toString()` stays in plain notation.

**Human review / verification**

Checked that 40 isn't a magic number: the widest intermediate is ~10⁶ × 10⁻³ carried to 8 dp, about 20 significant digits. 40 is 2× headroom — I wrote that into the file comment. Strings on the wire because `JSON.parse` to a double is a silent lossy step at the one boundary I can't test from the client.

**Outcome**

Policy enforced structurally: `Decimal` configured once; `number` appears in the money path only in `toChartNumber`, which is one-way and display-only.

---

## Example 4 — Calculation engine

**Goal / context**

Implement the spec's rules as a deterministic, pure function.

**Prompt / faithful excerpt**

> Implement `buildPortfolioSnapshot` in `engine.ts`. Rules exactly as written: BUY fee capitalised into basis; SELL fee deducted from proceeds; `cost removed = average cost before the sale × sold quantity`; SELL does not change the remaining average cost; full close resets quantity, basis, and average to zero; throw on a SELL that exceeds holdings. Replay per asset in timestamp order. No React, no HTTP, no fs.

**Agent response summary**

Per-symbol `Lot` accumulator with `applyBuy` / `applySell`, two-pass valuation (values first, allocation once the total is known), typed `ShortPositionError`.

**Human review / verification**

Read it line by line against the spec:

- Average cost carried over on SELL, not recomputed. ✔
- Ordering not deterministic — timestamp only, so same-instant trades fall back to file order. ✘
- Held asset with no price → `currentValue: null`, excluded from total, not counted as \$0. ✔
- Totals sum the same `positions` array the table renders, so cards, table, and charts reconcile by construction. ✔

**Outcome**

Added `trade_id` as a tiebreaker in `compareTrades` and a shuffled-input test. Required the short-position validator in `csv/validate.ts` to reuse the engine's own `compareTrades` and `Decimal` math, so the guard can't disagree with the thing it guards.

---

## Example 5 — Two failing tests, two different causes

**Goal / context**

First engine run: 18 pass, 2 fail.

```
✗ zeroes basis and average cost when a position is fully closed
  expected '27.0000000000000000000000000000000000001' to be '27'

✗ handles large quantities of sub-cent assets without losing precision
  expected '3363.3070084' to be '3363.3610084'
```

**Prompt / faithful excerpt**

> Don't change the engine or the tests. Run a standalone `decimal.js` script that imports nothing from `src/` and print: `464558 × 0.00723980`; and for buy 3 @ 100 fee 1, sell 3 @ 110 fee 2: basis, average, average × 3, realized.

**Agent response summary**

```
464558 × 0.00723980   = 3363.3070084
basis                 = 301
avg = 301/3           = 100.3333333333333333333333333333333333333
avg × 3               = 300.9999999999999999999999999999999999999
realized (avg × qty)  = 27.0000000000000000000000000000000000001
realized (basis)      = 27
```

**Human review / verification**

Failure 2 was my test: 464558 × 72398 = 33,633,070,084 → 3363.**307**0084. I transposed digits. Engine was right.

Failure 1 was a real bug: 301/3 doesn't terminate, so `avg × qty` on a full close leaves a 10⁻³⁹ residue in realized P&L. Over a complete buy→close cycle realized must equal net proceeds minus cost actually paid — exactly 27. The spec already requires a closed position to reset to zero, so consuming the exact remaining basis is the intended semantics.

**Outcome**

Fixed the test assertion. Fixed the engine:

```ts
const costRemoved = isFullClose ? lot.costBasis : lot.averageCost.times(quantity)
```

Added a regression test named for the mechanism. This path runs ten times on the supplied data.

---

## Example 6 — Independent verification

**Goal / context**

Tests written in the same session as the engine can share the same misreading. I wanted the numbers confirmed by something that didn't produce them.

**Prompt / faithful excerpt**

> Write `scripts/verify_independent.py` with stdlib `decimal`. Re-implement the rules from the PDF — do not open `engine.ts`. Read the same CSVs, emit JSON with every per-asset figure and the totals. I'll write the comparison test.

**Agent response summary**

Python script written. I wrote `tests/real-data.test.ts` asserting exact string equality on every field. First run:

```
TS:     -5052.962687945466166221712804876537540746
Python: -5052.962687945466166221712804876537540733
```

**Human review / verification**

Agreement to 37 digits. I didn't add a tolerance — a tiny difference is also what an ordering bug looks like after averaging. Cause: Python's `decimal` defaults to `ROUND_HALF_EVEN`; I'd set `decimal.js` to `ROUND_HALF_UP`. Context mismatch, not logic.

Two more checks outside both engines: `awk -F',' 'NR>1 {s+=$7} END {print s}' data/trades.csv` → `2708.86`, matching `totals.fees`; and the invariants `averageCost × quantity == costBasis` per asset and `Σ allocation == 1`.

**Outcome**

Aligned the Python context to `prec=40`, `ROUND_HALF_UP`. Both implementations match exactly at 40 significant digits on every asset and total. 67 tests: the seven required cases, import validation, real-data invariants.

---

## Example 7 — Lint error in agent-written React

**Goal / context**

`npm run lint` failed after the UI was in.

```
src/components/Dashboard.tsx
  67:28  error  Calling setState synchronously within an effect can trigger cascading renders
```

**Prompt / faithful excerpt**

> Explain why this rule fires here. Do not suggest a disable comment.

**Agent response summary**

A mount effect fetched the dataset if the server hadn't supplied one. The agent still proposed keeping it with `eslint-disable-next-line`.

**Human review / verification**

The question is whether the effect should exist. `page.tsx` is a server component that always resolves to a dataset or an error before hydration, so "no data on mount" is unreachable. The effect was covering a state the architecture already prevents.

**Outcome**

Deleted the effect, and the now-unreachable `KpiCardsSkeleton` and `Skeleton` primitive. Re-checked required states: first load is SSR with real figures; import shows "Validating…"; reset shows inline "Refreshing…" with data visible; load failure shows an error panel with retry; invalid import shows per-line issues and keeps the previous dataset. `npm run check` clean.

---

## Example 8 — Deployment

**Goal / context**

The app reads `data/*.csv` with `node:fs` at request time. Works locally; 500s on Vercel if the files aren't traced into the function bundle.

**Prompt / faithful excerpt**

> We read `data/*.csv` from `process.cwd()` with `node:fs`. What does Next's output tracing do with that on Vercel, and what's the minimal config so the files ship?

**Agent response summary**

Tracing can't follow a runtime-built path; the CSVs are omitted and the function fails with `ENOENT`. Proposed `outputFileTracingIncludes: { '/api/**/*': ['./data/*.csv'] }`.

**Human review / verification**

Right mechanism, incomplete fix: `page.tsx` reads the same files during SSR, so `/` needs the entry too. Confirmed the build reports `/` as dynamic (`ƒ`), not a prerendered snapshot.

**Outcome**

```ts
outputFileTracingIncludes: {
  '/': ['./data/*.csv'],
  '/api/**/*': ['./data/*.csv'],
},
```

Commented so it isn't deleted as unused config. No env vars, no secrets.

---

## Summary

The agent was fastest at things I could check mechanically: scaffolding, components, a zod schema, tests from a matrix I wrote. It was least reliable exactly where the grade is — a literal reading of `cost removed = average cost × quantity` is algebraically correct and numerically wrong, and that path runs ten times on the supplied data.

What caught it was not letting the engine be the only witness to its own numbers: hand arithmetic on one failure, a from-scratch Python implementation on the dataset, an `awk` sum on the raw fee column. Two of those three disagreed with the first implementation — once the code was wrong, once my test was.

Calls I'd defend: no server-side cache that lies on serverless, no tolerance to hide a 1e-37 mismatch, no lint suppression on an effect that shouldn't exist.
