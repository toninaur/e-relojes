import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProducts } from './aronium.mjs'

// Conector Aronium → tienda online.
//
// Cada `intervalMinutes` lee los productos de Aronium y manda a la tienda los
// que cambiaron (precio, stock, nombre, etc.). Una vez por día manda todo, por
// si algo se cambió a mano en el panel.
//
//   node src/index.mjs          corre en bucle (lo que usa la tarea programada)
//   node src/index.mjs --once   una sola pasada y termina
//   node src/index.mjs --full   una pasada mandando todo

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')
const STATE_PATH = path.join(ROOT, 'state.json')
const LOG_PATH = path.join(ROOT, 'connector.log')
const FULL_SYNC_EVERY_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 50
const BATCH_SIZE_WITH_IMAGES = 10

const args = new Set(process.argv.slice(2))
const config = loadConfig()

if (args.has('--once') || args.has('--full')) {
  const ok = await runOnce({ forceFull: args.has('--full') })
  process.exitCode = ok ? 0 : 1
} else {
  log(`Conector iniciado: ${config.storeUrl}, cada ${config.intervalMinutes} min`)
  for (;;) {
    await runOnce({ forceFull: false })
    await new Promise((r) => setTimeout(r, config.intervalMinutes * 60 * 1000))
  }
}

async function runOnce({ forceFull }) {
  try {
    const state = loadState()
    const full = forceFull || !state.lastFullSync || Date.now() - Date.parse(state.lastFullSync) > FULL_SYNC_EVERY_MS
    const products = readProducts(config.aroniumDb, { warehouseId: config.warehouseId })
    const pending = full ? products : products.filter((p) => state.hashes[p.code] !== p.hash)

    if (!pending.length) return true

    const totals = { prices_updated: 0, stock_updated: 0, created: 0, unchanged: 0 }
    // Las fotos solo sirven para crear productos: van únicamente con los
    // códigos que la tienda todavía no recibió.
    const isNew = (p) => !(p.code in state.hashes)
    const batches = [
      ...chunk(pending.filter((p) => !isNew(p) || !p.image), BATCH_SIZE),
      ...chunk(pending.filter((p) => isNew(p) && p.image), BATCH_SIZE_WITH_IMAGES),
    ]

    for (const batch of batches) {
      const result = await send(
        batch.map((p) => ({
          code: p.code,
          name: p.name,
          description: p.description,
          price: p.price,
          stock: p.stock,
          enabled: p.enabled,
          group: p.group,
          image: isNew(p) ? p.image : null,
        }))
      )
      totals.prices_updated += result.prices_updated.length
      totals.stock_updated += result.stock_updated.length
      totals.created += result.created.length
      totals.unchanged += result.unchanged
      if (result.created.length) log(`Productos nuevos en borrador: ${result.created.join(', ')}`)
      for (const p of batch) state.hashes[p.code] = p.hash
      saveState(state)
    }

    if (full) {
      // Códigos borrados en Aronium: se olvidan (la tienda los deja como están).
      const codes = new Set(products.map((p) => p.code))
      for (const code of Object.keys(state.hashes)) if (!codes.has(code)) delete state.hashes[code]
      state.lastFullSync = new Date().toISOString()
      saveState(state)
    }

    log(
      `${full ? 'Sincronización completa' : 'Cambios'}: ${pending.length} productos leídos, ` +
        `${totals.prices_updated} precios, ${totals.stock_updated} stocks, ${totals.created} nuevos, ${totals.unchanged} sin cambios`
    )
    return true
  } catch (error) {
    log(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

async function send(items) {
  const response = await fetch(new URL('/admin/aronium/sync', config.storeUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`,
    },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(120_000),
  })
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
    console.error(`config.json no es válido (${error.message}). En las rutas usá \\\\ o / en vez de \\.`)
    process.exit(1)
  }
  const cfg = {
    storeUrl: String(raw.storeUrl ?? '').replace(/\/+$/, ''),
    apiKey: String(raw.apiKey ?? ''),
    aroniumDb: raw.aroniumDb
      ? String(raw.aroniumDb).replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? '')
      : path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Aronium', 'Data', 'pos.db'),
    warehouseId: raw.warehouseId ? Number(raw.warehouseId) : null,
    intervalMinutes: Math.max(1, Number(raw.intervalMinutes) || 5),
  }
  if (!cfg.storeUrl || !cfg.apiKey) {
    console.error('config.json: faltan storeUrl o apiKey.')
    process.exit(1)
  }
  if (!fs.existsSync(cfg.aroniumDb)) {
    console.error(`No se encontró la base de Aronium en ${cfg.aroniumDb}. Revisá aroniumDb en config.json.`)
    process.exit(1)
  }
  return cfg
}

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    return { hashes: state.hashes ?? {}, lastFullSync: state.lastFullSync ?? null }
  } catch {
    return { hashes: {}, lastFullSync: null }
  }
}

function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state))
  fs.renameSync(tmp, STATE_PATH)
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
    // Sin log en disco el conector sigue funcionando.
  }
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
