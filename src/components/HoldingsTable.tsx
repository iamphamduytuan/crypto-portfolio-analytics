'use client'

import { useState } from 'react'
import type { AssetPosition } from '@/lib/domain/types'
import {
  formatPercent,
  formatPrice,
  formatQuantity,
  formatReturnPercent,
  formatUsd,
} from '@/lib/format'
import { useI18n } from '@/lib/i18n/LocaleProvider'
import { CoinIcon } from './CoinIcon'
import { Badge, EmptyState, signClass } from './primitives'

/**
 * One row per asset, with every column the specification requires.
 *
 * Closed positions remain visible when they carry realized P&L, so the realized column always
 * sums to the dashboard figure. A toggle hides fully flat, zero-P&L assets.
 */
export function HoldingsTable({ positions }: { positions: AssetPosition[] }) {
  const { t } = useI18n()
  const [showClosed, setShowClosed] = useState(true)

  const closedCount = positions.filter((p) => Number(p.quantity) === 0).length
  const rows = showClosed
    ? positions
    : positions.filter((p) => Number(p.quantity) !== 0 || Number(p.realizedPnl) !== 0)

  if (positions.length === 0) {
    return (
      <EmptyState
        title={t('holdings.emptyTitle')}
        description={t('holdings.emptyBody')}
      />
    )
  }

  return (
    <div>
      {closedCount > 0 ? (
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(event) => setShowClosed(event.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          {t('holdings.showClosed', { count: closedCount })}
        </label>
      ) : null}

      <ul className="space-y-3 md:hidden">
        {rows.map((position) => {
          const isClosed = Number(position.quantity) === 0
          const allocationWidth =
            position.allocation === null ? 0 : Math.min(100, Number(position.allocation) * 100)
          return (
            <li key={position.symbol} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-base font-medium">
                    <CoinIcon symbol={position.symbol} size={22} />
                    {position.symbol}
                    {isClosed ? <Badge>{t('holdings.closed')}</Badge> : null}
                    {position.currentPrice === null ? <Badge tone="warn">{t('holdings.noPrice')}</Badge> : null}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t('holdings.meta', {
                      count: position.tradeCount,
                      fees: formatUsd(position.totalFees),
                    })}
                  </p>
                </div>
                <p className={`display-num text-right text-2xl ${signClass(position.totalPnl)}`}>
                  {formatUsd(position.totalPnl, { signed: true })}
                </p>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Stat label={t('holdings.value')} value={formatUsd(position.currentValue)} />
                <Stat label={t('holdings.basis')} value={formatUsd(position.costBasis)} />
                <Stat label={t('holdings.quantity')} value={formatQuantity(position.quantity)} />
                <Stat label={t('holdings.price')} value={formatPrice(position.currentPrice)} />
                <Stat
                  label={t('holdings.realized')}
                  value={formatUsd(position.realizedPnl, { signed: true })}
                  className={signClass(position.realizedPnl)}
                />
                <Stat
                  label={t('holdings.unrealized')}
                  value={formatUsd(position.unrealizedPnl, { signed: true })}
                  className={signClass(position.unrealizedPnl)}
                />
              </dl>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[11px] uppercase tracking-[0.12em] text-muted">
                  <span>{t('holdings.allocation')}</span>
                  <span className="tabular normal-case tracking-normal">{formatPercent(position.allocation)}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
                  <div className="h-full bg-accent" style={{ width: `${allocationWidth}%` }} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface md:block">
        <table className="w-full min-w-[1000px] text-sm">
          <caption className="sr-only">
            {t('holdings.caption')}
          </caption>
          <thead className="text-left text-xs font-medium text-muted">
            <tr>
              <th scope="col" className="px-3 py-2.5">
                {t('holdings.asset')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.quantity')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.avgCost')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.price')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.basis')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.value')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.realized')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.unrealized')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.total')}
              </th>
              <th scope="col" className="px-3 py-2.5 text-right">
                {t('holdings.allocation')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((position) => {
              const isClosed = Number(position.quantity) === 0
              return (
                <tr key={position.symbol} className="border-t border-border hover:bg-surface-raised/60">
                  <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                    <span className="flex items-center gap-2">
                      <CoinIcon symbol={position.symbol} />
                      {position.symbol}
                      {isClosed ? <Badge>{t('holdings.closed')}</Badge> : null}
                      {position.currentPrice === null ? <Badge tone="warn">{t('holdings.noPrice')}</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted">
                      {t('holdings.meta', { count: position.tradeCount, fees: formatUsd(position.totalFees) })}
                    </span>
                  </th>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatQuantity(position.quantity)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {isClosed ? '—' : formatPrice(position.averageCost)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatPrice(position.currentPrice)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatUsd(position.costBasis)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatUsd(position.currentValue)}
                  </td>
                  <td
                    className={`tabular px-3 py-2.5 text-right ${signClass(position.realizedPnl)}`}
                  >
                    {formatUsd(position.realizedPnl, { signed: true })}
                  </td>
                  <td
                    className={`tabular px-3 py-2.5 text-right ${signClass(position.unrealizedPnl)}`}
                  >
                    {formatUsd(position.unrealizedPnl, { signed: true })}
                  </td>
                  <td className={`tabular px-3 py-2.5 text-right ${signClass(position.totalPnl)}`}>
                    <span className="block">{formatUsd(position.totalPnl, { signed: true })}</span>
                    <span className="block text-xs text-muted">
                      {isClosed ? '' : formatReturnPercent(position.totalPnl, position.costBasis)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatPercent(position.allocation)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className={`tabular mt-0.5 ${className}`}>{value}</dd>
    </div>
  )
}
