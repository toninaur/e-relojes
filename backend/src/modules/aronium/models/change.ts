import { model } from '@medusajs/framework/utils'
import { AroniumRun } from './run'

// Un evento aplicado en la tienda. Alta: producto nuevo (created). Baja:
// producto borrado o desactivado en Aronium, queda sin stock (removed).
// Modificación: precio, stock o foto.
export const AroniumChange = model.define('aronium_change', {
  id: model.id({ prefix: 'archg' }).primaryKey(),
  code: model.text(),
  product_id: model.text().nullable(),
  product_title: model.text().nullable(),
  field: model.enum(['price', 'stock', 'created', 'removed', 'image']),
  old_value: model.text().nullable(),
  new_value: model.text().nullable(),
  run: model.belongsTo(() => AroniumRun, { mappedBy: 'changes' }),
})
