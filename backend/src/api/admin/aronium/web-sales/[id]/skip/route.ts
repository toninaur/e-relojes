import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { skipWebSale } from '../../../../../../lib/aronium-web-sales'

// POST /admin/aronium/web-sales/:id/skip: "La cargué a mano". El local la
// registró en Aronium por su cuenta: el agente no la toca más.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ web_sale: await skipWebSale(req.scope, req.params.id) })
}
