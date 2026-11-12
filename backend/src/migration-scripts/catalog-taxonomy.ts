import { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import {
  createCollectionsWorkflow,
  createProductCategoriesWorkflow,
  createProductTypesWorkflow,
  updateProductCategoriesWorkflow,
} from '@medusajs/medusa/core-flows'
import { BRANDS, CATEGORIES, PRODUCT_TYPES } from '../lib/catalog-taxonomy'

// Categorías, tipos de producto y marcas del catálogo completo de E-Relojes
// (lib/catalog-taxonomy.ts). No crea productos.
//
// Corre una sola vez, con `medusa db:migrate` (en Railway, en el deploy, antes
// del seed de la demo). Agrega lo que falte y no borra nada: si el cliente
// después cambia o borra algo desde el panel, queda así. "Perfumes" y
// "Accesorios" (de la demo) se renombran, con sus productos adentro.
export default async function catalog_taxonomy({ container }: { container: MedusaContainer }) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const key = (s: string) => s.trim().toLowerCase()

  // ---- Categorías -----------------------------------------------------------
  const { data: existing } = await query.graph({ entity: 'product_category', fields: ['id', 'name', 'handle'] })
  const byName = new Map(existing.map((c) => [key(c.name), c]))
  const byHandle = new Map(existing.map((c) => [c.handle, c]))

  const toCreate: { name: string; handle: string; description: string; rank: number; is_active: boolean }[] = []
  for (const [rank, category] of CATEGORIES.entries()) {
    const current =
      byName.get(key(category.name)) ??
      ('renamedFrom' in category ? byName.get(key(category.renamedFrom)) : undefined) ??
      byHandle.get(category.handle)
    if (current) {
      await updateProductCategoriesWorkflow(container).run({
        input: {
          selector: { id: current.id },
          update: { name: category.name, handle: category.handle, description: category.description, rank },
        },
      })
    } else {
      toCreate.push({ name: category.name, handle: category.handle, description: category.description, rank, is_active: true })
    }
  }
  if (toCreate.length) {
    await createProductCategoriesWorkflow(container).run({ input: { product_categories: toCreate } })
  }
  logger.info(`Categorías: ${CATEGORIES.length - toCreate.length} actualizadas, ${toCreate.length} creadas`)

  // ---- Tipos de producto ----------------------------------------------------
  const { data: types } = await query.graph({ entity: 'product_type', fields: ['value'] })
  const haveTypes = new Set(types.map((t) => key(t.value)))
  const newTypes = PRODUCT_TYPES.filter((t) => !haveTypes.has(key(t)))
  if (newTypes.length) {
    await createProductTypesWorkflow(container).run({ input: { product_types: newTypes.map((value) => ({ value })) } })
  }
  logger.info(`Tipos de producto: ${newTypes.length} creados`)

  // ---- Marcas (colecciones) -------------------------------------------------
  const { data: collections } = await query.graph({ entity: 'product_collection', fields: ['title', 'handle'] })
  const haveBrands = new Set(collections.map((c) => key(c.title)))
  const takenHandles = new Set(collections.map((c) => c.handle))
  const newBrands = BRANDS.filter((b) => !haveBrands.has(key(b))).map((title) => {
    let handle = slugify(title)
    for (let n = 2; takenHandles.has(handle); n++) handle = `${slugify(title)}-${n}`
    takenHandles.add(handle)
    return { title, handle }
  })
  if (newBrands.length) {
    await createCollectionsWorkflow(container).run({ input: { collections: newBrands } })
  }
  logger.info(`Marcas: ${newBrands.length} creadas`)
}

function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'y')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
