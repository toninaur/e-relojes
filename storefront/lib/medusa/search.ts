import { sdk } from './client'

// Búsqueda y filtros del catálogo sobre el índice `product` de Medusa
// (backend/src/search/product.ts). El índice devuelve ids, total y conteos por
// filtro (facetas); los productos se piden después a /store/products, que es
// lo que trae fotos, variantes, stock y precios con ofertas.

/** Campos del índice que se filtran como lista de valores. */
export const FACET_FIELDS = ['type', 'category', 'brand', 'color', 'strap'] as const
export type FacetField = (typeof FACET_FIELDS)[number]

// En el índice, category/color/strap son listas (un producto puede tener
// varios); type y brand, un solo valor.
const ARRAY_FIELDS = new Set<FacetField>(['category', 'color', 'strap'])

// Keep in sync with the backend's PRICE_CURRENCIES.
const PRICE_FIELD = 'min_price_pyg'
const ON_SALE_FIELD = 'on_sale_pyg'

export const SORTS = {
  nuevos: { label: 'Más nuevos', order: { created_at: 'DESC' } },
  'precio-asc': { label: 'Menor precio', order: { [PRICE_FIELD]: 'ASC' } },
  'precio-desc': { label: 'Mayor precio', order: { [PRICE_FIELD]: 'DESC' } },
  nombre: { label: 'Nombre (A-Z)', order: { title: 'ASC' } },
} as const
export type SortKey = keyof typeof SORTS
export const DEFAULT_SORT: SortKey = 'nuevos'

/** Franjas de precio del filtro (Gs.). `to` no incluido. */
export const PRICE_RANGES = [
  { key: 'hasta-1m', to: 1_000_000 },
  { key: '1m-2m', from: 1_000_000, to: 2_000_000 },
  { key: '2m-3_5m', from: 2_000_000, to: 3_500_000 },
  { key: 'mas-3_5m', from: 3_500_000 },
] as const

export interface CatalogSearch {
  q?: string
  facets: Partial<Record<FacetField, string[]>>
  priceMin?: number
  priceMax?: number
  onSale?: boolean
  sort: SortKey
  limit: number
  offset: number
}

export interface FacetValue {
  value: string
  count: number
}

export interface CatalogSearchResult {
  ids: string[]
  count: number
  facets: Record<FacetField, FacetValue[]>
  onSaleCount: number
  /** Productos por franja de PRICE_RANGES, por `key`. */
  priceCounts: Record<string, number>
  /** Falló la búsqueda (backend caído o índice sin cargar). */
  failed: boolean
}

type FacetResponse =
  | { type: 'value'; values: { value: string | boolean; count: number }[] }
  | { type: 'range'; ranges: { key: string; count: number }[] }

interface SearchResponse {
  results: {
    hits: { id: string }[]
    facets?: Record<string, FacetResponse>
    metadata: { count?: number }
  }[]
}

function emptyFacets(): Record<FacetField, FacetValue[]> {
  return Object.fromEntries(FACET_FIELDS.map((f) => [f, []])) as unknown as Record<FacetField, FacetValue[]>
}

function buildFilters(params: CatalogSearch) {
  const filters: Record<string, unknown> = {}
  if (params.q) filters.q = params.q
  for (const field of FACET_FIELDS) {
    const values = params.facets[field]
    if (!values?.length) continue
    filters[field] = ARRAY_FIELDS.has(field) ? { $overlaps: values } : { $in: values }
  }
  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    filters[PRICE_FIELD] = {
      ...(params.priceMin !== undefined ? { $gte: params.priceMin } : {}),
      ...(params.priceMax !== undefined ? { $lte: params.priceMax } : {}),
    }
  }
  if (params.onSale) filters[ON_SALE_FIELD] = true
  return filters
}

export async function searchCatalog(params: CatalogSearch): Promise<CatalogSearchResult> {
  try {
    const { results } = await sdk.client.fetch<SearchResponse>('/store/search', {
      method: 'POST',
      body: {
        entity: 'product',
        fields: ['id'],
        filters: buildFilters(params),
        pagination: {
          skip: params.offset,
          take: params.limit,
          // Con texto buscado y el orden por defecto, primero lo más relevante.
          order: params.q && params.sort === DEFAULT_SORT ? undefined : SORTS[params.sort].order,
        },
        search_options: {
          count: 'exact',
          // "tisot" encuentra Tissot; la última palabra cuenta como prefijo
          // ("T137" encuentra la referencia T137.410…).
          typo_tolerance: true,
          match_strategy: 'last',
          // Cada filtro cuenta como si no estuviera aplicado él mismo: con
          // "Color: Negro" elegido, igual se ve cuántos hay en Azul.
          disjunctive_facets: true,
          facets: [
            ...FACET_FIELDS.map((field) => ({ field, limit: 50, sort: 'count' as const })),
            ON_SALE_FIELD,
            { field: PRICE_FIELD, type: 'range' as const, ranges: PRICE_RANGES.map((r) => ({ ...r })) },
          ],
        },
      },
      cache: 'no-store',
    })
    const result = results[0]
    const facets = emptyFacets()
    for (const field of FACET_FIELDS) {
      const facet = result.facets?.[field]
      if (facet?.type === 'value') {
        facets[field] = facet.values
          .filter((v) => typeof v.value === 'string' && v.value)
          .map((v) => ({ value: String(v.value), count: v.count }))
      }
    }
    const onSale = result.facets?.[ON_SALE_FIELD]
    const price = result.facets?.[PRICE_FIELD]
    return {
      ids: result.hits.map((h) => h.id),
      count: result.metadata.count ?? result.hits.length,
      facets,
      onSaleCount: onSale?.type === 'value' ? (onSale.values.find((v) => String(v.value) === 'true')?.count ?? 0) : 0,
      priceCounts: price?.type === 'range' ? Object.fromEntries(price.ranges.map((r) => [r.key, r.count])) : {},
      failed: false,
    }
  } catch (err) {
    console.error('[medusa] falló la búsqueda del catálogo', err)
    return { ids: [], count: 0, facets: emptyFacets(), onSaleCount: 0, priceCounts: {}, failed: true }
  }
}
