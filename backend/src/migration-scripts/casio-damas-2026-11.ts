import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'
import { normalize, WOMEN } from '../lib/aronium-classify'
import { reindexProducts } from '../lib/reindex-products'

// Los relojes Casio de mujer ("Casio Damas …") también van a la categoría
// "Damas" (20/11/2026): estaban solo en "Casio" y quien filtraba por Damas no
// los veía (134 de 180). Los nuevos de Aronium ya entran en las dos
// (lib/aronium-classify.ts). Corre una sola vez, con `medusa db:migrate`;
// solo agrega la categoría, no saca ninguna.
export default async function casio_damas_2026_11({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const products = await casioWomenWithoutDamas(container)
  if (!products.length) return
  await updateProductsWorkflow(container).run({
    input: { products: products.map((p) => ({ id: p.id, category_ids: [...p.categoryIds, p.damasId] })) },
  })
  logger.info(`[catálogo] ${products.length} relojes Casio de mujer agregados a la categoría Damas`)
  await reindexProducts(container, 'Casio de mujer en Damas')
}

/** Relojes Casio de mujer que todavía no están en "Damas". */
export async function casioWomenWithoutDamas(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: categories } = await query.graph({ entity: 'product_category', fields: ['id', 'name'], filters: { name: ['Casio', 'Damas'] } })
  const casio = categories.find((c) => c.name === 'Casio')
  const damas = categories.find((c) => c.name === 'Damas')
  if (!casio || !damas) return []
  // Los productos de "Casio" y, aparte, sus categorías leídas del producto: a
  // través de la categoría, las categorías de cada producto vienen vacías, y
  // guardar eso le sacaría "Casio" (pasó en la prueba del 20/11/2026).
  const { data: rows } = await query.graph({ entity: 'product_category', fields: ['id', 'products.id'], filters: { id: casio.id } })
  const ids = (rows[0]?.products ?? []).map((p) => p?.id).filter((id): id is string => Boolean(id))
  if (!ids.length) return []
  const { data } = await query.graph({ entity: 'product', fields: ['id', 'title', 'type.value', 'categories.id'], filters: { id: ids } })
  return data
    .filter((p) => (!p.type?.value || p.type.value === 'Reloj') && WOMEN.test(normalize(p.title ?? '')))
    .map((p) => ({ id: p.id, title: p.title, categoryIds: (p.categories ?? []).map((c) => c!.id), damasId: damas.id }))
    // Nunca guardar sin "Casio" (la lista nueva reemplaza a la anterior).
    .filter((p) => p.categoryIds.includes(casio.id) && !p.categoryIds.includes(damas.id))
}
