import { model } from '@medusajs/framework/utils'

// Una pasada que mandó algo a ContiMarket, o que falló (bitácora del panel).
export const ContimarketRun = model.define('contimarket_run', {
  id: model.id({ prefix: 'cmrun' }).primaryKey(),
  status: model.enum(['ok', 'error']).default('ok'),
  full: model.boolean().default(false),
  reason: model.text().nullable(),
  sent: model.number().default(0),
  rejected: model.number().default(0),
  error: model.text().nullable(),
  duration_ms: model.number().default(0),
})
