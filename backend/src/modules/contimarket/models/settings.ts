import { model } from '@medusajs/framework/utils'

// Configuración del conector de ContiMarket (una sola fila), manejada desde el
// panel. El email y la contraseña de ContiMarket NO van acá: son variables de
// entorno del servidor (CONTIMARKET_USER / CONTIMARKET_PASSWORD).
export const ContimarketSettings = model.define('contimarket_settings', {
  id: model.id({ prefix: 'cmset' }).primaryKey(),
  // Apagado hasta que el local lo active (y estén las credenciales).
  enabled: model.boolean().default(false),
  // Pausa desde el panel: no manda nada; al reanudar manda lo que cambió.
  paused: model.boolean().default(false),
  // Qué productos van: todos los publicados, o solo los que tienen la etiqueta
  // "contimarket".
  products: model.enum(['all', 'tagged']).default('all'),
  // Precio especial (PrecioContinental): el mismo, el de oferta de la tienda,
  // o un porcentaje menos que el normal.
  price_rule: model.enum(['same', 'offer', 'percent']).default('same'),
  price_percent: model.number().default(0),
  // Última unidad: con menos de min_stock unidades disponibles se manda 0.
  min_stock: model.number().default(1),
  // Peso y medidas por tipo de producto: { "Reloj": { "kg": 0.3, "cm": [12, 10, 8] } }.
  // Lo que falte toma los valores por defecto (lib/contimarket.ts).
  dimensions: model.json().nullable(),
  // "Sincronizar todo ahora" desde el panel.
  full_requested: model.boolean().default(false),
  last_run_at: model.dateTime().nullable(),
  last_full_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  last_error_at: model.dateTime().nullable(),
})
