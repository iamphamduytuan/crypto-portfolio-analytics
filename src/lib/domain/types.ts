/**
 * Domain data contracts.
 *
 * Money and quantities cross process boundaries (API responses, CSV) as strings, never as
 * JavaScript numbers. A `number` silently loses precision for values like CKB quantities
 * (hundreds of thousands of units at 8 decimal places) and accumulates drift across 200
 * sequential trades. Strings are exact to transport and are parsed into `Decimal` at the edge
 * of the calculation engine. See `money.ts` for the numeric policy.
 */

export const EXCHANGES = ['Binance', 'Coinbase'] as const
export const SYMBOLS = ['BTC', 'ETH', 'SOL', 'CKB', 'DOGE'] as const
export const SIDES = ['BUY', 'SELL'] as const

export type Exchange = (typeof EXCHANGES)[number]
export type Symbol_ = (typeof SYMBOLS)[number]
export type Side = (typeof SIDES)[number]

/** One validated row of `trades.csv`. Numeric fields stay as exact decimal strings. */
export type Trade = {
  tradeId: string
  /** UTC ISO-8601 instant. */
  timestamp: string
  exchange: Exchange
  symbol: Symbol_
  side: Side
  quantity: string
  priceUsd: string
  feeUsd: string
}

/** One validated row of `prices.csv` — the current-price snapshot. */
export type PriceSnapshotEntry = {
  asOf: string
  symbol: Symbol_
  priceUsd: string
}

export type PriceSnapshot = {
  /** Snapshot instant, surfaced in the UI so users know when the portfolio was valued. */
  asOf: string
  prices: Record<string, string>
}

/**
 * Per-asset result of replaying the trade history.
 *
 * `currentPrice` is `null` when the snapshot has no entry for a held asset — the UI must show
 * that the valuation is incomplete rather than silently treating the position as worth zero.
 */
export type AssetPosition = {
  symbol: Symbol_
  /** Quantity still held. Zero for a fully closed position. */
  quantity: string
  /** Weighted-average cost per unit, including capitalized BUY fees. Zero when flat. */
  averageCost: string
  /** Remaining cost basis of the open position. Zero when flat. */
  costBasis: string
  currentPrice: string | null
  /** `quantity × currentPrice`, or null when the price is missing. */
  currentValue: string | null
  realizedPnl: string
  /** `currentValue − costBasis`, or null when the price is missing. */
  unrealizedPnl: string | null
  /** `realizedPnl + unrealizedPnl`. Falls back to realized-only when the price is missing. */
  totalPnl: string | null
  /** Share of portfolio current value, as a fraction in [0,1]. Null when unvaluable. */
  allocation: string | null
  buyFees: string
  sellFees: string
  totalFees: string
  tradeCount: number
}

export type PortfolioTotals = {
  currentValue: string
  costBasis: string
  realizedPnl: string
  unrealizedPnl: string
  totalPnl: string
  totalFees: string
}

export type PortfolioSnapshot = {
  asOf: string
  positions: AssetPosition[]
  totals: PortfolioTotals
  /** Symbols held with no price in the snapshot — drives a visible warning in the UI. */
  missingPrices: Symbol_[]
  tradeCount: number
}
