import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Decimal } from '@/lib/domain/money'
import { buildPortfolioSnapshot } from '@/lib/domain/engine'
import { parsePricesCsv, parseTradesCsv } from '@/lib/csv/validate'
import type { AssetPosition } from '@/lib/domain/types'

/**
 * End-to-end correctness on the supplied dataset.
 *
 * The expected figures in `scripts/expected.json` come from `scripts/verify_independent.py`, a
 * from-scratch Python re-implementation of the specification using `decimal.Decimal`. Asserting
 * against a second independent implementation is what makes these numbers verifiable rather than
 * self-confirming: a bug would have to be reproduced identically in two separately written
 * implementations to slip through.
 *
 * Regenerate with: npm run verify
 */

const ROOT = join(__dirname, '..')

function loadSnapshot() {
  const tradesResult = parseTradesCsv(readFileSync(join(ROOT, 'data/trades.csv'), 'utf8'))
  if (!tradesResult.ok) {
    throw new Error(`Supplied trades.csv failed validation: ${JSON.stringify(tradesResult.issues)}`)
  }
  const pricesResult = parsePricesCsv(readFileSync(join(ROOT, 'data/prices.csv'), 'utf8'))
  if (!pricesResult.ok) {
    throw new Error(`Supplied prices.csv failed validation: ${JSON.stringify(pricesResult.issues)}`)
  }
  return {
    trades: tradesResult.data,
    snapshot: buildPortfolioSnapshot(tradesResult.data, pricesResult.data),
  }
}

type ExpectedPosition = AssetPosition & { fullCloses: number; reopens: number }
type Expected = {
  asOf: string
  tradeCount: number
  positions: ExpectedPosition[]
  totals: Record<string, string>
}

const expected: Expected = JSON.parse(readFileSync(join(ROOT, 'scripts/expected.json'), 'utf8'))

/** Compare two decimal strings exactly, independent of trailing-zero formatting. */
function expectDecimalEqual(actual: string | null, want: string | null, label: string) {
  if (want === null || actual === null) {
    expect(actual, label).toBe(want)
    return
  }
  expect(new Decimal(actual).equals(new Decimal(want)), `${label}: ${actual} !== ${want}`).toBe(true)
}

describe('supplied dataset', () => {
  it('imports cleanly — all 200 rows pass every validation rule', () => {
    const { trades, snapshot } = loadSnapshot()
    expect(trades).toHaveLength(200)
    expect(snapshot.tradeCount).toBe(200)
    expect(snapshot.missingPrices).toEqual([])
  })

  it('surfaces the price snapshot timestamp', () => {
    const { snapshot } = loadSnapshot()
    expect(snapshot.asOf).toBe('2026-03-31T23:59:59Z')
    expect(snapshot.asOf).toBe(expected.asOf)
  })

  it('matches the independent Python implementation for every asset', () => {
    const { snapshot } = loadSnapshot()
    expect(snapshot.positions).toHaveLength(expected.positions.length)

    for (const want of expected.positions) {
      const actual = snapshot.positions.find((p) => p.symbol === want.symbol)
      expect(actual, `missing position ${want.symbol}`).toBeDefined()
      if (!actual) continue

      expectDecimalEqual(actual.quantity, want.quantity, `${want.symbol}.quantity`)
      expectDecimalEqual(actual.averageCost, want.averageCost, `${want.symbol}.averageCost`)
      expectDecimalEqual(actual.costBasis, want.costBasis, `${want.symbol}.costBasis`)
      expectDecimalEqual(actual.currentPrice, want.currentPrice, `${want.symbol}.currentPrice`)
      expectDecimalEqual(actual.currentValue, want.currentValue, `${want.symbol}.currentValue`)
      expectDecimalEqual(actual.realizedPnl, want.realizedPnl, `${want.symbol}.realizedPnl`)
      expectDecimalEqual(actual.unrealizedPnl, want.unrealizedPnl, `${want.symbol}.unrealizedPnl`)
      expectDecimalEqual(actual.totalPnl, want.totalPnl, `${want.symbol}.totalPnl`)
      expectDecimalEqual(actual.allocation, want.allocation, `${want.symbol}.allocation`)
      expectDecimalEqual(actual.totalFees, want.totalFees, `${want.symbol}.totalFees`)
      expect(actual.tradeCount, `${want.symbol}.tradeCount`).toBe(want.tradeCount)
    }
  })

  it('matches the independent implementation on headline totals', () => {
    const { snapshot } = loadSnapshot()
    for (const [key, want] of Object.entries(expected.totals)) {
      expectDecimalEqual(
        snapshot.totals[key as keyof typeof snapshot.totals],
        want,
        `totals.${key}`
      )
    }
  })

  it('exercises the full-close-then-reopen path on every asset', () => {
    // Guards the test's own relevance: if the dataset were ever swapped for one without
    // reopened positions, the hardest branch in the engine would stop being covered here.
    for (const position of expected.positions) {
      expect(position.fullCloses, `${position.symbol} full closes`).toBeGreaterThan(0)
      expect(position.reopens, `${position.symbol} reopens`).toBeGreaterThan(0)
    }
  })
})

describe('invariants on the supplied dataset', () => {
  it('reconciles headline totals with the holdings rows the UI renders', () => {
    const { snapshot } = loadSnapshot()
    const sum = (pick: (p: AssetPosition) => string | null) =>
      snapshot.positions.reduce(
        (acc, p) => acc.plus(new Decimal(pick(p) ?? 0)),
        new Decimal(0)
      )

    expect(new Decimal(snapshot.totals.currentValue).equals(sum((p) => p.currentValue))).toBe(true)
    expect(new Decimal(snapshot.totals.costBasis).equals(sum((p) => p.costBasis))).toBe(true)
    expect(new Decimal(snapshot.totals.realizedPnl).equals(sum((p) => p.realizedPnl))).toBe(true)
    expect(new Decimal(snapshot.totals.unrealizedPnl).equals(sum((p) => p.unrealizedPnl))).toBe(true)
    expect(new Decimal(snapshot.totals.totalPnl).equals(sum((p) => p.totalPnl))).toBe(true)
    expect(new Decimal(snapshot.totals.totalFees).equals(sum((p) => p.totalFees))).toBe(true)
  })

  it('holds the averageCost × quantity === costBasis invariant per asset', () => {
    const { snapshot } = loadSnapshot()
    for (const position of snapshot.positions) {
      const product = new Decimal(position.averageCost).times(position.quantity)
      const basis = new Decimal(position.costBasis)
      // Allow a 10^-20 tolerance: average cost is a 40-digit division, so the product can differ
      // in the last significant digits while remaining far beyond display precision.
      expect(
        product.minus(basis).abs().lessThan('1e-20'),
        `${position.symbol}: ${product.toFixed()} vs ${basis.toFixed()}`
      ).toBe(true)
    }
  })

  it('sums allocations to exactly 1 across valued positions', () => {
    const { snapshot } = loadSnapshot()
    const total = snapshot.positions.reduce(
      (acc, p) => acc.plus(new Decimal(p.allocation ?? 0)),
      new Decimal(0)
    )
    expect(total.minus(1).abs().lessThan('1e-30')).toBe(true)
  })

  it('equals the raw CSV fee column total', () => {
    // Third, independent check of total fees: a direct column sum, bypassing the engine entirely.
    const csv = readFileSync(join(ROOT, 'data/trades.csv'), 'utf8').trim().split('\n').slice(1)
    const raw = csv.reduce((acc, line) => acc.plus(new Decimal(line.split(',')[7])), new Decimal(0))

    const { snapshot } = loadSnapshot()
    expect(new Decimal(snapshot.totals.totalFees).equals(raw)).toBe(true)
    expect(raw.toFixed(2)).toBe('2708.86')
  })

  it('never reports a negative holding', () => {
    const { snapshot } = loadSnapshot()
    for (const position of snapshot.positions) {
      expect(new Decimal(position.quantity).isNegative(), position.symbol).toBe(false)
      expect(new Decimal(position.costBasis).isNegative(), position.symbol).toBe(false)
    }
  })

  it('produces identical results when the input rows are shuffled', () => {
    // Determinism: replay order must come from timestamps, not from file order.
    const tradesResult = parseTradesCsv(readFileSync(join(ROOT, 'data/trades.csv'), 'utf8'))
    const pricesResult = parsePricesCsv(readFileSync(join(ROOT, 'data/prices.csv'), 'utf8'))
    if (!tradesResult.ok || !pricesResult.ok) throw new Error('fixture failed validation')

    // Deterministic pseudo-shuffle so a failure is reproducible.
    const shuffled = [...tradesResult.data].sort((a, b) =>
      (a.tradeId.charCodeAt(5) * 31 + a.tradeId.charCodeAt(7)) -
      (b.tradeId.charCodeAt(5) * 31 + b.tradeId.charCodeAt(7))
    )

    const ordered = buildPortfolioSnapshot(tradesResult.data, pricesResult.data)
    const reordered = buildPortfolioSnapshot(shuffled, pricesResult.data)
    expect(reordered.totals).toEqual(ordered.totals)
    expect(reordered.positions).toEqual(ordered.positions)
  })
})
