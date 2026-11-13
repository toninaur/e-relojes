import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProducts } from './aronium.mjs'

// Agente Aronium → tienda online.
//
// Cada `intervalMinutes` lee el catálogo de Aronium y lo manda entero a la
// tienda, que compara, aplica los cambios y guarda el historial (panel →
// Aronium). Si la tienda pide fotos (productos nuevos sin foto), las manda
// después. Si no puede leer Aronium, le avisa a la tienda para que el panel
// muestre el error.
//
//   node src/index.mjs          corre en bucle (lo que usa la tarea programada)
//   node src/index.mjs --once   una sola pasada y termina

const VERSION = '0.3.0'
// Cada cuánto pasa el agente, en minutos (config.json → intervalMinutes).
const MIN_INTERVAL = 5
const MAX_INTERVAL = 30
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')
const LOG_PATH = path.join(ROOT, 'connector.log')
const IMAGE_BATCH_SIZE = 10

const config = loadConfig()
const agent = { version: VERSION, host: os.hostname(), interval_minutes: config.intervalMinutes }

if (process.argv.includes('--once')) {
  process.exitCode = (await runOnce()) ? 0 : 1
} else {
  log(`Agente iniciado: ${config.storeUrl}, cada ${config.intervalMinutes} min`)
  for (;;) {
    await runOnce()
    await new Promise((r) => setTimeout(r, config.intervalMinutes * 60 * 1000))
  }
}

async function runOnce() {
  let products
  try {
    products = readProducts(config.aroniumDb, { warehouseId: config.warehouseId })
  } catch (error) {
    const message = `No se pudo leer Aronium (${config.aroniumDb}): ${errorMessage(error)}`
    log(`ERROR: ${message}`)
    // Que el panel lo muestre; si tampoco hay conexión, queda solo en el log.
    await post('/admin/aronium/sync', { agent, error: message }).catch(() => {})
    return false
  }

  try {
    const result = await post('/admin/aronium/sync', {
      agent,
      items: products.map(({ image, ...item }) => item),
    })
    const summary = [
      result.created && `${result.created} altas`,
      result.removed && `${result.removed} bajas`,
      result.prices_updated && `${result.prices_updated} precios`,
      result.stock_updated && `${result.stock_updated} stocks`,
    ].filter(Boolean)
    if (summary.length) log(`${products.length} productos: ${summary.join(', ')}`)

    const wanted = new Set(result.images_wanted ?? [])
    const images = products.filter((p) => p.image && wanted.has(p.code))
    for (let i = 0; i < images.length; i += IMAGE_BATCH_SIZE) {
      const batch = images.slice(i, i + IMAGE_BATCH_SIZE)
      const sent = await post('/admin/aronium/images', {
        items: batch.map((p) => ({ code: p.code, ...p.image, image_hash: p.image_hash })),
      })
      if (sent.images_added) log(`${sent.images_added} fotos enviadas`)
    }
    return true
  } catch (error) {
    log(`ERROR: ${errorMessage(error)}`)
    return false
  }
}

async function post(pathname, body) {
  let response
  try {
    response = await fetch(new URL(pathname, config.storeUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    throw new Error(`Sin conexión con la tienda (${config.storeUrl}): ${errorMessage(error)}`)
  }
  if (response.status === 401) throw new Error('La tienda rechazó la clave (apiKey): revisá config.json.')
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`La tienda respondió ${response.status}: ${text.slice(0, 500)}`)
  }
  return response.json()
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Falta ${CONFIG_PATH}. Copiá config.example.json a config.json y completalo.`)
    process.exit(1)
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (error) {
    console.error(`config.json no es válido (${errorMessage(error)}). En las rutas usá \\\\ o / en vez de \\.`)
    process.exit(1)
  }
  const cfg = {
    storeUrl: String(raw.storeUrl ?? '').replace(/\/+$/, ''),
    apiKey: String(raw.apiKey ?? ''),
    aroniumDb: raw.aroniumDb
      ? String(raw.aroniumDb).replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? '')
      : path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Aronium', 'Data', 'pos.db'),
    warehouseId: raw.warehouseId ? Number(raw.warehouseId) : null,
    intervalMinutes: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(Number(raw.intervalMinutes) || MIN_INTERVAL))),
  }
  if (!cfg.storeUrl || !cfg.apiKey) {
    console.error('config.json: faltan storeUrl o apiKey.')
    process.exit(1)
  }
  return cfg
}

function errorMessage(error) {
  if (!(error instanceof Error)) return String(error)
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_PATH, `${LOG_PATH}.1`)
    }
    fs.appendFileSync(LOG_PATH, `${line}\n`)
  } catch {
    // Sin log en disco el agente sigue funcionando.
  }
}
