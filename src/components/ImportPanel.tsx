'use client'

import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import { useRef, useState } from 'react'
import type { ValidationIssue } from '@/lib/csv/validate'
import { useI18n } from '@/lib/i18n/LocaleProvider'
import { CoinIcon } from './CoinIcon'
import { Spinner } from './primitives'

export type ImportReceipt = {
  fileName: string
  accepted: 'trades' | 'prices'
  tradeCount: number
  buyCount: number
  sellCount: number
  priceCount: number
  asOf: string
  portfolioValue: string
  prices: { symbol: string; price: string }[]
}

/**
 * Import / re-import / reset controls.
 *
 * The parent owns the dataset; this component only reports intent and renders the outcome. A
 * rejected import leaves the previously loaded dataset untouched — the caller swaps state only on
 * success — which is how the "never partially imported" requirement is met end to end.
 */
export function ImportPanel({
  source,
  isBusy,
  issues,
  errorMessage,
  tradesFileName,
  pricesFileName,
  receipt,
  onImport,
  onReset,
  onDismissIssues,
}: {
  source: 'seed' | 'upload'
  isBusy: boolean
  issues: ValidationIssue[]
  errorMessage: string | null
  tradesFileName: string | null
  pricesFileName: string | null
  receipt: ImportReceipt | null
  onImport: (file: File) => void
  onReset: () => void
  onDismissIssues: () => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (file) onImport(file)
    // Clear the input so re-selecting the same filename fires `change` again.
    if (inputRef.current) inputRef.current.value = ''
  }

  function openPicker() {
    if (!isBusy) inputRef.current?.click()
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        setIsDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setIsDragging(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setIsDragging(false)
        if (!isBusy) handleFiles(event.dataTransfer.files)
      }}
      className={`relative overflow-hidden rounded-2xl border bg-surface p-4 transition-[border-color,background-color,box-shadow] duration-200 sm:p-5 ${
        isDragging ? 'border-accent bg-accent-soft shadow-[0_0_0_4px_var(--accent-soft)]' : 'border-border'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('import.title')}</h2>
          <p id="import-hint" className="mt-1 text-sm text-muted">
            {t('import.drop')}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isBusy ? <Spinner label={t('import.validating')} /> : null}
          <button
            type="button"
            onClick={openPicker}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            <FileUploadOutlinedIcon sx={{ fontSize: 18 }} />
            {t('import.button')}
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={isBusy || source === 'seed'}
            className="rounded-full px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-40"
          >
            {t('import.reset')}
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label={t('import.aria')}
        aria-describedby="import-hint"
        onChange={(event) => handleFiles(event.target.files)}
      />

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <SourceFile
          label={t('import.trades')}
          fileName={tradesFileName ?? 'trades.csv'}
          sampleLabel={tradesFileName ? null : t('import.sampleWord')}
        />
        <SourceFile
          label={t('import.prices')}
          fileName={pricesFileName ?? 'prices.csv'}
          sampleLabel={pricesFileName ? null : t('import.sampleWord')}
        />
      </div>

      {receipt ? <ImportReceiptNotice receipt={receipt} /> : null}

      {errorMessage ? (
        <div role="alert" className="mt-3 rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-loss">{errorMessage}</p>
              <p className="mt-1 text-xs text-muted">
                {t('import.rejectedNote')}
              </p>
            </div>
            <button
              type="button"
              onClick={onDismissIssues}
              className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
            >
              {t('import.dismiss')}
            </button>
          </div>

          {issues.length > 0 ? (
            <>
              <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
                {issues.slice(0, 50).map((issue, index) => (
                  <li
                    key={`${issue.line}-${issue.field}-${index}`}
                    className="flex gap-2 rounded bg-background/40 px-2 py-1"
                  >
                    <span className="tabular shrink-0 text-muted">
                      {issue.line !== null ? t('import.line', { line: issue.line }) : t('import.file')}
                    </span>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
              {issues.length > 50 ? (
                <p className="mt-2 text-xs text-muted">
                  {t('import.more', { count: issues.length - 50 })}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div
        aria-hidden={!isDragging}
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-soft/95 transition-opacity duration-200 ${
          isDragging ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <p className="text-sm font-semibold text-accent">{t('import.dropActive')}</p>
      </div>
    </div>
  )
}

function SourceFile({
  label,
  fileName,
  sampleLabel,
}: {
  label: string
  fileName: string
  sampleLabel: string | null
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
        <InsertDriveFileOutlinedIcon sx={{ fontSize: 18 }} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <span className="block truncate text-sm font-medium">{fileName}</span>
      </span>
      {sampleLabel ? (
        <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          {sampleLabel}
        </span>
      ) : null}
    </div>
  )
}

function ImportReceiptNotice({ receipt }: { receipt: ImportReceipt }) {
  const { t } = useI18n()
  const detail =
    receipt.accepted === 'prices'
      ? t('import.receiptPrices', {
          priceCount: receipt.priceCount,
          asOf: receipt.asOf,
          tradeCount: receipt.tradeCount,
          value: receipt.portfolioValue,
        })
      : t('import.receiptTrades', {
          tradeCount: receipt.tradeCount,
          buyCount: receipt.buyCount,
          sellCount: receipt.sellCount,
          priceCount: receipt.priceCount,
          asOf: receipt.asOf,
          value: receipt.portfolioValue,
        })

  return (
    <div
      role="status"
      className="mt-4 overflow-hidden rounded-2xl border border-border bg-background motion-safe:animate-[rise_0.45s_cubic-bezier(0.22,1,0.36,1)_both]"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-gain/10 text-gain">
          <CheckCircleOutlineOutlinedIcon sx={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{t('import.loaded', { file: receipt.fileName })}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{detail}</p>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-2 border-t border-border p-3 sm:grid-cols-3 lg:grid-cols-5">
        {receipt.prices.map((entry) => (
          <li
            key={entry.symbol}
            className="flex min-w-0 items-center gap-2.5 rounded-xl bg-surface px-2.5 py-2"
          >
            <CoinIcon symbol={entry.symbol} size={28} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold tracking-wide">{entry.symbol}</span>
              <span className="tabular block truncate text-xs text-muted">{entry.price}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
