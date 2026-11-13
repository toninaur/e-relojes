import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { getContent, setContent } from '../../../../lib/site-content'

// GET /admin/content/:key
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ content: await getContent(req.scope, req.params.key) })
}

// POST /admin/content/:key: guarda el bloque entero.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ content: await setContent(req.scope, req.params.key, req.body) })
}
