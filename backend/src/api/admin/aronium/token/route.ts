import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { generateAgentToken } from '../../../../lib/aronium-agent-auth'

// POST /admin/aronium/token: clave nueva para el conector (se muestra una sola
// vez; la anterior deja de funcionar).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ token: await generateAgentToken(req.scope) })
}
