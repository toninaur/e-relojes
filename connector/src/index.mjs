import os from 'node:os'
import { readImages, readProducts } from './aronium.mjs'
import { createApi } from './api.mjs'
import { backupIfNeeded } from './backup.mjs'
import { loadConfig } from './config.mjs'
import { errorMessage, log } from './log.mjs'
import { checkSchema } from './schema.mjs'
import { loadState, saveState } from './state.mjs'
import { AroniumDataError, createWriter, isTransient } from './write.mjs'

// Sincronizador Aronium Lite ↔ tienda online (docs/sincronizador-aronium.md).
//
// Cada `intervalMinutes` (1 por defecto), en este orden:
// 1. Manda a la tienda los resultados que quedaron pendientes (ventas ya
//    escritas en Aronium cuando se cortó la conexión).
// 2. Ventas web → Aronium: trae de la tienda los pedidos nuevos, los pagos y
//    las cancelaciones, y los escribe en Aronium (write.mjs). Antes de la
//    primera escritura del día, copia de respaldo de pos.db (backup.mjs).
// 3. Aronium → tienda: lee productos, precios y stock y manda lo que cambió
//    (todo cada FULL_EVERY_MINUTES, al arrancar o si desaparece un código).
//    Va después de 2: así, cuando el stock de Aronium ya tiene restada una
//    venta web, la tienda ya sabe que esa venta está en Aronium y no la
//    descuenta dos veces.
// 4. Fotos que pidió la tienda.
//
//   node src/index.mjs          corre en bucle (lo que usa la tarea programada)
//   node src/index.mjs --once   una sola pasada completa y termina

const VERSION = '0.5.0'
const FULL_EVERY_MINUTES = 30
const IMAGE_BATCH_SIZE = 10

const config = loadConfig()
const api = createApi(config)
const writer = createWriter(config)
const state = loadState()
// Códigos que la tienda pidió volver a mandar ("Tomar de Aronium").
let forceCodes = new Set()

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
if (agent.write_blocked_reason) log(`Ventas web desactivadas: ${agent.write_blocked_reason}`)

if (process.argv.includes('--once')) {
  process.exitCode = (await pass({ forceFull: true })) ? 0 : 1
} else {
  log(`Agente ${VERSION} iniciado: ${config.storeUrl}, cada ${config.intervalMinutes} min${writeEnabled ? ', con ventas web' : ''}`)
  for (;;) {
    await pass()
    await new Promise((r) => setTimeout(r, config.intervalMinutes * 60 * 1000))
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

// ---- 2. Ventas web → Aronium -----------------------------------------------

async function webSales() {
  const { work } = await api.webSalesWork()
  if (!work.length) return
  for (const job of work) {
    // Copia de respaldo del día antes de la primera escritura.
    const backup = backupIfNeeded(config, state)
    if (backup) log(`Copia de respaldo de Aronium: ${backup}`)

    const label = `Pedido web #${job.payload?.display_id ?? job.id}`
    try {
      let result
      if (job.action === 'register') {
        result = { action: 'register', ...writer.registerSale(job.payload, { paid: job.paid }) }
        log(`${label}: registrado en Aronium como ${result.aronium_number}${result.payment_registered ? ' (pagado)' : ' (impago)'}${result.warning ? `. Aviso: ${result.warning}` : ''}`)
      } else if (job.action === 'payment') {
        result = { action: 'payment', ...writer.addPayment(job.aronium_number, job.payload) }
        log(`${label}: pago agregado a ${job.aronium_number}`)
      } else {
        result = { action: 'cancel', ...writer.cancelSale(job.aronium_number, job.payload) }
        log(`${label}: devolución ${result.refund_number} de ${job.aronium_number}`)
      }
      await report(job.id, result)
    } catch (error) {
      if (isTransient(error)) {
        // La caja estaba grabando: se reintenta en la pasada siguiente.
        log(`${label}: Aronium ocupado, se reintenta`)
        continue
      }
      const message = error instanceof AroniumDataError ? error.message : `Error al escribir en Aronium: ${errorMessage(error)}`
      log(`ERROR ${label}: ${message}`)
      await report(job.id, { action: job.action, ok: false, error: message })
    }
  }
}

// ---- 3 y 4. Aronium → tienda -------------------------------------------------

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
    forceFull || vanished || state.lastSent.size === 0 || Date.now() - state.lastFullAt >= FULL_EVERY_MINUTES * 60 * 1000
  const items = full
    ? products
    : products.filter((p) => forceCodes.has(p.code) || state.lastSent.get(p.code) !== current.get(p.code))

  try {
    const result = await api.sync({ agent, full, items })
    // Recién ahora, con la tienda al día, se toma como enviado.
    if (full) {
      state.lastSent = current
      state.lastFullAt = Date.now()
    } else {
      for (const p of items) state.lastSent.set(p.code, current.get(p.code))
    }
    forceCodes = new Set(result.refresh_codes ?? [])

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
