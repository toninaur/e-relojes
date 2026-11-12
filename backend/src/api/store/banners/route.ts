import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { BANNER_MODULE } from '../../../modules/banner'
import type BannerModuleService from '../../../modules/banner/service'

// GET /store/banners: diapositivas activas y vigentes, en orden.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const banners: BannerModuleService = req.scope.resolve(BANNER_MODULE)
  const now = Date.now()
  const list = await banners.listBanners({ is_active: true }, { order: { rank: 'ASC', created_at: 'ASC' } })
  res.json({
    banners: list
      .filter((b) => (!b.starts_at || new Date(b.starts_at).getTime() <= now) && (!b.ends_at || new Date(b.ends_at).getTime() > now))
      .map(({ id, title, text, image_url, image_alt, image_fit, button_label, button_url }) => ({
        id,
        title,
        text,
        image_url,
        image_alt,
        image_fit,
        button_label,
        button_url,
      })),
  })
}
