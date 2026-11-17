import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { listWebSalesForPanel } from '../../../../lib/aronium-web-sales'

// GET /admin/aronium/web-sales: ventas web y su estado en Aronium (panel).
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  res.json(await listWebSalesForPanel(req.scope, { limit, offset }))
}
