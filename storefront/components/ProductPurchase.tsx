'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useCart } from '@/lib/CartContext'
import { whatsappUrl, brand } from '@/lib/brand'
import type { UiProduct } from '@/lib/medusa/products'
import { t } from '@/lib/texts'
import Price from './Price'
import { WhatsAppIcon } from './icons'

// Precio, selección de variante (color y/o opción), cantidad, agregar al
// carrito y consulta por WhatsApp. El precio se actualiza según la variante.
export default function ProductPurchase({ product }: { product: UiProduct }) {
  const { variants } = product
  const { items: cartItems, addItem, busy } = useCart()

  const colors = useMemo(() => {
    const seen = new Map<string, string | null>()
    variants.forEach((v) => v.color && !seen.has(v.color) && seen.set(v.color, v.colorHex))
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }))
  }, [variants])

  const [color, setColor] = useState<string | null>(colors[0]?.name ?? null)
  const [size, setSize] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const forColor = useMemo(() => (color ? variants.filter((v) => v.color === color) : variants), [variants, color])
  const needsSize = forColor.some((v) => v.size)

  useEffect(() => setSize(null), [color])

  const selected = useMemo(() => {
    if (colors.length > 0 && !color) return null
    if (!needsSize) return forColor[0] ?? null
    return size ? (forColor.find((v) => v.size === size) ?? null) : null
  }, [colors.length, color, needsSize, forColor, size])

  const inCart = selected ? (cartItems.find((i) => i.variantId === selected.id)?.quantity ?? 0) : 0
  const available = selected ? selected.stock - inCart : 0
  const name = product.name

  const add = async () => {
    if (!selected) return
    setMessage(null)
    const result = await addItem(selected.id, quantity)
    setMessage(result.ok ? { ok: true, text: t.added } : { ok: false, text: result.error })
    if (result.ok) setQuantity(1)
  }

  const ref = selected?.sku ?? product.ref
  const waMessage = `${brand.whatsapp.greeting} Me interesa el ${name}${ref ? ` (ref. ${ref})` : ''}${
    selected && variants.length > 1 ? `, ${selected.title}` : ''
  } que vi en la web. ¿Está disponible?`

  return (
    <div className="space-y-6">
      <Price
        amount={selected?.price ?? product.price}
        original={selected ? selected.originalPrice : product.originalPrice}
        currency={product.currency}
        size="lg"
      />

      {colors.length > 0 && (
        <div>
          <p className="field-label">
            {t.chooseColor}
            {color ? `: ${color}` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) =>
              c.hex ? (
                <button
                  key={c.name}
                  type="button"
                  title={c.name}
                  aria-label={c.name}
                  aria-pressed={color === c.name}
                  onClick={() => setColor(c.name)}
                  className={`w-10 h-10 rounded-full ring-1 ring-line border-[3px] ${color === c.name ? 'border-ink' : 'border-white'}`}
                  style={{ background: c.hex }}
                />
              ) : (
                <button key={c.name} type="button" className="chip" aria-pressed={color === c.name} onClick={() => setColor(c.name)}>
                  {c.name}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {needsSize && (
        <div>
          <p className="field-label">{t.chooseSize}</p>
          <div className="flex flex-wrap gap-2">
            {forColor.map((v) => (
              <button
                key={v.id}
                type="button"
                className="chip disabled:opacity-35 disabled:cursor-not-allowed"
                disabled={v.stock === 0}
                aria-pressed={size === v.size}
                onClick={() => setSize(v.size)}
              >
                {v.size}
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && selected.stock > 0 && selected.stock <= 3 && (
        <p className="text-[0.92rem] text-accent font-semibold m-0">
          ¡Últimas {selected.stock === 1 ? 'unidad' : `${selected.stock} unidades`}!
        </p>
      )}

      <div className="flex gap-3">
        <label className="sr-only" htmlFor="qty">
          Cantidad
        </label>
        <input
          id="qty"
          type="number"
          min={1}
          max={Math.max(1, available)}
          value={quantity}
          onChange={(e) => setQuantity(Math.min(Math.max(1, Number(e.target.value) || 1), Math.max(1, available)))}
          className="field !w-20 text-center !rounded-full"
        />
        <button type="button" onClick={add} disabled={!selected || available <= 0 || busy} className="btn btn-dark flex-1">
          {selected?.stock === 0
            ? t.outOfStock
            : !selected
              ? 'Elegí una opción'
              : available <= 0
                ? t.inCart.replace('{{count}}', String(inCart))
                : t.addToCart}
        </button>
      </div>

      {message && (
        <p className={`text-[0.95rem] m-0 ${message.ok ? 'text-ink' : 'text-red-600'}`} role="status">
          {message.text}{' '}
          {message.ok && (
            <Link href="/carrito" className="font-semibold text-accent">
              {t.viewCart}
            </Link>
          )}
        </p>
      )}

      <a href={whatsappUrl(waMessage)} target="_blank" rel="noopener" className="btn btn-outline w-full">
        <WhatsAppIcon />
        Consultar por WhatsApp
      </a>
    </div>
  )
}
