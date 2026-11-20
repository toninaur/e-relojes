import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { z } from 'zod'
import { CONTIMARKET_MODULE } from '../modules/contimarket'
import type ContimarketModuleService from '../modules/contimarket/service'
import { batches, buildItem, type ContimarketItem, type ContimarketRules, itemHash, planPush, type StoreProductSnapshot } from './contimarket'
import { ContimarketAuthError, createContimarketClient, credentialsFromEnv, type ContimarketCredentials } from './contimarket-client'

// Tienda → ContiMarket. Aparte de la sincronización con Aronium (que es
// prioritaria): se dispara DESPUÉS de cada pasada del agente, con demora, y
// cada 5 minutos (jobs/contimarket-push.ts); nunca dentro de la pasada. Todo
// error queda acá: la tienda y Aronium no se enteran.
//
// Usa los mismos números que la tienda ya reconcilió con Aronium: precio
// normal y stock disponible (stock − reservado por pedidos web). Manda solo lo
// que cambió (huella por producto) y todo una vez por día.

const CURRENCY = 'pyg'
const FULL_EVERY_MS = 24 * 60 * 60 * 1000
const DEBOUNCE_MS = 15_000

function service(container: MedusaContainer): ContimarketModuleService {
  return container.resolve(CONTIMARKET_MODULE)
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** La fila de configuración (se crea apagada la primera vez). */
export async function getContimarketSettings(container: MedusaContainer) {
  const cm = service(container)
  const [row] = await cm.listContimarketSettings({}, { take: 1 })
  return row ?? (await cm.createContimarketSettings({}))
}

export function rulesFrom(settings: Record<string, any>): ContimarketRules {
  return {
    products: settings.products === 'tagged' ? 'tagged' : 'all',
    price_rule: ['offer', 'percent'].includes(settings.price_rule) ? settings.price_rule : 'same',
    price_percent: Number(settings.price_percent) || 0,
    min_stock: Math.max(1, Number(settings.min_stock) || 1),
    dimensions: (settings.dimensions as ContimarketRules['dimensions']) ?? null,
  }
}

// ---- Lo que hay en la tienda ----------------------------------------------------

type Row = Record<string, any>

/** Los productos de la tienda con código, como los necesita ContiMarket. */
export async function loadStoreSnapshots(container: MedusaContainer): Promise<StoreProductSnapshot[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: lists } = await query.graph({ entity: 'price_list', fields: ['id', 'status', 'starts_at', 'ends_at'] })
  const now = Date.now()
  const activeLists = new Set(
    (lists as Row[])
      .filter((l) => l.status === 'active' && (!l.starts_at || new Date(l.starts_at).getTime() <= now) && (!l.ends_at || new Date(l.ends_at).getTime() > now))
      .map((l) => l.id)
  )
  const { data: products } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'title',
      'description',
      'status',
      'thumbnail',
      'metadata',
      'images.url',
      'type.value',
      'collection.title',
      'tags.value',
      'variants.sku',
      'variants.price_set.prices.amount',
      'variants.price_set.prices.currency_code',
      'variants.price_set.prices.price_list_id',
      'variants.inventory_items.inventory.location_levels.stocked_quantity',
      'variants.inventory_items.inventory.location_levels.reserved_quantity',
    ],
  })
  const out: StoreProductSnapshot[] = []
  for (const p of products as Row[]) {
    const md = (p.metadata ?? {}) as Row
    const images = [p.thumbnail, ...(p.images ?? []).map((i: Row) => i?.url)].filter((u, i, all): u is string => Boolean(u) && all.indexOf(u) === i)
    for (const v of p.variants ?? []) {
      const code = String(v?.sku ?? '').trim()
      if (!code) continue
      const prices = (v.price_set?.prices ?? []).filter((x: Row) => x?.currency_code === CURRENCY)
      const base = prices.find((x: Row) => !x.price_list_id)
      if (!base) continue
      const offers = prices.filter((x: Row) => x.price_list_id && activeLists.has(x.price_list_id)).map((x: Row) => Number(x.amount))
      let available = 0
      for (const ii of v.inventory_items ?? []) {
        for (const l of ii?.inventory?.location_levels ?? []) available += (Number(l?.stocked_quantity) || 0) - (Number(l?.reserved_quantity) || 0)
      }
      out.push({
        code,
        product_id: p.id,
        title: p.title ?? code,
        description: p.description ?? null,
        published: p.status === 'published',
        brand: p.collection?.title ?? null,
        type: p.type?.value ?? null,
        tags: (p.tags ?? []).map((t: Row) => String(t?.value ?? '')).filter(Boolean),
        color: typeof md.color === 'string' ? md.color : null,
        strap: typeof md.malla === 'string' ? md.malla : null,
        specs: typeof md.specs === 'string' ? md.specs : null,
        images,
        price: Number(base.amount),
        offer_price: offers.length ? Math.min(...offers) : null,
        available,
      })
    }
  }
  return out
}

// ---- El envío ---------------------------------------------------------------------

export interface PushOutcome {
  skipped?: string
  sent: number
  rejected: number
  error?: string
}

type Client = ReturnType<typeof createContimarketClient>

/**
 * Manda a ContiMarket lo que cambió (o todo). Si ContiMarket rechaza algunos
 * productos de una tanda, se marcan con su motivo y el resto de la tanda se
 * vuelve a mandar sin ellos.
 */
export async function pushContimarket(
  container: MedusaContainer,
  options: { full?: boolean; reason?: string; credentials?: ContimarketCredentials | null; client?: Client } = {}
): Promise<PushOutcome> {
  const started = Date.now()
  const cm = service(container)
  const settings = await getContimarketSettings(container)
  if (!settings.enabled) return { skipped: 'apagado', sent: 0, rejected: 0 }
  if (settings.paused) return { skipped: 'en pausa', sent: 0, rejected: 0 }
  const credentials = options.credentials === undefined ? credentialsFromEnv() : options.credentials
  if (!credentials) {
    const error = 'Faltan las credenciales de ContiMarket (CONTIMARKET_URL, CONTIMARKET_USER y CONTIMARKET_PASSWORD en Railway).'
    await recordError(cm, settings.id, error)
    return { skipped: 'sin credenciales', sent: 0, rejected: 0, error }
  }
  const client = options.client ?? createContimarketClient(credentials)

  const full = Boolean(options.full || settings.full_requested || !settings.last_full_at || started - new Date(settings.last_full_at).getTime() >= FULL_EVERY_MS)
  const rules = rulesFrom(settings)
  const items = (await loadStoreSnapshots(container)).map((s) => ({ item: buildItem(s, rules), productId: s.product_id }))
  const productIdByCode = new Map(items.map((x) => [x.item.CodigoProducto, x.productId]))
  const records = await cm.listContimarketProducts({}, { take: 100000 })
  const recordByCode = new Map(records.map((r) => [r.code, r]))
  const previous = new Map(records.map((r) => [r.code, r.status === 'ok' ? r.hash : null]))
  const toSend = planPush(
    items.map((x) => x.item),
    previous,
    full
  )

  let sent = 0
  let rejected = 0
  const now = new Date()
  const save = async (item: ContimarketItem, error: string | null) => {
    const record = recordByCode.get(item.CodigoProducto)
    const data = {
      code: item.CodigoProducto,
      product_id: productIdByCode.get(item.CodigoProducto) ?? null,
      title: item.Nombre,
      hash: error ? null : itemHash(item),
      status: error ? ('error' as const) : ('ok' as const),
      last_error: error,
      stock: item.Stock,
      price: item.PrecioContinental,
      ...(error ? {} : { sent_at: now }),
    }
    if (record) await cm.updateContimarketProducts({ id: record.id, ...data })
    else recordByCode.set(item.CodigoProducto, await cm.createContimarketProducts(data))
  }

  try {
    for (const batch of batches(toSend)) {
      const first = await client.importProducts(batch)
      if (first.ok) {
        for (const item of batch) await save(item, null)
        sent += batch.length
        continue
      }
      // Rechazó algunos: se marcan y el resto va de nuevo sin ellos. Si no se
      // entiende la respuesta, la tanda entera queda con el error.
      const bad = new Map<string, string>()
      for (const r of first.rejected) bad.set(r.code, [bad.get(r.code), r.message].filter(Boolean).join('; '))
      const named = batch.filter((item) => bad.has(item.CodigoProducto))
      if (!named.length) {
        for (const item of batch) await save(item, `ContiMarket rechazó la tanda: ${first.raw || 'sin detalle'}`)
        rejected += batch.length
        continue
      }
      for (const item of named) await save(item, bad.get(item.CodigoProducto)!)
      rejected += named.length
      const rest = batch.filter((item) => !bad.has(item.CodigoProducto))
      if (!rest.length) continue
      const second = await client.importProducts(rest)
      if (second.ok) {
        for (const item of rest) await save(item, null)
        sent += rest.length
      } else {
        for (const item of rest) await save(item, `ContiMarket rechazó la tanda: ${second.raw || 'sin detalle'}`)
        rejected += rest.length
      }
    }
  } catch (error) {
    // Sin conexión, clave rechazada, etc.: lo que no se mandó queda para la
    // pasada siguiente (no se guardó su huella).
    const text = error instanceof ContimarketAuthError ? error.message : `No se pudo mandar a ContiMarket: ${message(error)}`
    await recordError(cm, settings.id, text)
    await cm.createContimarketRuns({ status: 'error', full, reason: options.reason ?? null, sent, rejected, error: text, duration_ms: Date.now() - started })
    return { sent, rejected, error: text }
  }

  await cm.updateContimarketSettings({
    id: settings.id,
    last_run_at: now,
    ...(full ? { last_full_at: now, full_requested: false } : {}),
    last_error: null,
  })
  if (sent || rejected) {
    await cm.createContimarketRuns({ status: 'ok', full, reason: options.reason ?? null, sent, rejected, duration_ms: Date.now() - started })
  }
  return { sent, rejected }
}

async function recordError(cm: ContimarketModuleService, settingsId: string, error: string) {
  await cm.updateContimarketSettings({ id: settingsId, last_error: error, last_error_at: new Date() })
}

// ---- Panel → ContiMarket ------------------------------------------------------------

export const contimarketSettingsSchema = z
  .object({
    enabled: z.boolean(),
    paused: z.boolean(),
    products: z.enum(['all', 'tagged']),
    price_rule: z.enum(['same', 'offer', 'percent']),
    price_percent: z.number().min(0).max(90),
    min_stock: z.number().int().min(1).max(20),
    dimensions: z.record(z.string(), z.object({ kg: z.number().positive().max(100).optional(), cm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional() })).nullable(),
  })
  .partial()

export async function updateContimarketSettings(container: MedusaContainer, input: z.infer<typeof contimarketSettingsSchema>) {
  const settings = await getContimarketSettings(container)
  await service(container).updateContimarketSettings({ id: settings.id, ...input })
  // Cambió qué o cómo se publica: se recalcula todo en la pasada siguiente.
  scheduleContimarketPush(container, 'cambio de configuración en el panel')
  return getContimarketStatus(container)
}

/** "Sincronizar todo ahora": pasada completa en unos segundos. */
export async function requestContimarketFull(container: MedusaContainer) {
  const settings = await getContimarketSettings(container)
  await service(container).updateContimarketSettings({ id: settings.id, full_requested: true })
  scheduleContimarketPush(container, 'pedido desde el panel')
  return getContimarketStatus(container)
}

/** Lo que muestra el panel → ContiMarket. */
export async function getContimarketStatus(container: MedusaContainer) {
  const cm = service(container)
  const settings = await getContimarketSettings(container)
  const [rejected, rejectedCount] = await cm.listAndCountContimarketProducts({ status: 'error' }, { order: { updated_at: 'DESC' }, take: 100 })
  const [, sentCount] = await cm.listAndCountContimarketProducts({ status: 'ok' }, { take: 1 })
  const runs = await cm.listContimarketRuns({}, { order: { created_at: 'DESC' }, take: 20 })
  return {
    // Sin las credenciales no se manda nada (van en Railway, no en el panel).
    has_credentials: Boolean(credentialsFromEnv()),
    settings,
    products_ok: sentCount,
    products_rejected: rejectedCount,
    rejected: rejected.map((r) => ({ code: r.code, title: r.title, product_id: r.product_id, error: r.last_error, updated_at: r.updated_at })),
    runs,
  }
}

// ---- Cuándo corre -----------------------------------------------------------------

let timer: NodeJS.Timeout | null = null
let running = false
let again = false
const reasons = new Set<string>()

/**
 * Pide una pasada a ContiMarket en unos segundos (varias seguidas se juntan
 * en una). Nunca espera ni tira errores: quien la pide (la sincronización con
 * Aronium) sigue igual pase lo que pase con ContiMarket.
 */
export function scheduleContimarketPush(container: MedusaContainer, reason: string) {
  reasons.add(reason)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const why = [...reasons].join(', ')
    reasons.clear()
    void runContimarketExclusive(container, { reason: why })
  }, DEBOUNCE_MS)
  timer.unref?.()
}

/** Una pasada por vez; si piden otra mientras corre, se hace una más al terminar. */
export async function runContimarketExclusive(container: MedusaContainer, options: { full?: boolean; reason?: string } = {}) {
  if (running) {
    again = true
    return null
  }
  running = true
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const outcome = await pushContimarket(container, options)
    if (outcome.sent || outcome.rejected) logger.info(`[contimarket] ${outcome.sent} enviados, ${outcome.rejected} rechazados (${options.reason ?? ''})`)
    if (outcome.error) logger.warn(`[contimarket] ${outcome.error}`)
    return outcome
  } catch (error) {
    logger.error(`[contimarket] ${message(error)}`)
    return null
  } finally {
    running = false
    if (again) {
      again = false
      scheduleContimarketPush(container, 'pedido durante otra pasada')
    }
  }
}
