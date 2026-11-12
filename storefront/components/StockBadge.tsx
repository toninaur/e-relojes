// Stock visible en la tarjeta del catálogo y en la ficha. `units` null = el
// producto no tiene control de stock en el admin (siempre disponible).

import type { UiVariant } from '@/lib/medusa/products'

const LOW_STOCK = 3

/** Unidades sumando las variantes, o null si alguna no controla stock. */
export function stockOf(variants: UiVariant[]): { units: number | null; inStock: boolean } {
  if (variants.some((v) => v.unlimitedStock)) return { units: null, inStock: true }
  const units = variants.reduce((sum, v) => sum + v.stock, 0)
  return { units, inStock: units > 0 }
}

export function stockLabel(units: number | null): string {
  if (units === null) return 'Disponible'
  if (units <= 0) return 'Sin stock'
  if (units <= LOW_STOCK) return units === 1 ? '¡Última unidad!' : `¡Últimas ${units} unidades!`
  return `${units} unidades en stock`
}

export default function StockBadge({ units, className = '' }: { units: number | null; className?: string }) {
  const out = units !== null && units <= 0
  const low = units !== null && units > 0 && units <= LOW_STOCK
  const dot = out ? 'bg-muted' : low ? 'bg-amber-500' : 'bg-emerald-500'
  const text = out ? 'text-muted' : low ? 'text-amber-700' : 'text-emerald-700'
  return (
    <p className={`flex items-center gap-1.5 m-0 font-semibold ${text} ${className}`}>
      <span aria-hidden className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot}`} />
      {stockLabel(units)}
    </p>
  )
}
