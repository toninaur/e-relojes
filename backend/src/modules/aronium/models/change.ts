import { model } from '@medusajs/framework/utils'
import { AroniumRun } from './run'

// Un evento aplicado en la tienda. Alta: producto nuevo (created). Baja:
// producto borrado o desactivado en Aronium, queda sin stock (removed).
// Modificación: precio, stock, foto o contenido. Publicado: borrador del
// conector que se publicó solo (foto, categoría y stock). Oculto: se quedó
// sin stock (vuelve solo cuando tiene).
export const AroniumChange = model.define('aronium_change', {
  id: model.id({ prefix: 'archg' }).primaryKey(),
  code: model.text(),
  product_id: model.text().nullable(),
  product_title: model.text().nullable(),
  field: model.enum(['price', 'stock', 'created', 'removed', 'image', 'content', 'published', 'hidden']),
  old_value: model.text().nullable(),
  new_value: model.text().nullable(),
  run: model.belongsTo(() => AroniumRun, { mappedBy: 'changes' }),
})
