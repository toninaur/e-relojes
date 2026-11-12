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
import type AroniumModuleService from '../modules/aronium/service'

// Sincronización con Aronium (el sistema de caja del local).
//
// El agente de la PC del local solo lee Aronium y manda el catálogo entero en
// cada pasada. Acá se compara con la tienda y se aplica. Un producto de
// Aronium es una variante de la tienda, unidas por el código: `Product.Code`
// de Aronium = SKU de la variante.
//
// - Variante existente: Aronium manda en el precio normal y el stock. Título,
//   fotos, descripción, filtros y ofertas se manejan en el panel.
// - Código nuevo: producto en borrador con nombre, descripción y categoría. La
//   foto se le pide después al agente (`images_wanted`), para no mandar fotos
//   en cada pasada.
//
// El stock de Aronium va a `stocked_quantity` del local. Lo vendido online sin
// entregar queda como reserva, así que lo disponible en la tienda es el stock
// de Aronium menos esas reservas.
//
// Cada pasada que cambia algo (o que falla) queda en el historial que muestra
// el panel (admin → Aronium).

const CURRENCY = 'pyg'
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
})

const agentSchema = z.object({
  version: z.string().nullish(),
  host: z.string().nullish(),
})

export const aroniumSyncSchema = z.object({
  agent: agentSchema.default({}),
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
  field: 'price' | 'stock' | 'created' | 'image'
  old_value?: string | null
  new_value?: string | null
}

type VariantRow = {
  id: string
  sku: string | null
  product?: { id: string; title: string; status: string; thumbnail?: string | null; metadata?: Record<string, unknown> | null } | null
  price_set?: { prices?: { amount: number; currency_code: string; price_list_id?: string | null }[] } | null
  inventory_items?: {
    inventory_item_id: string
    inventory?: { location_levels?: { id: string; location_id: string; stocked_quantity: number }[] } | null
  }[] | null
}

export async function syncAroniumSnapshot(container: MedusaContainer, input: z.infer<typeof aroniumSyncSchema>) {
  const started = Date.now()
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)

  if (input.error) {
    await touchAgent(aronium, input.agent, { error: input.error })
    // El mismo error en cada pasada se anota una sola vez en el historial.
    const [last] = await aronium.listAroniumRuns({}, { order: { created_at: 'DESC' }, take: 1 })
    if (last?.status !== 'error' || last.error !== input.error) {
      await aronium.createAroniumRuns({ status: 'error', error: input.error, duration_ms: Date.now() - started })
    }
    return { prices_updated: 0, stock_updated: 0, created: 0, unchanged: 0, images_wanted: [] as string[] }
  }

  try {
    const outcome = await applySnapshot(container, input.items)
    await touchAgent(aronium, input.agent, { productsTotal: input.items.length })
    if (outcome.changes.length) {
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
      unchanged: outcome.unchanged,
      images_wanted: outcome.imagesWanted,
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

async function applySnapshot(container: MedusaContainer, input: AroniumItem[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const changes: ChangeInput[] = []
  let unchanged = 0

  // El mismo código dos veces: vale el último.
  const items = [...new Map(input.map((i) => [i.code, i])).values()]
  if (!items.length) return { changes, unchanged, imagesWanted: [] as string[] }

  const { data: stockLocations } = await query.graph({ entity: 'stock_location', fields: ['id'] })
  const locationId = stockLocations[0]?.id
  if (!locationId) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'La tienda no tiene un local de stock.')

  const variants = await findVariants(container, items.map((i) => i.code))
  const bySku = new Map(variants.map((v) => [v.sku!, v]))

  const priceUpdates: { id: string; prices: { currency_code: string; amount: number }[] }[] = []
  const levelCreates: { inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
  const levelUpdates: { id: string; inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
  const imagesWanted: string[] = []

  for (const item of items) {
    const variant = bySku.get(item.code)
    if (!variant) continue
    const product = { product_id: variant.product?.id, product_title: variant.product?.title }
    const stock = item.enabled ? Math.max(0, Math.floor(item.stock)) : 0
    let changed = false

    const base = variant.price_set?.prices?.find((p) => !p.price_list_id && p.currency_code === CURRENCY)
    if (!base || Number(base.amount) !== item.price) {
      priceUpdates.push({ id: variant.id, prices: [{ currency_code: CURRENCY, amount: item.price }] })
      changes.push({ code: item.code, ...product, field: 'price', old_value: base ? String(base.amount) : null, new_value: String(item.price) })
      changed = true
    }

    // Una variante con un solo artículo de inventario (lo normal en la tienda).
    const inventoryItem = variant.inventory_items?.[0]
    if (inventoryItem) {
      const level = inventoryItem.inventory?.location_levels?.find((l) => l.location_id === locationId)
      const current = level ? Number(level.stocked_quantity) : null
      if (current !== stock) {
        if (level) levelUpdates.push({ id: level.id, inventory_item_id: inventoryItem.inventory_item_id, location_id: locationId, stocked_quantity: stock })
        else levelCreates.push({ inventory_item_id: inventoryItem.inventory_item_id, location_id: locationId, stocked_quantity: stock })
        changes.push({ code: item.code, ...product, field: 'stock', old_value: current === null ? null : String(current), new_value: String(stock) })
        changed = true
      }
    }

    // Foto de Aronium solo para los productos que creó el conector y siguen sin foto.
    if (item.image_hash && variant.product && !variant.product.thumbnail && variant.product.metadata?.aronium_code) {
      imagesWanted.push(item.code)
    }

    if (!changed) unchanged++
  }

  if (priceUpdates.length) {
    // Reemplaza solo los precios base: los de la lista "Ofertas" no se tocan.
    await updateProductVariantsWorkflow(container).run({ input: { product_variants: priceUpdates } })
  }

  const missing = items.filter((i) => !bySku.has(i.code) && i.enabled)
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

  return { changes, unchanged, imagesWanted }
}

/** Fotos que pidió la tienda: se suben y se asignan a productos sin foto. */
export async function attachAroniumImages(container: MedusaContainer, input: z.infer<typeof aroniumImagesSchema>) {
  const started = Date.now()
  const aronium: AroniumModuleService = container.resolve(ARONIUM_MODULE)
  const variants = await findVariants(container, input.items.map((i) => i.code))
  const targets = input.items.flatMap((item) => {
    const product = variants.find((v) => v.sku === item.code)?.product
    return product && !product.thumbnail ? [{ item, product }] : []
  })
  if (!targets.length) return { images_added: 0 }

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

  const updates = targets.flatMap(({ product }, index) => {
    const url = files[index]?.url
    return url ? [{ id: product.id, images: [{ url }], thumbnail: url }] : []
  })
  if (updates.length) {
    await updateProductsWorkflow(container).run({ input: { products: updates } })
    await recordRun(
      aronium,
      targets.slice(0, updates.length).map(({ item, product }) => ({
        code: item.code,
        product_id: product.id,
        product_title: product.title,
        field: 'image' as const,
      })),
      { items_received: input.items.length, duration_ms: Date.now() - started }
    )
  }
  return { images_added: updates.length }
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
    fields: ['id', 'title', 'thumbnail', 'created_at', 'metadata', 'variants.sku'],
    filters: { status: ProductStatus.DRAFT },
  })

  return {
    agent: agent ?? null,
    drafts: drafts
      .filter((p) => p.metadata?.aronium_code)
      .map((p) => ({
        id: p.id,
        title: p.title,
        code: String(p.metadata!.aronium_code),
        has_image: Boolean(p.thumbnail),
        created_at: p.created_at,
      })),
    runs,
    runs_count: runsCount,
  }
}

async function touchAgent(
  aronium: AroniumModuleService,
  agent: z.infer<typeof agentSchema>,
  { error, productsTotal }: { error?: string; productsTotal?: number }
) {
  const now = new Date()
  const data = {
    last_seen_at: now,
    version: agent.version ?? null,
    host: agent.host ?? null,
    ...(productsTotal !== undefined ? { products_total: productsTotal } : {}),
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
        'product.id',
        'product.title',
        'product.status',
        'product.thumbnail',
        'product.metadata',
        'price_set.prices.amount',
        'price_set.prices.currency_code',
        'price_set.prices.price_list_id',
        'inventory_items.inventory_item_id',
        'inventory_items.inventory.location_levels.id',
        'inventory_items.inventory.location_levels.location_id',
        'inventory_items.inventory.location_levels.stocked_quantity',
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
  const categoryByName = new Map(categories.map((c) => [normalize(c.name), c.id]))

  const handles = await uniqueHandles(container, items)

  await createProductsWorkflow(container).run({
    input: {
      products: items.map((item) => {
        const categoryId = item.group ? categoryByName.get(normalize(item.group)) : undefined
        return {
          title: item.name,
          handle: handles.get(item.code)!,
          description: item.description ?? undefined,
          status: ProductStatus.DRAFT,
          category_ids: categoryId ? [categoryId] : [],
          shipping_profile_id: shippingProfiles[0]?.id,
          metadata: { aronium_code: item.code, ...(item.group ? { aronium_group: item.group } : {}) },
          options: [{ title: 'Modelo', values: ['Único'] }],
          variants: [
            {
              title: 'Único',
              sku: item.code,
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

function slugify(text: string) {
  return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
