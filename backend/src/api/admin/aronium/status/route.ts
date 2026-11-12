import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { getAroniumStatus } from '../../../../lib/aronium-sync'

// GET /admin/aronium/status: lo que muestra la página Aronium del panel.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const offset = Math.max(0, Number(req.query.offset) || 0)
  res.json(await getAroniumStatus(req.scope, { limit, offset }))
}
