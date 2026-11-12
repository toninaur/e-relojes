import { model } from '@medusajs/framework/utils'

// Estado del agente instalado en la PC del local (una sola fila).
export const AroniumAgent = model.define('aronium_agent', {
  id: model.id({ prefix: 'aragent' }).primaryKey(),
  last_seen_at: model.dateTime().nullable(),
  version: model.text().nullable(),
  host: model.text().nullable(),
  products_total: model.number().default(0),
  last_error: model.text().nullable(),
  last_error_at: model.dateTime().nullable(),
})
