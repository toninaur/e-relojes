'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HttpTypes } from '@medusajs/types'
import { sdk } from './medusa/client'
import { t } from './texts'

// El carrito vive en Medusa: acá solo se guarda su id en el navegador. Medusa
// calcula precios, ofertas, cupones, envío y totales, y valida el stock en
// cada cambio, así que la tienda no repite esas reglas.

const CART_ID_KEY = 'erelojes-cart-id'
const LEGACY_CART_KEY = 'vb-cart'

// Relaciones que el carrito y el checkout necesitan, además de los campos por
// defecto (totales incluidos).
export const CART_FIELDS = '*items,*promotions,*shipping_methods,*shipping_address'

// Títulos de variante que no aportan nada ("Único", "Default variant").
const PLACEHOLDER_VARIANT = /^(único|unico|default( variant)?)$/i

export interface CartItem {
  lineId: string
  variantId: string
  productId: string
  handle: string | null
  title: string
  variantTitle: string | null
  unitPrice: number
  originalUnitPrice: number | null
  quantity: number
  total: number
  heroImage: string | null
}

export type CartResult = { ok: true } | { ok: false; error: string }

interface CartContextValue {
  cart: HttpTypes.StoreCart | null
  items: CartItem[]
  currency: string
  /** Ya se leyó el carrito guardado (antes de esto `items` está vacío). */
  ready: boolean
  /** Hay un cambio en curso contra Medusa. */
  busy: boolean
  addItem: (variantId: string, quantity?: number) => Promise<CartResult>
  setQuantity: (lineId: string, quantity: number) => Promise<CartResult>
  removeItem: (lineId: string) => Promise<CartResult>
  /** Para el checkout: reemplaza el carrito por el que devolvió Medusa. */
  setCart: (cart: HttpTypes.StoreCart) => void
  /** Después de crear el pedido: el próximo producto arranca un carrito nuevo. */
  forget: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

function readCartId(): string | null {
  try {
    return window.localStorage.getItem(CART_ID_KEY)
  } catch {
    return null
  }
}

function writeCartId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(CART_ID_KEY, id)
    else window.localStorage.removeItem(CART_ID_KEY)
  } catch {
    // Sin storage (modo privado, bloqueado): el carrito dura lo que la pestaña.
  }
}

/** Mensaje para el cliente a partir del error de Medusa. */
export function cartErrorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string } | undefined
  const message = e?.message ?? ''
  if (e?.code === 'insufficient_inventory' || /inventory/i.test(message)) return t.noMoreStock
  if (/promotion code .* is invalid/i.test(message)) return t.discountInvalid
  return t.cartError
}

function toItem(line: HttpTypes.StoreCartLineItem): CartItem {
  const variantTitle = line.variant_title && !PLACEHOLDER_VARIANT.test(line.variant_title) ? line.variant_title : null
  const brand = line.product_collection ?? null
  const productTitle = line.product_title ?? line.title
  const title = brand && !productTitle.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${productTitle}` : productTitle
  const compareAt = line.compare_at_unit_price ?? null
  return {
    lineId: line.id,
    variantId: line.variant_id ?? '',
    productId: line.product_id ?? '',
    handle: line.product_handle ?? null,
    title,
    variantTitle,
    unitPrice: line.unit_price,
    originalUnitPrice: compareAt !== null && compareAt > line.unit_price ? compareAt : null,
    quantity: line.quantity,
    total: line.total ?? line.unit_price * line.quantity,
    heroImage: line.thumbnail ?? null,
  }
}

async function getRegionId(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_MEDUSA_REGION_ID
  if (fixed) return fixed
  const { regions } = await sdk.store.region.list({ limit: 1, fields: 'id' })
  if (!regions[0]) throw new Error('No hay ninguna región configurada en Medusa')
  return regions[0].id
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCartState] = useState<HttpTypes.StoreCart | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  // El id también en una ref: dos "agregar" seguidos no deben crear dos carritos.
  const cartPromise = useRef<Promise<HttpTypes.StoreCart> | null>(null)

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_CART_KEY)
    } catch {}
    const id = readCartId()
    if (!id) {
      setReady(true)
      return
    }
    sdk.store.cart
      .retrieve(id, { fields: CART_FIELDS })
      .then(({ cart }) => {
        // Un carrito ya convertido en pedido no se puede seguir usando.
        if (cart.completed_at) writeCartId(null)
        else setCartState(cart)
      })
      .catch(() => writeCartId(null))
      .finally(() => setReady(true))
  }, [])

  const setCart = useCallback((next: HttpTypes.StoreCart) => {
    setCartState(next)
    writeCartId(next.id)
  }, [])

  const forget = useCallback(() => {
    cartPromise.current = null
    setCartState(null)
    writeCartId(null)
  }, [])

  const ensureCart = useCallback(async (): Promise<HttpTypes.StoreCart> => {
    if (cart) return cart
    if (!cartPromise.current) {
      cartPromise.current = getRegionId()
        .then((region_id) => sdk.store.cart.create({ region_id }, { fields: CART_FIELDS }))
        .then(({ cart }) => cart)
        .catch((err) => {
          cartPromise.current = null
          throw err
        })
    }
    return cartPromise.current
  }, [cart])

  const run = useCallback(
    async (action: () => Promise<HttpTypes.StoreCart>): Promise<CartResult> => {
      setBusy(true)
      try {
        setCart(await action())
        return { ok: true }
      } catch (err) {
        console.error('[carrito]', err)
        return { ok: false, error: cartErrorMessage(err) }
      } finally {
        setBusy(false)
      }
    },
    [setCart],
  )

  const addItem = useCallback(
    (variantId: string, quantity = 1) =>
      run(async () => {
        const current = await ensureCart()
        const { cart } = await sdk.store.cart.createLineItem(
          current.id,
          { variant_id: variantId, quantity },
          { fields: CART_FIELDS },
        )
        return cart
      }),
    [run, ensureCart],
  )

  const setQuantity = useCallback(
    (lineId: string, quantity: number) =>
      run(async () => {
        if (!cart) throw new Error('Sin carrito')
        const { cart: next } = await sdk.store.cart.updateLineItem(
          cart.id,
          lineId,
          { quantity: Math.max(1, quantity) },
          { fields: CART_FIELDS },
        )
        return next
      }),
    [run, cart],
  )

  const removeItem = useCallback(
    (lineId: string) =>
      run(async () => {
        if (!cart) throw new Error('Sin carrito')
        await sdk.store.cart.deleteLineItem(cart.id, lineId)
        const { cart: next } = await sdk.store.cart.retrieve(cart.id, { fields: CART_FIELDS })
        return next
      }),
    [run, cart],
  )

  const items = useMemo(
    () =>
      [...(cart?.items ?? [])]
        .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
        .map(toItem),
    [cart],
  )

  const value: CartContextValue = {
    cart,
    items,
    currency: (cart?.currency_code ?? 'pyg').toUpperCase(),
    ready,
    busy,
    addItem,
    setQuantity,
    removeItem,
    setCart,
    forget,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
