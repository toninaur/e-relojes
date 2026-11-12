import { model } from '@medusajs/framework/utils'

// Una diapositiva del banner rotativo de la portada.
export const Banner = model.define('banner', {
  id: model.id({ prefix: 'bnr' }).primaryKey(),
  title: model.text(),
  text: model.text().nullable(),
  image_url: model.text(),
  image_alt: model.text().nullable(),
  // contain: producto sobre fondo blanco, con margen. cover: la foto llena el círculo.
  image_fit: model.enum(['contain', 'cover']).default('contain'),
  button_label: model.text().nullable(),
  button_url: model.text().nullable(),
  rank: model.number().default(0),
  is_active: model.boolean().default(true),
  // Opcionales: para promociones con fecha. Fuera de ese rango no se muestra.
  starts_at: model.dateTime().nullable(),
  ends_at: model.dateTime().nullable(),
})
