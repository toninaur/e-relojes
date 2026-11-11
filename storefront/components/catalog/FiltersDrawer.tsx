'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

// En pantallas grandes los filtros son una columna fija; en el celular, un
// panel a pantalla completa que se abre con "Filtros". Queda abierto mientras
// se eligen varios filtros (cada uno recarga los resultados) y se cierra con
// "Ver resultados".
export default function FiltersDrawer({
  activeCount,
  resultCount,
  children,
}: {
  activeCount: number
  resultCount: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="catalog-filters"
        className="lg:hidden btn btn-outline btn-sm"
      >
        <SlidersHorizontal />
        Filtros{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>

      <div
        id="catalog-filters"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Filtros"
        className={`${open ? 'fixed inset-0 z-[60] flex flex-col bg-paper' : 'hidden'} lg:static lg:block lg:bg-transparent`}
      >
        <div className="lg:hidden flex items-center justify-between px-5 h-16 border-b border-line bg-white">
          <p className="font-display text-[1.4rem] font-semibold m-0">Filtros</p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar filtros" className="p-1">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 lg:p-0 lg:overflow-visible">{children}</div>
        <div className="lg:hidden p-4 border-t border-line bg-white pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setOpen(false)} className="btn btn-dark w-full">
            Ver {resultCount} {resultCount === 1 ? 'resultado' : 'resultados'}
          </button>
        </div>
      </div>
    </>
  )
}
