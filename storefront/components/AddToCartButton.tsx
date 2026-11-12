'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCart } from '@/lib/CartContext'
import type { UiProduct } from '@/lib/medusa/products'
import { t } from '@/lib/texts'

// Agregado rápido desde la tarjeta: solo para productos de una variante. Los
// que tienen opciones mandan a la ficha para elegir.
export default function AddToCartButton({ product, className = '' }: { product: UiProduct; className?: string }) {
  const { items, addItem } = useCart()
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'error'>('idle')

  if (product.variants.length !== 1) {
    return (
      <Link href={`/producto/${product.slug}`} className={`btn btn-dark ${className}`}>
        Ver opciones
      </Link>
    )
  }

  const variant = product.variants[0]
  const inCart = items.find((i) => i.variantId === variant.id)?.quantity ?? 0
  const soldOut = variant.stock === 0
  const maxed = inCart >= variant.stock

  const add = async () => {
    setState('adding')
    const result = await addItem(variant.id)
    setState(result.ok ? 'added' : 'error')
    setTimeout(() => setState('idle'), result.ok ? 1500 : 2500)
  }

  const label = soldOut
    ? t.outOfStock
    : state === 'adding'
      ? 'Agregando…'
      : state === 'added'
        ? '¡Agregado!'
        : state === 'error'
          ? 'No se pudo agregar'
          : inCart > 0
            ? t.inCart.replace('{{count}}', String(inCart))
            : t.addToCart

  return (
    <button
      type="button"
      onClick={add}
      disabled={soldOut || maxed || state === 'adding'}
      className={`btn btn-dark ${className}`}
    >
      {/* En celular la tarjeta es angosta (y lleva el botón de WhatsApp al lado). */}
      {label === t.addToCart ? (
        <>
          <span className="sm:hidden">Agregar</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        label
      )}
    </button>
  )
}
