import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import { z } from 'zod'
import { ARONIUM_MODULE } from '../modules/aronium'
import type AroniumModuleService from '../modules/aronium/service'

// Ventas web → Aronium (ver docs/sincronizador-aronium.md, punto 4.2).
//
// Cada pedido de la tienda entra en la cola `aronium_web_sale` con todo lo que
// hace falta para escribirlo en Aronium (payload). El agente del local pide el
// trabajo pendiente (`listAgentWork`), lo escribe en Aronium y devuelve el
// resultado (`applyAgentResult`). La tienda nunca toca la base de Aronium.
//
// Trabajo que puede recibir el agente:
// - register: escribir la venta (y su pago, si ya está pagada).
// - payment:  la venta ya está en Aronium y ahora se pagó: agregar el pago.
// - cancel:   la venta está en Aronium y se canceló en la tienda: escribir la
//             devolución.

const ORDER_FIELDS = [
  'id',
  'display_id',
  'status',
  'created_at',
  'currency_code',
  'email',
  'metadata',
  'total',
  'item_total',
  'shipping_total',
  'discount_total',
  'items.id',
  'items.title',
  'items.product_title',
  'items.variant_sku',
  'items.variant_title',
  'items.quantity',
  'items.unit_price',
  'items.total',
  'shipping_methods.name',
  'shipping_methods.total',
  'shipping_address.first_name',
  'shipping_address.last_name',
  'shipping_address.phone',
  'shipping_address.address_1',
  'shipping_address.address_2',
  'shipping_address.city',
  'shipping_address.postal_code',
  'payment_collections.status',
]

/** Lo que se escribe en Aronium. Se guarda al crear el pedido. */
export interface WebSalePayload {
  order_id: string
  display_id: number
  created_at: string
  currency: string
  /** Total cobrado (renglones con descuentos + envío). */
  total: number
  payment_method: string | null
  delivery: string | null
  customer: { name: string; phone: string | null; email: string | null; ruc: string | null; business_name: string | null }
  address: string | null
  notes: string | null
  gift: boolean
  lines: { line_item_id: string; sku: string | null; title: string; quantity: number; unit_price: number; total: number }[]
  shipping: { name: string; total: number } | null
}

type OrderRow = Record<string, any>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function buildPayload(order: OrderRow): WebSalePayload {
  const md = (order.metadata ?? {}) as Record<string, unknown>
  const addr = order.shipping_address ?? {}
  const name = [str(addr.first_name), str(addr.last_name)].filter(Boolean).join(' ') || 'Cliente web'
  const address = [str(addr.address_1), str(addr.address_2), str(addr.city)].filter(Boolean).join(', ') || null
  const shippingTotal = Number(order.shipping_total ?? 0)
  const shippingName = str(order.shipping_methods?.[0]?.name) ?? str(md.delivery_option)
  return {
    order_id: order.id,
    display_id: Number(order.display_id),
    created_at: new Date(order.created_at).toISOString(),
    currency: String(order.currency_code ?? 'pyg').toUpperCase(),
    total: Number(order.total ?? 0),
    payment_method: str(md.payment_method),
    delivery: shippingName,
    customer: {
      name,
      phone: str(addr.phone),
      email: str(order.email),
      ruc: str(md.ruc),
      business_name: str(md.razon_social),
    },
    address,
    notes: str(md.notes),
    gift: md.gift === true,
    lines: (order.items ?? []).map((item: OrderRow) => {
      const quantity = Number(item.quantity ?? 0)
      const total = Number(item.total ?? Number(item.unit_price ?? 0) * quantity)
      return {
        line_item_id: item.id,
        sku: str(item.variant_sku),
        title: [str(item.product_title) ?? str(item.title), str(item.variant_title)].filter(Boolean).join(' · '),
        quantity,
        // Precio realmente cobrado por unidad (con oferta o cupón).
        unit_price: quantity ? Math.round(total / quantity) : 0,
        total,
      }
    }),
    shipping: shippingName ? { name: shippingName, total: shippingTotal } : null,
  }
}

async function loadOrder(container: MedusaContainer, orderId: string): Promise<OrderRow | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: 'order', fields: ORDER_FIELDS, filters: { id: orderId } })
  return (data[0] as OrderRow) ?? null
}

function isPaid(order: OrderRow): boolean {
  return (order.payment_collections ?? []).some((pc: OrderRow) => pc?.status === 'completed')
}

function service(container: MedusaContainer): AroniumModuleService {
  return container.resolve(ARONIUM_MODULE)
}

async function findByOrder(container: MedusaContainer, orderId: string) {
  const [row] = await service(container).listAroniumWebSales({ order_id: orderId }, { take: 1 })
  return row ?? null
}

/** order.placed: el pedido entra en la cola. Si ya estaba, no hace nada. */
export async function enqueueOrder(container: MedusaContainer, orderId: string) {
  if (await findByOrder(container, orderId)) return null
  const order = await loadOrder(container, orderId)
  if (!order) return null
  return service(container).createAroniumWebSales({
    order_id: order.id,
    display_id: Number(order.display_id),
    status: 'pending',
    paid: isPaid(order),
    payload: buildPayload(order) as unknown as Record<string, unknown>,
  })
}

/** payment.captured (se marcó pagado en el panel): el pago tiene que llegar a Aronium. */
export async function markOrderPaid(container: MedusaContainer, orderId: string) {
  const sale = await findByOrder(container, orderId)
  if (!sale || sale.paid) return
  await service(container).updateAroniumWebSales({ id: sale.id, paid: true })
}

/** order.canceled: si no llegó a Aronium, sale de la cola; si llegó, falta la devolución. */
export async function cancelOrder(container: MedusaContainer, orderId: string) {
  const sale = await findByOrder(container, orderId)
  if (!sale || sale.status === 'cancelled' || sale.status === 'cancel_pending') return
  const registered = sale.status === 'registered'
  await service(container).updateAroniumWebSales({
    id: sale.id,
    status: registered ? 'cancel_pending' : 'cancelled',
    ...(registered ? {} : { cancelled_at: new Date() }),
    last_error: null,
  })
}

/** El pago capturado → pedido. */
export async function orderIdForPayment(container: MedusaContainer, paymentId: string): Promise<string | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'payment',
    fields: ['id', 'payment_collection.id', 'payment_collection.order.id'],
    filters: { id: paymentId },
  })
  const row = data[0] as OrderRow | undefined
  return row?.payment_collection?.order?.id ?? null
}

// ---- Agente ---------------------------------------------------------------

export type AgentAction = 'register' | 'payment' | 'cancel'

/** Trabajo para el agente, del más viejo al más nuevo. */
export async function listAgentWork(container: MedusaContainer, limit = 20) {
  const aronium = service(container)
  const rows = await aronium.listAroniumWebSales(
    { status: ['pending', 'registered', 'cancel_pending'] },
    { order: { created_at: 'ASC' }, take: 500 }
  )
  const work: { id: string; action: AgentAction; paid: boolean; aronium_number: string | null; payload: unknown }[] = []
  for (const row of rows) {
    let action: AgentAction | null = null
    if (row.status === 'pending') action = 'register'
    else if (row.status === 'cancel_pending') action = 'cancel'
    else if (row.status === 'registered' && row.paid && !row.payment_registered) action = 'payment'
    if (action) work.push({ id: row.id, action, paid: row.paid, aronium_number: row.aronium_number ?? null, payload: row.payload })
    if (work.length >= limit) break
  }
  return work
}

export const agentResultSchema = z.object({
  action: z.enum(['register', 'payment', 'cancel']),
  ok: z.boolean(),
  aronium_number: z.string().nullish(),
  refund_number: z.string().nullish(),
  // El pago se escribió junto con la venta.
  payment_registered: z.boolean().nullish(),
  error: z.string().nullish(),
  warning: z.string().nullish(),
})

export async function applyAgentResult(container: MedusaContainer, id: string, input: z.infer<typeof agentResultSchema>) {
  const aronium = service(container)
  const [sale] = await aronium.listAroniumWebSales({ id }, { take: 1 })
  if (!sale) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No existe la venta web ${id}`)

  if (!input.ok) {
    // Un pago o una devolución que falla deja la venta como estaba (se
    // reintenta sola); una venta que no se pudo registrar pasa a "con error".
    return aronium.updateAroniumWebSales({
      id,
      attempts: sale.attempts + 1,
      last_error: input.error ?? 'Error sin detalle',
      ...(input.action === 'register' ? { status: 'failed' as const } : {}),
    })
  }

  if (input.action === 'register') {
    return aronium.updateAroniumWebSales({
      id,
      status: 'registered',
      aronium_number: input.aronium_number ?? null,
      payment_registered: Boolean(input.payment_registered),
      registered_at: new Date(),
      attempts: sale.attempts + 1,
      last_error: null,
      warning: input.warning ?? null,
    })
  }
  if (input.action === 'payment') {
    return aronium.updateAroniumWebSales({ id, payment_registered: true, last_error: null })
  }
  return aronium.updateAroniumWebSales({
    id,
    status: 'cancelled',
    aronium_refund_number: input.refund_number ?? null,
    cancelled_at: new Date(),
    last_error: null,
  })
}

/** Panel: "Reintentar" una venta que falló. */
export async function retryWebSale(container: MedusaContainer, id: string) {
  const aronium = service(container)
  const [sale] = await aronium.listAroniumWebSales({ id }, { take: 1 })
  if (!sale) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No existe la venta web ${id}`)
  if (sale.status !== 'failed') return sale
  // Se rearma el payload por si el problema era un dato del pedido.
  const order = await loadOrder(container, sale.order_id)
  return aronium.updateAroniumWebSales({
    id,
    status: 'pending',
    last_error: null,
    ...(order ? { payload: buildPayload(order) as unknown as Record<string, unknown>, paid: sale.paid || isPaid(order) } : {}),
  })
}

/** Panel: las últimas ventas web y su estado en Aronium. */
export async function listWebSalesForPanel(container: MedusaContainer, { limit = 20, offset = 0 } = {}) {
  const [rows, count] = await service(container).listAndCountAroniumWebSales(
    {},
    { order: { created_at: 'DESC' }, take: limit, skip: offset }
  )
  return {
    web_sales: rows.map((r) => {
      const p = r.payload as unknown as WebSalePayload
      return {
        id: r.id,
        order_id: r.order_id,
        display_id: r.display_id,
        status: r.status,
        paid: r.paid,
        payment_registered: r.payment_registered,
        aronium_number: r.aronium_number,
        aronium_refund_number: r.aronium_refund_number,
        last_error: r.last_error,
        warning: r.warning,
        attempts: r.attempts,
        created_at: r.created_at,
        registered_at: r.registered_at,
        customer: p?.customer?.name ?? null,
        total: p?.total ?? null,
        items: (p?.lines ?? []).reduce((n, l) => n + l.quantity, 0),
      }
    }),
    count,
  }
}

// ---- Stock (regla 4) --------------------------------------------------------

/**
 * Unidades a sumar al stock de Aronium por artículo de inventario, para que
 * una venta web no se descuente dos veces:
 * - ventas ya escritas en Aronium cuyo pedido sigue reservado en la tienda
 *   (todavía no entregado): Aronium ya las restó y la reserva también.
 * - ventas canceladas en la tienda cuya devolución todavía no llegó a Aronium:
 *   la tienda ya liberó la reserva pero Aronium todavía no devolvió el stock.
 *
 * stock en la tienda = stock de Aronium + esto.
 */
export async function webSaleStockAdjustments(
  container: MedusaContainer,
  inventoryItemBySku: Map<string, string>
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const rows = await service(container).listAroniumWebSales({ status: ['registered', 'cancel_pending'] }, { take: 5000 })
  if (!rows.length) return out

  const registeredLines: string[] = []
  for (const row of rows) {
    const p = row.payload as unknown as WebSalePayload
    if (row.status === 'registered') {
      registeredLines.push(...p.lines.map((l) => l.line_item_id))
    } else {
      for (const line of p.lines) {
        const inv = line.sku ? inventoryItemBySku.get(line.sku) : undefined
        if (inv) out.set(inv, (out.get(inv) ?? 0) + line.quantity)
      }
    }
  }

  if (registeredLines.length) {
    const inventory = container.resolve(Modules.INVENTORY)
    const reservations = await inventory.listReservationItems({ line_item_id: registeredLines }, { take: 10000 })
    for (const r of reservations) {
      out.set(r.inventory_item_id, (out.get(r.inventory_item_id) ?? 0) + Number(r.quantity))
    }
  }
  return out
}
