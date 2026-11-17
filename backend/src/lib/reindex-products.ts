import type { MedusaContainer } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { reindexSearchIndexesWorkflow } from '@medusajs/medusa/core-flows'

// Reindexación del buscador de productos (backend/src/search/product.ts).
//
// El índice guarda el precio mínimo y si el producto está en oferta, pero los
// cambios en las listas de precios ("Ofertas") no pasan por los eventos de
// producto. Sin esto, el filtro "En oferta" y el orden por precio quedaban
// viejos hasta reiniciar el backend.
//
// Una carga de ofertas dispara varios eventos seguidos: se espera unos
// segundos y se reindexa una sola vez. Se reconstruye el índice entero en una
// versión nueva que reemplaza a la anterior al terminar (`swap`), así la
// tienda nunca ve el índice a medio cargar.

const DEBOUNCE_MS = 5_000

let timer: NodeJS.Timeout | null = null
let pendingReasons = new Set<string>()

export function scheduleProductReindex(container: MedusaContainer, reason: string) {
  pendingReasons.add(reason)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const reasons = [...pendingReasons]
    pendingReasons = new Set()
    void reindexProducts(container, reasons.join(', '))
  }, DEBOUNCE_MS)
}

export async function reindexProducts(container: MedusaContainer, reason: string) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    await reindexSearchIndexesWorkflow(container).run({ input: { index: 'product', strategy: 'swap' } })
    logger.info(`[buscador] índice de productos reconstruido (${reason})`)
  } catch (error) {
    logger.error(`[buscador] no se pudo reconstruir el índice de productos (${reason}): ${error instanceof Error ? error.message : error}`)
  }
}
