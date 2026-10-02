import { Decimal, ZERO, fromDecimal, toDecimal } from './money'
import type {
  AssetPosition,
  PortfolioSnapshot,
  PortfolioTotals,
  PriceSnapshot,
  Symbol_,
  Trade,
} from './types'

/**
 * Weighted-average cost-basis portfolio engine.
 *
 * Pure and deterministic: same trades + same prices always yield the same snapshot. It has no
 * knowledge of React, HTTP, or CSV — it takes validated domain objects and returns domain
 * objects, which is what makes the numeric results testable in isolation.
 *
 * Replay model: trades are grouped per symbol and replayed in ascending timestamp order. State
 * per symbol is (quantity, costBasis, averageCost); each trade mutates it per the rules below.
 */

/** Mutable per-asset accumulator used during replay. */
type Lot = {
  quantity: Decimal
  costBasis: Decimal
  averageCost: Decimal
  realizedPnl: Decimal
  buyFees: Decimal
  sellFees: Decimal
  tradeCount: number
}

function emptyLot(): Lot {
  return {
    quantity: ZERO,
    costBasis: ZERO,
    averageCost: ZERO,
    realizedPnl: ZERO,
    buyFees: ZERO,
    sellFees: ZERO,
    tradeCount: 0,
  }
}

export class ShortPositionError extends Error {
  constructor(
    readonly tradeId: string,
    readonly symbol: string,
    readonly requested: string,
    readonly available: string
  ) {
    super(
      `Trade ${tradeId} sells ${requested} ${symbol} but only ${available} is held at that point in the ordered history`
    )
    this.name = 'ShortPositionError'
  }
}

/**
 * Deterministic ordering for replay.
 *
 * Primary key is the UTC timestamp. `trade_id` breaks ties so that two trades on the same
 * instant always replay in the same order — without a tiebreaker, `Array.prototype.sort`
 * stability would leave the result dependent on the input file's row order, and a re-import of
 * reordered-but-identical rows could produce different realized P&L.
 */
export function compareTrades(a: Trade, b: Trade): number {
  const ta = Date.parse(a.timestamp)
  const tb = Date.parse(b.timestamp)
  if (ta !== tb) return ta - tb
  return a.tradeId.localeCompare(b.tradeId)
}

/** Apply one BUY. The fee is capitalized into cost basis, raising average cost. */
function applyBuy(lot: Lot, trade: Trade): void {
  const quantity = toDecimal(trade.quantity)
  const price = toDecimal(trade.priceUsd)
  const fee = toDecimal(trade.feeUsd)

  const grossBuyValue = quantity.times(price)
  const costAdded = grossBuyValue.plus(fee)

  lot.quantity = lot.quantity.plus(quantity)
  lot.costBasis = lot.costBasis.plus(costAdded)
  // Recomputed from the running totals (not incrementally averaged) so the invariant
  // `averageCost × quantity === costBasis` holds at full precision.
  lot.averageCost = lot.quantity.isZero() ? ZERO : lot.costBasis.dividedBy(lot.quantity)
  lot.buyFees = lot.buyFees.plus(fee)
  lot.tradeCount += 1
}

/**
 * Apply one SELL.
 *
 * Cost removed uses the average cost *before* the sale, so the average cost of the remaining
 * position is unchanged — it is deliberately carried over rather than recomputed, both because
 * the spec requires it and because recomputing would re-divide and could introduce a trailing
 * digit of drift.
 *
 * Throws `ShortPositionError` if the sale exceeds the quantity held at this point.
 */
function applySell(lot: Lot, trade: Trade): void {
  const quantity = toDecimal(trade.quantity)
  const price = toDecimal(trade.priceUsd)
  const fee = toDecimal(trade.feeUsd)

  if (quantity.greaterThan(lot.quantity)) {
    throw new ShortPositionError(
      trade.tradeId,
      trade.symbol,
      fromDecimal(quantity),
      fromDecimal(lot.quantity)
    )
  }

  const grossProceeds = quantity.times(price)
  const netProceeds = grossProceeds.minus(fee)
  const isFullClose = quantity.equals(lot.quantity)

  // On a full close, remove the ENTIRE remaining cost basis rather than `averageCost × quantity`.
  // The two are mathematically identical but not numerically: average cost is a division, so for
  // a basis like 301/3 the product `avg × 3` lands on 300.999…9 and leaks a residue into realized
  // P&L (observed as 27.0000000000000000000000000000000000001 instead of 27). Since the spec
  // already requires a closed position to be reset to zero, consuming the exact basis is both
  // the intended semantics and the economically correct result: over a complete buy→close cycle,
  // realized P&L must equal net proceeds minus total cost actually paid.
  const costRemoved = isFullClose ? lot.costBasis : lot.averageCost.times(quantity)

  lot.realizedPnl = lot.realizedPnl.plus(netProceeds.minus(costRemoved))
  lot.quantity = lot.quantity.minus(quantity)
  lot.costBasis = lot.costBasis.minus(costRemoved)
  lot.sellFees = lot.sellFees.plus(fee)
  lot.tradeCount += 1

  if (lot.quantity.isZero()) {
    // Reset so a later BUY starts a fresh position instead of blending with the closed cycle.
    lot.costBasis = ZERO
    lot.averageCost = ZERO
  }
}

/**
 * Replay the full trade history and value it against the price snapshot.
 *
 * @throws ShortPositionError when a SELL exceeds available quantity. Callers surface this as a
 * validation failure; the import is rejected wholesale so the app is never left half-imported.
 */
export function buildPortfolioSnapshot(
  trades: Trade[],
  snapshot: PriceSnapshot
): PortfolioSnapshot {
  const bySymbol = new Map<Symbol_, Lot>()
  const ordered = [...trades].sort(compareTrades)

  for (const trade of ordered) {
    let lot = bySymbol.get(trade.symbol)
    if (!lot) {
      lot = emptyLot()
      bySymbol.set(trade.symbol, lot)
    }
    if (trade.side === 'BUY') applyBuy(lot, trade)
    else applySell(lot, trade)
  }

  // Pass 1: value each position. Allocation needs the portfolio total, so it is filled in pass 2.
  const missingPrices: Symbol_[] = []
  let portfolioValue = ZERO

  type Valued = { position: Omit<AssetPosition, 'allocation'>; currentValue: Decimal | null }
  const valued: Valued[] = []

  for (const [symbol, lot] of bySymbol) {
    const rawPrice = snapshot.prices[symbol]
    const hasPrice = rawPrice !== undefined && rawPrice !== null && rawPrice !== ''
    const price = hasPrice ? toDecimal(rawPrice) : null

    // A missing price only matters while the asset is still held; a fully closed position is
    // worth zero regardless, and its realized P&L remains reportable.
    const isHeld = !lot.quantity.isZero()
    if (!price && isHeld) missingPrices.push(symbol)

    const currentValue = price ? lot.quantity.times(price) : isHeld ? null : ZERO
    const unrealizedPnl = currentValue ? currentValue.minus(lot.costBasis) : null
    const totalPnl = unrealizedPnl ? lot.realizedPnl.plus(unrealizedPnl) : null

    if (currentValue) portfolioValue = portfolioValue.plus(currentValue)

    valued.push({
      currentValue,
      position: {
        symbol,
        quantity: fromDecimal(lot.quantity),
        averageCost: fromDecimal(lot.averageCost),
        costBasis: fromDecimal(lot.costBasis),
        currentPrice: price ? fromDecimal(price) : null,
        currentValue: currentValue ? fromDecimal(currentValue) : null,
        realizedPnl: fromDecimal(lot.realizedPnl),
        unrealizedPnl: unrealizedPnl ? fromDecimal(unrealizedPnl) : null,
        totalPnl: totalPnl ? fromDecimal(totalPnl) : null,
        buyFees: fromDecimal(lot.buyFees),
        sellFees: fromDecimal(lot.sellFees),
        totalFees: fromDecimal(lot.buyFees.plus(lot.sellFees)),
        tradeCount: lot.tradeCount,
      },
    })
  }

  // Pass 2: allocation as a share of portfolio current value.
  const positions: AssetPosition[] = valued.map(({ position, currentValue }) => ({
    ...position,
    allocation:
      currentValue && !portfolioValue.isZero()
        ? fromDecimal(currentValue.dividedBy(portfolioValue))
        : currentValue
          ? fromDecimal(ZERO)
          : null,
  }))

  // Stable, meaningful default order: largest current value first, then by symbol. Closed
  // positions (value 0) sink to the bottom but stay visible for their realized P&L.
  positions.sort((a, b) => {
    const av = a.currentValue ? new Decimal(a.currentValue) : ZERO
    const bv = b.currentValue ? new Decimal(b.currentValue) : ZERO
    if (!av.equals(bv)) return bv.comparedTo(av)
    return a.symbol.localeCompare(b.symbol)
  })

  return {
    asOf: snapshot.asOf,
    positions,
    totals: sumTotals(positions),
    missingPrices,
    tradeCount: ordered.length,
  }
}

/**
 * Portfolio headline figures, summed from the per-asset rows.
 *
 * Deliberately derived from `positions` rather than accumulated in a parallel pass: the
 * assessment requires the dashboard, holdings table, and charts to reconcile, and summing the
 * same rows the table renders makes that true by construction instead of by coincidence.
 */
export function sumTotals(positions: AssetPosition[]): PortfolioTotals {
  let currentValue = ZERO
  let costBasis = ZERO
  let realizedPnl = ZERO
  let unrealizedPnl = ZERO
  let totalFees = ZERO

  for (const p of positions) {
    if (p.currentValue) currentValue = currentValue.plus(p.currentValue)
    costBasis = costBasis.plus(p.costBasis)
    realizedPnl = realizedPnl.plus(p.realizedPnl)
    if (p.unrealizedPnl) unrealizedPnl = unrealizedPnl.plus(p.unrealizedPnl)
    totalFees = totalFees.plus(p.totalFees)
  }

  return {
    currentValue: fromDecimal(currentValue),
    costBasis: fromDecimal(costBasis),
    realizedPnl: fromDecimal(realizedPnl),
    unrealizedPnl: fromDecimal(unrealizedPnl),
    totalPnl: fromDecimal(realizedPnl.plus(unrealizedPnl)),
    totalFees: fromDecimal(totalFees),
  }
}
