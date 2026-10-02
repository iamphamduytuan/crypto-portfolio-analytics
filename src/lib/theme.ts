import { createTheme } from '@mui/material/styles'

export type ThemeMode = 'light' | 'dark'

const palettes = {
  dark: {
    bg: '#0a0b0d',
    paper: '#141518',
    text: '#ffffff',
    muted: '#a3a7b0',
    line: '#2c2f36',
    accent: '#0052ff',
    accentText: '#ffffff',
    gain: '#27ad75',
    loss: '#f05d6a',
  },
  light: {
    bg: '#f7f8fa',
    paper: '#ffffff',
    text: '#0a0b0d',
    muted: '#5b616e',
    line: '#e7ebef',
    accent: '#0052ff',
    accentText: '#ffffff',
    gain: '#098551',
    loss: '#cf202f',
  },
} as const

/** Material theme kept in lockstep with the CSS variables in globals.css. */
export function buildTheme(mode: ThemeMode) {
  const color = palettes[mode]
  return createTheme({
    palette: {
      mode,
      primary: { main: color.accent, contrastText: color.accentText },
      background: { default: color.bg, paper: color.paper },
      text: { primary: color.text, secondary: color.muted },
      divider: color.line,
      success: { main: color.gain },
      error: { main: color.loss },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: 'var(--font-sans), Inter, sans-serif',
    },
    components: {
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 9999,
            backgroundColor: color.bg,
            transition: 'border-color 0.2s ease',
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1 },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600 },
        },
      },
      MuiIconButton: {
        defaultProps: { disableRipple: false },
      },
    },
  })
}
