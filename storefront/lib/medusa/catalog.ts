import type { HttpTypes } from '@medusajs/types'
import { sdk } from './client'
import { FEATURED_TAG, listProducts } from './products'

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

export async function listFeaturedProducts(limit = 24) {
  const tagId = await getTagId(FEATURED_TAG)
  if (!tagId) return []
  const { products } = await listProducts({ tagId, limit })
  return products
}

export async function listProductsInCategory(name: string, limit = 12) {
  const category = (await listCategories()).find((c) => c.name === name)
  if (!category) return []
  const { products } = await listProducts({ categoryId: category.id, limit, order: 'title' })
  return products
}
