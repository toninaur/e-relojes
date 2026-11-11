const CURRENCY_LOCALE: Record<string, string> = {
  PYG: 'es-PY',
  USD: 'en-US',
}

const ZERO_DECIMAL = new Set(['PYG'])

export function formatMoney(amount: number | string, currency = 'PYG'): string {
  const value = Number(amount)
  if (Number.isNaN(value)) return ''
  const code = currency.toUpperCase()
  return new Intl.NumberFormat(CURRENCY_LOCALE[code] ?? 'es-PY', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: ZERO_DECIMAL.has(code) ? 0 : 2,
  }).format(value)
}
