import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { agentResultSchema, applyAgentResult } from '../../../../lib/aronium-web-sales'

// POST /aronium-agent/web-sales/:id: resultado del agente para un pedido web
// (proforma escrita, venta creada, proforma anulada o devolución) o el error.
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = agentResultSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  res.json({ web_sale: await applyAgentResult(req.scope, req.params.id, parsed.data) })
}
