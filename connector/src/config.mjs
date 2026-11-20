import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// config.json del agente (ver config.example.json y README).

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, 'config.json')

export const MIN_INTERVAL = 1
export const MAX_INTERVAL = 30
const DEFAULT_INTERVAL = 1

/** Ruta con %LOCALAPPDATA% y similares resueltos. */
function expand(p) {
  return String(p).replace(/%([A-Z_]+)%/gi, (_, name) => process.env[name] ?? `%${name}%`)
}

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) fail(`Falta ${CONFIG_PATH}. Copiá config.example.json a config.json y completalo.`)
  let raw
  try {
    // Sin BOM: el Bloc de notas viejo y PowerShell 5 lo agregan al guardar.
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    fail(`config.json no es válido (${error.message}). En las rutas usá / o \\\\ en vez de \\.`)
  }
  const web = raw.webSales ?? {}
  const cfg = {
    storeUrl: String(raw.storeUrl ?? '').replace(/\/+$/, ''),
    // Clave del conector (arag_…, panel → Aronium → "Generar clave"). Con la
    // clave secreta de administrador vieja (apiKey) solo sincroniza el
    // catálogo, sin ventas web.
    token: String(raw.token ?? '').trim(),
    apiKey: String(raw.apiKey ?? '').trim(),
    aroniumDb: raw.aroniumDb
      ? expand(raw.aroniumDb)
      : path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Aronium', 'Data', 'pos.db'),
    warehouseId: raw.warehouseId ? Number(raw.warehouseId) : null,
    intervalMinutes: Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(Number(raw.intervalMinutes) || DEFAULT_INTERVAL))),
    backupDir: raw.backupDir ? expand(raw.backupDir) : path.join(ROOT, 'backups'),
    keepBackups: Math.max(1, Number(raw.keepBackups) || 14),
    // Pedidos web → Aronium (docs/sincronizador-aronium.md, punto 4.2 y
    // decisiones). El número de orden de la proforma y la venta es el código
    // de seguimiento PW-… que manda la tienda.
    webSales: {
      enabled: web.enabled !== false,
      // Usuario de Aronium que figura en la venta (nombre o usuario). Vacío:
      // el usuario principal (el historial de ventas de Aronium muestra solo
      // las del usuario con la sesión abierta).
      userName: String(web.userName ?? ''),
      // El "consumidor final" de Aronium: una venta suya nunca se toma como
      // duplicado de un pedido web.
      defaultCustomerName: String(web.defaultCustomerName ?? 'Walk-in customer'),
      // Forma de pago de Aronium según lo que eligió en la tienda (en el local,
      // las transferencias se cargan como "Itaú").
      paymentTypes: {
        bank_transfer: 'Itaú',
        cash_on_delivery: 'Efectivo',
        ...(web.paymentTypes ?? {}),
      },
      // Producto-servicio de Aronium para el costo de envío.
      shippingCode: String(web.shippingCode ?? 'ENVIO'),
      // Tipo de servicio de Aronium. Sin valor: el que más usan las ventas de
      // la caja (0 en el local; 1 en el Aronium de desarrollo).
      serviceType: web.serviceType === undefined || web.serviceType === null || web.serviceType === '' ? null : Number(web.serviceType),
    },
  }
  if (!cfg.storeUrl) fail('config.json: falta storeUrl.')
  if (!cfg.token && !cfg.apiKey) fail('config.json: falta token (la clave del conector, panel → Aronium → "Generar clave").')
  return cfg
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
