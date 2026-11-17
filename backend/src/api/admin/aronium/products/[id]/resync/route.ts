import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { requestProductResync } from '../../../../../../lib/aronium-sync'

// POST /admin/aronium/products/:id/resync: "Tomar de Aronium". La próxima
// pasada vuelve a copiar foto, descripción, filtros y características de
// Aronium, aunque se hayan editado en el panel.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await requestProductResync(req.scope, req.params.id))
}
