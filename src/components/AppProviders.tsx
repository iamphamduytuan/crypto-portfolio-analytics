'use client'

import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import 'dayjs/locale/en-gb'
import 'dayjs/locale/ja'
import 'dayjs/locale/ko'
import 'dayjs/locale/vi'
import 'dayjs/locale/zh-cn'
import { LocaleProvider, useI18n } from '@/lib/i18n/LocaleProvider'
import { buildTheme, type ThemeMode } from '@/lib/theme'
import { ToastProvider } from './ToastProvider'

const STORAGE_KEY = 'portfolio-theme'

type ColorMode = {
  mode: ThemeMode
  toggle: () => void
}

const ColorModeContext = createContext<ColorMode | null>(null)

export function useColorMode(): ColorMode {
  const value = useContext(ColorModeContext)
  if (!value) throw new Error('useColorMode must be used inside AppProviders')
  return value
}

function readMode(): ThemeMode {
  const attr = document.documentElement.dataset.theme
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function DateLocale({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n()
  const adapterLocale =
    locale === 'vi' ? 'vi' : locale === 'zh' ? 'zh-cn' : locale === 'ja' ? 'ja' : locale === 'ko' ? 'ko' : 'en-gb'

  useEffect(() => {
    dayjs.locale(adapterLocale)
  }, [adapterLocale])

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={adapterLocale}>
      {children}
    </LocalizationProvider>
  )
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setMode(readMode())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    document.documentElement.dataset.theme = mode
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode, ready])

  const theme = useMemo(() => buildTheme(mode), [mode])
  const colorMode = useMemo<ColorMode>(
    () => ({
      mode,
      toggle: () => setMode((current) => (current === 'dark' ? 'light' : 'dark')),
    }),
    [mode]
  )

  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <LocaleProvider>
          <ColorModeContext.Provider value={colorMode}>
            <DateLocale>
              <ToastProvider>{children}</ToastProvider>
            </DateLocale>
          </ColorModeContext.Provider>
        </LocaleProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  )
}
