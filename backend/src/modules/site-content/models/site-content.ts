import { model } from '@medusajs/framework/utils'

// Un bloque de contenido de la tienda que se edita en el panel: páginas
// legales y secciones de la portada. `key` dice qué es (lib/site-content.ts) y
// `data` guarda sus campos.
export const SiteContent = model.define('site_content', {
  id: model.id({ prefix: 'cnt' }).primaryKey(),
  key: model.text().unique(),
  data: model.json(),
})
