'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, ShoppingBag, X } from 'lucide-react'
import { brand, whatsappUrl } from '@/lib/brand'
import { useCart } from '@/lib/CartContext'
import HeaderSearch from './HeaderSearch'

// Pestañas principales. "Cómo comprar" y "Local" son secciones de la portada:
// se resaltan mientras esa sección está en pantalla (y Inicio, el resto).
type Section = 'comprar' | 'ubicacion' | null
const SECTIONS = ['comprar', 'ubicacion'] as const

const TABS = [
  { label: 'Inicio', href: '/', match: (p: string, s: Section) => p === '/' && s === null },
  {
    label: 'Catálogo',
    href: '/catalogo',
    match: (p: string) => p.startsWith('/catalogo') || p.startsWith('/producto'),
  },
  { label: 'Cómo comprar', href: '/#comprar', match: (p: string, s: Section) => p === '/' && s === 'comprar' },
  { label: 'Local', href: '/#ubicacion', match: (p: string, s: Section) => p === '/' && s === 'ubicacion' },
]

/** La sección de la portada que cruza la línea a un tercio de la pantalla. */
function useHomeSection(pathname: string): Section {
  const [section, setSection] = useState<Section>(null)
  useEffect(() => {
    if (pathname !== '/') {
      setSection(null)
      return
    }
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const line = window.innerHeight / 3
        let current: Section = null
        for (const id of SECTIONS) {
          const box = document.getElementById(id)?.getBoundingClientRect()
          if (box && box.top <= line && box.bottom > line) current = id
        }
        // Al fondo de la página el local puede no llegar a la línea.
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
        setSection(atBottom ? 'ubicacion' : current)
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [pathname])
  return section
}

export default function SiteHeader() {
  const pathname = usePathname()
  const section = useHomeSection(pathname)
  const [open, setOpen] = useState(false)
  const { items } = useCart()
  const cartCount = items.reduce((sum, i) => sum + i.quantity, 0)

  const tabCls = (active: boolean) =>
    `text-[0.95rem] font-medium no-underline transition-colors ${active ? 'text-white' : 'text-white/75 hover:text-white'}`

  return (
    <header className="sticky top-0 z-50 bg-ink text-white border-b border-[#262626] pt-[env(safe-area-inset-top)]">
      <div className="wrap relative flex items-center justify-between h-[76px] gap-4">
        <Link href="/" aria-label={`${brand.name}, ir al inicio`} onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo} alt={brand.name} width={78} height={56} className="h-14 w-auto" />
        </Link>

        <div className="flex items-center gap-5">
          <nav
            aria-label="Principal"
            className={`${open ? 'flex animate-panel-in' : 'hidden'} absolute left-0 right-0 top-full flex-col bg-ink px-5 pb-5 border-b border-[#262626]
              min-[900px]:static min-[900px]:flex min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-7 min-[900px]:p-0 min-[900px]:border-0`}
          >
            {TABS.map((tab) => {
              const active = tab.match(pathname, section)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`${tabCls(active)} py-3.5 border-b border-[#262626] min-[900px]:py-0 min-[900px]:border-0 relative
                    min-[900px]:after:absolute min-[900px]:after:-bottom-2 min-[900px]:after:left-0 min-[900px]:after:right-0 min-[900px]:after:h-0.5 min-[900px]:after:bg-white
                    after:transition-transform after:duration-300 after:ease-out
                    ${active ? 'after:scale-x-100' : 'after:scale-x-0'}`}
                >
                  {tab.label}
                </Link>
              )
            })}
            {/* Catálogos en PDF del local (Drive), en otra pestaña. */}
            <a
              href={brand.catalogsUrl}
              target="_blank"
              rel="noopener"
              onClick={() => setOpen(false)}
              className={`${tabCls(false)} py-3.5 border-b border-[#262626] min-[900px]:py-0 min-[900px]:border-0`}
            >
              Catálogos PDF
            </a>
            <a
              href={whatsappUrl()}
              target="_blank"
              rel="noopener"
              className="btn btn-light btn-sm mt-4 min-[900px]:mt-0"
            >
              WhatsApp
            </a>
          </nav>

          <HeaderSearch onOpen={() => setOpen(false)} />

          <Link
            href="/carrito"
            aria-label={`Carrito${cartCount ? `, ${cartCount} productos` : ''}`}
            className="relative text-white/85 hover:text-white"
            onClick={() => setOpen(false)}
          >
            <ShoppingBag className="w-6 h-6" />
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-2.5 grid place-items-center min-w-5 h-5 px-1 rounded-full bg-accent text-white text-[11px] font-bold">
                {cartCount}
              </span>
            )}
          </Link>

          <button
            type="button"
            className="min-[900px]:hidden text-white p-1"
            aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}
          </button>
        </div>
      </div>
    </header>
  )
}
