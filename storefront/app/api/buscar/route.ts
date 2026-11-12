import type { NextRequest } from 'next/server'
import { listProductsByIds } from '@/lib/medusa/products'
import { DEFAULT_SORT, searchCatalog } from '@/lib/medusa/search'

// GET /api/buscar?q=…: primeros resultados para el buscador del encabezado.
// Usa la misma búsqueda del catálogo (tolerante a errores, por marca, modelo
// o referencia).

const LIMIT = 6

export interface SearchSuggestion {
  slug: string
  brand: string | null
  model: string
  price: number
  originalPrice: number | null
  currency: string
  image: string | null
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100)
  if (q.length < 2) return Response.json({ count: 0, products: [] })

  const result = await searchCatalog({ q, facets: {}, sort: DEFAULT_SORT, limit: LIMIT, offset: 0 })
  const products = await listProductsByIds(result.ids)
  const suggestions: SearchSuggestion[] = products.map((p) => ({
    slug: p.slug,
    brand: p.brand,
    model: p.model,
    price: p.price,
    originalPrice: p.originalPrice,
    currency: p.currency,
    image: p.images[0] ?? null,
  }))
  return Response.json(
    { count: result.count, products: suggestions, failed: result.failed },
    { headers: { 'cache-control': 'public, max-age=60' } },
  )
}
