import type { PriceSnapshot, Trade } from '@/lib/domain/types'

let counter = 0

/**
 * Build a trade with sensible defaults so each test only states the fields it cares about.
 * Timestamps auto-increment by one hour, which keeps replay order equal to declaration order
 * unless a test sets `timestamp` explicitly.
 */
export function trade(overrides: Partial<Trade> & Pick<Trade, 'side'>): Trade {
  counter += 1
  const base: Trade = {
    tradeId: `T-${String(counter).padStart(4, '0')}`,
    timestamp: new Date(Date.UTC(2025, 0, 1, counter)).toISOString().replace('.000Z', 'Z'),
    exchange: 'Binance',
    symbol: 'BTC',
    side: 'BUY',
    quantity: '1',
    priceUsd: '100',
    feeUsd: '0',
  }
  return { ...base, ...overrides }
}

export function resetTradeCounter(): void {
  counter = 0
}

export function snapshot(
  prices: Record<string, string>,
  asOf = '2025-12-31T23:59:59Z'
): PriceSnapshot {
  return { asOf, prices }
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.join(',')).join('\n')
}

export const TRADE_HEADER = [
  'trade_id',
  'timestamp',
  'exchange',
  'symbol',
  'side',
  'quantity',
  'price_usd',
  'fee_usd',
]
