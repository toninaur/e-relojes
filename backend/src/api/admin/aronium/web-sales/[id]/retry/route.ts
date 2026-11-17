import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { retryWebSale } from '../../../../../../lib/aronium-web-sales'

// POST /admin/aronium/web-sales/:id/retry: vuelve a intentar una venta con error.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ web_sale: await retryWebSale(req.scope, req.params.id) })
}
