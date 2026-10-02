import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classifyCsv, parsePricesCsv, parseTradesCsv } from '@/lib/csv/validate'
import { importUploadedCsv } from '@/lib/store/dataset'
import { TRADE_HEADER, toCsv } from './helpers'

/**
 * Import-boundary tests. The contract under test is all-or-nothing: a file either produces a
 * complete valid dataset or a report of issues with no partial application.
 */

const VALID_ROW = [
  'TRD-0001',
  '2025-10-01T09:00:00Z',
  'Binance',
  'BTC',
  'BUY',
  '0.5',
  '100000',
  '3.31',
]

function tradesCsv(...rows: string[][]): string {
  return toCsv([TRADE_HEADER, ...rows])
}

/** Narrowing helper so failure assertions can read `issues` without non-null assertions. */
function expectFailure(result: ReturnType<typeof parseTradesCsv>) {
  if (result.ok) throw new Error('Expected import to fail but it succeeded')
  return result.issues
}

describe('trades.csv — happy path', () => {
  it('parses a valid file and preserves numeric values as exact strings', () => {
    const result = parseTradesCsv(tradesCsv(VALID_ROW))
    if (!result.ok) throw new Error(`Expected success, got: ${JSON.stringify(result.issues)}`)

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toEqual({
      tradeId: 'TRD-0001',
      timestamp: '2025-10-01T09:00:00Z',
      exchange: 'Binance',
      symbol: 'BTC',
      side: 'BUY',
      quantity: '0.5',
      priceUsd: '100000',
      feeUsd: '3.31',
    })
  })

  it('accepts a zero fee', () => {
    const result = parseTradesCsv(tradesCsv([...VALID_ROW.slice(0, 7), '0']))
    expect(result.ok).toBe(true)
  })

  it('tolerates CRLF line endings and a UTF-8 BOM', () => {
    const body = `\uFEFF${TRADE_HEADER.join(',')}\r\n${VALID_ROW.join(',')}\r\n`
    const result = parseTradesCsv(body)
    expect(result.ok).toBe(true)
  })
})

describe('trades.csv — structural validation', () => {
  it('reports every missing required column', () => {
    const header = TRADE_HEADER.filter((c) => c !== 'fee_usd' && c !== 'side')
    const issues = expectFailure(parseTradesCsv(toCsv([header, ['TRD-1', 'x', 'y', 'z', '1', '1']])))

    expect(issues.map((i) => i.field).sort()).toEqual(['fee_usd', 'side'])
    expect(issues.every((i) => i.code === 'missing_column')).toBe(true)
  })

  it('rejects a row with the wrong number of columns', () => {
    const issues = expectFailure(parseTradesCsv(tradesCsv(VALID_ROW.slice(0, 5))))
    expect(issues[0].code).toBe('csv_format')
    expect(issues[0].message).toMatch(/expected 8 columns but found 5/)
  })

  it('rejects an empty file', () => {
    expect(expectFailure(parseTradesCsv(''))[0].code).toBe('csv_format')
  })

  it('rejects a header-only file', () => {
    expect(expectFailure(parseTradesCsv(toCsv([TRADE_HEADER])))[0].code).toBe('empty_file')
  })
})

describe('trades.csv — row validation', () => {
  it('rejects duplicate trade_id and names the first occurrence', () => {
    const issues = expectFailure(
      parseTradesCsv(tradesCsv(VALID_ROW, [...VALID_ROW.slice(0, 1), ...VALID_ROW.slice(1)]))
    )

    expect(issues[0].code).toBe('duplicate_trade_id')
    expect(issues[0].field).toBe('trade_id')
    expect(issues[0].message).toMatch(/TRD-0001/)
    expect(issues[0].message).toMatch(/first seen on line 2/)
    expect(issues[0].line).toBe(3)
  })

  it.each([
    ['not-a-date', 'malformed'],
    ['2025-13-45T99:00:00Z', 'out of range'],
    ['2025-10-01 09:00:00', 'missing timezone'],
  ])('rejects invalid timestamp %s (%s)', (timestamp) => {
    const row = [VALID_ROW[0], timestamp, ...VALID_ROW.slice(2)]
    const issues = expectFailure(parseTradesCsv(tradesCsv(row)))
    expect(issues[0].field).toBe('timestamp')
  })

  it('rejects an unsupported exchange', () => {
    const row = [...VALID_ROW.slice(0, 2), 'Kraken', ...VALID_ROW.slice(3)]
    expect(expectFailure(parseTradesCsv(tradesCsv(row)))[0].field).toBe('exchange')
  })

  it('rejects an unsupported symbol', () => {
    const row = [...VALID_ROW.slice(0, 3), 'XRP', ...VALID_ROW.slice(4)]
    expect(expectFailure(parseTradesCsv(tradesCsv(row)))[0].field).toBe('symbol')
  })

  it('rejects an unsupported side', () => {
    const row = [...VALID_ROW.slice(0, 4), 'SHORT', ...VALID_ROW.slice(5)]
    expect(expectFailure(parseTradesCsv(tradesCsv(row)))[0].field).toBe('side')
  })

  it.each(['0', '-1'])('rejects quantity %s', (quantity) => {
    const row = [...VALID_ROW.slice(0, 5), quantity, ...VALID_ROW.slice(6)]
    const issues = expectFailure(parseTradesCsv(tradesCsv(row)))
    expect(issues[0].field).toBe('quantity')
    expect(issues[0].message).toMatch(/greater than 0/)
  })

  it.each(['0', '-250'])('rejects price %s', (price) => {
    const row = [...VALID_ROW.slice(0, 6), price, VALID_ROW[7]]
    const issues = expectFailure(parseTradesCsv(tradesCsv(row)))
    expect(issues[0].field).toBe('price_usd')
  })

  it('rejects a negative fee', () => {
    const row = [...VALID_ROW.slice(0, 7), '-1']
    const issues = expectFailure(parseTradesCsv(tradesCsv(row)))
    expect(issues[0].field).toBe('fee_usd')
    expect(issues[0].message).toMatch(/0 or greater/)
  })

  it.each(['abc', 'NaN', 'Infinity', ''])('rejects non-numeric quantity %s', (quantity) => {
    const row = [...VALID_ROW.slice(0, 5), quantity, ...VALID_ROW.slice(6)]
    expect(expectFailure(parseTradesCsv(tradesCsv(row)))[0].field).toBe('quantity')
  })

  it('collects issues from multiple bad rows instead of stopping at the first', () => {
    const issues = expectFailure(
      parseTradesCsv(
        tradesCsv(
          ['TRD-1', 'nope', 'Binance', 'BTC', 'BUY', '1', '1', '0'],
          ['TRD-2', '2025-10-01T09:00:00Z', 'Kraken', 'BTC', 'BUY', '1', '1', '0'],
          ['TRD-3', '2025-10-01T09:00:00Z', 'Binance', 'BTC', 'BUY', '-5', '1', '0']
        )
      )
    )

    expect(issues).toHaveLength(3)
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4])
    expect(issues.map((i) => i.field)).toEqual(['timestamp', 'exchange', 'quantity'])
  })
})

describe('trades.csv — replay feasibility', () => {
  it('rejects a SELL that exceeds the quantity held at that point', () => {
    const issues = expectFailure(
      parseTradesCsv(
        tradesCsv(
          ['TRD-1', '2025-10-01T09:00:00Z', 'Binance', 'BTC', 'BUY', '1', '100', '0'],
          ['TRD-2', '2025-10-02T09:00:00Z', 'Binance', 'BTC', 'SELL', '2', '100', '0']
        )
      )
    )

    expect(issues[0].code).toBe('short_position')
    expect(issues[0].message).toMatch(/TRD-2/)
    expect(issues[0].message).toMatch(/only 1/)
  })

  it('rejects a SELL ordered before its BUY even when the row order looks valid', () => {
    const issues = expectFailure(
      parseTradesCsv(
        tradesCsv(
          ['TRD-1', '2025-10-05T09:00:00Z', 'Binance', 'BTC', 'BUY', '1', '100', '0'],
          ['TRD-2', '2025-10-01T09:00:00Z', 'Binance', 'BTC', 'SELL', '1', '100', '0']
        )
      )
    )
    expect(issues[0].code).toBe('short_position')
  })

  it('evaluates holdings per symbol, not across the portfolio', () => {
    // 1 BTC held must not fund a 1 ETH sale.
    const issues = expectFailure(
      parseTradesCsv(
        tradesCsv(
          ['TRD-1', '2025-10-01T09:00:00Z', 'Binance', 'BTC', 'BUY', '1', '100', '0'],
          ['TRD-2', '2025-10-02T09:00:00Z', 'Binance', 'ETH', 'SELL', '1', '100', '0']
        )
      )
    )
    expect(issues[0].code).toBe('short_position')
    expect(issues[0].message).toMatch(/ETH/)
  })

  it('allows a sell-to-zero followed by a re-open', () => {
    const result = parseTradesCsv(
      tradesCsv(
        ['TRD-1', '2025-10-01T09:00:00Z', 'Binance', 'BTC', 'BUY', '1', '100', '0'],
        ['TRD-2', '2025-10-02T09:00:00Z', 'Binance', 'BTC', 'SELL', '1', '120', '0'],
        ['TRD-3', '2025-10-03T09:00:00Z', 'Binance', 'BTC', 'BUY', '2', '130', '0']
      )
    )
    expect(result.ok).toBe(true)
  })

  it('aggregates holdings across exchanges for the same symbol', () => {
    // The spec scopes cost basis per asset, so a Coinbase BUY can fund a Binance SELL.
    const result = parseTradesCsv(
      tradesCsv(
        ['TRD-1', '2025-10-01T09:00:00Z', 'Coinbase', 'BTC', 'BUY', '1', '100', '0'],
        ['TRD-2', '2025-10-02T09:00:00Z', 'Binance', 'BTC', 'SELL', '1', '120', '0']
      )
    )
    expect(result.ok).toBe(true)
  })
})

describe('prices.csv', () => {
  const header = ['as_of', 'symbol', 'price_usd']

  it('parses a snapshot and exposes the as_of instant', () => {
    const result = parsePricesCsv(
      toCsv([
        header,
        ['2026-03-31T23:59:59Z', 'BTC', '111500.00'],
        ['2026-03-31T23:59:59Z', 'CKB', '0.00715000'],
      ])
    )
    if (!result.ok) throw new Error('Expected success')

    expect(result.data.asOf).toBe('2026-03-31T23:59:59Z')
    expect(result.data.prices).toEqual({ BTC: '111500.00', CKB: '0.00715000' })
  })

  it('rejects a duplicate price for one symbol as ambiguous', () => {
    const result = parsePricesCsv(
      toCsv([
        header,
        ['2026-03-31T23:59:59Z', 'BTC', '111500.00'],
        ['2026-03-31T23:59:59Z', 'BTC', '111000.00'],
      ])
    )
    if (result.ok) throw new Error('Expected failure')
    expect(result.issues[0].code).toBe('duplicate_symbol')
  })

  it('rejects a non-positive price', () => {
    const result = parsePricesCsv(toCsv([header, ['2026-03-31T23:59:59Z', 'BTC', '0']]))
    if (result.ok) throw new Error('Expected failure')
    expect(result.issues[0].field).toBe('price_usd')
  })

  it('accepts the supplied prices.csv instead of rejecting it as a trade file', async () => {
    const text = readFileSync('data/prices.csv', 'utf8')
    expect(classifyCsv(text)).toBe('prices')

    const parsed = parsePricesCsv(text)
    if (!parsed.ok) throw new Error(`Expected success, got: ${JSON.stringify(parsed.issues)}`)
    expect(parsed.data.asOf).toBe('2026-03-31T23:59:59Z')
    expect(parsed.data.prices).toEqual({
      BTC: '111500.00',
      ETH: '4025.00',
      SOL: '208.500',
      CKB: '0.00715000',
      DOGE: '0.242000',
    })

    const imported = await importUploadedCsv(text)
    expect(imported.accepted).toBe('prices')
    expect(imported.dataset.trades).toHaveLength(200)
    const btc = imported.dataset.snapshot.positions.find((position) => position.symbol === 'BTC')
    expect(btc?.currentPrice).toBe('111500')
  })

  it('keeps an uploaded price snapshot when a new trade file is imported', async () => {
    const customPrices = toCsv([
      ['as_of', 'symbol', 'price_usd'],
      ['2026-04-01T00:00:00Z', 'BTC', '1'],
      ['2026-04-01T00:00:00Z', 'ETH', '1'],
      ['2026-04-01T00:00:00Z', 'SOL', '1'],
      ['2026-04-01T00:00:00Z', 'CKB', '1'],
      ['2026-04-01T00:00:00Z', 'DOGE', '1'],
    ])
    const priced = await importUploadedCsv(customPrices)
    const trades = toCsv([
      TRADE_HEADER,
      ['TRD-1', '2025-10-01T09:00:00Z', 'Binance', 'BTC', 'BUY', '2', '100', '0'],
    ])
    const imported = await importUploadedCsv(trades, { prices: priced.dataset.prices })
    expect(imported.accepted).toBe('trades')
    expect(imported.dataset.snapshot.asOf).toBe('2026-04-01T00:00:00Z')
    const btc = imported.dataset.snapshot.positions.find((position) => position.symbol === 'BTC')
    expect(btc?.currentPrice).toBe('1')
    expect(btc?.quantity).toBe('2')
  })

  it('uses the latest as_of when rows disagree', () => {
    const result = parsePricesCsv(
      toCsv([
        header,
        ['2026-03-30T00:00:00Z', 'BTC', '110000'],
        ['2026-03-31T23:59:59Z', 'ETH', '4025'],
      ])
    )
    if (!result.ok) throw new Error('Expected success')
    expect(result.data.asOf).toBe('2026-03-31T23:59:59Z')
  })
})
