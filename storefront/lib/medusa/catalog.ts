import type { HttpTypes } from '@medusajs/types'
import { sdk } from './client'
import { getContent } from './content'
import { FEATURED_TAG, listProducts, listProductsByIds } from './products'

// Categorías, marcas (colecciones) y tags: cambian poco, se cachean más.
const REVALIDATE_SECONDS = 300

export interface UiCategory {
  id: string
  name: string
  handle: string
}

export interface UiBrand {
  id: string
  title: string
  handle: string
}

export async function listCategories(): Promise<UiCategory[]> {
  try {
    const { product_categories } = await sdk.client.fetch<HttpTypes.StoreProductCategoryListResponse>(
      '/store/product-categories',
      {
        query: { limit: 100, fields: 'id,name,handle,rank', order: 'rank' },
        next: { revalidate: REVALIDATE_SECONDS },
      },
    )
    return product_categories.map((c) => ({ id: c.id, name: c.name, handle: c.handle }))
  } catch (err) {
    console.error('[medusa] no se pudieron obtener las categorías', err)
    return []
  }
}

export async function listBrands(): Promise<UiBrand[]> {
  try {
    const { collections } = await sdk.client.fetch<HttpTypes.StoreCollectionListResponse>('/store/collections', {
      query: { limit: 200, fields: 'id,title,handle', order: 'title' },
      next: { revalidate: REVALIDATE_SECONDS },
    })
    return collections.map((c) => ({ id: c.id, title: c.title, handle: c.handle }))
  } catch (err) {
    console.error('[medusa] no se pudieron obtener las marcas', err)
    return []
  }
}

async function getTagId(value: string): Promise<string | null> {
  try {
    const { product_tags } = await sdk.client.fetch<{ product_tags: { id: string; value: string }[] }>(
      '/store/product-tags',
      { query: { value, fields: 'id,value' }, next: { revalidate: REVALIDATE_SECONDS } },
    )
    return product_tags.find((tag) => tag.value === value)?.id ?? null
  } catch (err) {
    console.error('[medusa] no se pudo obtener el tag', value, err)
    return null
  }
}

export const MAX_FEATURED = 8

/** Destacados de la portada: los elegidos en el panel → Portada (hasta 8). Si
 *  esa lista nunca se guardó, los productos con el tag "destacado". */
export async function listFeaturedProducts(limit = MAX_FEATURED) {
  const content = await getContent('portada-destacados')
  if (content?.configured) return listProductsByIds(content.data.product_ids.slice(0, limit))
  const tagId = await getTagId(FEATURED_TAG)
  if (!tagId) return []
  const { products } = await listProducts({ tagId, limit })
  return products
}

/** Combos de la sección "Perfumes y decants": los elegidos en el panel →
 *  Portada. Si la sección nunca se guardó, los productos que se llaman "Combo…". */
export async function listCombos(configured: boolean, ids: string[]) {
  if (configured) return listProductsByIds(ids)
  const { products } = await listProducts({ q: 'combo', limit: 12, order: 'title' })
  return products.filter((p) => /\bcombo\b/i.test(p.title))
}
