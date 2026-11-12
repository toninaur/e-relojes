import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { bannerUpdateSchema, parseOrThrow } from '../../../../lib/banners'
import { BANNER_MODULE } from '../../../../modules/banner'
import type BannerModuleService from '../../../../modules/banner/service'

// POST /admin/banners/:id: editar (también activar/desactivar y reordenar).
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const banners: BannerModuleService = req.scope.resolve(BANNER_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const parsed = parseOrThrow(bannerUpdateSchema, body)
  // Solo los campos que vinieron: Zod completa los ausentes con null (por la
  // transformación de texto vacío a null) y borraría texto, botón o fechas al
  // ocultar o reordenar una diapositiva.
  const data = Object.fromEntries(Object.entries(parsed).filter(([key]) => key in body))
  res.json({ banner: await banners.updateBanners({ id: req.params.id, ...data }) })
}

// DELETE /admin/banners/:id
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const banners: BannerModuleService = req.scope.resolve(BANNER_MODULE)
  await banners.deleteBanners(req.params.id)
  res.json({ id: req.params.id, deleted: true })
}
