import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { aroniumSyncSchema, syncAroniumItems } from '../../../../lib/aronium-sync'

// POST /admin/aronium/sync — lo llama el conector del local con una clave
// secreta de API (admin → Settings → Secret API Keys). Ver connector/README.md.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = aroniumSyncSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  const result = await syncAroniumItems(req.scope, parsed.data.items)
  res.json(result)
}
