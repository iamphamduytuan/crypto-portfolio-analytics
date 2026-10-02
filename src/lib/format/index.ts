import { Decimal } from '@/lib/domain/money'

/**
 * Display formatting — the ONLY place rounding happens.
 *
 * The engine carries 40 significant digits throughout; these helpers round once, at render time,
 * using ROUND_HALF_UP (configured in `money.ts`). Keeping rounding here means the numbers shown in
 * the KPI cards, the holdings table, and the charts are all rounded from the same full-precision
 * source, so they reconcile.
 */

/** USD, 2 decimal places. Signed values use an explicit +/− so the sign never depends on colour. */
export function formatUsd(value: string | null, options: { signed?: boolean } = {}): string {
  if (value === null) return '—'
  const decimal = new Decimal(value)
  const rounded = decimal.toDecimalPlaces(2)
  const sign = options.signed ? (rounded.isNegative() ? '−' : '+') : rounded.isNegative() ? '−' : ''
  const body = rounded.abs().toNumber().toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  // `−0.00` reads as a loss that isn't there; normalise it.
  if (rounded.isZero()) return options.signed ? `$0.00` : '$0.00'
  return `${sign}$${body}`
}

/**
 * Unit price. Sub-dollar assets (CKB at ~$0.007) need more precision than BTC, so the number of
 * decimals adapts to magnitude rather than truncating a small price to `$0.01`.
 */
export function formatPrice(value: string | null): string {
  if (value === null) return '—'
  const decimal = new Decimal(value)
  if (decimal.isZero()) return '$0.00'
  const abs = decimal.abs()
  const places = abs.greaterThanOrEqualTo(100) ? 2 : abs.greaterThanOrEqualTo(1) ? 2 : abs.greaterThanOrEqualTo('0.01') ? 4 : 8
  return `$${decimal.toDecimalPlaces(places).toNumber().toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`
}

/**
 * Asset quantity. Crypto quantities span 10^-8 (BTC) to 10^6 (CKB), so trailing zeros are trimmed
 * and large holdings get thousands separators.
 */
export function formatQuantity(value: string): string {
  const decimal = new Decimal(value)
  if (decimal.isZero()) return '0'
  const abs = decimal.abs()
  const places = abs.greaterThanOrEqualTo(1000) ? 2 : abs.greaterThanOrEqualTo(1) ? 4 : 8
  const fixed = decimal.toDecimalPlaces(places)
  const [whole, fraction = ''] = fixed.toFixed(places).split('.')
  const groupedWhole = Number(whole).toLocaleString('en-US')
  const trimmed = fraction.replace(/0+$/, '')
  return trimmed ? `${groupedWhole}.${trimmed}` : groupedWhole
}

/** Percentage from a [0,1] fraction. */
export function formatPercent(value: string | null, places = 1): string {
  if (value === null) return '—'
  const percent = new Decimal(value).times(100).toDecimalPlaces(places)
  return `${percent.toFixed(places)}%`
}

/** Signed percentage return, e.g. P&L against cost basis. Returns null when basis is zero. */
export function formatReturnPercent(pnl: string | null, basis: string): string {
  if (pnl === null) return '—'
  const base = new Decimal(basis)
  if (base.isZero()) return '—'
  const percent = new Decimal(pnl).dividedBy(base).times(100).toDecimalPlaces(2)
  const sign = percent.isNegative() ? '−' : '+'
  return `${sign}${percent.abs().toFixed(2)}%`
}

/** Sign classification for styling. Callers must pair colour with a text cue (sign or icon). */
export function signOf(value: string | null): 'positive' | 'negative' | 'neutral' {
  if (value === null) return 'neutral'
  const decimal = new Decimal(value)
  if (decimal.isZero()) return 'neutral'
  return decimal.isNegative() ? 'negative' : 'positive'
}

/** Chart tooltips and axes need plain numbers; this is the single lossy boundary, and it is visual only. */
export function toChartNumber(value: string | null): number {
  return value === null ? 0 : new Decimal(value).toDecimalPlaces(2).toNumber()
}

const utcFormatters = new Map<string, Intl.DateTimeFormat>()

function utcFormatter(locale: string): Intl.DateTimeFormat {
  const cached = utcFormatters.get(locale)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
  utcFormatters.set(locale, created)
  return created
}

/** All timestamps render in UTC — the data is UTC and a local-time shift would misstate trade dates. */
export function formatUtc(iso: string, locale = 'en-GB'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${utcFormatter(locale).format(date)} UTC`
}

export function formatUtcDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(0, 10)
}
