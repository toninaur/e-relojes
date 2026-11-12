import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'
import { aroniumImagesSchema, attachAroniumImages } from '../../../../lib/aronium-sync'

// POST /admin/aronium/images: fotos de Aronium que pidió /sync (`images_wanted`).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const parsed = aroniumImagesSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  res.json(await attachAroniumImages(req.scope, parsed.data))
}
