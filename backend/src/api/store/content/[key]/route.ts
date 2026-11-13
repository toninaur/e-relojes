import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { getContent } from '../../../../lib/site-content'

// GET /store/content/:key: un bloque de contenido (páginas legales, portada).
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({ content: await getContent(req.scope, req.params.key) })
}
