const raw =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE ||
  'http://localhost:4000'

const trimmed = String(raw).replace(/\/+$/, '')

export const API_BASE = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
