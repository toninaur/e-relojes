import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys, MedusaError, ProductStatus } from '@medusajs/framework/utils'
import {
  batchInventoryItemLevelsWorkflow,
  createProductsWorkflow,
  updateProductVariantsWorkflow,
  uploadFilesWorkflow,
} from '@medusajs/medusa/core-flows'
import { z } from 'zod'

// Sincronización con Aronium (el sistema de caja del local).
//
// El conector que corre en la computadora del local manda los productos de
// Aronium que cambiaron. Un producto de Aronium es una variante de la tienda,
// unidas por el código: `Product.Code` de Aronium = SKU de la variante.
//
// - Variante existente: Aronium manda en el precio normal y el stock. El resto
//   (título, fotos, descripción, filtros, ofertas) se maneja en el panel y no
//   se toca.
// - Código que no existe en la tienda: se crea un producto en borrador, con
//   nombre, descripción y foto de Aronium (si tiene), para que lo completen y
//   lo publiquen desde el panel.
//
// El stock de Aronium va a `stocked_quantity` del local. Los pedidos online sin
// entregar quedan como reserva, así que lo disponible en la tienda es el stock
// de Aronium menos lo ya vendido online.

const CURRENCY = 'pyg'

export const aroniumItemSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  price: z.number().nonnegative(),
  stock: z.number(),
  // Desactivado en Aronium: llega con stock 0 y, si no existe en la tienda, no se crea.
  enabled: z.boolean().default(true),
  group: z.string().nullish(),
  image: z
    .object({ base64: z.string().min(1), mimeType: z.string().default('image/jpeg') })
    .nullish(),
})

export const aroniumSyncSchema = z.object({
  items: z.array(aroniumItemSchema).max(200),
})

export type AroniumItem = z.infer<typeof aroniumItemSchema>

export type AroniumSyncResult = {
  prices_updated: string[]
  stock_updated: string[]
  created: string[]
  unchanged: number
}

type VariantRow = {
  id: string
  sku: string | null
  price_set?: { prices?: { amount: number; currency_code: string; price_list_id?: string | null }[] } | null
  inventory_items?: {
    inventory_item_id: string
    inventory?: { location_levels?: { id: string; location_id: string; stocked_quantity: number }[] } | null
  }[] | null
}

export async function syncAroniumItems(container: MedusaContainer, input: AroniumItem[]): Promise<AroniumSyncResult> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const result: AroniumSyncResult = { prices_updated: [], stock_updated: [], created: [], unchanged: 0 }

  // El mismo código dos veces en un lote: vale el último.
  const items = [...new Map(input.map((i) => [i.code, i])).values()]
  if (!items.length) return result

  const { data: stockLocations } = await query.graph({ entity: 'stock_location', fields: ['id'] })
  const locationId = stockLocations[0]?.id
  if (!locationId) throw new MedusaError(MedusaError.Types.NOT_FOUND, 'La tienda no tiene un local de stock.')

  const variants = (await findVariants(container, items.map((i) => i.code))) as VariantRow[]
  const bySku = new Map(variants.map((v) => [v.sku!, v]))

  // ---- Variantes existentes: precio y stock ---------------------------------
  const priceUpdates: { id: string; prices: { currency_code: string; amount: number }[] }[] = []
  const levelCreates: { inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []
  const levelUpdates: { id: string; inventory_item_id: string; location_id: string; stocked_quantity: number }[] = []

  for (const item of items) {
    const variant = bySku.get(item.code)
    if (!variant) continue
    const stock = Math.max(0, Math.floor(item.stock))
    let changed = false

    const base = variant.price_set?.prices?.find((p) => !p.price_list_id && p.currency_code === CURRENCY)
    if (!base || Number(base.amount) !== item.price) {
      priceUpdates.push({ id: variant.id, prices: [{ currency_code: CURRENCY, amount: item.price }] })
      result.prices_updated.push(item.code)
      changed = true
    }

    // Una variante con un solo artículo de inventario (lo normal en la tienda).
    const inventoryItem = variant.inventory_items?.[0]
    if (inventoryItem) {
      const level = inventoryItem.inventory?.location_levels?.find((l) => l.location_id === locationId)
      if (!level) {
        levelCreates.push({ inventory_item_id: inventoryItem.inventory_item_id, location_id: locationId, stocked_quantity: stock })
      } else if (Number(level.stocked_quantity) !== stock) {
        levelUpdates.push({ id: level.id, inventory_item_id: inventoryItem.inventory_item_id, location_id: locationId, stocked_quantity: stock })
      }
      if (!level || Number(level.stocked_quantity) !== stock) {
        result.stock_updated.push(item.code)
        changed = true
      }
    }

    if (!changed) result.unchanged++
  }

  if (priceUpdates.length) {
    // Solo reemplaza los precios base: los de la lista "Ofertas" no se tocan.
    await updateProductVariantsWorkflow(container).run({ input: { product_variants: priceUpdates } })
  }

  // ---- Códigos nuevos: producto en borrador --------------------------------
  const missing = items.filter((i) => !bySku.has(i.code) && i.enabled)
  if (missing.length) {
    const created = await createDraftProducts(container, missing)
    result.created.push(...created.map((c) => c.code))
    for (const c of created) {
      if (c.inventory_item_id) {
        levelCreates.push({ inventory_item_id: c.inventory_item_id, location_id: locationId, stocked_quantity: c.stock })
      }
    }
  }

  if (levelCreates.length || levelUpdates.length) {
    await batchInventoryItemLevelsWorkflow(container).run({ input: { create: levelCreates, update: levelUpdates, delete: [] } })
  }

  return result
}

async function findVariants(container: MedusaContainer, skus: string[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product_variant',
    fields: [
      'id',
      'sku',
      'price_set.prices.amount',
      'price_set.prices.currency_code',
      'price_set.prices.price_list_id',
      'inventory_items.inventory_item_id',
      'inventory_items.inventory.location_levels.id',
      'inventory_items.inventory.location_levels.location_id',
      'inventory_items.inventory.location_levels.stocked_quantity',
    ],
    filters: { sku: skus },
  })
  return data
}

async function createDraftProducts(container: MedusaContainer, items: AroniumItem[]) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: salesChannels } = await query.graph({ entity: 'sales_channel', fields: ['id'] })
  const { data: shippingProfiles } = await query.graph({ entity: 'shipping_profile', fields: ['id'] })
  const { data: categories } = await query.graph({ entity: 'product_category', fields: ['id', 'name'] })
  const categoryByName = new Map(categories.map((c) => [normalize(c.name), c.id]))

  const handles = await uniqueHandles(container, items)
  const images = await uploadImages(container, items)

  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: items.map((item) => {
        const categoryId = item.group ? categoryByName.get(normalize(item.group)) : undefined
        const image = images.get(item.code)
        return {
          title: item.name,
          handle: handles.get(item.code)!,
          description: item.description ?? undefined,
          status: ProductStatus.DRAFT,
          category_ids: categoryId ? [categoryId] : [],
          shipping_profile_id: shippingProfiles[0]?.id,
          images: image ? [{ url: image }] : [],
          thumbnail: image,
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

  const variants = (await findVariants(container, items.map((i) => i.code))) as VariantRow[]
  return items
    .filter((item) => products.some((p) => p.handle === handles.get(item.code)))
    .map((item) => ({
      code: item.code,
      stock: Math.max(0, Math.floor(item.stock)),
      inventory_item_id: variants.find((v) => v.sku === item.code)?.inventory_items?.[0]?.inventory_item_id,
    }))
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

async function uploadImages(container: MedusaContainer, items: AroniumItem[]) {
  const withImage = items.filter((i) => i.image)
  const urls = new Map<string, string>()
  if (!withImage.length) return urls
  const { result } = await uploadFilesWorkflow(container).run({
    input: {
      files: withImage.map((i) => ({
        filename: `aronium-${slugify(i.code)}.${i.image!.mimeType === 'image/png' ? 'png' : 'jpg'}`,
        mimeType: i.image!.mimeType,
        content: i.image!.base64,
        access: 'public' as const,
      })),
    },
  })
  withImage.forEach((item, index) => {
    if (result[index]?.url) urls.set(item.code, result[index].url)
  })
  return urls
}

function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

function slugify(text: string) {
  return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
