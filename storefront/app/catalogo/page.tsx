import type { Metadata } from 'next'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { listBrands, listCategories } from '@/lib/medusa/catalog'
import { listProductsByIds } from '@/lib/medusa/products'
import { SORTS, searchCatalog, type FacetField, type FacetValue, type SortKey } from '@/lib/medusa/search'
import {
  activeFilterCount,
  catalogHref,
  LIST_PARAMS,
  parseCatalogState,
  stateToEntries,
  toggleHref,
  type CatalogState,
  type ListParam,
  type RawSearchParams,
} from '@/lib/catalog-url'
import { colorSwatch } from '@/lib/colors'
import { absoluteUrl, brand } from '@/lib/brand'
import { formatMoney } from '@/lib/format'
import { ProductGrid } from '@/components/ProductCard'
import FilterPanel, { type FilterSection } from '@/components/catalog/FilterPanel'
import FiltersDrawer from '@/components/catalog/FiltersDrawer'
import SortSelect from '@/components/catalog/SortSelect'
import { SearchTracker } from '@/components/Trackers'

const PAGE_SIZE = 24

type SearchParams = Promise<RawSearchParams>

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const state = parseCatalogState(await searchParams)
  const [categories, brands] = await Promise.all([listCategories(), listBrands()])
  const category = state.categoria.length === 1 ? categories.find((c) => c.handle === state.categoria[0]) : null
  const brandItem = state.marca.length === 1 ? brands.find((b) => b.handle === state.marca[0]) : null

  // A Google van el catálogo, cada categoría y cada marca. Búsquedas, filtros
  // combinados, orden y páginas siguientes no se indexan (serían casi copias).
  const otherFilters =
    state.q ||
    state.oferta ||
    state.min !== null ||
    state.max !== null ||
    state.pagina > 1 ||
    LIST_PARAMS.some((p) => p !== 'categoria' && p !== 'marca' && state[p].length > 0) ||
    state.categoria.length > 1 ||
    state.marca.length > 1 ||
    (category && brandItem)
  const landing = brandItem ?? category
  const name = brandItem ? `Relojes y productos ${brandItem.title}` : category ? category.name : 'Catálogo'
  const path = brandItem ? `/catalogo?marca=${brandItem.handle}` : category ? `/catalogo?categoria=${category.handle}` : '/catalogo'
  return {
    title: landing ? `${name} | Catálogo` : 'Catálogo',
    description: `${name} en ${brand.legalName}: precios, stock y compra online con envíos a todo el país.`,
    alternates: { canonical: path },
    openGraph: { url: absoluteUrl(path) },
    ...(otherFilters ? { robots: { index: false, follow: true } } : {}),
  }
}

// Cada filtro: parámetro de la URL ↔ campo del índice de búsqueda.
const SECTIONS: { param: ListParam; field: FacetField; title: string }[] = [
  { param: 'tipo', field: 'type', title: 'Tipo de producto' },
  { param: 'categoria', field: 'category', title: 'Categoría' },
  { param: 'marca', field: 'brand', title: 'Marca' },
  { param: 'color', field: 'color', title: 'Color' },
  { param: 'malla', field: 'strap', title: 'Malla' },
]

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const state = parseCatalogState(await searchParams)
  const [categories, brands] = await Promise.all([listCategories(), listBrands()])

  // categoria y marca van por handle en la URL; el índice guarda el nombre.
  const categoryName = new Map(categories.map((c) => [c.handle, c.name]))
  const categoryHandle = new Map(categories.map((c) => [c.name, c.handle]))
  const brandName = new Map(brands.map((b) => [b.handle, b.title]))
  const brandHandle = new Map(brands.map((b) => [b.title, b.handle]))
  const toIndex: Partial<Record<ListParam, (v: string) => string>> = {
    categoria: (h) => categoryName.get(h) ?? h,
    marca: (h) => brandName.get(h) ?? h,
  }
  const toUrl: Partial<Record<ListParam, (v: string) => string>> = {
    categoria: (n) => categoryHandle.get(n) ?? n,
    marca: (n) => brandHandle.get(n) ?? n,
  }
  const label = (param: ListParam, urlValue: string) => toIndex[param]?.(urlValue) ?? urlValue

  const result = await searchCatalog({
    q: state.q ?? undefined,
    facets: Object.fromEntries(SECTIONS.map((s) => [s.field, state[s.param].map((v) => label(s.param, v))])),
    priceMin: state.min ?? undefined,
    priceMax: state.max ?? undefined,
    onSale: state.oferta,
    sort: state.orden,
    limit: PAGE_SIZE,
    offset: (state.pagina - 1) * PAGE_SIZE,
  })
  const products = await listProductsByIds(result.ids)
  const pages = Math.max(1, Math.ceil(result.count / PAGE_SIZE))

  const sections: FilterSection[] = SECTIONS.map(({ param, field, title }) => {
    const values: FacetValue[] = [...result.facets[field]]
    // Un valor elegido que ya no tiene resultados igual se muestra, para poder sacarlo.
    for (const selected of state[param]) {
      const name = label(param, selected)
      if (!values.some((v) => v.value === name)) values.push({ value: name, count: 0 })
    }
    if (param === 'categoria') {
      // En el orden del admin (rank), no por cantidad.
      const rank = new Map(categories.map((c, i) => [c.name, i]))
      values.sort((a, b) => (rank.get(a.value) ?? 99) - (rank.get(b.value) ?? 99))
    } else if (param === 'marca') {
      values.sort((a, b) => a.value.localeCompare(b.value, 'es'))
    }
    return {
      param,
      title,
      options: values.map((v) => {
        const urlValue = toUrl[param]?.(v.value) ?? v.value
        return {
          value: urlValue,
          label: v.value,
          count: v.count,
          selected: state[param].includes(urlValue),
          swatch: param === 'color' ? colorSwatch(v.value) : undefined,
        }
      }),
    }
  })

  const activeCount = activeFilterCount(state)
  const single = (param: ListParam) =>
    state[param].length === 1 && SECTIONS.every((s) => s.param === param || state[s.param].length === 0)
      ? label(param, state[param][0])
      : null
  const heading = single('categoria') ?? single('tipo') ?? single('marca') ?? 'Catálogo'

  // Chips de los filtros aplicados, cada uno con su link para sacarlo.
  const chips: { label: string; href: string }[] = [
    ...(state.q ? [{ label: `“${state.q}”`, href: catalogHref(state, { q: null }) }] : []),
    ...SECTIONS.flatMap(({ param }) =>
      state[param].map((v) => ({ label: label(param, v), href: toggleHref(state, param, v) })),
    ),
    ...(state.min || state.max
      ? [
          {
            label:
              state.min && state.max
                ? `${formatMoney(state.min)} a ${formatMoney(state.max)}`
                : state.min
                  ? `Desde ${formatMoney(state.min)}`
                  : `Hasta ${formatMoney(state.max!)}`,
            href: catalogHref(state, { min: null, max: null }),
          },
        ]
      : []),
    ...(state.oferta ? [{ label: 'En oferta', href: catalogHref(state, { oferta: false }) }] : []),
  ]
  const clearHref = catalogHref({ ...state, q: null }, { tipo: [], categoria: [], marca: [], color: [], malla: [], min: null, max: null, oferta: false })

  const sortOptions = (Object.keys(SORTS) as SortKey[]).map((key) => ({
    value: key,
    label: SORTS[key].label,
    href: catalogHref(state, { orden: key }),
  }))

  return (
    <>
      {state.q && <SearchTracker term={state.q} />}
      <div className="bg-ink text-white pt-12 pb-10">
        <div className="wrap">
          <h1 className="text-[clamp(2.2rem,5vw,3.6rem)] mb-2">{heading}</h1>
          <p className="text-white/70 m-0">
            {result.count} {result.count === 1 ? 'producto' : 'productos'}
            {state.q ? ` para “${state.q}”` : ''}
          </p>
          <form action="/catalogo" className="mt-6 flex gap-2 max-w-xl">
            {stateToEntries({ ...state, q: null, pagina: 1 }).map(([k, v], i) => (
              <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
            ))}
            <label className="sr-only" htmlFor="q">
              Buscar
            </label>
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" aria-hidden />
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={state.q ?? ''}
                placeholder="Buscar marca, modelo o referencia"
                className="w-full rounded-full bg-white text-ink pl-11 pr-4 py-3 outline-none"
              />
            </div>
            <button type="submit" className="btn btn-light">
              Buscar
            </button>
          </form>
        </div>
      </div>

      <section className="py-8 sm:py-12">
        <div className="wrap grid lg:grid-cols-[250px_1fr] gap-x-10 gap-y-4">
          <aside>
            <FiltersDrawer activeCount={activeCount} resultCount={result.count}>
              <FilterPanel
                state={state}
                sections={sections}
                priceCounts={result.priceCounts}
                onSaleCount={result.onSaleCount}
              />
            </FiltersDrawer>
          </aside>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-6">
              {chips.length > 0 && (
                <ul className="flex flex-wrap gap-2 m-0 p-0 list-none flex-1 min-w-0" aria-label="Filtros aplicados">
                  {chips.map((chip) => (
                    <li key={chip.href}>
                      <Link
                        href={chip.href}
                        scroll={false}
                        aria-label={`Quitar filtro ${chip.label}`}
                        className="inline-flex items-center gap-1.5 bg-white border border-line rounded-full pl-3.5 pr-2.5 py-1.5 text-[0.9rem] font-semibold no-underline hover:border-ink"
                      >
                        {chip.label}
                        <X className="w-3.5 h-3.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link href={clearHref} className="inline-block py-1.5 text-[0.9rem] font-semibold text-accent no-underline hover:underline">
                      Limpiar todo
                    </Link>
                  </li>
                </ul>
              )}
              <div className="ml-auto">
                <SortSelect value={state.orden} options={sortOptions} />
              </div>
            </div>

            {result.failed ? (
              <div className="text-center py-20">
                <p className="text-muted mb-6">No pudimos cargar el catálogo. Probá de nuevo en un momento.</p>
              </div>
            ) : products.length > 0 ? (
              <ProductGrid products={products} />
            ) : (
              <div className="text-center py-20">
                <p className="text-muted mb-6">No encontramos productos con esos filtros.</p>
                <Link href="/catalogo" className="btn btn-dark">
                  Ver todo el catálogo
                </Link>
              </div>
            )}

            {pages > 1 && (
              <Pagination state={state} pages={pages} />
            )}
          </div>
        </div>
      </section>
    </>
  )
}

function Pagination({ state, pages }: { state: CatalogState; pages: number }) {
  const page = state.pagina
  return (
    <nav aria-label="Páginas" className="flex justify-center items-center gap-3 mt-12">
      {page > 1 && (
        <Link href={catalogHref(state, { pagina: page - 1 })} className="btn btn-outline btn-sm">
          ← Anterior
        </Link>
      )}
      <span className="text-muted text-[0.95rem]">
        Página {page} de {pages}
      </span>
      {page < pages && (
        <Link href={catalogHref(state, { pagina: page + 1 })} className="btn btn-outline btn-sm">
          Siguiente →
        </Link>
      )}
    </nav>
  )
}
