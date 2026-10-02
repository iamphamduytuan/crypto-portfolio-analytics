import { z } from 'zod'
import { Decimal } from '@/lib/domain/money'
import { EXCHANGES, SIDES, SYMBOLS } from '@/lib/domain/types'
import type { PriceSnapshot, PriceSnapshotEntry, Trade } from '@/lib/domain/types'
import { ShortPositionError, compareTrades } from '@/lib/domain/engine'
import { CsvFormatError, parseCsv } from './parse'

/**
 * Import boundary: raw CSV text in, validated domain objects out.
 *
 * Design rule — the import is all-or-nothing. Every row is checked and ALL issues are collected
 * before anything is returned, so the caller either gets a complete valid dataset or a complete
 * error report. Nothing is ever partially applied, which is what the spec means by "an invalid
 * file must not leave the application in a partially imported state".
 *
 * Errors are reported with the source line number and the offending value so they are actionable
 * rather than merely "invalid file".
 */

export type ValidationIssue = {
  /** 1-based line in the uploaded file. `null` for file-level issues (e.g. missing columns). */
  line: number | null
  /** Column name, or null for row/file-level issues. */
  field: string | null
  code: string
  message: string
}

export type ImportSuccess<T> = { ok: true; data: T }
export type ImportFailure = { ok: false; issues: ValidationIssue[] }
export type ImportResult<T> = ImportSuccess<T> | ImportFailure

export const TRADE_COLUMNS = [
  'trade_id',
  'timestamp',
  'exchange',
  'symbol',
  'side',
  'quantity',
  'price_usd',
  'fee_usd',
] as const

export const PRICE_COLUMNS = ['as_of', 'symbol', 'price_usd'] as const

/**
 * The demo accepts either supplied file. Header sniffing is what decides — the filename is not —
 * so dropping `prices.csv` into the trade importer is a price update, not a rejected trade file.
 */
export function classifyCsv(text: string): 'trades' | 'prices' | 'unknown' {
  let parsed
  try {
    parsed = parseCsv(text)
  } catch {
    return 'unknown'
  }
  const headers = new Set(parsed.headers)
  if (TRADE_COLUMNS.every((column) => headers.has(column))) return 'trades'
  if (PRICE_COLUMNS.every((column) => headers.has(column))) return 'prices'
  return 'unknown'
}

/**
 * Decimal-string validator.
 *
 * Rejects `NaN`/`Infinity`/empty and anything `Decimal` cannot parse, then applies a sign
 * constraint. Values are kept as strings (never coerced to `number`) so precision survives the
 * import — see `money.ts`.
 */
function decimalString(opts: { positive?: boolean; nonNegative?: boolean }) {
  return z.string().superRefine((raw, ctx) => {
    if (raw.trim() === '') {
      ctx.addIssue({ code: 'custom', message: 'value is required' })
      return
    }
    let parsed: Decimal
    try {
      parsed = new Decimal(raw)
    } catch {
      ctx.addIssue({ code: 'custom', message: `"${raw}" is not a valid number` })
      return
    }
    if (!parsed.isFinite()) {
      ctx.addIssue({ code: 'custom', message: `"${raw}" is not a finite number` })
      return
    }
    if (opts.positive && parsed.lessThanOrEqualTo(0)) {
      ctx.addIssue({ code: 'custom', message: `must be greater than 0 (received ${raw})` })
    }
    if (opts.nonNegative && parsed.lessThan(0)) {
      ctx.addIssue({ code: 'custom', message: `must be 0 or greater (received ${raw})` })
    }
  })
}

/** Strict UTC ISO-8601 instant. `Date.parse` alone accepts loose formats, so shape is checked first. */
const isoTimestamp = z.string().superRefine((raw, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    ctx.addIssue({ code: 'custom', message: `"${raw}" is not a valid ISO-8601 UTC timestamp` })
    return
  }
  if (Number.isNaN(Date.parse(raw))) {
    ctx.addIssue({ code: 'custom', message: `"${raw}" is not a real date` })
  }
})

const tradeRowSchema = z.object({
  trade_id: z.string().min(1, 'trade_id is required'),
  timestamp: isoTimestamp,
  exchange: z.enum(EXCHANGES),
  symbol: z.enum(SYMBOLS),
  side: z.enum(SIDES),
  quantity: decimalString({ positive: true }),
  price_usd: decimalString({ positive: true }),
  fee_usd: decimalString({ nonNegative: true }),
})

const priceRowSchema = z.object({
  as_of: isoTimestamp,
  symbol: z.enum(SYMBOLS),
  price_usd: decimalString({ positive: true }),
})

function missingColumnIssues(headers: string[], required: readonly string[]): ValidationIssue[] {
  const present = new Set(headers)
  return required
    .filter((column) => !present.has(column))
    .map((column) => ({
      line: null,
      field: column,
      code: 'missing_column',
      message: `Required column "${column}" is missing.`,
    }))
}

/**
 * Validate and parse `trades.csv`.
 *
 * Checks, in order: CSV shape → required columns → per-row types/enums/signs → duplicate
 * trade_id → replay feasibility (no SELL exceeding holdings). The replay check runs last because
 * it is only meaningful once every row is individually well-formed.
 */
export function parseTradesCsv(text: string): ImportResult<Trade[]> {
  let parsed
  try {
    parsed = parseCsv(text)
  } catch (error) {
    const message = error instanceof CsvFormatError ? error.message : 'Unable to read the CSV file.'
    return { ok: false, issues: [{ line: null, field: null, code: 'csv_format', message }] }
  }

  const issues = missingColumnIssues(parsed.headers, TRADE_COLUMNS)
  if (issues.length) return { ok: false, issues }

  if (parsed.rows.length === 0) {
    return {
      ok: false,
      issues: [
        { line: null, field: null, code: 'empty_file', message: 'File contains no trade rows.' },
      ],
    }
  }

  const trades: Trade[] = []
  const seenIds = new Map<string, number>()

  parsed.rows.forEach((row, index) => {
    const line = parsed.lineNumbers[index]
    const result = tradeRowSchema.safeParse(row)

    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path.join('.') || null
        issues.push({
          line,
          field,
          code: 'invalid_value',
          // Zod's default enum message lists allowed values, which is exactly the actionable
          // detail an importer needs; prefix with the column for scanability.
          message: field ? `${field}: ${issue.message}` : issue.message,
        })
      }
      return
    }

    const value = result.data
    const firstSeen = seenIds.get(value.trade_id)
    if (firstSeen !== undefined) {
      issues.push({
        line,
        field: 'trade_id',
        code: 'duplicate_trade_id',
        message: `Duplicate trade_id "${value.trade_id}" (first seen on line ${firstSeen}).`,
      })
      return
    }
    seenIds.set(value.trade_id, line)

    trades.push({
      tradeId: value.trade_id,
      timestamp: value.timestamp,
      exchange: value.exchange,
      symbol: value.symbol,
      side: value.side,
      quantity: value.quantity,
      priceUsd: value.price_usd,
      feeUsd: value.fee_usd,
    })
  })

  if (issues.length) return { ok: false, issues }

  const shortIssue = findShortPosition(trades)
  if (shortIssue) return { ok: false, issues: [shortIssue] }

  return { ok: true, data: trades }
}

/**
 * Dry-run the replay to catch a SELL that would open a short position.
 *
 * Reuses the engine's own ordering and quantity arithmetic rather than reimplementing them, so
 * the validator can never disagree with the calculation it is guarding.
 */
function findShortPosition(trades: Trade[]): ValidationIssue | null {
  const heldBySymbol = new Map<string, Decimal>()
  const lineByTradeId = new Map<string, number>()
  trades.forEach((trade, index) => lineByTradeId.set(trade.tradeId, index))

  for (const trade of [...trades].sort(compareTrades)) {
    const held = heldBySymbol.get(trade.symbol) ?? new Decimal(0)
    const quantity = new Decimal(trade.quantity)

    if (trade.side === 'BUY') {
      heldBySymbol.set(trade.symbol, held.plus(quantity))
      continue
    }

    if (quantity.greaterThan(held)) {
      const error = new ShortPositionError(
        trade.tradeId,
        trade.symbol,
        quantity.toFixed(),
        held.toFixed()
      )
      return {
        line: null,
        field: 'quantity',
        code: 'short_position',
        message: error.message,
      }
    }
    heldBySymbol.set(trade.symbol, held.minus(quantity))
  }

  return null
}

/**
 * Validate and parse `prices.csv` into a snapshot.
 *
 * One `as_of` is expected for the whole file; if rows disagree the latest instant wins and is the
 * value surfaced in the UI. A duplicate symbol is an error rather than a silent last-write-wins,
 * because two prices for one asset make the valuation ambiguous.
 */
export function parsePricesCsv(text: string): ImportResult<PriceSnapshot> {
  let parsed
  try {
    parsed = parseCsv(text)
  } catch (error) {
    const message = error instanceof CsvFormatError ? error.message : 'Unable to read the CSV file.'
    return { ok: false, issues: [{ line: null, field: null, code: 'csv_format', message }] }
  }

  const issues = missingColumnIssues(parsed.headers, PRICE_COLUMNS)
  if (issues.length) return { ok: false, issues }

  const entries: PriceSnapshotEntry[] = []
  const seenSymbols = new Map<string, number>()

  parsed.rows.forEach((row, index) => {
    const line = parsed.lineNumbers[index]
    const result = priceRowSchema.safeParse(row)

    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path.join('.') || null
        issues.push({
          line,
          field,
          code: 'invalid_value',
          message: field ? `${field}: ${issue.message}` : issue.message,
        })
      }
      return
    }

    const value = result.data
    const firstSeen = seenSymbols.get(value.symbol)
    if (firstSeen !== undefined) {
      issues.push({
        line,
        field: 'symbol',
        code: 'duplicate_symbol',
        message: `Duplicate price for "${value.symbol}" (first seen on line ${firstSeen}).`,
      })
      return
    }
    seenSymbols.set(value.symbol, line)

    entries.push({ asOf: value.as_of, symbol: value.symbol, priceUsd: value.price_usd })
  })

  if (issues.length) return { ok: false, issues }
  if (entries.length === 0) {
    return {
      ok: false,
      issues: [
        { line: null, field: null, code: 'empty_file', message: 'File contains no price rows.' },
      ],
    }
  }

  const asOf = entries.reduce(
    (latest, entry) => (Date.parse(entry.asOf) > Date.parse(latest) ? entry.asOf : latest),
    entries[0].asOf
  )

  const prices: Record<string, string> = {}
  for (const entry of entries) prices[entry.symbol] = entry.priceUsd

  return { ok: true, data: { asOf, prices } }
}

const tradeRecordSchema = z.object({
  tradeId: z.string().min(1),
  timestamp: isoTimestamp,
  exchange: z.enum(EXCHANGES),
  symbol: z.enum(SYMBOLS),
  side: z.enum(SIDES),
  quantity: decimalString({ positive: true }),
  priceUsd: decimalString({ positive: true }),
  feeUsd: decimalString({ nonNegative: true }),
})

/** Trades the client already holds, sent back so a prices.csv upload revalues that history. */
export function parseTradeList(value: unknown): ImportResult<Trade[]> {
  const parsed = z.array(tradeRecordSchema).safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.slice(0, 20).map((issue) => ({
        line: null,
        field: issue.path.join('.') || null,
        code: 'invalid_context',
        message: `Current trade history could not be read (${issue.path.join('.') || 'trades'}): ${issue.message}`,
      })),
    }
  }
  return { ok: true, data: parsed.data }
}

/** Price snapshot the client already holds, sent back so a trades.csv upload keeps that valuation. */
export function parsePriceSnapshotValue(value: unknown): ImportResult<PriceSnapshot> {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      issues: [
        {
          line: null,
          field: null,
          code: 'invalid_context',
          message: 'Current price snapshot could not be read.',
        },
      ],
    }
  }
  const record = value as { asOf?: unknown; prices?: unknown }
  const asOf = isoTimestamp.safeParse(record.asOf)
  if (!asOf.success) {
    return {
      ok: false,
      issues: [
        {
          line: null,
          field: 'as_of',
          code: 'invalid_context',
          message: 'Current price snapshot has an invalid as_of timestamp.',
        },
      ],
    }
  }
  if (!record.prices || typeof record.prices !== 'object') {
    return {
      ok: false,
      issues: [
        {
          line: null,
          field: 'price_usd',
          code: 'invalid_context',
          message: 'Current price snapshot has no prices.',
        },
      ],
    }
  }

  const prices: Record<string, string> = {}
  const issues: ValidationIssue[] = []
  for (const [symbol, raw] of Object.entries(record.prices as Record<string, unknown>)) {
    if (!SYMBOLS.includes(symbol as (typeof SYMBOLS)[number])) {
      issues.push({
        line: null,
        field: 'symbol',
        code: 'invalid_context',
        message: `Current price snapshot has unsupported symbol "${symbol}".`,
      })
      continue
    }
    const price = decimalString({ positive: true }).safeParse(raw)
    if (!price.success) {
      issues.push({
        line: null,
        field: 'price_usd',
        code: 'invalid_context',
        message: `Current price for ${symbol} is not a positive number.`,
      })
      continue
    }
    prices[symbol] = String(raw)
  }
  if (issues.length) return { ok: false, issues }
  return { ok: true, data: { asOf: asOf.data, prices } }
}
