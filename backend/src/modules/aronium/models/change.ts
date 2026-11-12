import { model } from '@medusajs/framework/utils'
import { AroniumRun } from './run'

// Un cambio aplicado en la tienda: precio, stock, producto nuevo o foto.
export const AroniumChange = model.define('aronium_change', {
  id: model.id({ prefix: 'archg' }).primaryKey(),
  code: model.text(),
  product_id: model.text().nullable(),
  product_title: model.text().nullable(),
  field: model.enum(['price', 'stock', 'created', 'image']),
  old_value: model.text().nullable(),
  new_value: model.text().nullable(),
  run: model.belongsTo(() => AroniumRun, { mappedBy: 'changes' }),
})
