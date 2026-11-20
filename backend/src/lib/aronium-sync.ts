import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from '@medusajs/framework/utils'
import {
  batchInventoryItemLevelsWorkflow,
  createProductsWorkflow,
  updateProductsWorkflow,
  updateProductVariantsWorkflow,
  uploadFilesWorkflow,
} from '@medusajs/medusa/core-flows'
import { z } from 'zod'
import { ARONIUM_MODULE } from '../modules/aronium'
import { classify } from './aronium-classify'
import { canWrite, parseAroniumContent, toMetadataValues, type SyncedField } from './aronium-content'
import { requestCodesRefresh, webSaleAlerts, webSaleStockAdjustments } from './aronium-web-sales'
import { scheduleContimarketPush } from './contimarket-sync'
import type AroniumModuleService from '../modules/aronium/service'

// Aronium → tienda (ver docs/sincronizador-aronium.md, punto 4.1).
//
// El agente de la PC del local lee Aronium cada minuto y manda lo que cambió
// (y el catálogo entero cada 30 minutos). Un producto de Aronium es una
// variante de la tienda, unidas por el código: `Product.Code` de Aronium = SKU.
//
// - Precio normal y stock: siempre de Aronium. Las ofertas no se tocan.
// - Stock: el de Aronium más las ventas web que Aronium ya restó pero la tienda
//   todavía tiene reservadas (lib/aronium-web-sales.ts, regla 4): así nada se
//   descuenta dos veces.
// - Contenido (foto principal, descripción, color, malla, características,
//   código de barras): de Aronium, salvo que se haya editado en el panel. Se
//   guarda en la metadata del producto lo último que se copió
//   (`aronium_synced`); si en la tienda hay otra cosa, alguien lo cambió y se
//   respeta, hasta que se pida "Tomar de Aronium" (`aronium_resync`).
// - Código nuevo: producto en borrador con nombre, descripción, filtros,
//   categoría, marca y tipo. La foto se le pide después al agente
//   (`images_wanted`), para no mandar fotos en cada pasada.
// - Código borrado (o desactivado) en Aronium: baja, stock 0.
// - Publicado y sin stock: se oculta, y vuelve solo cuando tiene stock (lo
//   pidió el local). Borrador del conector con foto, categoría y stock: se
//   publica solo, una vez. Lo que alguien ocultó a mano no se vuelve a
//   publicar (`visibilityChange`).
//
// Bitácora (panel → Aronium): cada pasada que cambia algo, o que falla.

const CURRENCY = 'pyg'
const NO_COLOR_TYPES = new Set(['Perfume', 'Decant'])
const SKU_CHUNK = 500

export const aroniumItemSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  price: z.number().nonnegative(),
  stock: z.number(),
  // Desactivado en Aronium: stock 0 y, si no existe en la tienda, no se crea.
  enabled: z.boolean().default(true),
  group: z.string().nullish(),
  image_hash: z.string().nullish(),
  // Agente 0.5+: códigos de barras de Aronium (el primero va a la variante).
  barcodes: z.array(z.string()).nullish(),
})

export const MIN_INTERVAL = 1
export const MAX_INTERVAL = 30

const agentSchema = z.object({
  version: z.string().nullish(),
  host: z.string().nullish(),
  // Agentes viejos no lo mandan: 5. Fuera de rango, el límite más cercano.
  interval_minutes: z.number().nullish(),
  // Agente 0.5+: si puede escribir ventas en esta base de Aronium (versión
  // conocida) y, si no, por qué.
  write_enabled: z.boolean().nullish(),
  write_blocked_reason: z.string().nullish(),
})

export const aroniumSyncSchema = z.object({
  agent: agentSchema.default({}),
  // true: el catálogo entero (los códigos que faltan son bajas). false: solo
  // lo que cambió desde la pasada anterior (agente 0.4+). Los agentes viejos
  // siempre mandan el catálogo entero y no lo indican.
  full: z.boolean().default(true),
  items: z.array(aroniumItemSchema).max(50000).default([]),
  // El agente no pudo leer Aronium: se registra el error y no se toca la tienda.
  error: z.string().nullish(),
})

export const aroniumImagesSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        base64: z.string().min(1),
        mimeType: z.enum(['image/jpeg', 'image/png']),
        image_hash: z.string().nullish(),
      })
    )
    .max(20),
})

export type AroniumItem = z.infer<typeof aroniumItemSchema>
type ChangeInput = {
  code: string
  product_id?: string | null
  product_title?: string | null
  field: 'price' | 'stock' | 'created' | 'removed' | 'image' | 'content' | 'published' | 'hidden'
  old_value?: string | null
  new_value?: string | null
}

type ProductRow = {
  id: string
  title: string
  status: string
  description?: string | null
  thumbnail?: string | null
  metadata?: Record<string, unknown> | null
  images?: { url: string }[] | null
  type?: { value?: string | null } | null
  variants?: { id: string }[] | null
}

type VariantRow = {
  id: string
  sku: string | null
  barcode?: string | null
  product?: ProductRow | null
  price_set?: { prices?: { amount: number; currency_code: string; price_list_id?: string | null }[] } | null
  inventory_items?: {
    inventory_item_id: string
    inventory?: { location_levels?: { id: string; location_id: string; stocked_quantity: number; reserved_quantity?: number | null }[] } | null
  }[] | null
}

type Synced = Partial<Record<SyncedField | 'image_hash' | 'image_url', string>>

function syncedOf(product: ProductRow | null | undefined): Synced {
  const s = product?.metadata?.aronium_synced
  return s && typeof s === 'object' ? (s as Synced) : {}
}

// Tipos que el local no vende online (las mallas): no se publican solos; se
// pueden publicar a mano.
const NOT_AUTO_PUBLISHED_TYPES = new Set(['Malla de reloj'])
const flagOn = (v: unknown) => v === true || v === 'true'
const flagOff = (v: unknown) => v === false || v === 'false'

/**
 * Qué hacer con la visibilidad de un producto según su stock (la categoría,
 * necesaria para publicar, se mira aparte: `withCategory`):
 * - Publicado y sin stock: se oculta (`aronium_no_stock`). Solo productos de
 *   una variante, como los de Aronium.
 * - Oculto por falta de stock, y con stock y foto: se vuelve a publicar.
 * - Borrador creado por el conector, con foto y stock: se publica, una sola
 *   vez. `aronium_autopublish: false` marca los que ya estuvieron publicados
 *   (por el conector, la importación del catálogo o a mano): si alguien los
 *   oculta a mano, quedan ocultos.
 */
export function visibilityChange(product: ProductRow, stock: number): 'publish' | 'hide' | null {
  const metadata = product.metadata ?? {}
  if (product.status === ProductStatus.PUBLISHED) {
    return stock <= 0 && (product.variants?.length ?? 1) === 1 ? 'hide' : null
  }
  if (product.status !== ProductStatus.DRAFT || stock <= 0 || !product.thumbnail) return null
  if (flagOn(metadata.aronium_no_stock)) return 'publish'
  if (!metadata.aronium_code || flagOff(metadata.aronium_autopublish)) return null
  if (NOT_AUTO_PUBLISHED_TYPES.has(product.type?.value ?? '')) return null
  return 'publish'
}

/** Ya publicado y todavía sin la marca: se le pone, para no republicarlo si lo ocultan a mano. */
export function needsPublishedMark(product: ProductRow): boolean {
  return product.status === ProductStatus.PUBLISHED && Boolean(product.metadata?.aronium_code) && !flagOff(product.metadata?.aronium_autopublish)
}

/** De estos productos, los que tienen categoría. */
async function withCategory(container: MedusaContainer, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: 'product', fields: ['id', 'categories.id'], filters: { id: ids } })
  return new Set(data.filter((p) => (p.categories ?? []).length > 0).map((p) => p.id))
}

/**
 * Stock disponible de la variante en todos los locales: lo que hay menos lo
 * reservado por pedidos web. Una última unidad reservada por un pedido sin
 * pagar no se puede comprar: el producto se oculta (el local no quiere
 * mostrar "Sin stock") y vuelve si el pedido se cancela.
 */
function variantStock(variant: VariantRow): number {
  let total = 0
  for (const ii of variant.inventory_items ?? [])
    for (const l of ii.inventory?.location_levels ?? []) total += (Number(l.stocked_quantity) || 0) - (Number(l.reserved_quantity) || 0)
  return total
}

/** La foto actual la puso el conector (o el producto no tiene foto). */
function imageIsOurs(product: ProductRow): boolean {
  if (!product.thumbnail) return true
  const synced = syncedOf(product)
  if (synced.image_url) return product.thumbnail === synced.image_url
  // Versiones viejas del conector subían la foto como "aronium-<código>".
  return Boolean(product.metadata?.aronium_code) && /\/[^/]*aronium-[^/]*$/.test(product.thumbnail)
}

export async function syncAroniumSnapshot(container: MedusaContainer, input: z.infer<typeof aroniumSyncSchema>) {
  const started = Date.now()
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)

  const [current] = await aronium.listAroniumAgents({}, { take: 1 })
  // Ajustes del panel que el agente aplica solo (agente 0.6+).
  const settings = {
    interval_minutes: current?.desired_interval ?? null,
    full_requested: Boolean(current?.full_requested),
    sync_paused: Boolean(current?.sync_paused),
  }
  const empty = { prices_updated: 0, stock_updated: 0, created: 0, removed: 0, content_updated: 0, unchanged: 0, images_wanted: [] as string[], refresh_codes: [] as string[] }

  if (input.error) {
    await touchAgent(aronium, input.agent, { error: input.error })
    // El mismo error en cada pasada se anota una sola vez en el historial.
    const [last] = await aronium.listAroniumRuns({}, { order: { created_at: 'DESC' }, take: 1 })
    if (last?.status !== 'error' || last.error !== input.error) {
      await aronium.createAroniumRuns({ status: 'error', error: input.error, duration_ms: Date.now() - started })
    }
    return { ...empty, settings }
  }

  // Pausado desde el panel: no se aplica nada (el agente no lo toma como
  // enviado y lo vuelve a mandar al reanudar). Igual cuenta como conexión.
  if (current?.sync_paused) {
    await touchAgent(aronium, input.agent, {})
    return { ...empty, paused: true, settings }
  }

  try {
    const saved = (current?.known_codes as { codes?: unknown } | null | undefined)?.codes
    const known = Array.isArray(saved) ? new Set(saved.map(String)) : null
    const outcome = await applySnapshot(container, input.items, known, input.full)
    // Códigos activos conocidos: en una pasada completa, los que vinieron; en
    // una parcial, los de antes más/menos los que se activaron o desactivaron.
    let knownCodes: string[] | undefined
    if (input.full) {
      // Catálogo vacío: probablemente una lectura mala; no se olvida lo conocido.
      if (input.items.length) knownCodes = [...new Set(input.items.filter((i) => i.enabled).map((i) => i.code))]
    } else if (known && input.items.length) {
      const next = new Set(known)
      for (const item of input.items) {
        if (item.enabled) next.add(item.code)
        else next.delete(item.code)
      }
      knownCodes = [...next]
    }
    // "Tomar de Aronium" pedido en el panel: el agente manda esos códigos en
    // la próxima pasada.
    const refresh = (current?.refresh_codes as { codes?: unknown } | null | undefined)?.codes
    const refreshCodes = Array.isArray(refresh) ? refresh.map(String) : []
    await touchAgent(aronium, input.agent, {
      ...(input.full ? { productsTotal: input.items.length } : {}),
      ...(knownCodes ? { knownCodes } : {}),
      ...(refreshCodes.length ? { clearRefresh: true } : {}),
      // "Sincronizar todo ahora" ya se cumplió con esta pasada completa.
      ...(input.full && current?.full_requested ? { clearFullRequest: true } : {}),
    })
    if (outcome.changes.length) {
      // ContiMarket se entera después, aparte: esta pasada no lo espera ni
      // depende de que ande (lib/contimarket-sync.ts).
      try {
        scheduleContimarketPush(container, 'sincronización de Aronium')
      } catch {}
      await recordRun(aronium, outcome.changes, {
        items_received: input.items.length,
        duration_ms: Date.now() - started,
      })
    }
    const count = (field: ChangeInput['field']) => outcome.changes.filter((c) => c.field === field).length
    return {
      prices_updated: count('price'),
      stock_updated: count('stock'),
      created: count('created'),
      removed: count('removed'),
      content_updated: count('content'),
      unchanged: outcome.unchanged,
      images_wanted: outcome.imagesWanted,
      refresh_codes: [...new Set([...refreshCodes, ...outcome.postponed])],
      settings: { ...settings, full_requested: settings.full_requested && !input.full },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await touchAgent(aronium, input.agent, { error: `La tienda no pudo aplicar los cambios: ${message}` })
    await aronium.createAroniumRuns({
      status: 'error',
      error: `La tienda no pudo aplicar los cambios: ${message}`,
      items_received: input.items.length,
      duration_ms: Date.now() - started,
    })
    throw error
  }
}

async function applySnapshot(container: MedusaContainer, input: AroniumItem[], known: Set<string> | null, full: boolean) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const changes: ChangeInput[] = []
  let unchanged = 0

  // El mismo código dos veces: vale el último.
  const items = [...new Map(input.map((i) => [i.code, i])).values()]
  if (!items.length) return { changes, unchanged, imagesWanted: [] as string[], postponed: [] as string[] }

  const { data: stockLocations } = await query.graph({ entity: 'stock_location', fields: ['id'] })
  const locationId = stockLocations[0]?.id
  if (!locationId) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'La tienda no tiene un local de stock.')

  const variants = await findVariants(container, items.map((i) => i.code))
  const bySku = new Map(variants.map((v) => [v.sku!, v]))

  // Regla 4: ventas web que Aronium ya restó y la tienda tiene reservadas, o
  // canceladas cuya devolución todavía no llegó a Aronium.
  const inventoryBySku = new Map(
    variants.flatMap((v) => (v.sku && v.inventory_items?.[0] ? [[v.sku, v.inventory_items[0].inventory_item_id] as [string, string]] : []))
  )
  const adjustments = await webSaleStockAdjustments(container, inventoryBySku)

  const priceUpdates: { id: string; prices: { currency_code: string; amount: number }[] }[] = []
  const barcodeUpdates: { id: string; barcode: string | null }[] = []
  type ProductPatch = { description?: string; status?: ProductStatus; metadata: Record<string, unknown> }
  const productUpdates = new Map<string, ProductPatch & { id: string }>()
  const queueProduct = (p: ProductRow, patch: ProductPatch) => {
    const prev = productUpdates.get(p.id)
    productUpdates.set(p.id, { ...prev, ...patch, id: p.id, metadata: { ...(prev?.metadata ?? p.metadata ?? {}), ...patch.metadata } })
  }
  const publishCandidates: { code: string; product: ProductRow }[] = []
  const levelCreates: { inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
  const levelUpdates: { id: string; inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
  const imagesWanted: string[] = []

  for (const item of items) {
    const variant = bySku.get(item.code)
    if (!variant) continue
    const product = { product_id: variant.product?.id, product_title: variant.product?.title }
    // Venía activo y ahora está desactivado en Aronium: baja.
    const removed = !item.enabled && Boolean(known?.has(item.code))
    let changed = false
    let stock: number | null = null

    const base = variant.price_set?.prices?.find((p) => !p.price_list_id && p.currency_code === CURRENCY)
    if (!base || Number(base.amount) !== item.price) {
      priceUpdates.push({ id: variant.id, prices: [{ currency_code: CURRENCY, amount: item.price }] })
      changes.push({ code: item.code, ...product, field: 'price', old_value: base ? String(base.amount) : null, new_value: String(item.price) })
      changed = true
    }

    // Una variante con un solo artículo de inventario (lo normal en la tienda).
    const inventoryItem = variant.inventory_items?.[0]
    if (inventoryItem) {
      const adjust = adjustments.get(inventoryItem.inventory_item_id) ?? 0
      stock = item.enabled ? Math.max(0, Math.floor(item.stock) + adjust) : 0
      const level = inventoryItem.inventory?.location_levels?.find((l) => l.location_id === locationId)
      const current = level ? Number(level.stocked_quantity) : null
      if (current !== stock) {
        if (level) levelUpdates.push({ id: level.id, inventory_item_id: inventoryItem.inventory_item_id, location_id: locationId, stocked_quantity: stock })
        else levelCreates.push({ inventory_item_id: inventoryItem.inventory_item_id, location_id: locationId, stocked_quantity: stock })
      }
      if (removed || current !== stock) {
        changes.push({
          code: item.code,
          ...product,
          field: removed ? 'removed' : 'stock',
          old_value: current === null ? null : String(current),
          new_value: String(stock),
        })
        changed = true
      }
    }

    // Contenido: descripción, filtros, características, código de barras y foto.
    if (variant.product) {
      const p = variant.product
      const content = applyContent(item, variant, p)
      if (content.productUpdate) queueProduct(p, content.productUpdate)
      // Visibilidad por lo disponible: el stock nuevo menos lo reservado.
      const reserved = Number(inventoryItem?.inventory?.location_levels?.find((l) => l.location_id === locationId)?.reserved_quantity) || 0
      const visibility = stock === null ? null : visibilityChange(p, stock - reserved)
      if (visibility === 'publish') publishCandidates.push({ code: item.code, product: p })
      else if (visibility === 'hide') {
        queueProduct(p, { status: ProductStatus.DRAFT, metadata: { aronium_no_stock: true, aronium_autopublish: false } })
        changes.push({ code: item.code, ...product, field: 'hidden' })
        changed = true
      } else if (needsPublishedMark(p)) queueProduct(p, { metadata: { aronium_autopublish: false } })
      if (content.barcode !== undefined) barcodeUpdates.push({ id: variant.id, barcode: content.barcode })
      if (content.fields.length) {
        changes.push({ code: item.code, ...product, field: 'content', new_value: content.fields.join(', ') })
        changed = true
      }
      if (content.wantImage) imagesWanted.push(item.code)
    }

    if (!changed) unchanged++
  }

  // Códigos que venían activos y ya no están en Aronium (borrados): baja.
  const present = new Set(items.map((i) => i.code))
  // Solo en una pasada completa: en una parcial faltan todos los que no cambiaron.
  const gone = full && known ? [...known].filter((code) => !present.has(code)) : []
  for (const variant of gone.length ? await findVariants(container, gone) : []) {
    const inventoryItem = variant.inventory_items?.[0]
    const level = inventoryItem?.inventory?.location_levels?.find((l) => l.location_id === locationId)
    const current = level ? Number(level.stocked_quantity) : null
    if (level && current !== 0) {
      levelUpdates.push({ id: level.id, inventory_item_id: inventoryItem!.inventory_item_id, location_id: locationId, stocked_quantity: 0 })
    }
    changes.push({
      code: variant.sku!,
      product_id: variant.product?.id,
      product_title: variant.product?.title,
      field: 'removed',
      old_value: current === null ? null : String(current),
      new_value: '0',
    })
    if (variant.product && visibilityChange(variant.product, 0) === 'hide') {
      queueProduct(variant.product, { status: ProductStatus.DRAFT, metadata: { aronium_no_stock: true, aronium_autopublish: false } })
    }
  }

  if (priceUpdates.length || barcodeUpdates.length) {
    // Reemplaza solo los precios base: los de la lista "Ofertas" no se tocan.
    const byId = new Map<string, Record<string, unknown>>()
    for (const u of priceUpdates) byId.set(u.id, { ...(byId.get(u.id) ?? {}), ...u })
    for (const u of barcodeUpdates) byId.set(u.id, { ...(byId.get(u.id) ?? {}), ...u })
    await updateProductVariantsWorkflow(container).run({ input: { product_variants: [...byId.values()] as any } })
  }
  const ready = await withCategory(container, publishCandidates.map((c) => c.product.id))
  for (const { code, product } of publishCandidates) {
    if (!ready.has(product.id)) continue
    queueProduct(product, { status: ProductStatus.PUBLISHED, metadata: { aronium_autopublish: false, aronium_no_stock: false } })
    changes.push({ code, product_id: product.id, product_title: product.title, field: 'published' })
  }

  if (productUpdates.size) {
    await updateProductsWorkflow(container).run({ input: { products: [...productUpdates.values()] } })
  }

  // Altas de a MAX_CREATE_PER_PASS: la primera pasada con todo el catálogo
  // (miles) no entra en el tiempo de una respuesta. Las que esperan vuelven en
  // refresh_codes y el agente las manda en la pasada siguiente.
  const allMissing = items.filter((i) => !bySku.has(i.code) && i.enabled)
  const missing = allMissing.slice(0, MAX_CREATE_PER_PASS)
  const postponed = allMissing.slice(MAX_CREATE_PER_PASS).map((i) => i.code)
  if (missing.length) {
    const created = await createDraftProducts(container, missing)
    for (const c of created) {
      changes.push({ code: c.code, product_id: c.product_id, product_title: c.title, field: 'created', new_value: String(c.stock) })
      if (c.inventory_item_id) {
        levelCreates.push({ inventory_item_id: c.inventory_item_id, location_id: locationId, stocked_quantity: c.stock })
      }
      if (c.image_hash) imagesWanted.push(c.code)
    }
  }

  if (levelCreates.length || levelUpdates.length) {
    await batchInventoryItemLevelsWorkflow(container).run({ input: { create: levelCreates, update: levelUpdates, delete: [] } })
  }

  return { changes, unchanged, imagesWanted, postponed }
}

/**
 * Qué del contenido de Aronium se copia a este producto (regla "editado en la
 * tienda", lib/aronium-content.ts).
 */
function applyContent(item: AroniumItem, variant: VariantRow, product: ProductRow) {
  const synced = syncedOf(product)
  const metadata = (product.metadata ?? {}) as Record<string, unknown>
  const resync = metadata.aronium_resync === true || metadata.aronium_resync === 'true'
  const values = toMetadataValues(parseAroniumContent(item.name, item.description))
  // El color no aplica a perfumes ni decants.
  if (NO_COLOR_TYPES.has(product.type?.value ?? '')) values.color = ''

  const nextSynced: Synced = { ...synced }
  const metaUpdate: Record<string, unknown> = {}
  let description: string | undefined
  const fields: string[] = []

  const consider = (field: 'description' | 'color' | 'malla' | 'specs', store: string, value: string, label: string) => {
    // Aronium vacío no borra algo cargado en la tienda.
    if (!value && store) return
    // Sin registro de lo último copiado (productos de versiones viejas del
    // conector): se toma solo si sigue siendo lo que vino de Aronium al
    // crearlo, nunca algo editado a mano.
    const untouched = synced[field] === undefined && field === 'description' && store.trim() === (item.description ?? '').trim()
    if (!canWrite({ store, lastSynced: synced[field], connectorProduct: untouched, resync })) return
    nextSynced[field] = value
    if (store.trim() === value.trim()) return
    if (field === 'description') description = value
    else metaUpdate[field] = value
    fields.push(label)
  }
  consider('description', product.description ?? '', values.description, 'descripción')
  consider('color', String(metadata.color ?? ''), values.color, 'color')
  consider('malla', String(metadata.malla ?? ''), values.malla, 'malla')
  consider('specs', String(metadata.specs ?? ''), values.specs, 'características')

  let barcode: string | null | undefined
  const aroniumBarcode = item.barcodes?.find((b) => b.trim())?.trim() ?? ''
  if (item.barcodes) {
    const store = variant.barcode ?? ''
    if ((aroniumBarcode || !store) && canWrite({ store, lastSynced: synced.barcode, connectorProduct: false, resync })) {
      nextSynced.barcode = aroniumBarcode
      if (store !== aroniumBarcode) {
        barcode = aroniumBarcode || null
        fields.push('código de barras')
      }
    }
  }

  // Foto: si Aronium tiene una distinta de la que se copió y la de la tienda
  // es la del conector (o no hay), se pide.
  let wantImage = false
  if (item.image_hash && !resync && synced.image_hash === undefined && product.thumbnail && imageIsOurs(product)) {
    // Foto subida por una versión vieja del conector: se adopta como está, sin
    // volver a subirla (si no, la primera pasada subiría todas las fotos).
    nextSynced.image_hash = item.image_hash
    nextSynced.image_url = product.thumbnail
  } else if (item.image_hash && (resync || imageIsOurs(product)) && item.image_hash !== synced.image_hash) {
    wantImage = true
    if (resync && product.thumbnail) nextSynced.image_url = product.thumbnail
  }

  const syncedChanged = JSON.stringify(nextSynced) !== JSON.stringify(synced)
  const productUpdate =
    description !== undefined || Object.keys(metaUpdate).length || syncedChanged || resync
      ? {
          ...(description !== undefined ? { description } : {}),
          metadata: { ...metaUpdate, aronium_synced: nextSynced, ...(resync ? { aronium_resync: '' } : {}) },
        }
      : null
  return { productUpdate, barcode, fields, wantImage }
}

/** Fotos que pidió la tienda: se suben y quedan como foto principal. */
export async function attachAroniumImages(container: MedusaContainer, input: z.infer<typeof aroniumImagesSchema>) {
  const started = Date.now()
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)
  const variants = await findVariants(container, input.items.map((i) => i.code))
  const targets = input.items.flatMap((item) => {
    const variant = variants.find((v) => v.sku === item.code)
    const product = variant?.product
    return variant && product && imageIsOurs(product) ? [{ item, product, stock: variantStock(variant) }] : []
  })
  if (!targets.length) return { images_added: 0 }
  // Con la foto, los borradores con categoría y stock ya se pueden publicar.
  const ready = await withCategory(
    container,
    targets.filter(({ product, stock }) => visibilityChange({ ...product, thumbnail: 'foto' }, stock) === 'publish').map(({ product }) => product.id)
  )

  const { result: files } = await uploadFilesWorkflow(container).run({
    input: {
      files: targets.map(({ item }) => ({
        filename: `aronium-${slugify(item.code)}.${item.mimeType === 'image/png' ? 'png' : 'jpg'}`,
        mimeType: item.mimeType,
        content: item.base64,
        access: 'public' as const,
      })),
    },
  })

  const updates = targets.flatMap(({ item, product }, index) => {
    const url = files[index]?.url
    if (!url) return []
    // La foto nueva va primera; las demás de la galería se quedan (menos la
    // foto anterior del conector).
    const old = product.thumbnail
    const others = (product.images ?? []).map((i) => i.url).filter((u) => u !== old)
    const synced = { ...syncedOf(product), image_url: url, image_hash: item.image_hash ?? '' }
    const publish = ready.has(product.id)
    return [
      {
        id: product.id,
        images: [{ url }, ...others.map((u) => ({ url: u }))],
        thumbnail: url,
        ...(publish ? { status: ProductStatus.PUBLISHED } : {}),
        metadata: {
          ...(product.metadata ?? {}),
          aronium_synced: synced,
          ...(publish ? { aronium_autopublish: false, aronium_no_stock: false } : {}),
        },
      },
    ]
  })
  if (updates.length) {
    await updateProductsWorkflow(container).run({ input: { products: updates } })
    const done = targets.filter(({ product }) => updates.some((u) => u.id === product.id))
    const change = (item: { code: string }, product: ProductRow, field: 'image' | 'published') => ({
      code: item.code,
      product_id: product.id,
      product_title: product.title,
      field,
    })
    await recordRun(
      aronium,
      [
        ...done.map(({ item, product }) => change(item, product, 'image')),
        ...done.filter(({ product }) => ready.has(product.id)).map(({ item, product }) => change(item, product, 'published')),
      ],
      { items_received: input.items.length, duration_ms: Date.now() - started }
    )
  }
  return { images_added: updates.length }
}

export const agentSettingsSchema = z.object({
  sync_paused: z.boolean().optional(),
  web_sales_paused: z.boolean().optional(),
  // null = lo que diga el config.json del agente.
  interval_minutes: z.number().int().min(MIN_INTERVAL).max(MAX_INTERVAL).nullable().optional(),
  full_requested: z.boolean().optional(),
})

/** Panel → Aronium: interruptores, frecuencia y "Sincronizar todo ahora". */
export async function updateAgentSettings(container: MedusaContainer, input: z.infer<typeof agentSettingsSchema>) {
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)
  const [agent] = await aronium.listAroniumAgents({}, { take: 1 })
  const data: Record<string, unknown> = {}
  if (input.sync_paused !== undefined) {
    data.sync_paused = input.sync_paused
    // Al reanudar, una pasada completa: se pone al día con todo lo que cambió.
    if (!input.sync_paused && agent?.sync_paused) data.full_requested = true
  }
  if (input.web_sales_paused !== undefined) data.web_sales_paused = input.web_sales_paused
  if (input.interval_minutes !== undefined) data.desired_interval = input.interval_minutes
  if (input.full_requested !== undefined) data.full_requested = input.full_requested
  if (agent) await aronium.updateAroniumAgents({ id: agent.id, ...data })
  else await aronium.createAroniumAgents(data)
  return getAroniumStatus(container, { limit: 1 })
}

/** Panel → "Tomar de Aronium": la próxima pasada vuelve a copiar todo el contenido. */
export async function requestProductResync(container: MedusaContainer, productId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)
  const { data } = await query.graph({ entity: 'product', fields: ['id', 'metadata', 'variants.sku'], filters: { id: productId } })
  const product = data[0]
  if (!product) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No existe el producto ${productId}`)
  const codes = (product.variants ?? []).map((v: { sku?: string | null }) => v?.sku).filter((s): s is string => Boolean(s))
  if (!codes.length) throw new MedusaError(MedusaError.Types.INVALID_DATA, 'El producto no tiene código de Aronium (SKU).')

  await updateProductsWorkflow(container).run({
    input: { products: [{ id: productId, metadata: { ...(product.metadata ?? {}), aronium_resync: true } }] },
  })
  await requestCodesRefresh(container, codes)
  return { codes }
}

/** Lo que muestra el panel: estado del agente, productos para completar e historial. */
export async function getAroniumStatus(container: MedusaContainer, { limit = 20, offset = 0 } = {}) {
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const [agent] = await aronium.listAroniumAgents({}, { take: 1 })
  const [runs, runsCount] = await aronium.listAndCountAroniumRuns(
    {},
    { relations: ['changes'], order: { created_at: 'DESC' }, take: limit, skip: offset }
  )

  // Borradores creados por el conector, para que los completen y publiquen.
  const { data: drafts } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'title',
      'thumbnail',
      'created_at',
      'metadata',
      'collection_id',
      'type.value',
      'variants.inventory_items.inventory.location_levels.stocked_quantity',
    ],
    filters: { status: ProductStatus.DRAFT },
  })

  const aroniumDrafts = drafts.filter((p) => p.metadata?.aronium_code)
  // Qué borradores tienen categoría, leído desde las categorías: pedir
  // categories.id de miles de productos tarda segundos.
  const { data: categoryRows } = await query.graph({ entity: 'product_category', fields: ['id', 'products.id'] })
  const categorized = new Set(categoryRows.flatMap((c) => (c.products ?? []).map((p) => p?.id)))

  // Pedidos web que esperan algo: el aviso del panel.
  const web_sale_alerts = await webSaleAlerts(container)

  return {
    web_sale_alerts,
    agent: agent
      ? {
          ...agent,
          known_codes: undefined,
          refresh_codes: undefined,
          token_hash: undefined,
          has_token: Boolean(agent.token_hash),
        }
      : null,
    // Con todo el catálogo de Aronium son miles: el panel muestra los primeros
    // DRAFTS_SHOWN, con stock primero (los que conviene publicar ya).
    drafts_count: aroniumDrafts.length,
    drafts_in_stock: aroniumDrafts.filter((p) => draftStock(p) > 0).length,
    drafts: aroniumDrafts
      .sort((a, b) => Number(draftStock(b) > 0) - Number(draftStock(a) > 0) || String(a.title).localeCompare(String(b.title)))
      .slice(0, DRAFTS_SHOWN)
      .map((p) => ({
        id: p.id,
        title: p.title,
        code: String(p.metadata!.aronium_code),
        has_image: Boolean(p.thumbnail),
        stock: draftStock(p),
        created_at: p.created_at,
        // Lo que falta para publicarlo bien (el catálogo filtra por esto).
        missing: [
          !categorized.has(p.id) && 'categoría',
          !p.collection_id && 'marca',
          !p.type && 'tipo',
          // El color no aplica a perfumes ni decants.
          !p.metadata?.color && !NO_COLOR_TYPES.has(p.type?.value ?? '') && 'color',
          !p.thumbnail && 'foto',
        ].filter((x): x is string => Boolean(x)),
      })),
    // La primera pasada con todo el catálogo trae miles de altas: se mandan
    // las primeras CHANGES_SHOWN de cada pasada (el resumen usa los totales).
    runs: runs.map((run) => {
      const changes = [...(run.changes ?? [])].sort((a, b) => (CHANGE_ORDER[a.field] ?? 9) - (CHANGE_ORDER[b.field] ?? 9) || String(a.code).localeCompare(String(b.code)))
      return {
        ...run,
        changes: changes.slice(0, CHANGES_SHOWN),
        changes_total: changes.length,
        content_updated: changes.filter((c) => c.field === 'content').length,
      }
    }),
    runs_count: runsCount,
  }
}

async function touchAgent(
  aronium: AroniumModuleService,
  agent: z.infer<typeof agentSchema>,
  {
    error,
    productsTotal,
    knownCodes,
    clearRefresh,
    clearFullRequest,
  }: { error?: string; productsTotal?: number; knownCodes?: string[]; clearRefresh?: boolean; clearFullRequest?: boolean }
) {
  const now = new Date()
  const data = {
    last_seen_at: now,
    version: agent.version ?? null,
    host: agent.host ?? null,
    interval_minutes: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(agent.interval_minutes ?? MIN_INTERVAL))),
    // Si el agente puede registrar ventas web en esta base de Aronium (agente 0.5+).
    ...(agent.write_enabled !== undefined && agent.write_enabled !== null
      ? { write_enabled: agent.write_enabled, write_blocked_reason: agent.write_enabled ? null : (agent.write_blocked_reason ?? null) }
      : {}),
    ...(productsTotal !== undefined ? { products_total: productsTotal } : {}),
    ...(knownCodes ? { known_codes: { codes: knownCodes } } : {}),
    ...(clearRefresh ? { refresh_codes: null } : {}),
    ...(clearFullRequest ? { full_requested: false } : {}),
    ...(error ? { last_error: error, last_error_at: now } : { last_error: null }),
  }
  const [existing] = await aronium.listAroniumAgents({}, { take: 1 })
  if (existing) await aronium.updateAroniumAgents({ id: existing.id, ...data })
  else await aronium.createAroniumAgents(data)
}

async function recordRun(
  aronium: AroniumModuleService,
  changes: ChangeInput[],
  extra: { items_received: number; duration_ms: number }
) {
  const count = (field: ChangeInput['field']) => changes.filter((c) => c.field === field).length
  const run = await aronium.createAroniumRuns({
    status: 'ok',
    ...extra,
    prices_updated: count('price'),
    stock_updated: count('stock'),
    created: count('created'),
    removed: count('removed'),
    images_added: count('image'),
  })
  await aronium.createAroniumChanges(changes.map((c) => ({ ...c, run_id: run.id })))
}

async function findVariants(container: MedusaContainer, skus: string[]): Promise<VariantRow[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const rows: VariantRow[] = []
  for (let i = 0; i < skus.length; i += SKU_CHUNK) {
    const { data } = await query.graph({
      entity: 'product_variant',
      fields: [
        'id',
        'sku',
        'barcode',
        'product.id',
        'product.title',
        'product.status',
        'product.description',
        'product.thumbnail',
        'product.metadata',
        'product.images.url',
        'product.type.value',
        'product.variants.id',
        'price_set.prices.amount',
        'price_set.prices.currency_code',
        'price_set.prices.price_list_id',
        'inventory_items.inventory_item_id',
        'inventory_items.inventory.location_levels.id',
        'inventory_items.inventory.location_levels.location_id',
        'inventory_items.inventory.location_levels.stocked_quantity',
        'inventory_items.inventory.location_levels.reserved_quantity',
      ],
      filters: { sku: skus.slice(i, i + SKU_CHUNK) },
    })
    rows.push(...(data as unknown as VariantRow[]))
  }
  return rows
}

async function createDraftProducts(container: MedusaContainer, items: AroniumItem[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: salesChannels } = await query.graph({ entity: 'sales_channel', fields: ['id'] })
  const { data: shippingProfiles } = await query.graph({ entity: 'shipping_profile', fields: ['id'] })
  const { data: categories } = await query.graph({ entity: 'product_category', fields: ['id', 'name'] })
  const { data: collections } = await query.graph({ entity: 'product_collection', fields: ['id', 'title'] })
  const { data: types } = await query.graph({ entity: 'product_type', fields: ['id', 'value'] })
  const categoryId = new Map(categories.map((c) => [c.name, c.id]))
  const brandId = new Map(collections.map((c) => [c.title, c.id]))
  const typeId = new Map(types.map((t) => [t.value, t.id]))

  const handles = await uniqueHandles(container, items)

  await createProductsWorkflow(container).run({
    input: {
      products: items.map((item) => {
        // Categoría (por el grupo de Aronium), marca y tipo (por el nombre):
        // lib/aronium-classify.ts. Descripción, color, malla y características:
        // lib/aronium-content.ts. Lo que no se deduce queda para el panel.
        const found = classify(item, [...categoryId.keys()], [...brandId.keys()])
        const category = found.category ? categoryId.get(found.category) : undefined
        const extra = found.extraCategories.map((c) => categoryId.get(c)).filter((id): id is string => Boolean(id))
        const values = toMetadataValues(parseAroniumContent(item.name, item.description))
        if (found.type && NO_COLOR_TYPES.has(found.type)) values.color = ''
        const barcode = item.barcodes?.find((b) => b.trim())?.trim() ?? ''
        const synced: Synced = { ...values, ...(item.barcodes ? { barcode } : {}) }
        return {
          title: item.name,
          handle: handles.get(item.code)!,
          description: values.description || undefined,
          status: ProductStatus.DRAFT,
          category_ids: category ? [category, ...extra] : [],
          collection_id: found.brand ? brandId.get(found.brand) : undefined,
          type_id: found.type ? typeId.get(found.type) : undefined,
          shipping_profile_id: shippingProfiles[0]?.id,
          metadata: {
            aronium_code: item.code,
            ...(item.group ? { aronium_group: item.group } : {}),
            ...(values.color ? { color: values.color } : {}),
            ...(values.malla ? { malla: values.malla } : {}),
            ...(values.specs ? { specs: values.specs } : {}),
            aronium_synced: synced,
          },
          options: [{ title: 'Modelo', values: ['Único'] }],
          variants: [
            {
              title: 'Único',
              sku: item.code,
              ...(barcode ? { barcode } : {}),
              manage_inventory: true,
              options: { Modelo: 'Único' },
              prices: [{ currency_code: CURRENCY, amount: item.price }],
            },
          ],
          sales_channels: salesChannels[0] ? [{ id: salesChannels[0].id }] : [],
        }
      }),
    },
  })

  const variants = await findVariants(container, items.map((i) => i.code))
  return items.flatMap((item) => {
    const variant = variants.find((v) => v.sku === item.code)
    if (!variant?.product) return []
    return [
      {
        code: item.code,
        product_id: variant.product.id,
        title: variant.product.title,
        stock: Math.max(0, Math.floor(item.stock)),
        image_hash: item.image_hash ?? null,
        inventory_item_id: variant.inventory_items?.[0]?.inventory_item_id,
      },
    ]
  })
}

async function uniqueHandles(container: MedusaContainer, items: AroniumItem[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const wanted = items.map((i) => [i.code, slugify(`${i.name}-${i.code}`) || `producto-${slugify(i.code)}`] as const)
  const { data } = await query.graph({ entity: 'product', fields: ['handle'], filters: { handle: wanted.map(([, h]) => h) } })
  const taken = new Set(data.map((p) => p.handle))
  const handles = new Map<string, string>()
  for (const [code, handle] of wanted) {
    let candidate = handle
    for (let n = 2; taken.has(candidate); n++) candidate = `${handle}-${n}`
    taken.add(candidate)
    handles.set(code, candidate)
  }
  return handles
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

export const MAX_CREATE_PER_PASS = 250
const DRAFTS_SHOWN = 100
const CHANGES_SHOWN = 200
const CHANGE_ORDER: Record<string, number> = { created: 0, published: 1, hidden: 2, removed: 3, price: 4, stock: 5, image: 6, content: 7 }

function draftStock(p: { variants?: unknown }): number {
  let total = 0
  type Variant = { inventory_items?: { inventory?: { location_levels?: { stocked_quantity?: unknown }[] | null } | null }[] | null }
  for (const v of (p.variants ?? []) as Variant[]) for (const ii of v.inventory_items ?? []) for (const l of ii.inventory?.location_levels ?? []) total += Number(l.stocked_quantity) || 0
  return total
}

function slugify(text: string) {
  // Cortar después de limpiar los guiones de las puntas dejaba un guion al final
  // ("…-ltp-v007d-"), que Medusa rechaza.
  return normalize(text).replace(/[^a-z0-9]+/g, '-').slice(0, 80).replace(/^-+|-+$/g, '')
}
