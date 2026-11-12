'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import type { SearchSuggestion } from '@/app/api/buscar/route'

// Buscador del encabezado: la lupa abre una barra debajo del encabezado con
// resultados mientras se escribe. Enter lleva al catálogo con la búsqueda; las
// flechas eligen un producto. También se abre con la tecla "/".

const DEBOUNCE_MS = 200

export default function HeaderSearch({ onOpen }: { onOpen?: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchSuggestion[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  // El panel va de lado a lado, pegado abajo del encabezado (que es sticky).
  const [top, setTop] = useState(0)

  const term = q.trim()

  const show = () => {
    setTop(document.querySelector('header')?.getBoundingClientRect().bottom ?? 0)
    setOpen(true)
    onOpen?.()
  }
  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  // Cambió de página: se cierra.
  useEffect(() => close(), [pathname])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // "/" abre el buscador (como en muchos sitios), salvo escribiendo en un campo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key === '/' && !open && !/^(input|textarea|select)$/i.test(target.tagName) && !target.isContentEditable) {
        e.preventDefault()
        show()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Click afuera cierra.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    setActive(-1)
    if (term.length < 2) {
      setResults([])
      setCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        const data: { count: number; products: SearchSuggestion[] } = await res.json()
        setResults(data.products)
        setCount(data.count)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (active >= 0 && results[active]) {
      router.push(`/producto/${results[active].slug}`)
    } else if (term) {
      router.push(`/catalogo?q=${encodeURIComponent(term)}`)
    }
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close()
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault()
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1))
    }
  }

  const showList = term.length >= 2

  return (
    // display: contents: no ocupa lugar; el panel se ubica respecto del encabezado.
    <div ref={rootRef} className="contents">
      <button
        type="button"
        aria-label="Buscar productos"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        className="text-white/85 hover:text-white p-0.5"
      >
        <Search className="w-6 h-6" />
      </button>

      {open && (
        <div
          style={{ top }}
          className="fixed inset-x-0 z-40 bg-ink border-b border-[#262626] shadow-[0_18px_40px_rgb(0_0_0/0.35)]"
        >
          <div className="wrap py-4">
            <form role="search" onSubmit={submit} className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
                <input
                  ref={inputRef}
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Buscar marca, modelo o referencia"
                  aria-label="Buscar productos"
                  role="combobox"
                  aria-expanded={showList}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
                  autoComplete="off"
                  enterKeyHint="search"
                  className="w-full h-12 rounded-full bg-white text-ink pl-12 pr-4 text-[1rem] outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-search-cancel-button]:appearance-none"
                />
              </div>
              <button type="button" onClick={close} aria-label="Cerrar el buscador" className="text-white/80 hover:text-white p-1">
                <X className="w-6 h-6" />
              </button>
            </form>

            {showList && (
              <div className="mt-3 bg-white text-ink rounded-2xl overflow-hidden max-h-[min(70vh,560px)] overflow-y-auto">
                {results.length > 0 ? (
                  <>
                    <ul id={listId} role="listbox" aria-label="Resultados">
                      {results.map((p, i) => (
                        <li key={p.slug} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                          <Link
                            href={`/producto/${p.slug}`}
                            onClick={close}
                            onMouseEnter={() => setActive(i)}
                            className={`flex items-center gap-4 px-4 py-3 no-underline text-ink border-b border-line ${
                              i === active ? 'bg-paper' : ''
                            }`}
                          >
                            <span className="w-14 h-14 shrink-0 rounded-lg border border-line bg-white grid place-items-center overflow-hidden">
                              {p.image && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.image} alt="" className="w-full h-full object-contain" loading="lazy" />
                              )}
                            </span>
                            <span className="flex-1 min-w-0">
                              {p.brand && (
                                <span className="block text-[0.78rem] font-semibold tracking-[0.08em] uppercase text-muted">
                                  {p.brand}
                                </span>
                              )}
                              <span className="block font-medium truncate">{p.model}</span>
                            </span>
                            <span className="text-right shrink-0">
                              <strong className="block">{formatMoney(p.price, p.currency)}</strong>
                              {p.originalPrice && (
                                <s className="block text-[0.82rem] text-muted">{formatMoney(p.originalPrice, p.currency)}</s>
                              )}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={`/catalogo?q=${encodeURIComponent(term)}`}
                      onClick={close}
                      className="block px-4 py-3.5 text-center font-semibold text-accent no-underline hover:bg-paper"
                    >
                      {count > results.length ? `Ver los ${count} resultados` : 'Ver en el catálogo'}
                    </Link>
                  </>
                ) : (
                  <p className="px-4 py-5 m-0 text-muted" aria-live="polite">
                    {loading ? 'Buscando…' : `No encontramos productos para “${term}”. Probá con la marca o el modelo.`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
