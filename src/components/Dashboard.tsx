'use client'

import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined'
import CheckIcon from '@mui/icons-material/Check'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useCallback, useState } from 'react'
import type { ApiErrorResponse, PortfolioResponse } from '@/lib/api-contract'
import type { ValidationIssue } from '@/lib/csv/validate'
import { formatPrice, formatUsd, formatUtc } from '@/lib/format'
import { LOCALES, type Locale } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/LocaleProvider'
import { useColorMode } from './AppProviders'
import { useToast } from './ToastProvider'
import { AllocationChart, PnlByAssetChart } from './Charts'
import { FlagIcon } from './FlagIcon'
import { HoldingsTable } from './HoldingsTable'
import { ImportPanel, type ImportReceipt } from './ImportPanel'
import { KpiCards } from './KpiCards'
import { TransactionExplorer } from './TransactionExplorer'
import { Card, ErrorNotice } from './primitives'

/**
 * Client shell. Owns the active dataset and the request lifecycle; all arithmetic happens on the
 * server (see `src/lib/domain`). The initial snapshot is passed in from the server component so
 * the first paint has real data instead of a spinner.
 */

type LoadState = 'ready' | 'loading' | 'failed'

export function Dashboard({
  initialData,
  initialError,
}: {
  initialData: PortfolioResponse | null
  initialError: string | null
}) {
  const { t, intl, locale, setLocale } = useI18n()
  const toast = useToast()
  const [data, setData] = useState<PortfolioResponse | null>(initialData)
  const [loadState, setLoadState] = useState<LoadState>(initialData ? 'ready' : 'failed')
  const [loadError, setLoadError] = useState<string | null>(initialError)

  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([])
  const [tradesFileName, setTradesFileName] = useState<string | null>(null)
  const [pricesFileName, setPricesFileName] = useState<string | null>(null)
  const [importReceipt, setImportReceipt] = useState<ImportReceipt | null>(null)

  /** Fetch the seed dataset. Also serves as "reset to sample data" and as retry after a failure. */
  const loadSeed = useCallback(async () => {
    setLoadState('loading')
    setLoadError(null)
    try {
      const response = await fetch('/api/portfolio', { cache: 'no-store' })
      const payload: unknown = await response.json()

      if (!response.ok) {
        const message = (payload as ApiErrorResponse)?.error ?? 'Could not load the portfolio.'
        setLoadError(message)
        setLoadState('failed')
        return false
      }

      setData(payload as PortfolioResponse)
      setTradesFileName(null)
      setPricesFileName(null)
      setImportReceipt(null)
      setImportError(null)
      setImportIssues([])
      setLoadState('ready')
      return true
    } catch {
      // Network-level failure (offline, aborted). Distinguish from a server-reported error.
      setLoadError('Could not reach the server. Check your connection and try again.')
      setLoadState('failed')
      return false
    }
  }, [])

  const importFile = useCallback(async (file: File) => {
    setIsImporting(true)
    setImportError(null)
    setImportIssues([])

    try {
      const body = new FormData()
      body.append('file', file)
      // Send the dataset on screen so uploading one supplied file does not discard the other.
      if (data) {
        body.append('trades', JSON.stringify(data.trades))
        body.append('prices', JSON.stringify(data.prices))
      }
      const response = await fetch('/api/import', { method: 'POST', body })
      const payload: unknown = await response.json()

      if (!response.ok) {
        const error = payload as ApiErrorResponse
        setImportError(error?.error ?? 'The file could not be imported.')
        setImportIssues(error?.issues ?? [])
        toast(error?.error ?? t('toast.failed'), 'error')
        // Deliberately leave `data` untouched: a rejected import must not clear the dashboard.
        return
      }

      const next = payload as PortfolioResponse
      setData(next)
      const accepted = next.accepted === 'prices' ? 'prices' : 'trades'
      if (accepted === 'prices') setPricesFileName(file.name)
      else setTradesFileName(file.name)
      setImportReceipt(buildReceipt(file.name, accepted, next, intl))
      setLoadState('ready')
      setLoadError(null)
      toast(t('import.loaded', { file: file.name }), 'success')
    } catch {
      setImportError('Could not upload the file. Check your connection and try again.')
      toast(t('toast.offline'), 'error')
    } finally {
      setIsImporting(false)
    }
  }, [data, intl, t, toast])

  // No data to render: either the server could not build the snapshot, or a manual retry failed.
  // There is no first-load spinner by design — the server component computes the snapshot before
  // the page is sent, so the first paint already has real figures.
  if (!data) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header
          locale={locale}
          onLocale={setLocale}
          title={t('app.title')}
          subtitle={t('app.subtitle')}
          languageLabel={t('app.language')}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          <ErrorNotice title={t('app.unavailable')} onRetry={() => void loadSeed()}>
            <p>{loadError ?? t('app.unavailableBody')}</p>
          </ErrorNotice>
        </main>
        <Footer />
      </div>
    )
  }

  const { snapshot, trades, source } = data
  const hasTrades = trades.length > 0

  return (
    <div className="flex min-h-screen flex-col">
      <Header locale={locale} onLocale={setLocale} title={t('app.title')} subtitle={t('app.subtitle')} languageLabel={t('app.language')} />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6">
        <div className="rise space-y-8 py-6 sm:py-8">
      <section aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="sr-only">
          Portfolio overview
        </h2>
        <KpiCards
          totals={snapshot.totals}
          asOf={formatUtc(snapshot.asOf, intl)}
          tradeCount={snapshot.tradeCount}
          refreshing={loadState === 'loading'}
        />
      </section>

      <ImportPanel
        source={source}
        isBusy={isImporting}
        issues={importIssues}
        errorMessage={importError}
        tradesFileName={tradesFileName}
        pricesFileName={pricesFileName}
        receipt={importReceipt}
        onImport={(file) => void importFile(file)}
        onReset={() => {
          void loadSeed().then((ok) => {
            if (ok) toast(t('toast.reset'), 'success')
            else toast(t('toast.offline'), 'error')
          })
        }}
        onDismissIssues={() => {
          setImportError(null)
          setImportIssues([])
        }}
      />

      {snapshot.missingPrices.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-sm"
        >
          <p className="font-semibold text-loss">{t('app.missingTitle')}</p>
          <p className="mt-1 text-muted">
            {t('app.missingBody', { symbols: snapshot.missingPrices.join(', ') })}
          </p>
        </div>
      ) : null}

      {!hasTrades ? (
        <Card>
          <p className="font-medium">{t('app.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted">{t('app.emptyBody')}</p>
        </Card>
      ) : (
        <>
          <section aria-labelledby="holdings-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="holdings-heading" className="text-xl font-semibold tracking-tight">
                {t('app.holdings')}
              </h2>
              <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted">
                <CalculateOutlinedIcon sx={{ fontSize: 15, color: 'var(--accent)' }} />
                {t('app.method')}
              </p>
            </div>
            <HoldingsTable positions={snapshot.positions} />
          </section>

          <section aria-labelledby="charts-heading" className="grid gap-4 lg:grid-cols-2">
            <h2 id="charts-heading" className="sr-only">
              Charts
            </h2>
            <AllocationChart positions={snapshot.positions} />
            <PnlByAssetChart positions={snapshot.positions} />
          </section>

          <section aria-labelledby="transactions-heading">
            <h2 id="transactions-heading" className="sr-only">
              Transactions
            </h2>
            <TransactionExplorer trades={trades} />
          </section>
        </>
      )}
        </div>
      </main>

      <Footer />
    </div>
  )
}

function buildReceipt(
  fileName: string,
  accepted: 'trades' | 'prices',
  data: PortfolioResponse,
  locale: string
): ImportReceipt {
  return {
    fileName,
    accepted,
    tradeCount: data.trades.length,
    buyCount: data.trades.filter((trade) => trade.side === 'BUY').length,
    sellCount: data.trades.filter((trade) => trade.side === 'SELL').length,
    priceCount: Object.keys(data.prices.prices).length,
    asOf: formatUtc(data.prices.asOf, locale),
    portfolioValue: formatUsd(data.snapshot.totals.currentValue),
    prices: Object.entries(data.prices.prices)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([symbol, price]) => ({ symbol, price: formatPrice(price) })),
  }
}

function Header({
  locale,
  onLocale,
  title,
  subtitle,
  languageLabel,
}: {
  locale: string
  onLocale: (code: Locale) => void
  title: string
  subtitle: string
  languageLabel: string
}) {
  const { t } = useI18n()
  const { mode, toggle } = useColorMode()
  const [languageAnchor, setLanguageAnchor] = useState<HTMLElement | null>(null)
  const currentLocale = LOCALES.find((item) => item.code === locale)

  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/85 backdrop-blur-xl transition-colors">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-8.5 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-sm shadow-accent/25 sm:size-9.5">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm sm:text-base font-bold tracking-tight text-foreground">{title}</h1>
            <p className="hidden md:block truncate text-xs text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            aria-label={languageLabel}
            aria-haspopup="menu"
            aria-expanded={languageAnchor !== null}
            onClick={(event) => setLanguageAnchor(event.currentTarget)}
            className="inline-flex h-8 sm:h-8.5 items-center gap-1.5 sm:gap-2 rounded-full border border-border bg-surface px-2.5 sm:px-3 text-foreground transition-all duration-200 hover:border-accent hover:bg-surface-raised active:scale-[0.98] shadow-xs"
          >
            <FlagIcon locale={locale} size={16} />
            <span className="text-[11px] font-bold uppercase tracking-wider">{currentLocale?.code ?? locale}</span>
            <span className="hidden sm:inline text-[11px] font-bold text-foreground/90">· {currentLocale?.label}</span>
            <KeyboardArrowDownIcon
              sx={{
                fontSize: 15,
                color: 'text.secondary',
                transition: 'transform 0.2s ease',
                transform: languageAnchor !== null ? 'rotate(180deg)' : 'none',
                ml: -0.25,
              }}
            />
          </button>

          <Menu
            anchorEl={languageAnchor}
            open={languageAnchor !== null}
            onClose={() => setLanguageAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{
              paper: {
                sx: {
                  mt: 1,
                  borderRadius: '16px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--surface)',
                  minWidth: 210,
                  boxShadow: '0 16px 36px -4px rgba(0, 0, 0, 0.22)',
                  p: 0.75,
                },
              },
            }}
          >
            {LOCALES.map((item) => {
              const isSelected = item.code === locale
              return (
                <MenuItem
                  key={item.code}
                  selected={isSelected}
                  onClick={() => {
                    onLocale(item.code)
                    setLanguageAnchor(null)
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    py: 1.25,
                    px: 1.5,
                    borderRadius: '12px',
                    mx: 0.25,
                    my: 0.25,
                    fontSize: 12,
                    fontWeight: 700,
                    transition: 'all 0.15s ease',
                    '&.Mui-selected': {
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      '&:hover': { backgroundColor: 'var(--accent-soft)' },
                    },
                    '&:hover': {
                      backgroundColor: 'var(--surface-raised)',
                    },
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <FlagIcon locale={item.code} size={20} />
                    <span className="text-xs font-bold">{item.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                      {item.code}
                    </span>
                    {isSelected ? <CheckIcon sx={{ fontSize: 16, color: 'var(--accent)' }} /> : null}
                  </div>
                </MenuItem>
              )
            })}
          </Menu>

          <button
            type="button"
            onClick={toggle}
            aria-label={mode === 'dark' ? t('app.light') : t('app.dark')}
            title={mode === 'dark' ? t('app.light') : t('app.dark')}
            className="inline-flex size-8.5 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-all duration-200 hover:border-accent hover:bg-surface-raised active:scale-[0.96] shadow-xs"
          >
            {mode === 'dark' ? (
              <LightModeOutlinedIcon sx={{ fontSize: 17 }} />
            ) : (
              <DarkModeOutlinedIcon sx={{ fontSize: 17 }} />
            )}
          </button>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  const { t } = useI18n()
  return (
    <footer className="mt-14 w-full border-t border-border bg-background transition-colors">
      <div className="mx-auto w-full max-w-7xl px-4 pt-10 pb-12 space-y-8 text-xs text-muted sm:px-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {/* Col 1: Overview & Blockchain context */}
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-white shadow-xs">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <span className="text-sm font-bold text-foreground">Crypto Portfolio Analytics</span>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Digital asset valuation and blockchain transaction ledger accounting. Deterministic cost basis calculations across spot trades and multichain cryptocurrency holdings.
          </p>
          <p className="text-[11px] leading-relaxed text-muted/80">
            Monitored assets: Bitcoin (BTC), Ethereum (ETH), Solana (SOL), Dogecoin (DOGE), and Nervos Network (CKB).
          </p>
        </div>

        {/* Col 2: Accounting specifications without bullets/dots */}
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Blockchain Accounting</p>
          <div className="space-y-2.5 text-xs text-muted">
            <div>
              <span className="font-bold text-foreground">Weighted-Average Basis:</span>{' '}
              <span>BUY transaction fees capitalized into holding cost basis</span>
            </div>
            <div>
              <span className="font-bold text-foreground">Realized P&amp;L:</span>{' '}
              <span>Net settlement proceeds after SELL transaction fee deduction</span>
            </div>
            <div>
              <span className="font-bold text-foreground">Lot Reconciliation:</span>{' '}
              <span>Full position closure resets cost basis with zero residual balance</span>
            </div>
            <div>
              <span className="font-bold text-foreground">Mathematical Determinism:</span>{' '}
              <span>40-digit decimal arithmetic eliminates floating-point drift</span>
            </div>
          </div>
        </div>

        {/* Col 3: Ledger Data & Verification (no github, no vercel, no dots) */}
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Ledger Data &amp; Source</p>
          <div className="space-y-2.5 text-xs">
            <div>
              <span className="text-muted">Settlement Standard: </span>
              <span className="font-bold text-foreground">Multi-Exchange Replay Protocol</span>
            </div>
            <div>
              <span className="text-muted">Market Snapshot: </span>
              <span className="tabular font-bold text-foreground">2026-03-31T23:59:59Z UTC</span>
            </div>
            <div>
              <span className="text-muted">Base Currency: </span>
              <span className="font-bold text-foreground">USD (Fiat / Stablecoin)</span>
            </div>
            <div>
              <span className="text-muted">Order Execution: </span>
              <span className="font-bold text-foreground">Binance &amp; Coinbase Spot Trades</span>
            </div>
          </div>
        </div>
      </div>

      {/* Blockchain Ledger Accounting Protocol Box */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs transition-colors">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-accent text-white shadow-2xs">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                Blockchain Ledger Accounting Standard
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted max-w-4xl">
              {t('app.footer')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0 pt-1 sm:pt-0">
            <span className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground">
              Deterministic WAC
            </span>
            <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-accent">
              40-Digit Decimal
            </span>
          </div>
        </div>
      </div>

      {/* Copyright line without dots */}
      <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between text-[11px] text-muted border-t border-border">
        <p>© 2026 Crypto Portfolio Analytics. Blockchain Asset Valuation Engine.</p>
        <p className="font-medium text-foreground">Deterministic Accounting Ledger</p>
      </div>
    </div>
  </footer>
  )
}
