import os from 'node:os'
import { readImages, readProducts } from './aronium.mjs'
import { createApi } from './api.mjs'
import { pendingEntry, writeAlerts } from './alerts.mjs'
import { backupIfNeeded } from './backup.mjs'
import { loadConfig } from './config.mjs'
import { errorMessage, log } from './log.mjs'
import { checkSchema } from './schema.mjs'
import { loadState, saveState } from './state.mjs'
import { AroniumDataError, createWriter, isTransient } from './write.mjs'

// Sincronizador Aronium Lite ↔ tienda online (docs/sincronizador-aronium.md).
//
// Cada `intervalMinutes` (1 por defecto), en este orden:
// 1. Manda a la tienda los resultados que quedaron pendientes (proformas o
//    ventas ya escritas en Aronium cuando se cortó la conexión).
// 2. Pedidos web → Aronium: trae de la tienda los pedidos nuevos (proforma),
//    las proformas abiertas (si la cajera las marcó "Pagado", crea la venta)
//    y las cancelaciones (write.mjs). Antes de la primera escritura del día,
//    copia de respaldo de pos.db (backup.mjs).
// 3. Aronium → tienda: lee productos, precios y stock y manda lo que cambió
//    (todo cada FULL_EVERY_MINUTES, al arrancar o si desaparece un código).
//    Va después de 2: así, cuando el stock de Aronium ya tiene restada una
//    venta web, la tienda ya sabe que esa venta está en Aronium y no la
//    descuenta dos veces.
// 4. Fotos que pidió la tienda.
//
//   node src/index.mjs          corre en bucle (lo que usa la tarea programada)
//   node src/index.mjs --once   una sola pasada completa y termina

const VERSION = '0.8.2'
const FULL_EVERY_MINUTES = 30
const IMAGE_BATCH_SIZE = 10

const config = loadConfig()
const api = createApi(config)
const writer = createWriter(config)
const state = loadState()
// Códigos que la tienda pidió volver a mandar ("Tomar de Aronium", pedidos
// web nuevos o cancelados). Se guardan en state.json hasta mandarlos.
let forceCodes = new Set(state.forceCodes)
// Lo que se maneja desde el panel → Aronium (llega en cada respuesta de la
// tienda): frecuencia, "Sincronizar todo ahora" y pausa.
let intervalMinutes = config.intervalMinutes
let fullRequested = false
let wasPaused = false
// Último error informado por pedido: una proforma borrada falla en cada pasada
// y no hace falta repetirle lo mismo a la tienda. (Arriba del ciclo principal:
// lo que se declara después no existe todavía cuando corre la primera pasada.)
const lastReported = new Map()

// Escribir ventas: solo si la base de Aronium es una versión conocida.
const schema = checkSchemaSafe()
const writeEnabled = config.webSales.enabled && api.supportsWebSales && schema.ok
const agent = {
  version: VERSION,
  host: os.hostname(),
  interval_minutes: config.intervalMinutes,
  write_enabled: writeEnabled,
  write_blocked_reason: !config.webSales.enabled
    ? null
    : !api.supportsWebSales
      ? 'El conector usa la clave de administrador vieja: generá la clave del conector en el panel → Aronium para registrar ventas web.'
      : schema.ok
        ? null
        : schema.reason,
}
if (agent.write_blocked_reason) log(`Pedidos web desactivados: ${agent.write_blocked_reason}`)

if (process.argv.includes('--once')) {
  process.exitCode = (await pass({ forceFull: true })) ? 0 : 1
} else {
  log(`Agente ${VERSION} iniciado: ${config.storeUrl}, cada ${config.intervalMinutes} min${writeEnabled ? ', con pedidos web' : ''}`)
  for (;;) {
    await pass()
    await new Promise((r) => setTimeout(r, intervalMinutes * 60 * 1000))
  }
}

function checkSchemaSafe() {
  try {
    return checkSchema(config.aroniumDb)
  } catch (error) {
    return { ok: false, reason: `No se pudo revisar la base de Aronium (${config.aroniumDb}): ${errorMessage(error)}` }
  }
}

async function pass({ forceFull = false } = {}) {
  let ok = true
  try {
    await flushResults()
    if (writeEnabled) await webSales()
  } catch (error) {
    // Sin conexión con la tienda, etc.: el catálogo se intenta igual.
    log(`ERROR (ventas web): ${errorMessage(error)}`)
    ok = false
  }
  ok = (await catalog(forceFull)) && ok
  saveState(state)
  return ok
}

// ---- 1. Resultados pendientes ----------------------------------------------

async function report(id, result) {
  state.pendingResults.push({ id, result })
  saveState(state)
  await flushResults()
}

async function flushResults() {
  while (state.pendingResults.length) {
    const { id, result } = state.pendingResults[0]
    await api.webSaleResult(id, result)
    state.pendingResults.shift()
    saveState(state)
  }
}

// ---- 2. Pedidos web → Aronium ----------------------------------------------

async function webSales() {
  const { work } = await api.webSalesWork()
  // Para el programa de avisos de la PC (avisos.json): proformas que esperan
  // que la cajera las marque "Pagado", y pedidos con error.
  const alerts = { pending: [], errors: [] }
  try {
    await doWebSales(work, alerts)
  } finally {
    writeAlerts(alerts)
  }
}

async function doWebSales(work, alerts) {
  for (const job of work) {
    const code = job.tracking_code
    const label = `Pedido web #${job.payload?.display_id ?? job.id} (${code})`
    let result = null
    try {
      if (job.action === 'watch') {
        // Lectura: ¿la cajera marcó la proforma "Pagado"?
        const st = writer.quoteStatus(job.aronium_quote_number, code)
        if (st.exists && !st.paid && !st.invoiced) {
          lastReported.delete(job.id)
          alerts.pending.push(pendingEntry(job, st.number))
          continue
        }
        backup()
        // Pagada (o la venta ya existe, o la proforma desapareció → error).
        result = { action: 'invoice', ...writer.invoiceQuote(job.aronium_quote_number, job.payload, code) }
        log(`${label}: proforma ${job.aronium_quote_number} marcada "Pagado" → venta ${result.aronium_number}${result.warning ? `. Aviso: ${result.warning}` : ''}`)
      } else if (job.action === 'quote') {
        backup()
        result = { action: 'quote', ...writer.writeQuote(job.payload, code) }
        alerts.pending.push(pendingEntry(job, result.quote_number))
        log(`${label}: proforma ${result.quote_number} en Aronium (No pagado)${result.warning ? `. Aviso: ${result.warning}` : ''}`)
      } else if (job.action === 'cancel') {
        backup()
        if (job.aronium_number) {
          result = { action: 'cancel', ...writer.cancelSale(job.aronium_number, job.payload, code) }
          log(`${label}: devolución ${result.refund_number} de ${job.aronium_number}`)
        } else {
          result = { action: 'cancel', ...writer.voidQuote(job.aronium_quote_number, job.payload, code) }
          log(`${label}: proforma ${job.aronium_quote_number ?? ''} anulada${result.warning ? `. Aviso: ${result.warning}` : ''}`)
        }
      } else {
        continue
      }
    } catch (error) {
      if (isTransient(error)) {
        // La caja estaba grabando: se reintenta en la pasada siguiente.
        log(`${label}: Aronium ocupado, se reintenta`)
        if (job.action === 'watch') alerts.pending.push(pendingEntry(job))
        continue
      }
      const message = error instanceof AroniumDataError ? error.message : `Error al escribir en Aronium: ${errorMessage(error)}`
      alerts.errors.push({ code, number: job.payload?.display_id ?? null, message })
      if (lastReported.get(job.id) === message) continue
      lastReported.set(job.id, message)
      log(`ERROR ${label}: ${message}`)
      const action = job.action === 'watch' ? 'invoice' : job.action
      await report(job.id, { action, ok: false, error: message })
      continue
    }
    // Fuera del try: lo escrito en Aronium está bien aunque no se pueda avisar
    // a la tienda (se cortó internet). El resultado queda en state.json y se
    // manda en la pasada siguiente; no se convierte en un error del pedido.
    lastReported.delete(job.id)
    await report(job.id, result)
  }
}

/** Copia de respaldo del día antes de la primera escritura. */
function backup() {
  const file = backupIfNeeded(config, state)
  if (file) log(`Copia de respaldo de Aronium: ${file}`)
}

// ---- 3 y 4. Aronium → tienda -------------------------------------------------

/** Ajustes del panel → Aronium que llegan en la respuesta de la tienda. */
function applySettings(settings) {
  if (!settings) return
  const wanted = settings.interval_minutes ?? config.intervalMinutes
  const next = Math.min(30, Math.max(1, Math.round(Number(wanted) || config.intervalMinutes)))
  if (next !== intervalMinutes) {
    log(`Frecuencia cambiada desde el panel: cada ${next} min`)
    intervalMinutes = next
  }
  fullRequested = Boolean(settings.full_requested)
}

/** Lo que importa comparar de un producto: si cambia, se manda. */
function signature(p) {
  return JSON.stringify([p.name, p.description, p.price, p.stock, p.enabled, p.group, p.image_hash, p.barcodes])
}

async function catalog(forceFull) {
  let products
  try {
    products = readProducts(config.aroniumDb, { warehouseId: config.warehouseId })
      // El producto del costo de envío no se vende en la tienda (aunque en
      // Aronium lo hayan cargado como producto común y no como servicio).
      .filter((p) => p.code !== config.webSales.shippingCode)
  } catch (error) {
    const message = `No se pudo leer Aronium (${config.aroniumDb}): ${errorMessage(error)}`
    log(`ERROR: ${message}`)
    // Que el panel lo muestre; si tampoco hay conexión, queda solo en el log.
    await api.sync({ agent, error: message }).catch(() => {})
    return false
  }

  const current = new Map(products.map((p) => [p.code, signature(p)]))
  const vanished = [...state.lastSent.keys()].some((code) => !current.has(code))
  const full =
    forceFull ||
    fullRequested ||
    vanished ||
    state.lastSent.size === 0 ||
    Date.now() - state.lastFullAt >= FULL_EVERY_MINUTES * 60 * 1000
  const items = full
    ? products
    : products.filter((p) => forceCodes.has(p.code) || state.lastSent.get(p.code) !== current.get(p.code))

  try {
    const result = await api.sync({ agent: { ...agent, interval_minutes: intervalMinutes }, full, items })
    applySettings(result.settings)
    if (result.paused) {
      // Pausado desde el panel: la tienda no aplicó nada, así que no se toma
      // como enviado (al reanudar se manda todo lo que cambió).
      if (!wasPaused) log('Sincronización pausada desde el panel: Aronium → tienda en espera.')
      wasPaused = true
      return true
    }
    if (wasPaused) log('Sincronización reanudada desde el panel.')
    wasPaused = false
    // Recién ahora, con la tienda al día, se toma como enviado.
    if (full) {
      state.lastSent = current
      state.lastFullAt = Date.now()
    } else {
      for (const p of items) state.lastSent.set(p.code, current.get(p.code))
    }
    forceCodes = new Set(result.refresh_codes ?? [])
    state.forceCodes = [...forceCodes]

    const summary = [
      result.created && `${result.created} altas`,
      result.removed && `${result.removed} bajas`,
      result.prices_updated && `${result.prices_updated} precios`,
      result.stock_updated && `${result.stock_updated} stocks`,
      result.content_updated && `${result.content_updated} con contenido nuevo`,
    ].filter(Boolean)
    if (summary.length) log(`${full ? `Pasada completa (${products.length} productos)` : `${items.length} con cambios`}: ${summary.join(', ')}`)

    const wanted = [...new Set(result.images_wanted ?? [])]
    const byCode = new Map(products.map((p) => [p.code, p]))
    for (let i = 0; i < wanted.length; i += IMAGE_BATCH_SIZE) {
      const images = readImages(config.aroniumDb, wanted.slice(i, i + IMAGE_BATCH_SIZE))
      if (!images.size) continue
      const sent = await api.images({
        items: [...images].map(([code, image]) => ({ code, ...image, image_hash: byCode.get(code)?.image_hash ?? null })),
      })
      if (sent.images_added) log(`${sent.images_added} fotos enviadas`)
    }
    return true
  } catch (error) {
    log(`ERROR: ${errorMessage(error)}`)
    return false
  }
}
