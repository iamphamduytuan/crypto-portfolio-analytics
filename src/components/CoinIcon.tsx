/**
 * Coin marks saved from CoinGecko's public coin images.
 * Unknown symbols fall back to an initial.
 */

const KNOWN = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'CKB'])

export function CoinIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  if (!KNOWN.has(symbol)) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-raised text-[10px] font-semibold text-muted"
        style={{ width: size, height: size }}
      >
        {symbol.slice(0, 1)}
      </span>
    )
  }

  return (
    <img
      src={`/coins/${symbol.toLowerCase()}.png`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full border border-border bg-white object-cover"
    />
  )
}
