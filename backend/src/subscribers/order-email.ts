import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { sendOrderEmail } from '../lib/order-email'

// Cada pedido web nuevo → mail al local (lib/order-email.ts). Si el mail
// falla, el pedido sigue igual: el error queda en el registro del servidor.
export default async function orderEmail({ event, container }: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const skipped = await sendOrderEmail(container, event.data.id)
    if (skipped) logger.info(`[pedido-mail] ${event.data.id}: no se mandó, ${skipped}`)
    else logger.info(`[pedido-mail] ${event.data.id}: aviso enviado`)
  } catch (error) {
    logger.warn(`[pedido-mail] ${event.data.id}: ${error instanceof Error ? error.message : error}`)
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed',
}
