import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { hideSoldOut } from '../lib/aronium-sync'
import { cancelOrder, enqueueOrder, markOrderPaid, orderIdForPayment } from '../lib/aronium-web-sales'

// Ventas web → Aronium: cada pedido nuevo entra en la cola; si se cancela o se
// marca como pagado, la cola se entera. El agente del local hace el resto
// (lib/aronium-web-sales.ts). Si el pedido se llevó la última unidad, el
// producto se oculta en el momento (lib/aronium-sync.ts, hideSoldOut).
export default async function aroniumWebSales({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    if (event.name === 'order.placed') {
      const sale = await enqueueOrder(container, event.data.id)
      const lines = ((sale?.payload as { lines?: { sku?: string | null }[] } | undefined)?.lines ?? [])
      const skus = lines.map((l) => l.sku ?? '').filter(Boolean)
      try {
        const hidden = await hideSoldOut(container, skus)
        if (hidden.length) logger.info(`[aronium] Pedido ${event.data.id}: última unidad vendida, oculto ${hidden.join(', ')}`)
      } catch (error) {
        // La próxima pasada del agente lo oculta igual.
        logger.warn(`[aronium] No se pudo ocultar lo agotado del pedido ${event.data.id}: ${error instanceof Error ? error.message : error}`)
      }
    } else if (event.name === 'order.canceled') await cancelOrder(container, event.data.id)
    else if (event.name === 'payment.captured') {
      const orderId = await orderIdForPayment(container, event.data.id)
      if (orderId) await markOrderPaid(container, orderId)
    }
  } catch (error) {
    // Un error acá no puede frenar el pedido; queda en el registro del servidor.
    logger.error(`[aronium] ${event.name} ${event.data?.id}: ${error instanceof Error ? error.message : error}`)
  }
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.canceled', 'payment.captured'],
}
