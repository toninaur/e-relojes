import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { aroniumSyncSchema, syncAroniumSnapshot } from '../../../../lib/aronium-sync'

// POST /admin/aronium/sync: el agente del local manda el catálogo de Aronium
// (o el error si no pudo leerlo). Se autentica con una clave secreta de API.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = aroniumSyncSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  res.json(await syncAroniumSnapshot(req.scope, parsed.data))
}
