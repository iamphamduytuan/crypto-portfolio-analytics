import Decimal from 'decimal.js'

/**
 * Numeric policy for the whole application.
 *
 * Why not `number`: IEEE-754 doubles cannot represent decimal fractions like 0.00715 exactly.
 * Replaying 200 trades with `+=` on doubles accumulates representation error into cost basis,
 * which then propagates into average cost, realized P&L, and every downstream total. The error
 * is small per operation but the assessment requires internal consistency between headline
 * figures, the holdings table, and the charts — so it has to be exact, not merely close.
 *
 * Why `decimal.js`: arbitrary-precision decimal arithmetic with an explicit rounding mode, and
 * no native build step (important for serverless deployment).
 *
 * Precision: 40 significant digits internally. The widest real quantity in the dataset is a CKB
 * position (~10^6 units at 8 dp) priced at ~10^-3, so intermediate products need roughly 20
 * significant digits; 40 leaves ample headroom while remaining fast.
 *
 * Rounding: NONE during calculation. Values are rounded ONLY at the display boundary (see
 * `src/lib/format`) using ROUND_HALF_UP, the convention a finance reviewer expects. Division
 * (average cost, allocation) is the only inherently non-terminating operation; it is carried at
 * full 40-digit precision rather than being pre-rounded.
 */
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  // Keep `toString()` in plain notation across the dataset's range so serialized API values are
  // never exponential (`1e-7`), which would be ambiguous to parse on the client.
  toExpNeg: -30,
  toExpPos: 40,
})

export { Decimal }

export const ZERO = new Decimal(0)

/** Parse an exact decimal string from CSV or an API payload. */
export function toDecimal(value: string | number | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value)
}

/** Serialize for transport: plain (non-exponential) decimal string, full precision retained. */
export function fromDecimal(value: Decimal): string {
  return value.toFixed()
}

export function isZero(value: Decimal): boolean {
  return value.isZero()
}
