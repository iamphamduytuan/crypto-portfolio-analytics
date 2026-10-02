'use client'

import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AssetPosition } from '@/lib/domain/types'
import { formatPercent, formatUsd, toChartNumber } from '@/lib/format'
import { useI18n } from '@/lib/i18n/LocaleProvider'
import { CoinIcon } from './CoinIcon'
import { Card, EmptyState, SectionHeading } from './primitives'

export const ASSET_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  DOGE: 'Dogecoin',
  CKB: 'Nervos Network',
}

const ASSET_COLORS: Record<string, string> = {
  BTC: '#ea580c',
  ETH: '#4f46e5',
  SOL: '#db2777',
  CKB: '#0d9488',
  DOGE: '#f5c518',
}

function colorFor(symbol: string, index: number): string {
  return ASSET_COLORS[symbol] ?? ['#4da3ff', '#a78bfa', '#f472b6', '#facc15', '#34d399'][index % 5]
}

interface AllocationDatum {
  symbol: string
  value: number
  allocation: string | null
  fill: string
}

function CustomAllocationTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: AllocationDatum }>
}) {
  if (!active || !payload || !payload.length) return null
  const item = payload[0].payload
  return (
    <div className="min-w-[170px] rounded-xl border border-neutral-700/80 bg-[#181a20] px-3.5 py-2.5 text-white shadow-2xl">
      <div className="flex items-center gap-2.5">
        <CoinIcon symbol={item.symbol} size={22} />
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-white">{item.symbol}</span>
            <span className="text-[11px] text-neutral-400">{ASSET_NAMES[item.symbol] ?? ''}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs font-extrabold text-white">{formatUsd(String(item.value))}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: `${item.fill}35`, color: item.fill }}
            >
              {formatPercent(item.allocation)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Allocation by current value. Interactive donut with center metric & coin icons. */
export function AllocationChart({ positions }: { positions: AssetPosition[] }) {
  const { t } = useI18n()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)

  const data: AllocationDatum[] = useMemo(
    () =>
      positions
        .filter((p) => p.currentValue !== null && Number(p.currentValue) > 0)
        .map((p, index) => ({
          symbol: p.symbol,
          value: toChartNumber(p.currentValue),
          allocation: p.allocation,
          fill: colorFor(p.symbol, index),
        })),
    [positions]
  )

  const totalValued = useMemo(() => data.reduce((acc, curr) => acc + curr.value, 0), [data])

  const selectedIndex = pinnedIndex ?? activeIndex
  const pinnedDatum = pinnedIndex !== null && data[pinnedIndex] ? data[pinnedIndex] : null

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title={t('charts.allocationTitle')}
          description={t('charts.allocationBody')}
        />
        {pinnedIndex !== null && (
          <button
            type="button"
            onClick={() => setPinnedIndex(null)}
            className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-muted hover:border-accent hover:text-foreground"
          >
            Reset
          </button>
        )}
      </div>

      {data.length === 0 ? (
        <EmptyState title={t('charts.emptyAllocTitle')} description={t('charts.emptyAllocBody')} />
      ) : (
        <>
          <div className="relative mt-2 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="symbol"
                  innerRadius="62%"
                  outerRadius="84%"
                  paddingAngle={3}
                  cornerRadius={6}
                  stroke="var(--surface)"
                  strokeWidth={3}
                  isAnimationActive={true}
                  animationDuration={800}
                  animationEasing="ease-out"
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onClick={(_, index) =>
                    setPinnedIndex((current) => (current === index ? null : index))
                  }
                >
                  {data.map((entry, index) => {
                    const isSelected = selectedIndex === index
                    return (
                      <Cell
                        key={entry.symbol}
                        fill={entry.fill}
                        opacity={selectedIndex === null || isSelected ? 1 : 0.45}
                        style={{
                          cursor: 'pointer',
                          transition: 'opacity 0.25s ease, transform 0.25s ease',
                          transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                          transformOrigin: 'center center',
                        }}
                      />
                    )
                  })}
                </Pie>
                <Tooltip
                  content={<CustomAllocationTooltip />}
                  wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Interactive Donut Center Hole */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              {pinnedDatum ? (
                <div className="flex flex-col items-center justify-center transition-all duration-300 animate-in fade-in zoom-in-95">
                  <CoinIcon symbol={pinnedDatum.symbol} size={32} />
                  <span className="mt-1 text-xs font-bold text-foreground">{pinnedDatum.symbol}</span>
                  <span className="text-base font-extrabold tracking-tight text-foreground">
                    {formatUsd(String(pinnedDatum.value))}
                  </span>
                  <span
                    className="mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ backgroundColor: `${pinnedDatum.fill}20`, color: pinnedDatum.fill }}
                  >
                    {formatPercent(pinnedDatum.allocation)}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center transition-all duration-300">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Total Valued
                  </span>
                  <span className="text-lg font-extrabold tracking-tight text-foreground">
                    {formatUsd(String(totalValued))}
                  </span>
                  <span className="mt-0.5 text-[10px] text-accent font-semibold">{data.length} Assets</span>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Token Holdings List with CoinGecko Official Logos */}
          <div className="mt-4 space-y-1.5">
            {data.map((entry, index) => {
              const isSelected = selectedIndex === index
              return (
                <div
                  key={entry.symbol}
                  onClick={() =>
                    setPinnedIndex((current) => (current === index ? null : index))
                  }
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 transition-all duration-200 border ${
                    isSelected
                      ? 'border-accent bg-accent/10 shadow-xs'
                      : 'border-transparent hover:border-border hover:bg-surface-raised'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <CoinIcon symbol={entry.symbol} size={22} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-foreground">{entry.symbol}</span>
                        <span className="hidden text-[11px] text-muted sm:inline">
                          {ASSET_NAMES[entry.symbol] ?? ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="tabular text-xs font-bold text-foreground">
                      {formatUsd(String(entry.value))}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular"
                      style={{
                        backgroundColor: `${entry.fill}20`,
                        color: entry.fill,
                        border: `1px solid ${entry.fill}35`,
                      }}
                    >
                      {formatPercent(entry.allocation)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Card>
  )
}

type PnlViewMode = 'all' | 'realized' | 'unrealized'

function CustomPnlTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number }>
  label?: string
}) {
  if (!active || !payload || !payload.length || !label) return null
  const realized = payload.find((p) => p.dataKey === 'realized')?.value ?? 0
  const unrealized = payload.find((p) => p.dataKey === 'unrealized')?.value ?? 0
  const total = realized + unrealized

  return (
    <div className="min-w-[190px] rounded-xl border border-neutral-700/80 bg-[#181a20] p-3 text-white shadow-2xl">
      <div className="flex items-center gap-2 border-b border-neutral-700/60 pb-2">
        <CoinIcon symbol={label} size={22} />
        <div>
          <span className="text-xs font-bold text-white">{label}</span>
          <span className="ml-1.5 text-[10px] text-neutral-400">{ASSET_NAMES[label] ?? ''}</span>
        </div>
      </div>
      <div className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">Realized P&amp;L:</span>
          <span className={`font-bold tabular ${realized >= 0 ? 'text-[#27ad75]' : 'text-[#f05d6a]'}`}>
            {formatUsd(String(realized), { signed: true })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-neutral-400">Unrealized P&amp;L:</span>
          <span className={`font-bold tabular ${unrealized >= 0 ? 'text-[#27ad75]' : 'text-[#f05d6a]'}`}>
            {formatUsd(String(unrealized), { signed: true })}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-700/40 pt-1 font-bold">
          <span className="text-neutral-200">Net P&amp;L:</span>
          <span className={`tabular ${total >= 0 ? 'text-[#27ad75]' : 'text-[#f05d6a]'}`}>
            {formatUsd(String(total), { signed: true })}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Realized and unrealized P&L per asset with coin icons, color-coded P&L, and view mode toggle.
 */
export function PnlByAssetChart({ positions }: { positions: AssetPosition[] }) {
  const { t } = useI18n()
  const [viewMode, setViewMode] = useState<PnlViewMode>('all')
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  const data = useMemo(
    () =>
      [...positions]
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .map((p) => ({
          symbol: p.symbol,
          realized: toChartNumber(p.realizedPnl),
          unrealized: toChartNumber(p.unrealizedPnl),
        })),
    [positions]
  )

  const hasAnyValue = data.some((d) => d.realized !== 0 || d.unrealized !== 0)

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeading
          title={t('charts.pnlTitle')}
          description={t('charts.pnlBody')}
        />

        {/* View Mode Filter Pills */}
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-0.5 text-[11px] font-bold shrink-0 self-start">
          <button
            type="button"
            onClick={() => setViewMode('all')}
            className={`rounded-full px-2.5 py-1 transition-all ${
              viewMode === 'all'
                ? 'bg-accent text-white shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setViewMode('realized')}
            className={`rounded-full px-2.5 py-1 transition-all ${
              viewMode === 'realized'
                ? 'bg-accent text-white shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            Realized
          </button>
          <button
            type="button"
            onClick={() => setViewMode('unrealized')}
            className={`rounded-full px-2.5 py-1 transition-all ${
              viewMode === 'unrealized'
                ? 'bg-accent text-white shadow-xs'
                : 'text-muted hover:text-foreground'
            }`}
          >
            Unrealized
          </button>
        </div>
      </div>

      {!hasAnyValue ? (
        <EmptyState title={t('charts.emptyPnlTitle')} description={t('charts.emptyPnlBody')} />
      ) : (
        <>
          <div className="mt-2 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 3" opacity={0.6} />
                <XAxis
                  dataKey="symbol"
                  stroke="var(--muted)"
                  fontSize={12}
                  tickLine={false}
                  fontWeight={600}
                />
                <YAxis
                  stroke="var(--muted)"
                  fontSize={11}
                  tickLine={false}
                  width={64}
                  tickFormatter={(value: number) =>
                    `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US', {
                      maximumFractionDigits: 0,
                    })}`
                  }
                />
                <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
                <Tooltip
                  content={<CustomPnlTooltip />}
                  cursor={{ fill: 'rgba(0,82,255,0.06)' }}
                  wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }}
                />
                <Legend
                  verticalAlign="bottom"
                  formatter={(value) => (
                    <span className="text-xs font-bold text-muted">
                      {value === 'realized' ? t('charts.realized') : t('charts.unrealized')}
                    </span>
                  )}
                />
                {(viewMode === 'all' || viewMode === 'realized') && (
                  <Bar
                    dataKey="realized"
                    fill="#0052ff"
                    radius={[6, 6, 0, 0]}
                    isAnimationActive={true}
                    animationDuration={800}
                  />
                )}
                {(viewMode === 'all' || viewMode === 'unrealized') && (
                  <Bar
                    dataKey="unrealized"
                    fill="#38bdf8"
                    radius={[6, 6, 0, 0]}
                    isAnimationActive={true}
                    animationDuration={800}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Interactive P&L Table with Coin Icons & Color-Coded Values */}
          <div className="mt-4 overflow-hidden rounded-xl border border-border/80 bg-surface">
            <table className="w-full text-xs">
              <caption className="sr-only">{t('charts.pnlCaption')}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-raised/50 text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="px-3.5 py-2 text-left font-bold">
                    {t('charts.asset')}
                  </th>
                  <th scope="col" className="px-3.5 py-2 text-right font-bold">
                    {t('charts.realized')}
                  </th>
                  <th scope="col" className="px-3.5 py-2 text-right font-bold">
                    {t('charts.unrealized')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.map((entry) => {
                  const isSelected = selectedSymbol === entry.symbol
                  return (
                    <tr
                      key={entry.symbol}
                      onClick={() =>
                        setSelectedSymbol((current) => (current === entry.symbol ? null : entry.symbol))
                      }
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent/10 font-bold' : 'hover:bg-surface-raised'
                      }`}
                    >
                      <th scope="row" className="px-3.5 py-2.5 text-left font-medium">
                        <div className="flex items-center gap-2.5">
                          <CoinIcon symbol={entry.symbol} size={22} />
                          <div>
                            <span className="font-bold text-foreground">{entry.symbol}</span>
                            <span className="ml-1.5 hidden text-[11px] text-muted sm:inline">
                              {ASSET_NAMES[entry.symbol] ?? ''}
                            </span>
                          </div>
                        </div>
                      </th>
                      <td
                        className={`tabular px-3.5 py-2.5 text-right font-bold ${
                          entry.realized >= 0 ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {formatUsd(String(entry.realized), { signed: true })}
                      </td>
                      <td
                        className={`tabular px-3.5 py-2.5 text-right font-bold ${
                          entry.unrealized >= 0 ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {formatUsd(String(entry.unrealized), { signed: true })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
