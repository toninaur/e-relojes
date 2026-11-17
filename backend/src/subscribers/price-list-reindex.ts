import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { scheduleProductReindex } from '../lib/reindex-products'

// Panel → Ofertas (listas de precios): crear, editar, borrar o cambiar sus
// precios actualiza el buscador del catálogo (filtro "En oferta" y orden por
// precio). Ver lib/reindex-products.ts.
export default async function priceListReindex({ event, container }: SubscriberArgs<unknown>) {
  scheduleProductReindex(container, event.name)
}

export const config: SubscriberConfig = {
  event: [
    'price-list.created',
    'price-list.updated',
    'price-list.deleted',
    'price-list.prices_added',
    'price-list.prices_updated',
    'price-list.prices_removed',
  ],
}
