import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { bannerSchema, parseOrThrow } from '../../../lib/banners'
import { BANNER_MODULE } from '../../../modules/banner'
import type BannerModuleService from '../../../modules/banner/service'

// GET /admin/banners: todas las diapositivas, en orden.
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const banners: BannerModuleService = req.scope.resolve(BANNER_MODULE)
  res.json({ banners: await banners.listBanners({}, { order: { rank: 'ASC', created_at: 'ASC' } }) })
}

// POST /admin/banners: nueva diapositiva, al final.
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const banners: BannerModuleService = req.scope.resolve(BANNER_MODULE)
  const data = parseOrThrow(bannerSchema, req.body)
  const existing = await banners.listBanners({}, { select: ['rank'] })
  const rank = existing.reduce((max, b) => Math.max(max, b.rank + 1), 0)
  res.json({ banner: await banners.createBanners({ ...data, rank }) })
}
