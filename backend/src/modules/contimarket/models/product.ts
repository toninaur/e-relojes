import { model } from '@medusajs/framework/utils'

// Lo último que ContiMarket recibió bien de cada producto (por código): con la
// huella se manda solo lo que cambió. status "error": ContiMarket lo rechazó
// (motivo en last_error) y se reintenta cuando el producto cambie o en la
// pasada completa diaria.
export const ContimarketProduct = model.define('contimarket_product', {
  id: model.id({ prefix: 'cmprod' }).primaryKey(),
  code: model.text().unique(),
  product_id: model.text().nullable(),
  title: model.text().nullable(),
  hash: model.text().nullable(),
  status: model.enum(['ok', 'error']).default('ok'),
  last_error: model.text().nullable(),
  stock: model.number().default(0),
  price: model.number().default(0),
  sent_at: model.dateTime().nullable(),
})
