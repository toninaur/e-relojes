import fs from 'node:fs'
import os from 'node:os'
import { readImages, readProducts } from './aronium.mjs'
import { createApi } from './api.mjs'
import { pendingEntry, writeAlerts } from './alerts.mjs'
import { backupIfNeeded } from './backup.mjs'
import { CONFIG_PATH, loadConfig } from './config.mjs'
import { acquireLock, LOCK_ADDRESS } from './lock.mjs'
import { errorMessage, log } from './log.mjs'
import { checkSchema } from './schema.mjs'
import { loadState, saveState } from './state.mjs'
import { takeOrder, writeStatus } from './status.mjs'
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
// Entre pasadas atiende al programa de la PC (Sincronizador.exe): le cuenta
// cómo anda en status.json y, si pide "Sincronizar ahora", no espera al
// próximo turno (status.mjs). Con "paused" en config.json (Pausar, desde el
// programa) no lee ni escribe nada.
//
//   node src/index.mjs          corre en bucle (lo que usa la tarea programada)
//   node src/index.mjs --once   una sola pasada completa y termina

const VERSION = '0.10.0'
const FULL_EVERY_MINUTES = 30
const IMAGE_BATCH_SIZE = 10

// El reloj de esta PC puede estar mal (pila gastada, alguien lo cambió): las
// ventas saldrían con otra fecha y caerían en otro cierre de caja. Con más de
// esta diferencia con la tienda, no se escriben pedidos.
const MAX_CLOCK_SKEW_MINUTES = 30

// Se releen si alguien cambia config.json (una clave nueva, otra forma de
// pago) sin tener que reiniciar el agente.
let config = loadConfig()
let configMtime = mtimeOf(CONFIG_PATH)
let api = createApi(config)
let writer = createWriter(config)
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

// Si puede escribir pedidos en Aronium y, si no, por qué. Se revisa en cada
// pasada: Aronium se puede actualizar con el agente andando (corre semanas
// sin reiniciarse) y el reloj de la PC puede cambiar.
const agent = {
  version: VERSION,
  host: os.hostname(),
  interval_minutes: config.intervalMinutes,
  write_enabled: false,
  write_blocked_reason: null,
}
// busy: la caja estaba grabando y no se pudo revisar todavía (no es un problema).
const BUSY = 'Aronium ocupado (la caja está grabando): los pedidos web esperan a la próxima pasada.'
let schema = { ok: false, reason: BUSY, busy: true }

// Para el programa de la PC (status.mjs).
const PAUSED_LOCAL = 'Sincronizador pausado desde la PC del local (programa Sincronizador): no lee Aronium ni registra pedidos web hasta que lo reanuden ahí.'
let pausedLocal = false
const status = {
  version: VERSION,
  pid: process.pid,
  lock: LOCK_ADDRESS,
  started_at: new Date().toISOString(),
  state: 'running',
  interval_minutes: config.intervalMinutes,
  interval_from_panel: config.intervalFromPanel,
  last_pass_at: null,
  last_pass_ok: null,
  next_pass_at: null,
  store_ok_at: null,
  store_error: null,
  store_error_since: null,
  aronium_ok_at: null,
  aronium_error: null,
  products: null,
  write_enabled: false,
  write_blocked_reason: null,
}
function storeOk() {
  status.store_ok_at = new Date().toISOString()
  status.store_error = null
  status.store_error_since = null
}
function storeFailed(error) {
  if (!status.store_error) status.store_error_since = new Date().toISOString()
  status.store_error = errorMessage(error)
}

const once = process.argv.includes('--once')
// Un solo agente por carpeta (lock.mjs).
if (!(await acquireLock())) {
  const message = 'Ya hay un sincronizador corriendo en esta carpeta (la tarea programada o alguien lo abrió a mano): no se abre otro.'
  if (once) console.error(message)
  else log(message)
  process.exit(once ? 1 : 0)
}

if (once) {
  process.exitCode = (await pass({ forceFull: true })) ? 0 : 1
} else {
  // Nada inesperado tiene que tumbar el agente. Si igual se cae, la tarea
  // programada lo vuelve a abrir en 5 minutos (install.ps1).
  process.on('unhandledRejection', (error) => log(`ERROR inesperado: ${errorMessage(error)}`))
  process.on('uncaughtException', (error) => {
    log(`ERROR inesperado, el agente se reinicia: ${errorMessage(error)}`)
    process.exit(1)
  })
  refreshWriteState()
  log(`Agente ${VERSION} iniciado: ${config.storeUrl}, cada ${config.intervalMinutes} min${agent.write_enabled ? ', con pedidos web' : ''}`)
  writeStatus(status)
  let forceFull = false
  for (;;) {
    try {
      await pass({ forceFull })
    } catch (error) {
      log(`ERROR inesperado en la pasada: ${errorMessage(error)}`)
    }
    // SINCRONIZADOR_PRUEBA_MS: solo para las pruebas (test/agent.test.mjs),
    // pasadas seguidas sin esperar minutos.
    const waitMs = Number(process.env.SINCRONIZADOR_PRUEBA_MS) || intervalMinutes * 60 * 1000
    status.next_pass_at = new Date(Date.now() + waitMs).toISOString()
    writeStatus(status)
    const order = await waitForTurn(waitMs)
    forceFull = order === 'full'
    if (order === 'full') log('Pasada completa pedida desde el programa de la PC.')
    else if (order === 'sync') log('"Sincronizar ahora" pedido desde el programa de la PC.')
  }
}

/**
 * Espera el próximo turno, salvo que el programa de la PC pida una pasada
 * ("sync" o "full") o cambie config.json (Pausar / Reanudar: "config").
 */
async function waitForTurn(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, Math.min(1000, end - Date.now())))
    const order = takeOrder()
    if (order) return order
    if (mtimeOf(CONFIG_PATH) !== configMtime) return 'config'
  }
  return null
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/** config.json cambió: se relee sin reiniciar. Si quedó mal, sigue con el anterior. */
function reloadConfigIfChanged() {
  const mtime = mtimeOf(CONFIG_PATH)
  if (mtime === configMtime) return
  configMtime = mtime
  try {
    const next = loadConfig({ exitOnError: false })
    const intervalChanged = next.intervalMinutes !== config.intervalMinutes
    config = next
    api = createApi(config)
    writer = createWriter(config)
    // Con la frecuencia fijada en la PC, vale la de config.json aunque el panel
    // haya puesto otra antes.
    if (intervalChanged || !config.intervalFromPanel) intervalMinutes = config.intervalMinutes
    log(`config.json cambió: se usa la nueva configuración (${config.storeUrl}, cada ${intervalMinutes} min).`)
  } catch (error) {
    log(`ERROR: config.json cambió pero no se puede usar (${errorMessage(error)}). Se sigue con la configuración anterior.`)
  }
}

/** La base de Aronium: si se puede revisar ahora (la caja grabando: queda lo anterior). */
function refreshSchema() {
  try {
    schema = checkSchema(config.aroniumDb)
  } catch (error) {
    // Ocupada: queda lo que se sabía (o "ocupado" si todavía no se sabía nada).
    if (isTransient(error)) {
      if (schema.busy) log(BUSY)
      return
    }
    schema = { ok: false, reason: `No se pudo revisar la base de Aronium (${config.aroniumDb}): ${errorMessage(error)}` }
  }
}

/** ¿Puede escribir pedidos? Lo anota en `agent` (va a la tienda) y en el log si cambió. */
function refreshWriteState() {
  refreshSchema()
  const skew = api.clockSkewMs()
  const skewMinutes = skew === null ? 0 : Math.round(skew / 60000)
  let reason = null
  if (!config.webSales.enabled) reason = null
  else if (!api.supportsWebSales) reason = 'El conector usa la clave de administrador vieja: generá la clave del conector en el panel → Aronium para registrar ventas web.'
  else if (!schema.ok) reason = schema.reason
  else if (Math.abs(skewMinutes) > MAX_CLOCK_SKEW_MINUTES) {
    reason = `El reloj de esta PC está ${Math.abs(skewMinutes)} minutos ${skewMinutes > 0 ? 'adelantado' : 'atrasado'}: las ventas web saldrían con otra fecha en Aronium. Corregí la fecha y la hora de Windows; los pedidos se registran solos después.`
  }
  const enabled = config.webSales.enabled && !reason
  if (reason !== agent.write_blocked_reason) {
    if (reason && !schema.busy) log(`Pedidos web desactivados: ${reason}`)
    else if (agent.write_blocked_reason && agent.write_blocked_reason !== BUSY) log('Pedidos web activados de nuevo.')
  }
  agent.write_enabled = enabled
  agent.write_blocked_reason = config.webSales.enabled ? reason : null
}

async function pass({ forceFull = false } = {}) {
  let ok = true
  reloadConfigIfChanged()
  status.interval_from_panel = config.intervalFromPanel
  if (config.paused) return pausedPass()
  if (pausedLocal) log('Sincronización reanudada desde la PC.')
  pausedLocal = false
  status.state = 'passing'
  writeStatus(status)
  refreshWriteState()
  try {
    await flushResults()
    if (config.webSales.enabled && api.supportsWebSales) await webSales()
  } catch (error) {
    // Sin conexión con la tienda, etc.: el catálogo se intenta igual.
    log(`ERROR (ventas web): ${errorMessage(error)}`)
    if (/tienda/i.test(errorMessage(error))) storeFailed(error)
    ok = false
  }
  ok = (await catalog(forceFull)) && ok
  saveState(state)
  status.state = wasPaused ? 'paused_panel' : 'running'
  status.last_pass_at = new Date().toISOString()
  status.last_pass_ok = ok
  status.interval_minutes = intervalMinutes
  status.write_enabled = agent.write_enabled
  status.write_blocked_reason = agent.write_blocked_reason
  writeStatus(status)
  return ok
}

/** Pausado desde la PC: nada de Aronium; solo le avisa a la tienda, para que el panel lo muestre. */
async function pausedPass() {
  if (!pausedLocal) log('Sincronización pausada desde la PC: no se lee Aronium ni se registran pedidos web hasta reanudar.')
  pausedLocal = true
  status.state = 'paused_local'
  try {
    await api.sync({ agent: { ...agent, interval_minutes: intervalMinutes }, error: PAUSED_LOCAL })
    storeOk()
  } catch (error) {
    storeFailed(error)
  }
  status.last_pass_at = new Date().toISOString()
  status.last_pass_ok = true
  writeStatus(status)
  return true
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
  // Con la hora de la tienda recién llegada: ¿el reloj de la PC está bien?
  refreshWriteState()
  // Para el programa de avisos de la PC (avisos.json): proformas que esperan
  // que la cajera las marque "Pagado", pedidos con error y, si no se puede
  // escribir en Aronium, por qué.
  const alerts = { pending: [], errors: [], blocked: null, interval_minutes: intervalMinutes }
  if (!agent.write_enabled) {
    alerts.blocked = agent.write_blocked_reason
    for (const job of work) if (job.action === 'watch') alerts.pending.push(pendingEntry(job))
    writeAlerts(alerts)
    return
  }
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
  // Frecuencia fijada en la PC (intervalFromPanel: false): el panel no la cambia.
  const wanted = config.intervalFromPanel ? (settings.interval_minutes ?? config.intervalMinutes) : config.intervalMinutes
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
    status.aronium_ok_at = new Date().toISOString()
    status.aronium_error = null
    status.products = products.length
  } catch (error) {
    if (isTransient(error)) {
      // La caja estaba grabando más de 5 segundos: no es un problema para
      // mostrar en el panel; se lee en la pasada siguiente.
      log('Aronium ocupado (la caja está grabando): el catálogo se lee en la próxima pasada.')
      return true
    }
    // La tarea corre como SYSTEM: %LOCALAPPDATA% es la carpeta del sistema, no
    // la del usuario de Aronium (install.ps1 pone la ruta completa).
    const hint = /systemprofile/i.test(config.aroniumDb)
      ? ' La tarea corre con la cuenta del sistema: en config.json poné la ruta completa de pos.db (sin %LOCALAPPDATA%), o volvé a correr install.ps1, que la completa.'
      : ''
    const message = `No se pudo leer Aronium (${config.aroniumDb}): ${errorMessage(error)}.${hint}`
    log(`ERROR: ${message}`)
    status.aronium_error = message
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
    storeOk()
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
    if (/tienda/i.test(errorMessage(error))) storeFailed(error)
    return false
  }
}
