import { createHash } from 'node:crypto'

// Conector tienda → ContiMarket: lo que no depende de Medusa ni de la red,
// para poder probarlo solo. Arma cada producto como lo pide la API de carga
// masiva de ContiMarket (POST /ImportProduct, PDF v1.5 y v2.2.1), su huella
// (para mandar solo lo que cambió) y las tandas (máximo 10 MB por envío).

/** Un producto de ContiMarket, tal como lo recibe /ImportProduct. */
export interface ContimarketItem {
  CodigoProducto: string
  Nombre: string
  DescripcionBreve: string
  DescripcionCompleta: string
  PrecioCatalogo: number
  PrecioContinental: number
  Stock: number
  Peso: number
  Longitud: number
  Anchura: number
  Altura: number
  Caracteristicas: { Title: string; Value: string }[]
  Imagen: { url: string }[]
}

/** Lo que se necesita de un producto de la tienda (una variante = un código). */
export interface StoreProductSnapshot {
  code: string
  product_id: string
  title: string
  description: string | null
  /** Publicado en la tienda (los ocultos van con stock 0). */
  published: boolean
  brand: string | null
  type: string | null
  /** Etiquetas del producto (la de ContiMarket es "contimarket"). */
  tags: string[]
  /** metadata del producto: color, malla y specs ("40 mm | Zafiro"). */
  color: string | null
  strap: string | null
  specs: string | null
  /** URLs públicas de las fotos, la principal primero. */
  images: string[]
  /** Precio normal y, si tiene, el de oferta vigente (guaraníes). */
  price: number
  offer_price: number | null
  /** Stock disponible en la tienda: stock − reservado por pedidos web. */
  available: number
}

export interface ContimarketRules {
  products: 'all' | 'tagged'
  price_rule: 'same' | 'offer' | 'percent'
  price_percent: number
  min_stock: number
  dimensions?: Record<string, { kg?: number; cm?: [number, number, number] }> | null
}

export const CONTIMARKET_TAG = 'contimarket'
/** El PDF v2.2.1 dice 3 fotos como máximo; el v1.5, 4. Se usa el menor. */
export const MAX_IMAGES = 3
/** El límite de ContiMarket es 10 MB por envío: se deja margen. */
export const MAX_BATCH_BYTES = 9 * 1024 * 1024
export const MAX_BATCH_ITEMS = 200

/**
 * Peso (kg) y medidas (cm: largo, ancho, alto) con caja, por tipo de
 * producto. Ni Aronium ni la tienda los tienen y ContiMarket los exige; son
 * estimaciones que se pueden cambiar desde el panel (rules.dimensions).
 */
export const DEFAULT_DIMENSIONS: Record<string, { kg: number; cm: [number, number, number] }> = {
  Reloj: { kg: 0.3, cm: [12, 10, 8] },
  Perfume: { kg: 0.5, cm: [15, 10, 8] },
  Decant: { kg: 0.1, cm: [12, 4, 4] },
  'Lentes de sol': { kg: 0.3, cm: [16, 8, 6] },
  Joya: { kg: 0.1, cm: [10, 8, 4] },
  Pulsera: { kg: 0.1, cm: [10, 8, 4] },
  Billetera: { kg: 0.2, cm: [12, 10, 3] },
  Cinto: { kg: 0.3, cm: [20, 15, 5] },
  'Mochila o bolso': { kg: 0.8, cm: [40, 30, 15] },
  Cartera: { kg: 0.6, cm: [30, 25, 12] },
  Necessaire: { kg: 0.3, cm: [25, 15, 10] },
  Organizador: { kg: 0.6, cm: [30, 20, 10] },
}
const FALLBACK_DIMENSIONS = { kg: 0.5, cm: [20, 15, 10] as [number, number, number] }

/** ¿Este producto va a ContiMarket (con su stock)? */
export function isListed(p: StoreProductSnapshot, rules: ContimarketRules): boolean {
  if (!p.published) return false
  if (rules.products === 'tagged' && !p.tags.some((t) => t.toLowerCase() === CONTIMARKET_TAG)) return false
  return true
}

/** Stock que se publica: 0 si no va, o si quedan menos de min_stock unidades. */
export function listedStock(p: StoreProductSnapshot, rules: ContimarketRules): number {
  if (!isListed(p, rules)) return 0
  const available = Math.max(0, Math.floor(p.available))
  return available >= Math.max(1, rules.min_stock) ? available : 0
}

/** Precio especial dentro de ContiMarket, según la regla del local. */
export function specialPrice(p: StoreProductSnapshot, rules: ContimarketRules): number {
  if (rules.price_rule === 'offer' && p.offer_price && p.offer_price < p.price) return Math.round(p.offer_price)
  if (rules.price_rule === 'percent' && rules.price_percent > 0 && rules.price_percent < 100) {
    return Math.round(p.price * (1 - rules.price_percent / 100))
  }
  return Math.round(p.price)
}

const clean = (text: string | null | undefined) => String(text ?? '').replace(/\s+/g, ' ').trim()
const splitList = (text: string | null) =>
  String(text ?? '')
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)

/** Primera oración (o las primeras palabras) para la descripción breve. */
function firstSentence(text: string, max = 160): string {
  const sentence = text.match(/^.+?[.!?](\s|$)/)?.[0]?.trim() ?? text
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

/** El producto como lo pide ContiMarket. Las descripciones nunca van vacías. */
export function buildItem(p: StoreProductSnapshot, rules: ContimarketRules): ContimarketItem {
  const name = clean(p.title) || p.code
  const colors = splitList(p.color)
  const straps = splitList(p.strap)
  const specs = splitList(p.specs)
  // Sin descripción en la tienda (casi todo lo que viene de Aronium): una
  // armada con lo que se sabe, sin inventar nada. "Reloj Emporio Armani
  // AR11521." (el tipo delante, salvo que el nombre ya lo diga).
  const details = [
    colors.length ? `Color: ${colors.join(', ')}.` : '',
    straps.length ? `Malla: ${straps.join(', ')}.` : '',
    specs.length ? `Características: ${specs.join(', ')}.` : '',
  ].filter(Boolean)
  const lead = p.type && !name.toLowerCase().includes(p.type.toLowerCase()) ? `${p.type} ${name}.` : `${name}.`
  const description = clean(p.description)
  const full = description || [lead, ...details, `Referencia ${p.code}.`].join(' ')
  const short = description ? firstSentence(description) : firstSentence(lead)

  const features: { Title: string; Value: string }[] = []
  if (p.brand) features.push({ Title: 'Marca', Value: p.brand })
  if (p.type) features.push({ Title: 'Tipo', Value: p.type })
  if (colors.length) features.push({ Title: 'Color', Value: colors.join(', ') })
  if (straps.length) features.push({ Title: 'Malla', Value: straps.join(', ') })
  for (const spec of specs) features.push({ Title: 'Característica', Value: spec })
  features.push({ Title: 'Referencia', Value: p.code })

  const custom = p.type ? rules.dimensions?.[p.type] : undefined
  const base = (p.type && DEFAULT_DIMENSIONS[p.type]) || FALLBACK_DIMENSIONS
  const kg = custom?.kg ?? base.kg
  const [length, width, height] = custom?.cm ?? base.cm

  return {
    CodigoProducto: p.code,
    Nombre: name,
    DescripcionBreve: short,
    DescripcionCompleta: full,
    PrecioCatalogo: Math.round(p.price),
    PrecioContinental: specialPrice(p, rules),
    Stock: listedStock(p, rules),
    Peso: kg,
    Longitud: length,
    Anchura: width,
    Altura: height,
    Caracteristicas: features,
    Imagen: p.images.filter((u) => /^https?:\/\//i.test(u)).slice(0, MAX_IMAGES).map((url) => ({ url })),
  }
}

/** Huella del producto: si no cambió, no se vuelve a mandar. */
export function itemHash(item: ContimarketItem): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 32)
}

/**
 * Qué mandar: los productos cuya huella cambió (todos si `full`). Un producto
 * que ContiMarket nunca recibió y que no va (stock 0) no se manda: no hace
 * falta crearlo para decir que no hay.
 */
export function planPush(items: ContimarketItem[], previous: Map<string, string | null>, full = false): ContimarketItem[] {
  return items.filter((item) => {
    const before = previous.get(item.CodigoProducto)
    if (before === undefined) return item.Stock > 0
    return full || before !== itemHash(item)
  })
}

/** Tandas de hasta MAX_BATCH_ITEMS productos y MAX_BATCH_BYTES (JSON). */
export function batches(items: ContimarketItem[], maxItems = MAX_BATCH_ITEMS, maxBytes = MAX_BATCH_BYTES): ContimarketItem[][] {
  const out: ContimarketItem[][] = []
  let current: ContimarketItem[] = []
  let bytes = 2
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1
    if (current.length && (current.length >= maxItems || bytes + size > maxBytes)) {
      out.push(current)
      current = []
      bytes = 2
    }
    current.push(item)
    bytes += size
  }
  if (current.length) out.push(current)
  return out
}
