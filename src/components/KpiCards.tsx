'use client'

import type { PortfolioTotals } from '@/lib/domain/types'
import { formatReturnPercent, formatUsd } from '@/lib/format'
import { useI18n } from '@/lib/i18n/LocaleProvider'
import { signClass } from './primitives'

/**
 * Headline portfolio figures.
 *
 * Every value is taken from `totals`, which the engine derives by summing the same rows the
 * holdings table renders — so the cards and the table cannot disagree.
 *
 * The portfolio value is the hero. Supporting figures sit in one hairline grid so the eye
 * reads a blotter, not six identical cards.
 */
export function KpiCards({
  totals,
  asOf,
  tradeCount,
  refreshing,
}: {
  totals: PortfolioTotals
  asOf: string
  tradeCount: number
  refreshing: boolean
}) {
  const { t } = useI18n()
  const totalReturn = formatReturnPercent(totals.totalPnl, totals.costBasis)

  const cells = [
    {
      label: t('kpi.basis'),
      value: formatUsd(totals.costBasis),
      hint: t('kpi.basisHint'),
      tone: 'neutral' as const,
    },
    {
      label: t('kpi.realized'),
      value: formatUsd(totals.realizedPnl, { signed: true }),
      hint: t('kpi.realizedHint'),
      tone: 'signed' as const,
      signal: totals.realizedPnl,
    },
    {
      label: t('kpi.unrealized'),
      value: formatUsd(totals.unrealizedPnl, { signed: true }),
      hint: t('kpi.unrealizedHint'),
      tone: 'signed' as const,
      signal: totals.unrealizedPnl,
    },
    {
      label: t('kpi.total'),
      value: formatUsd(totals.totalPnl, { signed: true }),
      hint: t('kpi.vsBasis', { percent: totalReturn }),
      tone: 'signed' as const,
      signal: totals.totalPnl,
    },
    {
      label: t('kpi.fees'),
      value: formatUsd(totals.totalFees),
      hint: t('kpi.feesHint'),
      tone: 'neutral' as const,
    },
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">{t('kpi.value')}</p>
            <p className="display-num mt-1 text-5xl text-foreground sm:text-6xl">
              {formatUsd(totals.currentValue)}
            </p>
            <p className="mt-3 max-w-md text-sm text-muted">{t('kpi.valueHint')}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-sm text-muted">{t('app.valuedAt')}</dt>
              <dd className="mt-1 text-foreground">{asOf}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">{t('kpi.total')}</dt>
              <dd className={`mt-1 tabular ${signClass(totals.totalPnl)}`}>{totalReturn}</dd>
            </div>
            <div className="col-span-2">
              <dt className="sr-only">{t('app.transactions', { count: tradeCount })}</dt>
              <dd className="text-muted">
                {t('app.transactions', { count: tradeCount })}
                {refreshing ? ` · ${t('app.refreshing')}` : ''}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-5">
        {cells.map((item) => (
          <div key={item.label} className="bg-surface px-5 py-4 sm:last:col-span-2 xl:last:col-span-1">
            <dt className="text-sm text-muted">
              {item.label}
            </dt>
            <dd
              className={`display-num mt-2 text-2xl sm:text-[1.65rem] ${
                item.tone === 'signed' ? signClass(item.signal ?? null) : 'text-foreground'
              }`}
            >
              {item.value}
            </dd>
            <p className="mt-2 text-xs leading-relaxed text-muted">{item.hint}</p>
          </div>
        ))}
      </dl>
    </div>
  )
}
