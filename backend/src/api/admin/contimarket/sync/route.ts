import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { requestContimarketFull } from '../../../../lib/contimarket-sync'

// POST /admin/contimarket/sync: "Sincronizar todo ahora" (pasada completa en
// unos segundos, aparte de la sincronización con Aronium).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await requestContimarketFull(req.scope))
}
