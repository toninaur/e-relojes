import { DEFAULT_SORT, SORTS, type SortKey } from './medusa/search'

// Los filtros del catálogo viven en la URL (se pueden compartir y el botón
// "atrás" funciona). Un filtro con varios valores repite el parámetro:
// /catalogo?color=Negro&color=Azul&malla=Acero&min=1000000&orden=precio-asc
//
// categoria y marca van por handle (son los links de la portada y la ficha);
// tipo, color y malla, por su valor tal cual está cargado en Medusa.

export const LIST_PARAMS = ['tipo', 'categoria', 'marca', 'color', 'malla'] as const
export type ListParam = (typeof LIST_PARAMS)[number]

export interface CatalogState {
  q: string | null
  tipo: string[]
  categoria: string[]
  marca: string[]
  color: string[]
  malla: string[]
  min: number | null
  max: number | null
  oferta: boolean
  orden: SortKey
  pagina: number
}

export type RawSearchParams = Record<string, string | string[] | undefined>

const asList = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean)
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function asAmount(v: string | string[] | undefined): number | null {
  const n = Number(String(first(v) ?? '').replace(/\D/g, ''))
  return n > 0 ? n : null
}

export function parseCatalogState(params: RawSearchParams): CatalogState {
  const orden = first(params.orden)
  return {
    q: first(params.q)?.trim() || null,
    tipo: asList(params.tipo),
    categoria: asList(params.categoria),
    marca: asList(params.marca),
    color: asList(params.color),
    malla: asList(params.malla),
    min: asAmount(params.min),
    max: asAmount(params.max),
    oferta: first(params.oferta) === '1',
    orden: orden && orden in SORTS ? (orden as SortKey) : DEFAULT_SORT,
    pagina: Math.max(1, Number(first(params.pagina)) || 1),
  }
}

/** Los parámetros de un estado, sin los valores por defecto. */
export function stateToEntries(state: CatalogState): [string, string][] {
  const entries: [string, string][] = []
  if (state.q) entries.push(['q', state.q])
  for (const key of LIST_PARAMS) state[key].forEach((v) => entries.push([key, v]))
  if (state.min) entries.push(['min', String(state.min)])
  if (state.max) entries.push(['max', String(state.max)])
  if (state.oferta) entries.push(['oferta', '1'])
  if (state.orden !== DEFAULT_SORT) entries.push(['orden', state.orden])
  if (state.pagina > 1) entries.push(['pagina', String(state.pagina)])
  return entries
}

/** Link al catálogo con cambios sobre el estado actual. La página vuelve a 1 salvo que se pida. */
export function catalogHref(state: CatalogState, changes: Partial<CatalogState> = {}): string {
  const next = { ...state, pagina: 1, ...changes }
  const qs = new URLSearchParams(stateToEntries(next)).toString()
  return qs ? `/catalogo?${qs}` : '/catalogo'
}

/** Link que agrega o saca un valor de un filtro de lista. */
export function toggleHref(state: CatalogState, key: ListParam, value: string): string {
  const current = state[key]
  const values = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return catalogHref(state, { [key]: values })
}

export function activeFilterCount(state: CatalogState): number {
  return (
    LIST_PARAMS.reduce((n, key) => n + state[key].length, 0) +
    (state.min || state.max ? 1 : 0) +
    (state.oferta ? 1 : 0)
  )
}
