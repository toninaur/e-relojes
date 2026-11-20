import type { MedusaContainer } from '@medusajs/framework/types'
import { runContimarketExclusive } from '../lib/contimarket-sync'

// Revisión de ContiMarket cada 5 minutos: lo que no pasa por la sincronización
// con Aronium (una reserva de un pedido web, una oferta, una edición en el
// panel) llega igual. Manda solo lo que cambió, y todo una vez por día. Si el
// conector está apagado o en pausa, no hace nada.
export default async function contimarketPush(container: MedusaContainer) {
  await runContimarketExclusive(container, { reason: 'revisión cada 5 minutos' })
}

export const config = {
  name: 'contimarket-push',
  schedule: '*/5 * * * *',
}
