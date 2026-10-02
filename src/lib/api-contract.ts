import type { PortfolioSnapshot, PriceSnapshot, Trade } from '@/lib/domain/types'
import type { ValidationIssue } from '@/lib/csv/validate'

/**
 * Shared HTTP contract between the route handlers and the client.
 *
 * Both sides import these types, so a change to a response shape is a compile error rather than
 * a runtime surprise. Every numeric field inside `PortfolioSnapshot` is a decimal string; see
 * `src/lib/domain/money.ts` for why.
 */

export type PortfolioResponse = {
  source: 'seed' | 'upload'
  snapshot: PortfolioSnapshot
  trades: Trade[]
  /** Valuation snapshot in force. Echoed back on the next import so a trades upload keeps a previously uploaded prices.csv, and vice versa. */
  prices: PriceSnapshot
  /** Present on POST /api/import: which supplied file the upload was. */
  accepted?: 'trades' | 'prices'
}

export type ApiErrorResponse = {
  error: string
  /** Present for 422 validation failures; empty for unexpected server errors. */
  issues: ValidationIssue[]
}

export function isApiError(value: unknown): value is ApiErrorResponse {
  return typeof value === 'object' && value !== null && 'error' in value
}
