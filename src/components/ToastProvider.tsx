'use client'

import Alert from '@mui/material/Alert'
import Grow from '@mui/material/Grow'
import Snackbar from '@mui/material/Snackbar'
import { createContext, useCallback, useContext, useState } from 'react'

type Severity = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  message: string
  severity: Severity
}

const ToastContext = createContext<(message: string, severity?: Severity) => void>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null)

  const show = useCallback((message: string, severity: Severity = 'info') => {
    setToast({ id: Date.now(), message, severity })
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        key={toast?.id}
        open={toast !== null}
        autoHideDuration={4200}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return
          setToast(null)
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slots={{ transition: Grow }}
      >
        <Alert
          severity={toast?.severity ?? 'info'}
          variant="filled"
          onClose={() => setToast(null)}
          sx={{ width: '100%', maxWidth: 420, alignItems: 'center', borderRadius: 3, boxShadow: 6 }}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  )
}
