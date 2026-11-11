'use client'

import { useMemo, useState } from 'react'
import type { UiProduct } from '@/lib/medusa/products'
import { ProductGrid } from './ProductCard'

// Destacados de la portada, con filtro por categoría (las que aparecen entre
// los destacados).
export default function FeaturedProducts({ products }: { products: UiProduct[] }) {
  const [filter, setFilter] = useState<string | null>(null)

  const categories = useMemo(() => {
    const seen = new Map<string, string>()
    products.forEach((p) => p.categories.forEach((c) => seen.set(c.handle, c.name)))
    return [...seen.entries()].map(([handle, name]) => ({ handle, name }))
  }, [products])

  const visible = filter ? products.filter((p) => p.categories.some((c) => c.handle === filter)) : products

  return (
    <>
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-8" role="group" aria-label="Filtrar destacados">
          <button type="button" className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
            Todos
          </button>
          {categories.map((c) => (
            <button
              key={c.handle}
              type="button"
              className="chip"
              aria-pressed={filter === c.handle}
              onClick={() => setFilter(c.handle)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      <ProductGrid products={visible} />
    </>
  )
}
