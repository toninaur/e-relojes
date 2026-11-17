import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { listAgentWork } from '../../../lib/aronium-web-sales'

// GET /aronium-agent/web-sales: ventas web para escribir en Aronium (nuevas,
// pagos y devoluciones), de la más vieja a la más nueva.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  res.json({ work: await listAgentWork(req.scope, limit) })
}
