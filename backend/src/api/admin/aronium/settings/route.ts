import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { agentSettingsSchema, updateAgentSettings } from '../../../../lib/aronium-sync'

// POST /admin/aronium/settings: interruptores (sincronización y ventas web),
// frecuencia y "Sincronizar todo ahora", desde el panel → Aronium.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = agentSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => i.message).join('; '))
  }
  res.json(await updateAgentSettings(req.scope, parsed.data))
}
