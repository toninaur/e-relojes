import { MedusaContainer } from '@medusajs/framework'
import { applyCatalogTaxonomy } from '../lib/apply-catalog-taxonomy'

// Taxonomía ajustada con el Aronium real del local (18/11/2026): categoría
// "Ropa", tipos Remera, Corbata, Ropa interior y Malla de reloj, y las marcas
// que faltaban (Hugo Boss, Under Armour, U.S. Polo Assn…). Las migraciones
// corren una sola vez cada una: por eso es un archivo nuevo.
export default async function catalog_taxonomy_2026_11({ container }: { container: MedusaContainer }) {
  await applyCatalogTaxonomy(container)
}
