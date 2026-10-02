'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { LOCALES, MESSAGES, htmlLang, intlLocale, type Locale, type MessageKey } from './messages'

const STORAGE_KEY = 'portfolio-locale'

type I18n = {
  locale: Locale
  intl: string
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
}

const LocaleContext = createContext<I18n | null>(null)

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return LOCALES.some((item) => item.code === stored) ? (stored as Locale) : 'en'
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    setLocaleState(readStoredLocale())
  }, [])

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale)
    document.documentElement.dataset.locale = locale
  }, [locale])

  const value = useMemo<I18n>(() => {
    const table = MESSAGES[locale]
    return {
      locale,
      intl: intlLocale(locale),
      setLocale: (next) => {
        setLocaleState(next)
        window.localStorage.setItem(STORAGE_KEY, next)
      },
      t: (key, vars) => {
        let text = table[key] ?? MESSAGES.en[key] ?? key
        if (vars) {
          for (const [name, replacement] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(replacement))
          }
        }
        return text
      },
    }
  }, [locale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useI18n(): I18n {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('useI18n must be used inside LocaleProvider')
  return value
}
