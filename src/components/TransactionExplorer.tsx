'use client'

import SearchIcon from '@mui/icons-material/Search'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState, type ReactNode } from 'react'
import { Decimal } from '@/lib/domain/money'
import { EXCHANGES, SIDES, SYMBOLS } from '@/lib/domain/types'
import type { Trade } from '@/lib/domain/types'
import { formatPrice, formatQuantity, formatUsd, formatUtc } from '@/lib/format'
import { useI18n } from '@/lib/i18n/LocaleProvider'
import { CoinIcon } from './CoinIcon'
import { Card, EmptyState, SectionHeading } from './primitives'

/**
 * Transaction explorer: search, filter by exchange/side/asset, date range, sort, paginate.
 *
 * Filtering runs client-side. With ~200 rows already in memory from the snapshot response, a
 * server round-trip per keystroke would add latency and code for no benefit — the spec explicitly
 * warns against over-engineering. The boundary that matters (money arithmetic and validation) is
 * still server-side; this is presentation only.
 */

const PAGE_SIZES = [25, 50, 100] as const
type SortKey = 'timestamp' | 'grossValue' | 'feeUsd'
type SortDirection = 'asc' | 'desc'

/** Gross trade value, required by the spec alongside the raw columns. */
function grossValue(trade: Trade): Decimal {
  return new Decimal(trade.quantity).times(trade.priceUsd)
}

export function TransactionExplorer({ trades }: { trades: Trade[] }) {
  const { t, intl } = useI18n()
  const searchId = 'tx-search'
  const [query, setQuery] = useState('')
  const [symbol, setSymbol] = useState<string>('all')
  const [exchange, setExchange] = useState<string>('all')
  const [side, setSide] = useState<string>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Date inputs are plain dates; treat the range as inclusive of the whole `to` day in UTC.
    const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : null
    const toMs = to ? Date.parse(`${to}T23:59:59.999Z`) : null

    const rows = trades.filter((trade) => {
      if (symbol !== 'all' && trade.symbol !== symbol) return false
      if (exchange !== 'all' && trade.exchange !== exchange) return false
      if (side !== 'all' && trade.side !== side) return false

      if (fromMs !== null || toMs !== null) {
        const ts = Date.parse(trade.timestamp)
        if (fromMs !== null && ts < fromMs) return false
        if (toMs !== null && ts > toMs) return false
      }

      if (needle) {
        const haystack = `${trade.tradeId} ${trade.symbol} ${trade.exchange} ${trade.side}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })

    const direction = sortDirection === 'asc' ? 1 : -1
    return rows.sort((a, b) => {
      if (sortKey === 'timestamp') {
        const diff = Date.parse(a.timestamp) - Date.parse(b.timestamp)
        // Stable tiebreak so pagination never reshuffles rows between renders.
        return (diff !== 0 ? diff : a.tradeId.localeCompare(b.tradeId)) * direction
      }
      const left = sortKey === 'feeUsd' ? new Decimal(a.feeUsd) : grossValue(a)
      const right = sortKey === 'feeUsd' ? new Decimal(b.feeUsd) : grossValue(b)
      const compared = left.comparedTo(right)
      return (compared !== 0 ? compared : a.tradeId.localeCompare(b.tradeId)) * direction
    })
  }, [trades, query, symbol, exchange, side, from, to, sortKey, sortDirection])

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, trade) => ({
          gross: acc.gross.plus(grossValue(trade)),
          fees: acc.fees.plus(trade.feeUsd),
        }),
        { gross: new Decimal(0), fees: new Decimal(0) }
      ),
    [filtered]
  )

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  // Clamp rather than storing a corrected page in state: filters can shrink the result set below
  // the current page, and resetting inside an effect would cause an extra render.
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection(key === 'timestamp' ? 'desc' : 'desc')
    }
    setPage(1)
  }

  function resetFilters() {
    setQuery('')
    setSymbol('all')
    setExchange('all')
    setSide('all')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const hasFilters =
    query !== '' || symbol !== 'all' || exchange !== 'all' || side !== 'all' || from !== '' || to !== ''

  return (
    <Card>
      <SectionHeading
        title={t('tx.title')}
        description={t('tx.summary', {
          filtered: filtered.length,
          total: trades.length,
          gross: formatUsd(totals.gross.toFixed()),
          fees: formatUsd(totals.fees.toFixed()),
        })}
        action={
          hasFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent"
            >
              {t('tx.clear')}
            </button>
          ) : null
        }
      />

      <div className="mb-4 rounded-xl border border-border bg-background p-3">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(168px,220px)_minmax(0,1fr)_minmax(0,1.15fr)_minmax(96px,0.72fr)_minmax(200px,1.45fr)_minmax(200px,1.45fr)]">
        <Field label={t('tx.search')} className="sm:col-span-2 xl:col-span-1">
          <div className="relative">
            <SearchIcon
              aria-hidden
              sx={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: 'text.secondary', pointerEvents: 'none' }}
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder={t('tx.searchPlaceholder')}
              className="h-10 w-full rounded-full border border-border bg-surface pr-4 pl-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent"
            />
          </div>
        </Field>

        <FilterSelect
          label={t('tx.asset')}
          allLabel={t('tx.all')}
          value={symbol}
          options={SYMBOLS}
          onChange={(value) => {
            setSymbol(value)
            setPage(1)
          }}
        />
        <FilterSelect
          label={t('tx.exchange')}
          allLabel={t('tx.all')}
          value={exchange}
          options={EXCHANGES}
          onChange={(value) => {
            setExchange(value)
            setPage(1)
          }}
        />
        <FilterSelect
          label={t('tx.side')}
          allLabel={t('tx.all')}
          value={side}
          options={SIDES}
          renderOption={(option) => <SideChoice side={option} />}
          onChange={(value) => {
            setSide(value)
            setPage(1)
          }}
        />

        <DateInput
          label={t('tx.from')}
          value={from}
          onChange={(value) => {
            setFrom(value)
            setPage(1)
          }}
        />
        <DateInput
          label={t('tx.to')}
          value={to}
          onChange={(value) => {
            setTo(value)
            setPage(1)
          }}
        />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={t('tx.emptyTitle')}
          description={t('tx.emptyBody')}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-background">
            <table className="w-full min-w-[920px] text-sm">
              <caption className="sr-only">{t('tx.caption')}</caption>
              <thead className="bg-background text-left text-xs font-medium text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2.5">
                    {t('tx.tradeId')}
                  </th>
                  <SortableHeader
                    label={t('tx.timestamp')}
                    active={sortKey === 'timestamp'}
                    direction={sortDirection}
                    onClick={() => toggleSort('timestamp')}
                  />
                  <th scope="col" className="px-3 py-2.5">
                    {t('tx.exchange')}
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    {t('tx.asset')}
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    {t('tx.side')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    {t('tx.quantity')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    {t('tx.price')}
                  </th>
                  <SortableHeader
                    label={t('tx.gross')}
                    align="right"
                    active={sortKey === 'grossValue'}
                    direction={sortDirection}
                    onClick={() => toggleSort('grossValue')}
                  />
                  <SortableHeader
                    label={t('tx.fee')}
                    align="right"
                    active={sortKey === 'feeUsd'}
                    direction={sortDirection}
                    onClick={() => toggleSort('feeUsd')}
                  />
                </tr>
              </thead>
              <tbody>
                {visible.map((trade) => (
                  <tr key={trade.tradeId} className="border-t border-border">
                    <th scope="row" className="tabular px-3 py-2 text-left font-normal text-muted">
                      {trade.tradeId}
                    </th>
                    <td className="tabular px-3 py-2 whitespace-nowrap">
                      {formatUtc(trade.timestamp, intl)}
                    </td>
                    <td className="px-3 py-2">{trade.exchange}</td>
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <CoinIcon symbol={trade.symbol} />
                        {trade.symbol}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <SideMark side={trade.side} />
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {formatQuantity(trade.quantity)}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{formatPrice(trade.priceUsd)}</td>
                    <td className="tabular px-3 py-2 text-right">
                      {formatUsd(grossValue(trade).toFixed())}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-muted">
                      {formatUsd(trade.feeUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav
            aria-label={t('tx.pagination')}
            className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <TextField
              select
              hiddenLabel
              size="small"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
              sx={{ ...controlSx, width: 96 }}
              slotProps={{ htmlInput: { 'aria-label': t('tx.rows') } }}
            >
              {PAGE_SIZES.map((size) => (
                <MenuItem key={size} value={size}>
                  {size}
                </MenuItem>
              ))}
            </TextField>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                className="rounded-full border border-border bg-background px-3 py-1.5 font-medium disabled:opacity-40"
              >
                {t('tx.previous')}
              </button>
              <span aria-live="polite" className="text-muted">
                {t('tx.page', { page: currentPage, pages: pageCount })}
              </span>
              <button
                type="button"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= pageCount}
                className="rounded-full border border-border bg-background px-3 py-1.5 font-medium disabled:opacity-40"
              >
                {t('tx.next')}
              </button>
            </div>
          </nav>
        </>
      )}
    </Card>
  )
}

const controlSx = {
  width: '100%',
  '& .MuiOutlinedInput-root, & .MuiPickersOutlinedInput-root': {
    height: 40,
    borderRadius: 9999,
    backgroundColor: 'var(--surface)',
    fontSize: 14,
  },
  '& .MuiOutlinedInput-notchedOutline, & .MuiPickersOutlinedInput-notchedOutline': {
    borderColor: 'var(--border)',
  },
  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline, & .MuiPickersOutlinedInput-root:hover .MuiPickersOutlinedInput-notchedOutline':
    {
      borderColor: 'var(--accent)',
    },
  '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline, & .MuiPickersOutlinedInput-root.Mui-focused .MuiPickersOutlinedInput-notchedOutline':
    {
      borderWidth: '1px',
      borderColor: 'var(--accent)',
    },
} as const

function Field({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  )
}

/** Compact side label for the filter. A filled chip inside the pill select reads as a button inside a button. */
function SideChoice({ side }: { side: string }) {
  const buy = side === 'BUY'
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-semibold ${buy ? 'text-gain' : 'text-loss'}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${buy ? 'bg-gain' : 'bg-loss'}`} />
      {side}
    </span>
  )
}

/** Exchange-style side chip: green buy, red sell. */
function SideMark({ side }: { side: string }) {
  const buy = side === 'BUY'
  return (
    <span
      className={`inline-flex h-[22px] min-w-[52px] items-center justify-center rounded px-2 text-[11px] font-semibold tracking-wide text-white ${
        buy ? 'bg-gain' : 'bg-loss'
      }`}
    >
      {side}
    </span>
  )
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string
  allLabel: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  renderOption?: (option: string) => ReactNode
}) {
  return (
    <Field label={label}>
      <TextField
        select
        fullWidth
        hiddenLabel
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        sx={controlSx}
        slotProps={{
          select: {
            renderValue: (selected) => {
              const current = String(selected)
              if (current === 'all' || !renderOption) return current === 'all' ? allLabel : current
              return renderOption(current)
            },
          },
        }}
      >
        <MenuItem value="all">{allLabel}</MenuItem>
        {options.map((option) => (
          <MenuItem key={option} value={option}>
            {renderOption ? renderOption(option) : option}
          </MenuItem>
        ))}
      </TextField>
    </Field>
  )
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const parsed: Dayjs | null = value ? dayjs(value) : null
  return (
    <Field label={label}>
    <DatePicker
      value={parsed}
      format="YYYY-MM-DD"
      sx={controlSx}
      onChange={(next) => onChange(next && next.isValid() ? next.format('YYYY-MM-DD') : '')}
      slotProps={{
        textField: { size: 'small', fullWidth: true, hiddenLabel: true },
        popper: {
          sx: {
            '& .MuiPaper-root': { borderRadius: 3 },
          },
        },
      }}
    />
    </Field>
  )
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  direction: SortDirection
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : ''}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}
