import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { getContimarketStatus } from '../../../../lib/contimarket-sync'

// GET /admin/contimarket/status: lo que muestra la página ContiMarket del panel.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await getContimarketStatus(req.scope))
}
