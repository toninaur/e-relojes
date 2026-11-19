import { MedusaContainer } from '@medusajs/framework'
import { applyCatalogTaxonomy } from '../lib/apply-catalog-taxonomy'

// Categorías, tipos de producto y marcas del catálogo completo de E-Relojes
// (lib/catalog-taxonomy.ts). No crea productos.
//
// Corre una sola vez, con `medusa db:migrate` (en Railway, en el deploy, antes
// del seed de la demo). Agrega lo que falte y no borra nada: si el cliente
// después cambia o borra algo desde el panel, queda así. "Perfumes" y
// "Accesorios" (de la demo) se renombran, con sus productos adentro.
export default async function catalog_taxonomy({ container }: { container: MedusaContainer }) {
  await applyCatalogTaxonomy(container)
}
