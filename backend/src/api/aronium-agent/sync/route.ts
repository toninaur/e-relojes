import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { aroniumSyncSchema, syncAroniumSnapshot } from '../../../lib/aronium-sync'

// POST /aronium-agent/sync: catálogo de Aronium (todo o solo lo que cambió),
// o el error si el agente no pudo leerlo. Clave del conector (middlewares.ts).
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const parsed = aroniumSyncSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  res.json(await syncAroniumSnapshot(req.scope, parsed.data))
}
