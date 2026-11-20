import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { contimarketSettingsSchema, updateContimarketSettings } from '../../../../lib/contimarket-sync'

// POST /admin/contimarket/settings: encender, pausar, qué productos van,
// precio especial, regla de la última unidad y medidas por tipo.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = contimarketSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  res.json(await updateContimarketSettings(req.scope, parsed.data))
}
