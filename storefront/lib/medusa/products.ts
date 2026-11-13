import type { HttpTypes } from '@medusajs/types'
import { sdk } from './client'
import { getRegion } from './region'

// Traduce los productos de Medusa al modelo que usa la UI, para que los
// componentes no dependan de Medusa.
//
// Cómo se cargan los datos en el admin (ver también README):
// - Marca            → colección del producto.
// - Categoría        → categorías del producto.
// - Referencia       → SKU de la variante.
// - Características  → metadata `specs`, separadas por " | ".
// - Destacado        → panel → Portada (o tag `destacado` si nunca se guardó).
// - Oferta           → lista de precios de tipo "sale" (se muestra el precio normal tachado).
// - Variantes: opción "Color" → selector de color (hex opcional en la
//   metadata de la variante, `color_hex`); cualquier otra opción con más de
//   un valor → selector de opción.

const REVALIDATE_SECONDS = 60
export const FEATURED_TAG = 'destacado'

const PRODUCT_FIELDS = [
  '*variants.calculated_price',
  '+variants.inventory_quantity',
  '+variants.manage_inventory',
  '+variants.allow_backorder',
  '+variants.metadata',
  '*variants.options',
  '*images',
  '*collection',
  '*categories',
  '*tags',
  '+metadata',
].join(',')

// Sin control de stock (o con venta sin stock), se permite este máximo por
// línea del carrito.
const UNLIMITED_STOCK = 99

export interface UiVariant {
  id: string
  title: string
  sku: string | null
  color: string | null
  colorHex: string | null
  size: string | null
  price: number
  originalPrice: number | null
  stock: number
  /** Sin control de stock en el admin: siempre disponible, sin cantidad que mostrar. */
  unlimitedStock: boolean
}

export interface UiProduct {
  id: string
  slug: string
  title: string
  // Nombre completo ("Tissot PRX") y modelo sin la marca ("PRX"). En el admin
  // el título puede llevar la marca o no; la tienda arma los dos.
  name: string
  model: string
  brand: string | null
  brandHandle: string | null
  ref: string | null
  description: string | null
  price: number
  originalPrice: number | null
  currency: string
  specs: string[]
  categories: { name: string; handle: string }[]
  featured: boolean
  images: string[]
  sizeChartImage: string | null
  sizeChartText: string | null
  variants: UiVariant[]
}

const COLOR_OPTION = /^(color|colour)$/i

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseSpecs(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  const s = str(value)
  return s ? s.split('|').map((x) => x.trim()).filter(Boolean) : []
}

function toUiVariant(variant: HttpTypes.StoreProductVariant): UiVariant {
  let color: string | null = null
  let size: string | null = null
  for (const ov of variant.options ?? []) {
    const title = ov.option?.title ?? ''
    if (COLOR_OPTION.test(title)) color = ov.value
    else if (size === null) size = ov.value
  }

  const cp = variant.calculated_price
  const price = cp?.calculated_amount ?? 0
  const original = cp?.original_amount ?? null
  const unlimited = !variant.manage_inventory || variant.allow_backorder

  return {
    id: variant.id,
    title: variant.title ?? '',
    sku: variant.sku ?? null,
    color,
    colorHex: str(variant.metadata?.color_hex),
    size,
    price,
    originalPrice: original !== null && original > price ? original : null,
    stock: unlimited ? UNLIMITED_STOCK : Math.max(0, variant.inventory_quantity ?? 0),
    unlimitedStock: Boolean(unlimited),
  }
}

function toUiProduct(product: HttpTypes.StoreProduct, fallbackCurrency: string): UiProduct {
  const variants = (product.variants ?? []).map(toUiVariant)

  // Si una opción tiene un solo valor (ej. "Modelo: Único"), no es una
  // elección real: no se muestra selector.
  const distinctSizes = new Set(variants.map((v) => v.size).filter(Boolean))
  if (distinctSizes.size <= 1) variants.forEach((v) => (v.size = null))

  const cheapest = variants.reduce<UiVariant | null>((min, v) => (!min || v.price < min.price ? v : min), null)
  const currency =
    product.variants?.find((v) => v.calculated_price?.currency_code)?.calculated_price?.currency_code ??
    fallbackCurrency

  const images = (product.images ?? []).map((img) => img.url)
  if (images.length === 0 && product.thumbnail) images.push(product.thumbnail)

  const brandTitle = product.collection?.title ?? null
  const hasBrandPrefix = !!brandTitle && product.title.toLowerCase().startsWith(`${brandTitle.toLowerCase()} `)

  return {
    id: product.id,
    slug: product.handle,
    title: product.title,
    name: brandTitle && !hasBrandPrefix ? `${brandTitle} ${product.title}` : product.title,
    model: hasBrandPrefix ? product.title.slice(brandTitle!.length + 1) : product.title,
    brand: brandTitle,
    brandHandle: product.collection?.handle ?? null,
    ref: str(product.metadata?.ref) ?? (variants.length === 1 ? variants[0].sku : null),
    description: product.description ?? null,
    price: cheapest?.price ?? 0,
    originalPrice: cheapest?.originalPrice ?? null,
    currency: currency.toUpperCase(),
    specs: parseSpecs(product.metadata?.specs),
    categories: (product.categories ?? []).map((c) => ({ name: c.name, handle: c.handle })),
    featured: (product.tags ?? []).some((tag) => tag.value === FEATURED_TAG),
    images,
    sizeChartImage: str(product.metadata?.size_chart_image),
    sizeChartText: str(product.metadata?.size_chart_text),
    variants,
  }
}

export interface ProductQuery {
  ids?: string[]
  q?: string
  categoryId?: string
  collectionId?: string
  tagId?: string
  handle?: string
  order?: string
  limit?: number
  offset?: number
}

export interface ProductPage {
  products: UiProduct[]
  count: number
}

export async function listProducts(params: ProductQuery = {}): Promise<ProductPage> {
  const region = await getRegion()
  if (!region) return { products: [], count: 0 }

  const query: Record<string, unknown> = {
    region_id: region.id,
    fields: PRODUCT_FIELDS,
    limit: params.limit ?? 24,
    offset: params.offset ?? 0,
    order: params.order ?? '-created_at',
  }
  if (params.ids) query.id = params.ids
  if (params.q) query.q = params.q
  if (params.categoryId) query.category_id = params.categoryId
  if (params.collectionId) query.collection_id = params.collectionId
  if (params.tagId) query.tag_id = params.tagId
  if (params.handle) query.handle = params.handle

  try {
    const { products, count } = await sdk.client.fetch<HttpTypes.StoreProductListResponse>('/store/products', {
      query,
      next: { revalidate: REVALIDATE_SECONDS },
    })
    return { products: products.map((p) => toUiProduct(p, region.currency_code)), count }
  } catch (err) {
    console.error('[medusa] no se pudieron obtener los productos', err)
    return { products: [], count: 0 }
  }
}

/** Los productos con esos ids, en el mismo orden (el que dio la búsqueda). */
export async function listProductsByIds(ids: string[]): Promise<UiProduct[]> {
  if (!ids.length) return []
  const { products } = await listProducts({ ids, limit: ids.length })
  const byId = new Map(products.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is UiProduct => Boolean(p))
}

export async function getProductBySlug(slug: string): Promise<UiProduct | null> {
  const { products } = await listProducts({ handle: slug, limit: 1 })
  return products[0] ?? null
}

