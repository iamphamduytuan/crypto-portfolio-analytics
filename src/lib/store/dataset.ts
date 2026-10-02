import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ShortPositionError, buildPortfolioSnapshot } from '@/lib/domain/engine'
import { classifyCsv, parsePricesCsv, parseTradesCsv } from '@/lib/csv/validate'
import { CsvFormatError, parseCsv } from '@/lib/csv/parse'
import type { PortfolioSnapshot, PriceSnapshot, Trade } from '@/lib/domain/types'
import type { ValidationIssue } from '@/lib/csv/validate'

/**
 * Server-side access to the supplied dataset.
 *
 * Server-only module (uses `node:fs`) — it must never be imported from a client component.
 * `next.config.ts` adds `data/*.csv` to the serverless output tracing so the files ship with the
 * deployment.
 */

export type Dataset = {
  /** `seed` = the supplied files; `upload` = a user-imported trades.csv. */
  source: 'seed' | 'upload'
  trades: Trade[]
  prices: PriceSnapshot
  snapshot: PortfolioSnapshot
}

export class DatasetError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[]
  ) {
    super(message)
    this.name = 'DatasetError'
  }
}

const DATA_DIR = join(process.cwd(), 'data')

/**
 * Cached seed dataset.
 *
 * The supplied CSVs are immutable build inputs, so parsing and replaying them once per server
 * instance is safe. Cached as a resolved promise so concurrent requests share one read instead of
 * racing. Note this is per-instance: on a serverless platform each cold start re-parses, which is
 * ~1ms for 200 rows.
 */
let seedCache: Promise<Dataset> | null = null

export function loadSeedDataset(): Promise<Dataset> {
  if (!seedCache) {
    seedCache = readSeed().catch((error) => {
      // Never cache a failure — a transient read error must not poison the instance for its
      // whole lifetime.
      seedCache = null
      throw error
    })
  }
  return seedCache
}

async function readSeed(): Promise<Dataset> {
  const [tradesText, pricesText] = await Promise.all([
    readFile(join(DATA_DIR, 'trades.csv'), 'utf8'),
    readFile(join(DATA_DIR, 'prices.csv'), 'utf8'),
  ])

  const prices = parsePricesCsv(pricesText)
  if (!prices.ok) {
    throw new DatasetError('Bundled prices.csv is invalid.', prices.issues)
  }

  const trades = parseTradesCsv(tradesText)
  if (!trades.ok) {
    throw new DatasetError('Bundled trades.csv is invalid.', trades.issues)
  }

  return {
    source: 'seed',
    trades: trades.data,
    prices: prices.data,
    snapshot: buildPortfolioSnapshot(trades.data, prices.data),
  }
}

function replay(trades: Trade[], prices: PriceSnapshot): PortfolioSnapshot {
  try {
    return buildPortfolioSnapshot(trades, prices)
  } catch (error) {
    if (error instanceof ShortPositionError) {
      throw new DatasetError('The uploaded file was rejected.', [
        { line: null, field: 'quantity', code: 'short_position', message: error.message },
      ])
    }
    throw error
  }
}

/**
 * Accept either supplied file.
 *
 * - `trades.csv` replaces the history and is valued with `context.prices` (or the bundled snapshot).
 * - `prices.csv` replaces the valuation snapshot and is applied to `context.trades` (or the bundled history).
 *
 * The other side is never inferred from the filename. A rejected file throws `DatasetError` and
 * returns nothing, so the caller cannot apply a partial update.
 */
export async function importUploadedCsv(
  text: string,
  context: { trades?: Trade[]; prices?: PriceSnapshot } = {}
): Promise<{ dataset: Dataset; accepted: 'trades' | 'prices' }> {
  const seed = await loadSeedDataset()

  let headers: string[]
  try {
    headers = parseCsv(text).headers
  } catch (error) {
    const message = error instanceof CsvFormatError ? error.message : 'Unable to read the CSV file.'
    throw new DatasetError(message, [{ line: null, field: null, code: 'csv_format', message }])
  }

  const kind = classifyCsv(text)
  if (kind === 'unknown') {
    const message =
      'This file is not a trades.csv or a prices.csv. ' +
      'trades.csv needs trade_id, timestamp, exchange, symbol, side, quantity, price_usd, fee_usd. ' +
      'prices.csv needs as_of, symbol, price_usd.'
    throw new DatasetError(message, [
      {
        line: null,
        field: null,
        code: 'unrecognised_file',
        message: `Found columns: ${headers.join(', ') || '(none)'}. ${message}`,
      },
    ])
  }

  if (kind === 'prices') {
    const prices = parsePricesCsv(text)
    if (!prices.ok) {
      throw new DatasetError(
        'The price snapshot was rejected. The trade history was not changed.',
        prices.issues
      )
    }
    const trades = context.trades ?? seed.trades
    return {
      accepted: 'prices',
      dataset: {
        source: 'upload',
        trades,
        prices: prices.data,
        snapshot: replay(trades, prices.data),
      },
    }
  }

  const trades = parseTradesCsv(text)
  if (!trades.ok) {
    throw new DatasetError(
      'The trade file was rejected. The previous dataset is unchanged.',
      trades.issues
    )
  }
  const prices = context.prices ?? seed.prices
  return {
    accepted: 'trades',
    dataset: {
      source: 'upload',
      trades: trades.data,
      prices,
      snapshot: replay(trades.data, prices),
    },
  }
}
