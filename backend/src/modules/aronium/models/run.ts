import { model } from '@medusajs/framework/utils'
import { AroniumChange } from './change'

// Una pasada del agente que cambió algo en la tienda, o que falló. Las
// pasadas sin cambios solo actualizan la última conexión del agente.
export const AroniumRun = model.define('aronium_run', {
  id: model.id({ prefix: 'arrun' }).primaryKey(),
  status: model.enum(['ok', 'error']).default('ok'),
  items_received: model.number().default(0),
  prices_updated: model.number().default(0),
  stock_updated: model.number().default(0),
  created: model.number().default(0),
  images_added: model.number().default(0),
  error: model.text().nullable(),
  duration_ms: model.number().default(0),
  changes: model.hasMany(() => AroniumChange, { mappedBy: 'run' }),
})
