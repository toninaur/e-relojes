import type { MetadataRoute } from 'next'
import { absoluteUrl } from '@/lib/brand'
import { sdk } from '@/lib/medusa/client'
import { listBrands, listCategories } from '@/lib/medusa/catalog'
import { getContent } from '@/lib/medusa/content'
import { LEGAL_PAGES } from '@/components/legal/LegalPage'

// /sitemap.xml: las páginas que tiene que conocer Google. Se regenera cada hora.
export const revalidate = 3600

const PAGE = 200

async function listProductHandles(): Promise<{ handle: string; updated_at: string | null }[]> {
  const out: { handle: string; updated_at: string | null }[] = []
  try {
    for (let offset = 0; ; offset += PAGE) {
      const { products, count } = await sdk.client.fetch<{
        products: { handle: string; updated_at: string | null }[]
        count: number
      }>('/store/products', { query: { fields: 'handle,updated_at', limit: PAGE, offset }, next: { revalidate } })
      out.push(...products)
      if (offset + PAGE >= count) break
    }
  } catch (err) {
    console.error('[sitemap] no se pudieron obtener los productos', err)
  }
  return out
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, brands, legal] = await Promise.all([
    listProductHandles(),
    listCategories(),
    listBrands(),
    // Solo las páginas legales que tienen texto.
    Promise.all(LEGAL_PAGES.map(async (p) => ((await getContent(p.key))?.data.body.trim() ? p.path : null))),
  ])
  return [
    { url: absoluteUrl('/'), changeFrequency: 'daily', priority: 1 },
    { url: absoluteUrl('/catalogo'), changeFrequency: 'daily', priority: 0.9 },
    ...categories.map((c) => ({
      url: absoluteUrl(`/catalogo?categoria=${c.handle}`),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...brands.map((b) => ({
      url: absoluteUrl(`/catalogo?marca=${b.handle}`),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...legal
      .filter((path): path is string => Boolean(path))
      .map((path) => ({ url: absoluteUrl(path), changeFrequency: 'yearly' as const, priority: 0.2 })),
    ...products.map((p) => ({
      url: absoluteUrl(`/producto/${p.handle}`),
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]
}
