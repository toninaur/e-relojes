// Medición: Google Analytics 4 y Píxel de Meta (Facebook/Instagram).
//
// Se activan con NEXT_PUBLIC_GA_ID (G-XXXXXXX) y NEXT_PUBLIC_META_PIXEL_ID.
// Sin esas variables no se carga nada y estas funciones no hacen nada.
// Los eventos siguen los nombres estándar de cada plataforma, así los
// informes de comercio electrónico y las campañas los reconocen solos.

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID

const CURRENCY = 'PYG'

export interface AnalyticsItem {
  id: string
  name: string
  brand?: string | null
  category?: string | null
  variant?: string | null
  price: number
  quantity?: number
}

type Gtag = (...args: unknown[]) => void
type Fbq = (...args: unknown[]) => void

declare global {
  interface Window {
    gtag?: Gtag
    fbq?: Fbq
    dataLayer?: unknown[]
  }
}

// Los scripts de Google y Meta cargan después de que la página arranca. Un
// evento anterior (por ejemplo, abrir directo la ficha de un producto) queda en
// cola y se manda cuando el script está listo.
const pending: { target: 'gtag' | 'fbq'; args: unknown[] }[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null

function flush() {
  for (let i = 0; i < pending.length; ) {
    const fn = window[pending[i].target]
    if (fn) fn(...pending.splice(i, 1)[0].args)
    else i++
  }
  if (!pending.length && flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
}

function call(target: 'gtag' | 'fbq', enabled: string | undefined, args: unknown[]) {
  if (typeof window === 'undefined' || !enabled) return
  const fn = window[target]
  if (fn) return fn(...args)
  pending.push({ target, args })
  if (!flushTimer) {
    let tries = 0
    flushTimer = setInterval(() => {
      flush()
      // Bloqueado por un adblocker: después de 15 s se descarta.
      if (++tries > 30 && flushTimer) {
        clearInterval(flushTimer)
        flushTimer = null
        pending.length = 0
      }
    }, 500)
  }
}

const gtag = (...args: unknown[]) => call('gtag', GA_ID, args)
const fbq = (...args: unknown[]) => call('fbq', META_PIXEL_ID, args)

function gaItems(items: AnalyticsItem[]) {
  return items.map((i) => ({
    item_id: i.id,
    item_name: i.name,
    item_brand: i.brand ?? undefined,
    item_category: i.category ?? undefined,
    item_variant: i.variant ?? undefined,
    price: i.price,
    quantity: i.quantity ?? 1,
  }))
}

function metaContents(items: AnalyticsItem[]) {
  return {
    content_ids: items.map((i) => i.id),
    contents: items.map((i) => ({ id: i.id, quantity: i.quantity ?? 1, item_price: i.price })),
    content_type: 'product',
    currency: CURRENCY,
  }
}

const total = (items: AnalyticsItem[]) => items.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0)

export function trackPageView(url: string) {
  gtag('event', 'page_view', { page_location: url })
  fbq('track', 'PageView')
}

export function trackViewItem(item: AnalyticsItem) {
  gtag('event', 'view_item', { currency: CURRENCY, value: item.price, items: gaItems([item]) })
  fbq('track', 'ViewContent', { ...metaContents([item]), content_name: item.name, value: item.price })
}

export function trackAddToCart(item: AnalyticsItem) {
  const value = item.price * (item.quantity ?? 1)
  gtag('event', 'add_to_cart', { currency: CURRENCY, value, items: gaItems([item]) })
  fbq('track', 'AddToCart', { ...metaContents([item]), value })
}

export function trackBeginCheckout(items: AnalyticsItem[], value = total(items)) {
  gtag('event', 'begin_checkout', { currency: CURRENCY, value, items: gaItems(items) })
  fbq('track', 'InitiateCheckout', { ...metaContents(items), value, num_items: items.length })
}

export function trackPurchase(orderId: string, items: AnalyticsItem[], value: number) {
  gtag('event', 'purchase', { transaction_id: orderId, currency: CURRENCY, value, items: gaItems(items) })
  fbq('track', 'Purchase', { ...metaContents(items), value })
}

export function trackSearch(term: string) {
  gtag('event', 'search', { search_term: term })
  fbq('track', 'Search', { search_string: term })
}

/** Click en un botón de WhatsApp: para el local es un contacto de venta. */
export function trackWhatsApp(location: string) {
  gtag('event', 'generate_lead', { method: 'whatsapp', link_url: location })
  fbq('track', 'Contact', { method: 'whatsapp' })
}
