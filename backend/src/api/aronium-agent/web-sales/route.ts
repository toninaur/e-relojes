import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { listAgentWork } from '../../../lib/aronium-web-sales'

// GET /aronium-agent/web-sales: trabajo para el agente, del más viejo al más
// nuevo: proformas para escribir (quote), proformas para vigilar por si las
// marcaron "Pagado" (watch) y cancelaciones (cancel).
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  res.json({ work: await listAgentWork(req.scope, limit) })
}
