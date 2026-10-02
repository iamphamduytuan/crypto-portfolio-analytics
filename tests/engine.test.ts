import { beforeEach, describe, expect, it } from 'vitest'
import { ShortPositionError, buildPortfolioSnapshot, compareTrades } from '@/lib/domain/engine'
import type { Symbol_ } from '@/lib/domain/types'
import { resetTradeCounter, snapshot, trade } from './helpers'

/**
 * Every expectation below is a hand-computed figure derived from the rules in the specification,
 * not a value captured from a previous run of this code. Each test states the arithmetic it
 * asserts so a reviewer can check it without executing anything.
 */

function positionOf(
  trades: Parameters<typeof buildPortfolioSnapshot>[0],
  prices: Record<string, string>,
  symbol: Symbol_ = 'BTC'
) {
  const result = buildPortfolioSnapshot(trades, snapshot(prices))
  const position = result.positions.find((p) => p.symbol === symbol)
  if (!position) throw new Error(`No position for ${symbol}`)
  return { position, result }
}

beforeEach(() => resetTradeCounter())

describe('BUY handling', () => {
  it('averages multiple BUYs at different prices by value, not by price', () => {
    // BUY 1 @ 100 → basis 100. BUY 1 @ 200 → basis 300. qty 2 → avg 300/2 = 150.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '1', priceUsd: '100' }),
        trade({ side: 'BUY', quantity: '1', priceUsd: '200' }),
      ],
      { BTC: '150' }
    )

    expect(position.quantity).toBe('2')
    expect(position.costBasis).toBe('300')
    expect(position.averageCost).toBe('150')
  })

  it('capitalizes the BUY fee into average cost', () => {
    // gross = 2 × 100 = 200; cost added = 200 + 10 = 210; avg = 210 / 2 = 105 (not 100).
    const { position } = positionOf(
      [trade({ side: 'BUY', quantity: '2', priceUsd: '100', feeUsd: '10' })],
      { BTC: '100' }
    )

    expect(position.costBasis).toBe('210')
    expect(position.averageCost).toBe('105')
    // Current value 2 × 100 = 200 against basis 210 → the fee alone makes this a 10 loss.
    expect(position.currentValue).toBe('200')
    expect(position.unrealizedPnl).toBe('-10')
  })

  it('weights unequal quantities correctly', () => {
    // BUY 3 @ 10 = 30; BUY 1 @ 50 = 50; basis 80 over qty 4 → avg 20.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '3', priceUsd: '10' }),
        trade({ side: 'BUY', quantity: '1', priceUsd: '50' }),
      ],
      { BTC: '20' }
    )

    expect(position.averageCost).toBe('20')
    expect(position.costBasis).toBe('80')
  })
})

describe('SELL handling', () => {
  it('realizes P&L on a partial sell and leaves average cost unchanged', () => {
    // BUY 10 @ 100 → avg 100, basis 1000.
    // SELL 4 @ 150 → net 600; cost removed 100 × 4 = 400; realized = 600 − 400 = 200.
    // Remaining qty 6, basis 1000 − 400 = 600, avg still 100.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '10', priceUsd: '100' }),
        trade({ side: 'SELL', quantity: '4', priceUsd: '150' }),
      ],
      { BTC: '100' }
    )

    expect(position.realizedPnl).toBe('200')
    expect(position.quantity).toBe('6')
    expect(position.costBasis).toBe('600')
    expect(position.averageCost).toBe('100')
  })

  it('deducts the SELL fee from proceeds', () => {
    // Same as above but fee 25 → net 575; realized = 575 − 400 = 175.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '10', priceUsd: '100' }),
        trade({ side: 'SELL', quantity: '4', priceUsd: '150', feeUsd: '25' }),
      ],
      { BTC: '100' }
    )

    expect(position.realizedPnl).toBe('175')
    // The SELL fee must not alter the cost basis of what is still held.
    expect(position.costBasis).toBe('600')
    expect(position.averageCost).toBe('100')
  })

  it('resets the lot on a full close, then starts a fresh basis on the next BUY', () => {
    // BUY 5 @ 100 → avg 100, basis 500.
    // SELL 5 @ 120 → net 600; cost removed 500; realized 100. Position flat → reset to zero.
    // BUY 2 @ 300 → basis 600, avg 300 (NOT blended with the closed cycle's 100).
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '5', priceUsd: '100' }),
        trade({ side: 'SELL', quantity: '5', priceUsd: '120' }),
        trade({ side: 'BUY', quantity: '2', priceUsd: '300' }),
      ],
      { BTC: '300' }
    )

    expect(position.realizedPnl).toBe('100')
    expect(position.quantity).toBe('2')
    expect(position.costBasis).toBe('600')
    expect(position.averageCost).toBe('300')
    // Valued at cost → unrealized is exactly zero, so total P&L is the realized 100.
    expect(position.unrealizedPnl).toBe('0')
    expect(position.totalPnl).toBe('100')
  })

  it('zeroes basis and average cost when a position is fully closed', () => {
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '3', priceUsd: '100', feeUsd: '1' }),
        trade({ side: 'SELL', quantity: '3', priceUsd: '110', feeUsd: '2' }),
      ],
      { BTC: '110' }
    )

    // net 330 − 2 = 328; cost removed = full basis 301; realized = 328 − 301 = 27.
    expect(position.quantity).toBe('0')
    expect(position.costBasis).toBe('0')
    expect(position.averageCost).toBe('0')
    expect(position.realizedPnl).toBe('27')
    // A closed position is worth zero — not "unvaluable" — so totals stay well defined.
    expect(position.currentValue).toBe('0')
    expect(position.unrealizedPnl).toBe('0')
    expect(position.totalPnl).toBe('27')
  })

  it('realizes an exact figure on a full close whose average cost does not terminate', () => {
    // Regression guard. BUY 3 @ 100 fee 1 → basis 301, avg 301/3 = 100.333… (non-terminating).
    // SELL 3 @ 110 fee 2 → net 328. Over a complete cycle realized P&L must be exactly 328 − 301.
    // Removing `avg × 3` instead of the exact remaining basis leaks a division residue and yields
    // 27.0000000000000000000000000000000000001.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '3', priceUsd: '100', feeUsd: '1' }),
        trade({ side: 'SELL', quantity: '3', priceUsd: '110', feeUsd: '2' }),
      ],
      { BTC: '110' }
    )

    expect(position.realizedPnl).toBe('27')
  })

  it('rejects a SELL that would create a short position', () => {
    expect(() =>
      buildPortfolioSnapshot(
        [
          trade({ side: 'BUY', quantity: '1', priceUsd: '100' }),
          trade({ side: 'SELL', quantity: '2', priceUsd: '100' }),
        ],
        snapshot({ BTC: '100' })
      )
    ).toThrow(ShortPositionError)
  })

  it('rejects a SELL that precedes its BUY in timestamp order', () => {
    // Declaration order is irrelevant — only the ordered history matters.
    expect(() =>
      buildPortfolioSnapshot(
        [
          trade({ side: 'SELL', quantity: '1', priceUsd: '100', timestamp: '2025-01-01T00:00:00Z' }),
          trade({ side: 'BUY', quantity: '1', priceUsd: '100', timestamp: '2025-01-02T00:00:00Z' }),
        ],
        snapshot({ BTC: '100' })
      )
    ).toThrow(ShortPositionError)
  })

  it('allows selling exactly the full held quantity', () => {
    expect(() =>
      buildPortfolioSnapshot(
        [
          trade({ side: 'BUY', quantity: '1.5', priceUsd: '100' }),
          trade({ side: 'SELL', quantity: '1.5', priceUsd: '100' }),
        ],
        snapshot({ BTC: '100' })
      )
    ).not.toThrow()
  })
})

describe('ordering', () => {
  it('replays in timestamp order regardless of input row order', () => {
    const late = trade({
      side: 'BUY',
      quantity: '1',
      priceUsd: '200',
      timestamp: '2025-02-01T00:00:00Z',
    })
    const early = trade({
      side: 'BUY',
      quantity: '1',
      priceUsd: '100',
      timestamp: '2025-01-01T00:00:00Z',
    })

    const forward = buildPortfolioSnapshot([early, late], snapshot({ BTC: '150' }))
    const reversed = buildPortfolioSnapshot([late, early], snapshot({ BTC: '150' }))

    expect(reversed.positions[0].averageCost).toBe(forward.positions[0].averageCost)
    expect(reversed.totals).toEqual(forward.totals)
  })

  it('breaks identical timestamps deterministically by trade_id', () => {
    const a = trade({ side: 'BUY', tradeId: 'TRD-0002', timestamp: '2025-01-01T00:00:00Z' })
    const b = trade({ side: 'BUY', tradeId: 'TRD-0001', timestamp: '2025-01-01T00:00:00Z' })
    expect(compareTrades(a, b)).toBeGreaterThan(0)
    expect(compareTrades(b, a)).toBeLessThan(0)
  })
})

describe('valuation and totals', () => {
  it('computes allocation as a share of portfolio current value', () => {
    // BTC 1 × 100 = 100; ETH 1 × 300 = 300; portfolio 400 → 25% / 75%.
    const result = buildPortfolioSnapshot(
      [
        trade({ side: 'BUY', symbol: 'BTC', quantity: '1', priceUsd: '100' }),
        trade({ side: 'BUY', symbol: 'ETH', quantity: '1', priceUsd: '300' }),
      ],
      snapshot({ BTC: '100', ETH: '300' })
    )

    const btc = result.positions.find((p) => p.symbol === 'BTC')!
    const eth = result.positions.find((p) => p.symbol === 'ETH')!

    expect(btc.allocation).toBe('0.25')
    expect(eth.allocation).toBe('0.75')
    expect(result.totals.currentValue).toBe('400')
  })

  it('reconciles headline totals with the sum of the holdings rows', () => {
    const result = buildPortfolioSnapshot(
      [
        trade({ side: 'BUY', symbol: 'BTC', quantity: '2', priceUsd: '100', feeUsd: '5' }),
        trade({ side: 'SELL', symbol: 'BTC', quantity: '1', priceUsd: '150', feeUsd: '3' }),
        trade({ side: 'BUY', symbol: 'ETH', quantity: '10', priceUsd: '20', feeUsd: '2' }),
      ],
      snapshot({ BTC: '150', ETH: '25' })
    )

    const sum = (pick: (p: (typeof result.positions)[number]) => string | null) =>
      result.positions.reduce((acc, p) => acc + Number(pick(p) ?? 0), 0)

    expect(Number(result.totals.currentValue)).toBeCloseTo(sum((p) => p.currentValue), 10)
    expect(Number(result.totals.costBasis)).toBeCloseTo(sum((p) => p.costBasis), 10)
    expect(Number(result.totals.realizedPnl)).toBeCloseTo(sum((p) => p.realizedPnl), 10)
    expect(Number(result.totals.unrealizedPnl)).toBeCloseTo(sum((p) => p.unrealizedPnl), 10)
    expect(Number(result.totals.totalFees)).toBe(10)
    // total P&L is realized + unrealized, which must also equal the sum of per-asset total P&L.
    expect(Number(result.totals.totalPnl)).toBeCloseTo(sum((p) => p.totalPnl), 10)
  })

  it('flags a held asset with no price instead of valuing it at zero', () => {
    const result = buildPortfolioSnapshot(
      [
        trade({ side: 'BUY', symbol: 'BTC', quantity: '1', priceUsd: '100' }),
        trade({ side: 'BUY', symbol: 'DOGE', quantity: '100', priceUsd: '1' }),
      ],
      snapshot({ BTC: '100' })
    )

    const doge = result.positions.find((p) => p.symbol === 'DOGE')!
    expect(result.missingPrices).toContain('DOGE')
    expect(doge.currentPrice).toBeNull()
    expect(doge.currentValue).toBeNull()
    expect(doge.unrealizedPnl).toBeNull()
    expect(doge.allocation).toBeNull()
    // The unvaluable asset must not inflate portfolio value with a phantom zero.
    expect(result.totals.currentValue).toBe('100')
  })

  it('reports a closed asset with non-zero realized P&L and zero allocation', () => {
    const result = buildPortfolioSnapshot(
      [
        trade({ side: 'BUY', symbol: 'SOL', quantity: '10', priceUsd: '10' }),
        trade({ side: 'SELL', symbol: 'SOL', quantity: '10', priceUsd: '15' }),
        trade({ side: 'BUY', symbol: 'BTC', quantity: '1', priceUsd: '100' }),
      ],
      snapshot({ SOL: '15', BTC: '100' })
    )

    const sol = result.positions.find((p) => p.symbol === 'SOL')!
    expect(sol.quantity).toBe('0')
    expect(sol.realizedPnl).toBe('50')
    expect(sol.allocation).toBe('0')
    expect(result.totals.currentValue).toBe('100')
  })

  it('handles an empty history without dividing by zero', () => {
    const result = buildPortfolioSnapshot([], snapshot({ BTC: '100' }))
    expect(result.positions).toEqual([])
    expect(result.totals.currentValue).toBe('0')
    expect(result.totals.totalPnl).toBe('0')
    expect(result.tradeCount).toBe(0)
  })
})

describe('precision', () => {
  it('keeps cost basis exact where floating point would drift', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. Three BUYs of 1 unit at these prices must total exactly 0.6.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '1', priceUsd: '0.1' }),
        trade({ side: 'BUY', quantity: '1', priceUsd: '0.2' }),
        trade({ side: 'BUY', quantity: '1', priceUsd: '0.3' }),
      ],
      { BTC: '0.2' }
    )

    expect(position.costBasis).toBe('0.6')
    expect(position.averageCost).toBe('0.2')
    expect(position.unrealizedPnl).toBe('0')
  })

  it('maintains averageCost × quantity === costBasis after a partial sell', () => {
    // avg = 1000/3 is non-terminating; the invariant must still hold at full precision.
    const { position } = positionOf(
      [
        trade({ side: 'BUY', quantity: '3', priceUsd: '333.333333333333333333' }),
        trade({ side: 'SELL', quantity: '1', priceUsd: '400' }),
      ],
      { BTC: '400' }
    )

    const product = Number(position.averageCost) * Number(position.quantity)
    expect(product).toBeCloseTo(Number(position.costBasis), 10)
  })

  it('handles large quantities of sub-cent assets without losing precision', () => {
    // CKB-shaped: 464558 × 0.0072398 = 3363.3070084 exactly (464558 × 72398 = 33633070084).
    const { position } = positionOf(
      [trade({ side: 'BUY', symbol: 'CKB', quantity: '464558', priceUsd: '0.00723980' })],
      { CKB: '0.00715' },
      'CKB'
    )

    expect(position.costBasis).toBe('3363.3070084')
  })
})
