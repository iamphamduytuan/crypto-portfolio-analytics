'use client'

import type { ReactNode } from 'react'
import { signOf } from '@/lib/format'
import { useI18n } from '@/lib/i18n/LocaleProvider'

/** Shared presentational primitives. No business logic lives here. */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-border bg-surface p-4 sm:p-5 ${className}`}>
      {children}
    </div>
  )
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/**
 * Colour class for a signed value.
 *
 * Returns `text-muted` for zero so a flat position is not styled as a gain. Callers must also
 * render the sign as text — colour alone is never the signal.
 */
export function signClass(value: string | null): string {
  const sign = signOf(value)
  if (sign === 'positive') return 'text-gain'
  if (sign === 'negative') return 'text-loss'
  return 'text-muted'
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'warn'
}) {
  const tones = {
    neutral: 'border-border bg-surface-raised text-muted',
    accent: 'border-accent/30 bg-accent-soft text-accent',
    warn: 'border-loss/40 bg-loss/10 text-loss',
  } as const
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span
        aria-hidden
        className="size-3 animate-spin rounded-full border-2 border-muted border-t-transparent"
      />
      {label}
    </span>
  )
}

/** Non-blocking inline error. `role="alert"` so screen readers announce failures immediately. */
export function ErrorNotice({
  title,
  children,
  onRetry,
}: {
  title: string
  children?: ReactNode
  onRetry?: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      role="alert"
      className="rounded-xl border border-loss/40 bg-loss/10 p-4 text-sm text-foreground"
    >
      <p className="font-semibold text-loss">{title}</p>
      {children ? <div className="mt-2 text-muted">{children}</div> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-full bg-accent px-4 py-1.5 font-semibold text-white hover:brightness-110"
        >
          {t('app.retry')}
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </div>
  )
}