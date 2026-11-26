import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import { capturePaymentWorkflow, markPaymentCollectionAsPaid } from '@medusajs/medusa/core-flows'
import { z } from 'zod'
import { ARONIUM_MODULE } from '../modules/aronium'
import type AroniumModuleService from '../modules/aronium/service'

// Pedidos web → Aronium (docs/sincronizador-aronium.md, punto 4.2).
//
// Cada pedido de la tienda entra en la cola `aronium_web_sale` con todo lo que
// hace falta para escribirlo en Aronium (payload) y un código de seguimiento
// (PW-1042-K7). El agente del local pide el trabajo pendiente
// (`listAgentWork`), lo hace en Aronium y devuelve el resultado
// (`applyAgentResult`). La tienda nunca toca la base de Aronium.
//
// Ciclo:  pending ──quote──▶ quoted ──(la cajera marca "Pagado")──▶ invoiced
//
// Trabajo que puede recibir el agente:
// - quote:  escribir la proforma ("No pagado").
// - watch:  la proforma está en Aronium: fijarse si la marcaron "Pagado" y,
//           si es así, crear la venta. El agente contesta con `invoice`.
// - cancel: el pedido se canceló en la tienda: anular la proforma, o escribir
//           la devolución si ya era venta.

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
  'customer_id',
  'customer.has_account',
  'customer.metadata',
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
  'shipping_address.company',
  'shipping_address.phone',
  'shipping_address.address_1',
  'shipping_address.address_2',
  'shipping_address.city',
  'shipping_address.province',
  'shipping_address.postal_code',
  'shipping_address.country_code',
  'payment_collections.id',
  'payment_collections.status',
  'payment_collections.payments.id',
  'payment_collections.payments.captured_at',
]

/** Lo que se escribe en Aronium. Se guarda al crear el pedido. */
export interface WebSalePayload {
  order_id: string
  display_id: number
  tracking_code: string
  created_at: string
  currency: string
  /** Total cobrado (renglones con descuentos + envío). */
  total: number
  payment_method: string | null
  delivery: string | null
  customer: {
    name: string
    phone: string | null
    email: string | null
    ruc: string | null
    business_name: string | null
    address: {
      line1: string | null
      line2: string | null
      city: string | null
      postal_code: string | null
      country_code: string | null
    }
  }
  /** Dirección en una línea, para la nota interna. */
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

// ---- Código de seguimiento -------------------------------------------------

// Sin letras ni números que se confunden al dictar o escribir a mano (0/O, 1/I/L).
const CHECK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * "PW-1042-K7": el número del pedido y 2 caracteres de control derivados de
 * él. Siempre da lo mismo para el mismo pedido, y un número mal tipeado casi
 * nunca coincide con su control.
 */
export function trackingCode(displayId: number): string {
  const n = CHECK_ALPHABET.length
  let h = 2166136261
  for (const ch of String(displayId)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  const check = CHECK_ALPHABET[h % n] + CHECK_ALPHABET[Math.floor(h / n) % n]
  return `PW-${displayId}-${check}`
}

/** ¿El código está bien escrito? (para buscarlo desde el panel). */
export function isValidTrackingCode(code: string): boolean {
  const m = /^PW-(\d+)-([A-Z0-9]{2})$/.exec(code.trim().toUpperCase())
  return Boolean(m && trackingCode(Number(m[1])) === `PW-${m[1]}-${m[2]}`)
}

// ---- Pedido → payload -------------------------------------------------------

export function buildPayload(order: OrderRow): WebSalePayload {
  const md = (order.metadata ?? {}) as Record<string, unknown>
  const addr = order.shipping_address ?? {}
  const name = [str(addr.first_name), str(addr.last_name)].filter(Boolean).join(' ') || 'Cliente web'
  const address = [str(addr.address_1), str(addr.address_2), str(addr.city)].filter(Boolean).join(', ') || null
  const shippingTotal = Number(order.shipping_total ?? 0)
  const shippingName = str(order.shipping_methods?.[0]?.name) ?? str(md.delivery_option)
  const displayId = Number(order.display_id)
  return {
    order_id: order.id,
    display_id: displayId,
    tracking_code: trackingCode(displayId),
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
      address: {
        line1: str(addr.address_1),
        line2: str(addr.address_2),
        city: str(addr.city),
        postal_code: str(addr.postal_code),
        country_code: str(addr.country_code)?.toUpperCase() ?? null,
      },
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

export async function loadOrder(container: MedusaContainer, orderId: string): Promise<OrderRow | null> {
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

async function findById(container: MedusaContainer, id: string) {
  const [row] = await service(container).listAroniumWebSales({ id }, { take: 1 })
  if (!row) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No existe el pedido web ${id}`)
  return row
}

function logger(container: MedusaContainer) {
  return container.resolve(ContainerRegistrationKeys.LOGGER)
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// ---- Eventos de la tienda ---------------------------------------------------

/**
 * Pide al agente que vuelva a mandar estos códigos en la próxima pasada (en
 * un minuto). Lo usa "Tomar de Aronium" y, al entrar o cancelarse un pedido
 * web, para que la tienda revise enseguida si el producto se oculta (la última
 * unidad quedó reservada) o vuelve (se liberó la reserva): Aronium no cambia
 * con una proforma, así que sin esto el agente no lo mandaría hasta la pasada
 * completa (cada 30 minutos).
 */
export async function requestCodesRefresh(container: MedusaContainer, codes: string[]) {
  const wanted = codes.filter(Boolean)
  if (!wanted.length) return
  const aronium = service(container)
  const [agent] = await aronium.listAroniumAgents({}, { take: 1 })
  const prev = (agent?.refresh_codes as { codes?: unknown } | null | undefined)?.codes
  const next = [...new Set([...(Array.isArray(prev) ? prev.map(String) : []), ...wanted])]
  if (agent) await aronium.updateAroniumAgents({ id: agent.id, refresh_codes: { codes: next } })
  else await aronium.createAroniumAgents({ refresh_codes: { codes: next } })
}

/** Códigos de los productos de un pedido web. */
function payloadCodes(payload: unknown): string[] {
  return ((payload as WebSalePayload | null)?.lines ?? []).map((l) => l.sku ?? '').filter(Boolean)
}

async function refreshSafely(container: MedusaContainer, codes: string[]) {
  try {
    await requestCodesRefresh(container, codes)
  } catch (error) {
    // Sin esto, la pasada completa lo corrige igual.
    logger(container).warn(`[aronium] No se pudo pedir el reenvío de ${codes.join(', ')}: ${message(error)}`)
  }
}

/**
 * Datos que quedan en la tienda además de la cola: el código de seguimiento
 * en el pedido (se ve en el panel) y el RUC y la razón social en el cliente
 * con cuenta (para la próxima compra). Si falla, el pedido sigue igual.
 */
async function saveOrderAndCustomerData(container: MedusaContainer, order: OrderRow, code: string) {
  try {
    const orders = container.resolve(Modules.ORDER)
    await orders.updateOrders(order.id, { metadata: { ...(order.metadata ?? {}), aronium_tracking_code: code } })
  } catch (error) {
    logger(container).warn(`[aronium] No se pudo guardar el código ${code} en el pedido ${order.id}: ${message(error)}`)
  }

  const md = (order.metadata ?? {}) as Record<string, unknown>
  const ruc = str(md.ruc)
  const businessName = str(md.razon_social)
  if (!order.customer_id || !order.customer?.has_account || (!ruc && !businessName)) return
  const current = (order.customer.metadata ?? {}) as Record<string, unknown>
  if (current.ruc === ruc && current.razon_social === businessName) return
  try {
    const customers = container.resolve(Modules.CUSTOMER)
    await customers.updateCustomers(order.customer_id, {
      metadata: { ...current, ...(ruc ? { ruc } : {}), ...(businessName ? { razon_social: businessName } : {}) },
    })
  } catch (error) {
    logger(container).warn(`[aronium] No se pudo guardar el RUC en el cliente ${order.customer_id}: ${message(error)}`)
  }
}

/** order.placed: el pedido entra en la cola. Si ya estaba, no hace nada. */
export async function enqueueOrder(container: MedusaContainer, orderId: string) {
  if (await findByOrder(container, orderId)) return null
  const order = await loadOrder(container, orderId)
  if (!order) return null
  const payload = buildPayload(order)
  const row = await service(container).createAroniumWebSales({
    order_id: order.id,
    display_id: payload.display_id,
    tracking_code: payload.tracking_code,
    status: 'pending',
    paid: isPaid(order),
    payload: payload as unknown as Record<string, unknown>,
  })
  await saveOrderAndCustomerData(container, order, payload.tracking_code)
  await refreshSafely(container, payloadCodes(payload))
  return row
}

/** payment.captured (se marcó pagado en el panel o lo marcó el agente). */
export async function markOrderPaid(container: MedusaContainer, orderId: string) {
  const sale = await findByOrder(container, orderId)
  if (!sale || sale.paid) return
  await service(container).updateAroniumWebSales({ id: sale.id, paid: true })
}

/**
 * order.canceled: si no llegó a Aronium, sale de la cola; si hay proforma o
 * venta, falta anularla o hacer la devolución.
 */
export async function cancelOrder(container: MedusaContainer, orderId: string) {
  const sale = await findByOrder(container, orderId)
  if (!sale || sale.status === 'cancelled' || sale.status === 'cancel_pending') return
  const inAronium = sale.status === 'quoted' || sale.status === 'invoiced'
  await service(container).updateAroniumWebSales({
    id: sale.id,
    status: inAronium ? 'cancel_pending' : 'cancelled',
    ...(inAronium ? {} : { cancelled_at: new Date() }),
    last_error: null,
  })
  await refreshSafely(container, payloadCodes(sale.payload))
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

/**
 * La venta ya está en Aronium (la cajera cobró): el pedido queda pagado en la
 * tienda, igual que con "Marcar como pagado" del panel.
 */
async function markOrderPaidInStore(container: MedusaContainer, orderId: string) {
  const order = await loadOrder(container, orderId)
  if (!order || isPaid(order)) return
  for (const pc of order.payment_collections ?? []) {
    if (!pc || pc.status === 'completed' || pc.status === 'canceled') continue
    const pending = (pc.payments ?? []).filter((p: OrderRow) => p && !p.captured_at)
    if (pending.length) {
      for (const p of pending) await capturePaymentWorkflow(container).run({ input: { payment_id: p.id } })
    } else {
      await markPaymentCollectionAsPaid(container).run({ input: { order_id: orderId, payment_collection_id: pc.id } })
    }
  }
}

// ---- Agente ---------------------------------------------------------------

export type AgentAction = 'quote' | 'watch' | 'cancel'

export interface AgentJob {
  id: string
  action: AgentAction
  tracking_code: string
  aronium_quote_number: string | null
  aronium_number: string | null
  payload: unknown
}

/** Trabajo para el agente, del más viejo al más nuevo. */
export async function listAgentWork(container: MedusaContainer, limit = 20): Promise<AgentJob[]> {
  const aronium = service(container)
  // Pausado desde el panel: no hay trabajo (lo pendiente espera en la cola).
  const [agent] = await aronium.listAroniumAgents({}, { take: 1 })
  if (agent?.web_sales_paused) return []
  // Un agente anterior al rediseño de la proforma no entiende este trabajo:
  // lo pendiente espera hasta que se actualice (el panel lo avisa).
  if (agent?.version && !supportsQuotes(agent.version)) return []
  const rows = await aronium.listAroniumWebSales(
    { status: ['pending', 'quoted', 'cancel_pending'] },
    { order: { created_at: 'ASC' }, take: 500 }
  )
  const work: AgentJob[] = []
  // Primero lo que cambia algo (proformas nuevas, cancelaciones); los "watch"
  // son una lectura barata y van todos, sin límite, para que ninguna proforma
  // pagada espere.
  for (const row of rows) {
    if (row.status === 'quoted') continue
    if (work.length >= limit) break
    work.push(job(row, row.status === 'pending' ? 'quote' : 'cancel'))
  }
  for (const row of rows) if (row.status === 'quoted') work.push(job(row, 'watch'))
  return work
}

/** Versión mínima del agente con el ciclo proforma → venta. */
export const MIN_AGENT_VERSION = '0.7.0'

export function supportsQuotes(version: string): boolean {
  const [a = 0, b = 0, c = 0] = version.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const [x, y, z] = MIN_AGENT_VERSION.split('.').map(Number)
  return a !== x ? a > x : b !== y ? b > y : c >= z
}

function job(row: Record<string, any>, action: AgentAction): AgentJob {
  return {
    id: row.id,
    action,
    tracking_code: row.tracking_code ?? trackingCode(row.display_id),
    aronium_quote_number: row.aronium_quote_number ?? null,
    aronium_number: row.aronium_number ?? null,
    payload: row.payload,
  }
}

export const agentResultSchema = z.object({
  action: z.enum(['quote', 'invoice', 'cancel']),
  ok: z.boolean(),
  quote_number: z.string().nullish(),
  aronium_number: z.string().nullish(),
  refund_number: z.string().nullish(),
  error: z.string().nullish(),
  warning: z.string().nullish(),
})

export async function applyAgentResult(container: MedusaContainer, id: string, input: z.infer<typeof agentResultSchema>) {
  const aronium = service(container)
  const sale = await findById(container, id)

  if (!input.ok) {
    // Una proforma que no se pudo escribir pasa a "con error" (se reintenta
    // desde el panel). Una venta o una anulación que falla deja el pedido
    // como estaba y se reintenta sola en la pasada siguiente.
    return aronium.updateAroniumWebSales({
      id,
      attempts: sale.attempts + 1,
      last_error: input.error ?? 'Error sin detalle',
      ...(input.action === 'quote' && sale.status === 'pending' ? { status: 'failed' as const } : {}),
    })
  }

  if (input.action === 'quote') {
    return aronium.updateAroniumWebSales({
      id,
      // Si se canceló mientras el agente escribía, la proforma queda para anular.
      status: sale.status === 'cancelled' ? 'cancel_pending' : 'quoted',
      aronium_quote_number: input.quote_number ?? null,
      registered_at: new Date(),
      attempts: sale.attempts + 1,
      last_error: null,
      warning: input.warning ?? null,
      ...(sale.status === 'cancelled' ? { cancelled_at: null } : {}),
    })
  }

  if (input.action === 'invoice') {
    // Si el pedido se canceló mientras tanto, la venta ya existe en Aronium:
    // queda en cancel_pending y el agente escribe la devolución.
    const cancelling = sale.status === 'cancel_pending'
    const warnings = [input.warning].filter(Boolean) as string[]
    if (!cancelling) {
      try {
        await markOrderPaidInStore(container, sale.order_id)
      } catch (error) {
        warnings.push(`La venta está en Aronium pero no se pudo marcar el pedido como pagado en la tienda: ${message(error)}. Marcalo a mano.`)
      }
    }
    return aronium.updateAroniumWebSales({
      id,
      status: cancelling ? 'cancel_pending' : 'invoiced',
      aronium_number: input.aronium_number ?? null,
      invoiced_at: new Date(),
      paid: true,
      last_error: null,
      warning: warnings.length ? warnings.join(' ') : null,
    })
  }

  return aronium.updateAroniumWebSales({
    id,
    status: 'cancelled',
    aronium_refund_number: input.refund_number ?? null,
    cancelled_at: new Date(),
    last_error: null,
    ...(input.warning ? { warning: input.warning } : {}),
  })
}

/**
 * Panel: "La cargué a mano". El local lo registró en Aronium por su cuenta (por
 * ejemplo, porque un producto no tenía código o se borró la proforma): el
 * agente no lo toca más.
 */
export async function skipWebSale(container: MedusaContainer, id: string) {
  const sale = await findById(container, id)
  // Una proforma con error (por ejemplo, la borraron en Aronium) también: el
  // aviso le pide a la cajera cargar la venta a mano.
  const quotedWithError = sale.status === 'quoted' && Boolean(sale.last_error)
  if (sale.status !== 'failed' && sale.status !== 'pending' && !quotedWithError) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'Solo un pedido pendiente o con error se puede marcar como cargado a mano.')
  }
  return service(container).updateAroniumWebSales({ id, status: 'skipped', last_error: null })
}

/** Panel: "Reintentar" un pedido que falló. */
export async function retryWebSale(container: MedusaContainer, id: string) {
  const sale = await findById(container, id)
  if (sale.status !== 'failed') return sale
  // Se rearma el payload por si el problema era un dato del pedido.
  const order = await loadOrder(container, sale.order_id)
  return service(container).updateAroniumWebSales({
    id,
    status: 'pending',
    last_error: null,
    ...(order ? { payload: buildPayload(order) as unknown as Record<string, unknown>, paid: sale.paid || isPaid(order) } : {}),
  })
}

/** Panel: los últimos pedidos web y su estado en Aronium. */
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
        tracking_code: r.tracking_code ?? trackingCode(r.display_id),
        status: r.status,
        paid: r.paid,
        aronium_quote_number: r.aronium_quote_number,
        aronium_number: r.aronium_number,
        aronium_refund_number: r.aronium_refund_number,
        last_error: r.last_error,
        warning: r.warning,
        attempts: r.attempts,
        created_at: r.created_at,
        registered_at: r.registered_at,
        invoiced_at: r.invoiced_at,
        customer: p?.customer?.name ?? null,
        total: p?.total ?? null,
        items: (p?.lines ?? []).reduce((n, l) => n + l.quantity, 0),
      }
    }),
    count,
  }
}

/** Panel: cuántos pedidos esperan algo (para el aviso). */
export async function webSaleAlerts(container: MedusaContainer) {
  const rows = await service(container).listAroniumWebSales(
    { status: ['pending', 'quoted', 'failed', 'cancel_pending'] },
    { take: 1000 }
  )
  const count = (s: string) => rows.filter((r) => r.status === s).length
  const [agent] = await service(container).listAroniumAgents({}, { take: 1 })
  return {
    agent_outdated: Boolean(agent?.version && !supportsQuotes(agent.version)),
    pending: count('pending'),
    quoted: count('quoted'),
    failed: count('failed'),
    cancel_pending: count('cancel_pending'),
    warnings: rows.filter((r) => r.warning).length,
  }
}

// ---- Stock (regla 4) --------------------------------------------------------

/**
 * Unidades a sumar al stock de Aronium por artículo de inventario, para que
 * un pedido web no se descuente dos veces:
 * - pedidos ya convertidos en venta en Aronium (por el agente, o "cargados a
 *   mano") que siguen reservados en la tienda (todavía no entregados): Aronium
 *   ya los restó y la reserva también.
 * - ventas canceladas en la tienda cuya devolución todavía no llegó a Aronium:
 *   la tienda ya liberó la reserva pero Aronium todavía no devolvió el stock.
 * Una proforma no mueve stock en Aronium: no suma nada.
 *
 * stock en la tienda = stock de Aronium + esto.
 */
export async function webSaleStockAdjustments(
  container: MedusaContainer,
  inventoryItemBySku: Map<string, string>
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const rows = await service(container).listAroniumWebSales({ status: ['invoiced', 'skipped', 'cancel_pending'] }, { take: 5000 })
  if (!rows.length) return out

  const invoicedLines: string[] = []
  for (const row of rows) {
    const p = row.payload as unknown as WebSalePayload
    if (row.status === 'invoiced' || row.status === 'skipped') {
      invoicedLines.push(...p.lines.map((l) => l.line_item_id))
    } else if (row.aronium_number) {
      // cancel_pending de una venta (no de una proforma): falta la devolución.
      for (const line of p.lines) {
        const inv = line.sku ? inventoryItemBySku.get(line.sku) : undefined
        if (inv) out.set(inv, (out.get(inv) ?? 0) + line.quantity)
      }
    }
  }

  if (invoicedLines.length) {
    const inventory = container.resolve(Modules.INVENTORY)
    const reservations = await inventory.listReservationItems({ line_item_id: invoicedLines }, { take: 10000 })
    for (const r of reservations) {
      out.set(r.inventory_item_id, (out.get(r.inventory_item_id) ?? 0) + Number(r.quantity))
    }
  }
  return out
}
