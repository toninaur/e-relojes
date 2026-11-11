import Link from 'next/link'
import { Check } from 'lucide-react'
import { catalogHref, toggleHref, stateToEntries, type CatalogState, type ListParam } from '@/lib/catalog-url'
import { PRICE_RANGES } from '@/lib/medusa/search'
import { formatMoney } from '@/lib/format'

export interface FilterOption {
  /** Valor en la URL. */
  value: string
  label: string
  count: number
  selected: boolean
  /** Color CSS para mostrar una muestra (filtro de color). */
  swatch?: string
}

export interface FilterSection {
  param: ListParam
  title: string
  options: FilterOption[]
}

// Cuántas opciones se ven antes de "Ver más".
const VISIBLE_OPTIONS = 8

const sectionCls = 'border-b border-line py-5 first:pt-0'
const titleCls = 'text-[0.82rem] font-bold tracking-[0.08em] uppercase text-muted mb-3'

function OptionLink({ href, option }: { href: string; option: FilterOption }) {
  const empty = option.count === 0 && !option.selected
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={option.selected ? 'true' : undefined}
      className={`flex items-center gap-2.5 py-1.5 no-underline text-[0.97rem] ${
        empty ? 'text-muted/60' : 'text-ink hover:text-accent'
      }`}
    >
      {option.swatch ? (
        <span
          aria-hidden
          className={`w-5 h-5 rounded-full shrink-0 ring-1 ring-line ${
            option.selected ? 'outline-2 outline-offset-2 outline-ink outline' : ''
          }`}
          style={{ background: option.swatch }}
        />
      ) : (
        <span
          aria-hidden
          className={`grid place-items-center w-[18px] h-[18px] rounded-[5px] border-[1.5px] shrink-0 ${
            option.selected ? 'bg-ink border-ink text-white' : 'border-line bg-white'
          }`}
        >
          {option.selected && <Check className="w-3 h-3" strokeWidth={3} />}
        </span>
      )}
      <span className={`flex-1 ${option.selected ? 'font-semibold' : ''}`}>{option.label}</span>
      <span className="text-[0.82rem] text-muted tabular-nums">{option.count}</span>
    </Link>
  )
}

export default function FilterPanel({
  state,
  sections,
  priceCounts,
  onSaleCount,
}: {
  state: CatalogState
  sections: FilterSection[]
  priceCounts: Record<string, number>
  onSaleCount: number
}) {
  // El formulario de precio conserva el resto de los filtros.
  const keep = stateToEntries({ ...state, min: null, max: null, pagina: 1 })

  return (
    <div>
      {sections
        .filter((s) => s.options.length > 0)
        .map((section) => {
          const visible = section.options.slice(0, VISIBLE_OPTIONS)
          const rest = section.options.slice(VISIBLE_OPTIONS)
          return (
            <section key={section.param} className={sectionCls} aria-label={section.title}>
              <h2 className={titleCls}>{section.title}</h2>
              {visible.map((o) => (
                <OptionLink key={o.value} option={o} href={toggleHref(state, section.param, o.value)} />
              ))}
              {rest.length > 0 && (
                <details open={rest.some((o) => o.selected)}>
                  <summary className="cursor-pointer text-[0.92rem] font-semibold text-accent py-1.5 list-none">
                    Ver {rest.length} más
                  </summary>
                  {rest.map((o) => (
                    <OptionLink key={o.value} option={o} href={toggleHref(state, section.param, o.value)} />
                  ))}
                </details>
              )}
            </section>
          )
        })}

      <section className={sectionCls} aria-label="Precio">
        <h2 className={titleCls}>Precio</h2>
        {PRICE_RANGES.map((range) => {
          const from: number | null = 'from' in range ? range.from : null
          const upper: number | null = 'to' in range ? range.to : null
          // `to` no se incluye en la franja; el filtro de la URL sí incluye `max`.
          const to = upper === null ? null : upper - 1
          const selected = state.min === from && state.max === to
          const label =
            from === null
              ? `Hasta ${formatMoney(upper ?? 0)}`
              : upper === null
                ? `Más de ${formatMoney(from)}`
                : `${formatMoney(from)} a ${formatMoney(upper)}`
          return (
            <OptionLink
              key={range.key}
              option={{ value: range.key, label, count: priceCounts[range.key] ?? 0, selected }}
              href={catalogHref(state, selected ? { min: null, max: null } : { min: from, max: to })}
            />
          )
        })}
        <form action="/catalogo" className="mt-3">
          {keep.map(([k, v], i) => (
            <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
          ))}
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="price-min">
              Precio mínimo
            </label>
            <input
              id="price-min"
              name="min"
              inputMode="numeric"
              placeholder="Mínimo"
              defaultValue={state.min ?? ''}
              className="field !py-2 !px-3 !text-[0.92rem] min-w-0"
            />
            <span className="text-muted">–</span>
            <label className="sr-only" htmlFor="price-max">
              Precio máximo
            </label>
            <input
              id="price-max"
              name="max"
              inputMode="numeric"
              placeholder="Máximo"
              defaultValue={state.max ?? ''}
              className="field !py-2 !px-3 !text-[0.92rem] min-w-0"
            />
          </div>
          <button type="submit" className="btn btn-outline btn-sm w-full mt-2">
            Aplicar precio
          </button>
        </form>
      </section>

      {(onSaleCount > 0 || state.oferta) && (
        <section className={sectionCls} aria-label="Ofertas">
          <h2 className={titleCls}>Ofertas</h2>
          <OptionLink
            option={{ value: '1', label: 'Solo productos en oferta', count: onSaleCount, selected: state.oferta }}
            href={catalogHref(state, { oferta: !state.oferta })}
          />
        </section>
      )}
    </div>
  )
}
