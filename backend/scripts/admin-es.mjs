// Genera src/admin/i18n/es.json: los textos del panel en español que cambian
// respecto de la traducción oficial de Medusa, con las palabras que usa el
// local (Marcas, Ofertas, Marcar como pagado, Envío…).
//
//   node scripts/admin-es.mjs        (desde backend/)
//
// Volver a correrlo después de actualizar Medusa: toma la traducción oficial
// de esa versión y vuelve a aplicar los reemplazos.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dashboard = path.dirname(require.resolve('@medusajs/dashboard/package.json'))
const official = JSON.parse(fs.readFileSync(path.join(dashboard, 'src/i18n/translations/es.json'), 'utf8'))

// Reemplazos de palabras, en orden (los más largos primero).
const WORDS = [
  // Listas de precios → Ofertas (en la tienda se usan para los precios de oferta).
  [/Listas de Precios|Listas de precios/g, 'Ofertas'],
  [/listas de precios/g, 'ofertas'],
  [/Lista de Precios|Lista de precios/g, 'Oferta'],
  [/lista de precios/g, 'oferta'],
  // Colecciones → Marcas (cada marca es una colección).
  [/Colecciones de productos/g, 'Marcas'],
  [/colecciones de productos/g, 'marcas'],
  [/Colección de producto/g, 'Marca'],
  [/Colecciones/g, 'Marcas'],
  [/colecciones/g, 'marcas'],
  [/Colección/g, 'Marca'],
  [/colección/g, 'marca'],
  // Capturar un pago → cobrar / marcar como pagado.
  [/las capturas/g, 'los cobros'],
  [/la captura/g, 'el cobro'],
  [/Capturad/g, 'Cobrad'],
  [/capturad/g, 'cobrad'],
  [/Capturar/g, 'Cobrar'],
  [/capturar/g, 'cobrar'],
  [/Capturas/g, 'Cobros'],
  [/capturas/g, 'cobros'],
  [/Captura\b/g, 'Cobro'],
  [/captura\b/g, 'cobro'],
  // Cumplimiento (fulfillment) → envío.
  [/Cumplimientos/g, 'Envíos'],
  [/cumplimientos/g, 'envíos'],
  [/Cumplimiento/g, 'Envío'],
  [/cumplimiento/g, 'envío'],
]

// Textos puntuales, por clave.
const KEYS = {
  'orders.payment.capture': 'Marcar como pagado',
  'orders.payment.capture_short': 'Marcar pagado',
  'orders.payment.isReadyToBeCaptured': 'El pago <0/> está pendiente. Marcalo como pagado cuando lo cobres.',
  'orders.payment.status.captured': 'Pagado',
  'orders.payment.status.partiallyCaptured': 'Pagado en parte',
  'orders.payment.capturePayment': 'Se marcará como pagado el monto de {{amount}}.',
  'orders.payment.capturePaymentSuccess': 'Pago de {{amount}} marcado como pagado',
  'orders.activity.events.payment.captured': 'Pago recibido',
  'orders.shipment.title': 'Marcar como enviado',
  'orders.fulfillment.create': 'Preparar pedido',
  'orders.fulfillment.awaitingFulfillmentBadge': 'Falta preparar',
  'fields.paidTotal': 'Total cobrado',
  'products.productStatus.draft': 'Oculto (borrador)',
  'products.productStatus.published': 'Visible en la tienda',
  'promotions.domain': 'Cupones y promociones',
  'app.search.groups.promotion': 'Cupones y promociones',
  'app.keyboardShortcuts.navigation.goToPromotions': 'Cupones y promociones',
  'priceLists.fields.type.options.sale.label': 'Oferta',
  'priceLists.fields.type.options.sale.description': 'Precio de oferta por un tiempo: en la tienda aparece con el precio normal tachado.',
}

const out = {}
let changed = 0
function walk(node, prefix, target) {
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue
    const id = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      const child = {}
      walk(value, id, child)
      if (Object.keys(child).length) target[key] = child
    } else if (typeof value === 'string') {
      let next = KEYS[id] ?? WORDS.reduce((s, [re, to]) => s.replace(re, to), value)
      if (next !== value) {
        target[key] = next
        changed++
      }
    }
  }
}
walk(official, '', out)

const missing = Object.keys(KEYS).filter((id) => id.split('.').reduce((n, k) => n?.[k], official) === undefined)
if (missing.length) console.warn(`Claves que ya no existen en Medusa: ${missing.join(', ')}`)

const file = path.join(ROOT, 'src/admin/i18n/es.json')
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
console.log(`${changed} textos cambiados → ${path.relative(ROOT, file)}`)
