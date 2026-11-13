'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HttpTypes } from '@medusajs/types'
import { Minus, Plus, X } from 'lucide-react'
import { CART_FIELDS, cartErrorMessage, useCart } from '@/lib/CartContext'
import { sdk } from '@/lib/medusa/client'
import { brand, whatsappUrl } from '@/lib/brand'
import { t } from '@/lib/texts'
import { formatMoney } from '@/lib/format'
import { WhatsAppIcon } from '@/components/icons'

// Carrito y checkout en una página. El pedido se crea en Medusa: datos de
// contacto y dirección en el carrito, forma de entrega, pago manual y
// `complete`. Transferencia o efectivo quedan en la metadata del pedido
// (`payment_method`), que el panel muestra en el pedido.
//
// Formas de entrega: todas las opciones de envío cargadas en el panel
// (Configuración → Ubicaciones y envíos), por ejemplo "Envío a domicilio",
// "Encomienda al interior" o "Retiro en el local". Las de retiro (tipo
// "pickup" o con "retiro" en el nombre) no piden dirección.
//
// Pasarela de pago online: pendiente, la elige el cliente.

type PaymentMethod = 'bank_transfer' | 'cash_on_delivery'

const MANUAL_PAYMENT_PROVIDER = 'pp_system_default'
const COUNTRY_CODE = 'py'

const sectionTitleCls = 'text-[1.35rem] mb-4'

interface PlacedOrder {
  number: number
  total: number
  currency: string
  paymentMethod: PaymentMethod
}

type ShippingOption = HttpTypes.StoreCartShippingOption

function isPickup(option: ShippingOption | null): boolean {
  return !!option && (option.type?.code === 'pickup' || /retiro/i.test(option.name))
}

function optionCardCls(active: boolean) {
  return `flex items-center gap-3 border rounded-xl p-4 cursor-pointer transition-colors ${
    active ? 'border-ink bg-white' : 'border-line bg-white hover:border-muted'
  }`
}

export default function CheckoutPage() {
  const { cart, items, currency, ready, busy, setQuantity, removeItem, setCart, forget } = useCart()

  const [buyerName, setBuyerName] = useState('')
  const [buyerPhone, setBuyerPhone] = useState('')
  const [buyerEmail, setBuyerEmail] = useState('')

  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([])
  const [optionId, setOptionId] = useState<string | null>(null)
  const [addressLine, setAddressLine] = useState('')
  const [addressUnit, setAddressUnit] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer')

  const [discountInput, setDiscountInput] = useState('')
  const [discountBusy, setDiscountBusy] = useState(false)
  const [discountError, setDiscountError] = useState<string | null>(null)

  const [lineError, setLineError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<PlacedOrder | null>(null)

  const cartId = cart?.id
  const hasItems = items.length > 0

  // Formas de entrega del carrito: primero las que llevan a domicilio, el
  // retiro al final. Se elige de entrada la primera.
  useEffect(() => {
    if (!cartId || !hasItems) return
    sdk.store.fulfillment
      .listCartOptions({ cart_id: cartId })
      .then(({ shipping_options }) => {
        const sorted = [...shipping_options].sort((a, b) => Number(isPickup(a)) - Number(isPickup(b)))
        setShippingOptions(sorted)
        setOptionId((current) => (current && sorted.some((o) => o.id === current) ? current : (sorted[0]?.id ?? null)))
      })
      .catch((err) => console.error('[checkout] opciones de envío', err))
  }, [cartId, hasItems])

  // La forma de entrega elegida se carga en el carrito para que el total la incluya.
  const selectedOption = shippingOptions.find((o) => o.id === optionId) ?? null
  const pickup = isPickup(selectedOption)
  const currentMethodId = cart?.shipping_methods?.[0]?.shipping_option_id
  useEffect(() => {
    if (!cartId || !selectedOption || currentMethodId === selectedOption.id) return
    sdk.store.cart
      .addShippingMethod(cartId, { option_id: selectedOption.id }, { fields: CART_FIELDS })
      .then(({ cart }) => setCart(cart))
      .catch((err) => console.error('[checkout] método de envío', err))
  }, [cartId, selectedOption, currentMethodId, setCart])

  const changeQuantity = async (lineId: string, quantity: number) => {
    setLineError(null)
    const result = await setQuantity(lineId, quantity)
    if (!result.ok) setLineError(result.error)
  }

  const remove = async (lineId: string) => {
    setLineError(null)
    const result = await removeItem(lineId)
    if (!result.ok) setLineError(result.error)
  }

  const appliedCodes = (cart?.promotions ?? []).map((p) => p.code).filter((c): c is string => Boolean(c))

  const applyDiscount = async () => {
    const code = discountInput.trim()
    if (!code || !cartId) return
    setDiscountBusy(true)
    setDiscountError(null)
    try {
      const { cart } = await sdk.client.fetch<HttpTypes.StoreCartResponse>(`/store/carts/${cartId}/promotions`, {
        method: 'POST',
        body: { promo_codes: [code] },
        query: { fields: CART_FIELDS },
      })
      // Medusa acepta un código válido aunque no aplique a este carrito.
      if (!cart.promotions?.some((p) => p.code?.toLowerCase() === code.toLowerCase())) {
        setDiscountError(t.discountInvalid)
      } else {
        setDiscountInput('')
      }
      setCart(cart)
    } catch (err) {
      setDiscountError(cartErrorMessage(err) === t.cartError ? t.discountInvalid : cartErrorMessage(err))
    } finally {
      setDiscountBusy(false)
    }
  }

  const removeDiscount = async (code: string) => {
    if (!cartId) return
    setDiscountBusy(true)
    try {
      const { cart } = await sdk.client.fetch<HttpTypes.StoreCartResponse>(`/store/carts/${cartId}/promotions`, {
        method: 'DELETE',
        body: { promo_codes: [code] },
        query: { fields: CART_FIELDS },
      })
      setCart(cart)
    } catch (err) {
      console.error('[checkout] quitar cupón', err)
    } finally {
      setDiscountBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cart || !hasItems) return
    if (!buyerName.trim() || !buyerPhone.trim()) {
      setError(t.contactRequired)
      return
    }
    if (!pickup && (!addressLine.trim() || !city.trim())) {
      setError(t.addressRequired)
      return
    }
    if (!selectedOption) {
      setError(t.orderError)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const address = {
        first_name: buyerName.trim(),
        phone: buyerPhone.trim(),
        country_code: COUNTRY_CODE,
        ...(!pickup
          ? {
              address_1: addressLine.trim(),
              address_2: addressUnit.trim() || undefined,
              postal_code: postalCode.trim() || undefined,
              city: city.trim(),
            }
          : {}),
      }
      const { cart: updated } = await sdk.store.cart.update(cart.id, {
        email: buyerEmail.trim() || undefined,
        shipping_address: address,
        billing_address: address,
        metadata: { payment_method: paymentMethod, delivery_method: pickup ? 'pickup' : 'shipping', delivery_option: selectedOption.name },
      })
      if (updated.shipping_methods?.[0]?.shipping_option_id !== selectedOption.id) {
        await sdk.store.cart.addShippingMethod(cart.id, { option_id: selectedOption.id })
      }
      await sdk.store.payment.initiatePaymentSession(updated, { provider_id: MANUAL_PAYMENT_PROVIDER })

      const result = await sdk.store.cart.complete(cart.id)
      if (result.type !== 'order') {
        console.error('[checkout] el carrito no se completó', result.error)
        setError(cartErrorMessage(result.error))
        return
      }
      setOrder({
        number: result.order.display_id ?? 0,
        total: result.order.total,
        currency: result.order.currency_code.toUpperCase(),
        paymentMethod,
      })
      forget()
      window.scrollTo({ top: 0 })
    } catch (err) {
      console.error('[checkout]', err)
      const message = cartErrorMessage(err)
      setError(message === t.cartError ? t.orderError : message)
    } finally {
      setSubmitting(false)
    }
  }

  const subtotal = cart?.item_subtotal ?? 0
  const shippingTotal = cart?.shipping_total ?? 0
  const discountTotal = cart?.discount_total ?? 0
  const total = cart?.total ?? 0

  return (
    <section className="py-10 sm:py-14">
      <div className="wrap max-w-5xl">
        <Link href="/catalogo" className="text-[0.92rem] text-muted hover:text-ink no-underline mb-6 inline-block">
          {t.backToStore}
        </Link>

        {order ? (
          <OrderPlaced order={order} />
        ) : !ready ? (
          <p className="text-muted py-16 text-center">{t.cartLoading}</p>
        ) : !hasItems ? (
          <div className="max-w-xl mx-auto text-center py-12">
            <h1 className="text-[clamp(2rem,4vw,2.8rem)] mb-4">{t.cartTitle}</h1>
            <p className="text-muted mb-8">{t.cartEmpty}</p>
            <Link href="/catalogo" className="btn btn-dark">
              Ver el catálogo
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-[clamp(2rem,4vw,2.8rem)] mb-8">{t.cartTitle}</h1>
            <div className="grid lg:grid-cols-[1fr_380px] gap-10 lg:gap-12">
              <form onSubmit={submit} className="space-y-10 order-2 lg:order-1">
                <div>
                  <h2 className={sectionTitleCls}>{t.contactTitle}</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="field-label" htmlFor="buyer-name">
                        {t.buyerName}
                      </label>
                      <input
                        id="buyer-name"
                        autoComplete="name"
                        value={buyerName}
                        onChange={(e) => setBuyerName(e.target.value)}
                        className="field"
                      />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="field-label" htmlFor="buyer-phone">
                          {t.buyerPhone}
                        </label>
                        <input
                          id="buyer-phone"
                          type="tel"
                          autoComplete="tel"
                          value={buyerPhone}
                          onChange={(e) => setBuyerPhone(e.target.value)}
                          className="field"
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor="buyer-email">
                          {t.buyerEmail}
                        </label>
                        <input
                          id="buyer-email"
                          type="email"
                          autoComplete="email"
                          value={buyerEmail}
                          onChange={(e) => setBuyerEmail(e.target.value)}
                          className="field"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className={sectionTitleCls}>{t.deliveryMethodTitle}</h2>
                  <div className="grid sm:grid-cols-2 gap-3 mb-5">
                    {shippingOptions.map((option) => (
                      <label key={option.id} className={optionCardCls(optionId === option.id)}>
                        <input
                          type="radio"
                          name="delivery"
                          checked={optionId === option.id}
                          onChange={() => setOptionId(option.id)}
                          className="accent-ink"
                        />
                        <span className="flex-1 text-[0.95rem] font-semibold">{option.name}</span>
                        <span className="text-[0.9rem] text-muted">
                          {option.amount > 0 ? formatMoney(option.amount, currency) : t.freeShipping}
                        </span>
                      </label>
                    ))}
                  </div>

                  {!pickup ? (
                    <div className="space-y-4">
                      <div>
                        <label className="field-label" htmlFor="address-line">
                          {t.addressLine}
                        </label>
                        <input
                          id="address-line"
                          autoComplete="address-line1"
                          value={addressLine}
                          onChange={(e) => setAddressLine(e.target.value)}
                          className="field"
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor="address-unit">
                          {t.addressUnit}
                        </label>
                        <input
                          id="address-unit"
                          autoComplete="address-line2"
                          value={addressUnit}
                          onChange={(e) => setAddressUnit(e.target.value)}
                          className="field"
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="field-label" htmlFor="city">
                            {t.city}
                          </label>
                          <input
                            id="city"
                            autoComplete="address-level2"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="field"
                          />
                        </div>
                        <div>
                          <label className="field-label" htmlFor="postal-code">
                            {t.postalCode}
                          </label>
                          <input
                            id="postal-code"
                            autoComplete="postal-code"
                            value={postalCode}
                            onChange={(e) => setPostalCode(e.target.value)}
                            className="field"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white border border-line rounded-xl p-4 text-[0.95rem]">
                      <p className="m-0 font-semibold">{brand.location.address}</p>
                      {brand.location.hours.map((h) => (
                        <p key={h} className="m-0 text-muted">
                          {h}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h2 className={sectionTitleCls}>{t.paymentTitle}</h2>
                  <div className="space-y-3">
                    <label className={optionCardCls(paymentMethod === 'bank_transfer')}>
                      <input
                        type="radio"
                        name="payment"
                        checked={paymentMethod === 'bank_transfer'}
                        onChange={() => setPaymentMethod('bank_transfer')}
                        className="accent-ink"
                      />
                      <span className="text-[0.95rem] font-semibold">{t.bankTransferOption}</span>
                    </label>
                    <label className={optionCardCls(paymentMethod === 'cash_on_delivery')}>
                      <input
                        type="radio"
                        name="payment"
                        checked={paymentMethod === 'cash_on_delivery'}
                        onChange={() => setPaymentMethod('cash_on_delivery')}
                        className="accent-ink"
                      />
                      <span className="text-[0.95rem] font-semibold">{t.cashOnDeliveryOption}</span>
                    </label>
                  </div>
                  <p className="text-[0.9rem] text-muted mt-3 mb-0">
                    {paymentMethod === 'bank_transfer' ? t.transferHint : t.cashHint}
                  </p>
                </div>

                {error && (
                  <p className="text-[0.95rem] text-red-600 m-0" role="alert">
                    {error}
                  </p>
                )}

                <button type="submit" disabled={submitting || busy || !selectedOption} className="btn btn-dark w-full">
                  {submitting ? t.submitting : `${t.submitOrder} · ${formatMoney(total, currency)}`}
                </button>
              </form>

              <aside className="order-1 lg:order-2 lg:sticky lg:top-28 self-start bg-white border border-line rounded-[var(--radius-card)] p-5 sm:p-6 space-y-5 h-fit">
                <ul className="divide-y divide-line m-0 p-0 list-none">
                  {items.map((item) => (
                    <li key={item.lineId} className="flex gap-3 py-4 first:pt-0">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-paper shrink-0">
                        {item.heroImage && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.heroImage} alt="" className="w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          {item.handle ? (
                            <Link
                              href={`/producto/${item.handle}`}
                              className="text-[0.95rem] font-semibold leading-snug no-underline hover:underline"
                            >
                              {item.title}
                            </Link>
                          ) : (
                            <p className="text-[0.95rem] font-semibold leading-snug m-0">{item.title}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => remove(item.lineId)}
                            disabled={busy}
                            aria-label={`${t.remove} ${item.title}`}
                            className="text-muted hover:text-ink p-0.5 -mt-0.5 shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        {item.variantTitle && <p className="text-[0.82rem] text-muted m-0">{item.variantTitle}</p>}
                        <div className="flex items-center justify-between gap-2 mt-2">
                          <div className="inline-flex items-center border border-line rounded-full">
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.lineId, item.quantity - 1)}
                              disabled={busy || item.quantity <= 1}
                              aria-label="Restar uno"
                              className="p-1.5 disabled:opacity-30"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="min-w-6 text-center text-[0.9rem] font-semibold" aria-live="polite">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => changeQuantity(item.lineId, item.quantity + 1)}
                              disabled={busy}
                              aria-label="Sumar uno"
                              className="p-1.5 disabled:opacity-30"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="text-[0.95rem] font-semibold">{formatMoney(item.total, currency)}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {lineError && (
                  <p className="text-[0.85rem] text-red-600 m-0" role="alert">
                    {lineError}
                  </p>
                )}

                <div>
                  <div className="flex items-center gap-2">
                    <input
                      value={discountInput}
                      onChange={(e) => {
                        setDiscountInput(e.target.value)
                        setDiscountError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          applyDiscount()
                        }
                      }}
                      placeholder={t.discountPlaceholder}
                      aria-label={t.discountPlaceholder}
                      className="field !py-2.5 flex-1 min-w-0"
                    />
                    <button
                      type="button"
                      onClick={applyDiscount}
                      disabled={discountBusy || !discountInput.trim()}
                      className="btn btn-outline btn-sm shrink-0"
                    >
                      {discountBusy ? t.discountApplying : t.applyDiscount}
                    </button>
                  </div>
                  {discountError && <p className="text-[0.85rem] text-red-600 mt-2 mb-0">{discountError}</p>}
                  {appliedCodes.map((code) => (
                    <p key={code} className="flex items-center gap-2 text-[0.85rem] text-green-700 mt-2 mb-0">
                      {t.discountApplied}: <strong>{code}</strong>
                      <button
                        type="button"
                        onClick={() => removeDiscount(code)}
                        disabled={discountBusy}
                        className="text-muted underline hover:text-ink"
                      >
                        {t.removeDiscount}
                      </button>
                    </p>
                  ))}
                </div>

                <dl className="border-t border-line pt-4 space-y-2 text-[0.95rem] m-0">
                  <div className="flex justify-between text-muted">
                    <dt>{t.subtotal}</dt>
                    <dd className="m-0">{formatMoney(subtotal, currency)}</dd>
                  </div>
                  <div className="flex justify-between text-muted">
                    <dt>{t.shippingLine}</dt>
                    <dd className="m-0">{shippingTotal > 0 ? formatMoney(shippingTotal, currency) : t.freeShipping}</dd>
                  </div>
                  {discountTotal > 0 && (
                    <div className="flex justify-between text-green-700">
                      <dt>{t.discountLine}</dt>
                      <dd className="m-0">-{formatMoney(discountTotal, currency)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between text-[1.1rem] font-bold pt-2 border-t border-line">
                    <dt>{t.total}</dt>
                    <dd className="m-0">{formatMoney(total, currency)}</dd>
                  </div>
                </dl>
              </aside>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function OrderPlaced({ order }: { order: PlacedOrder }) {
  const transfer = order.paymentMethod === 'bank_transfer'
  const message = transfer
    ? `${brand.whatsapp.greeting} Hice el pedido #${order.number} por ${formatMoney(order.total, order.currency)}. Te paso el comprobante de la transferencia.`
    : `${brand.whatsapp.greeting} Hice el pedido #${order.number} por ${formatMoney(order.total, order.currency)}, pago en efectivo.`

  return (
    <div className="max-w-xl mx-auto text-center py-10">
      <p className="mx-auto mb-5 grid place-items-center w-14 h-14 rounded-full bg-ink text-white text-2xl">✓</p>
      <h1 className="text-[clamp(1.8rem,4vw,2.5rem)] mb-3">{t.orderSuccess.replace('{{number}}', String(order.number))}</h1>
      <p className="text-muted mb-8">{transfer ? t.orderNextTransfer : t.orderNextCash}</p>

      {transfer && (
        <div className="bg-white border border-line rounded-[var(--radius-card)] p-5 text-left mb-8">
          <p className="field-label">{t.transferInfo}</p>
          <p className="whitespace-pre-line m-0 mb-3">{brand.payment.transferInstructions}</p>
          <p className="m-0 font-bold">
            {t.total}: {formatMoney(order.total, order.currency)}
          </p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a href={whatsappUrl(message)} target="_blank" rel="noopener" className="btn btn-dark">
          <WhatsAppIcon />
          {transfer ? t.sendComprobante : t.coordinateWhatsapp}
        </a>
        <Link href="/catalogo" className="btn btn-outline">
          {t.backToStore}
        </Link>
      </div>
    </div>
  )
}
