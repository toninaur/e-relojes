import { sdk } from './client'

// Diapositivas del banner rotativo de la portada (panel → Banner).
export interface UiBanner {
  id: string
  title: string
  text: string | null
  image_url: string
  image_alt: string | null
  image_fit: 'contain' | 'cover'
  button_label: string | null
  button_url: string | null
}

export async function listBanners(): Promise<UiBanner[]> {
  try {
    const { banners } = await sdk.client.fetch<{ banners: UiBanner[] }>('/store/banners', {
      next: { revalidate: 60 },
    })
    return banners
  } catch (err) {
    console.error('[medusa] no se pudo obtener el banner', err)
    return []
  }
}
