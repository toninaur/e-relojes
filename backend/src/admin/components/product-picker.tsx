import { ArrowDownMini, ArrowUpMini, MagnifyingGlass, PhotoSolid, XMark } from '@medusajs/icons'
import { Badge, Button, IconButton, Input, Text } from '@medusajs/ui'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'

// Elegir productos para una sección de la portada: buscar por nombre,
// agregar, ordenar y quitar.

type Product = { id: string; title: string; thumbnail: string | null; status: string }

const FIELDS = 'id,title,thumbnail,status'

export const ProductPicker = ({
  value,
  onChange,
  max,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  max: number
}) => {
  const [known, setKnown] = useState<Record<string, Product | null>>({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[] | null>(null)

  // Datos de los elegidos que todavía no conocemos (null: ya no existe).
  useEffect(() => {
    const missing = value.filter((id) => !(id in known))
    if (!missing.length) return
    const params = new URLSearchParams({ fields: FIELDS, limit: String(missing.length) })
    missing.forEach((id) => params.append('id[]', id))
    api<{ products: Product[] }>(`/admin/products?${params}`)
      .then(({ products }) =>
        setKnown((k) => ({
          ...k,
          ...Object.fromEntries(missing.map((id) => [id, products.find((p) => p.id === id) ?? null])),
        })),
      )
      .catch(() => {})
  }, [value, known])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      return
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, fields: FIELDS, limit: '10' })
      api<{ products: Product[] }>(`/admin/products?${params}`)
        .then(({ products }) => {
          setResults(products)
          setKnown((k) => ({ ...k, ...Object.fromEntries(products.map((p) => [p.id, p])) }))
        })
        .catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const move = (index: number, delta: -1 | 1) => {
    const next = [...value]
    const [id] = next.splice(index, 1)
    next.splice(index + delta, 0, id)
    onChange(next)
  }
  const full = value.length >= max

  return (
    <div className="flex flex-col gap-y-3">
      {value.length === 0 ? (
        <Text size="small" className="text-ui-fg-subtle">
          Ninguno elegido.
        </Text>
      ) : (
        <ol className="flex flex-col divide-y rounded-md border">
          {value.map((id, i) => {
            const p = known[id]
            return (
              <li key={id} className="flex items-center gap-x-3 px-3 py-2">
                <Text size="small" className="w-5 text-ui-fg-subtle">
                  {i + 1}
                </Text>
                <Thumb src={p?.thumbnail} />
                <div className="flex min-w-0 flex-1 items-center gap-x-2">
                  <Text size="small" className="truncate">
                    {p === undefined ? 'Cargando…' : p === null ? 'Producto borrado' : p.title}
                  </Text>
                  {p && p.status !== 'published' && (
                    <Badge color="orange" size="2xsmall">
                      Oculto: no se muestra
                    </Badge>
                  )}
                </div>
                <IconButton size="small" variant="transparent" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                  <ArrowUpMini />
                </IconButton>
                <IconButton
                  size="small"
                  variant="transparent"
                  disabled={i === value.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Bajar"
                >
                  <ArrowDownMini />
                </IconButton>
                <IconButton
                  size="small"
                  variant="transparent"
                  onClick={() => onChange(value.filter((x) => x !== id))}
                  aria-label="Quitar"
                >
                  <XMark />
                </IconButton>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-col gap-y-2">
        <div className="relative">
          <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-ui-fg-muted" />
          <Input
            className="pl-8"
            placeholder={full ? `Ya hay ${max}: quitá uno para agregar otro` : 'Buscar un producto por nombre para agregarlo…'}
            value={query}
            disabled={full}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results && !full && (
          <ul className="flex flex-col divide-y rounded-md border">
            {results.length === 0 && (
              <li className="px-3 py-2">
                <Text size="small" className="text-ui-fg-subtle">
                  No se encontraron productos.
                </Text>
              </li>
            )}
            {results.map((p) => {
              const added = value.includes(p.id)
              return (
                <li key={p.id} className="flex items-center gap-x-3 px-3 py-2">
                  <Thumb src={p.thumbnail} />
                  <Text size="small" className="flex-1 truncate">
                    {p.title}
                    {p.status !== 'published' && <span className="text-ui-fg-subtle"> (oculto)</span>}
                  </Text>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={added}
                    onClick={() => {
                      onChange([...value, p.id])
                      if (value.length + 1 >= max) setQuery('')
                    }}
                  >
                    {added ? 'Agregado' : 'Agregar'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

const Thumb = ({ src }: { src?: string | null }) =>
  src ? (
    <img src={src} alt="" className="h-9 w-9 shrink-0 rounded border bg-white object-contain" />
  ) : (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded border bg-ui-bg-subtle">
      <PhotoSolid className="text-ui-fg-muted" />
    </div>
  )
