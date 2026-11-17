import type { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { reindexProducts } from '../lib/reindex-products'

// Una oferta con fecha de inicio o de fin empieza o termina sola, sin ningún
// evento. Cada hora se mira si alguna lista de precios cruzó su fecha desde la
// pasada anterior y, si es así, se actualiza el buscador.
const WINDOW_MS = 65 * 60 * 1000

export default async function reindexOffersByDate(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: lists } = await query.graph({ entity: 'price_list', fields: ['id', 'title', 'starts_at', 'ends_at'] })

  const now = Date.now()
  const crossed = (date: unknown) => {
    if (!date) return false
    const t = new Date(date as string).getTime()
    return t <= now && now - t < WINDOW_MS
  }
  const changed = lists.filter((l) => crossed(l.starts_at) || crossed(l.ends_at))
  if (changed.length) {
    await reindexProducts(container, `ofertas por fecha: ${changed.map((l) => l.title).join(', ')}`)
  }
}

export const config = {
  name: 'reindex-offers-by-date',
  // Al minuto 1 de cada hora (las ofertas suelen empezar a la hora en punto).
  schedule: '1 * * * *',
}
