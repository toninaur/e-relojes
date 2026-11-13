import { sdk } from './client'

// Contenido que el cliente edita en el panel (Portada y Páginas). Lo sirve
// el backend en /store/content/:key (backend/src/lib/site-content.ts).

export interface LegalPage {
  title: string
  body: string
}

export interface FeaturedContent {
  product_ids: string[]
}

export interface PerfumesContent {
  title: string
  text: string
  decant_title: string
  decant_text: string
  photos: { url: string; alt: string }[]
  combos_title: string
  combo_product_ids: string[]
}

interface ContentMap {
  'pagina-terminos': LegalPage
  'pagina-cambios-y-devoluciones': LegalPage
  'pagina-privacidad': LegalPage
  'portada-destacados': FeaturedContent
  'portada-perfumes': PerfumesContent
}

export type ContentKey = keyof ContentMap

export interface Content<K extends ContentKey> {
  /** Si alguien lo guardó en el panel; si no, `data` es el de fábrica. */
  configured: boolean
  data: ContentMap[K]
}

export async function getContent<K extends ContentKey>(key: K): Promise<Content<K> | null> {
  try {
    const { content } = await sdk.client.fetch<{ content: Content<K> }>(`/store/content/${key}`, {
      next: { revalidate: 60 },
    })
    return content
  } catch (err) {
    console.error('[medusa] no se pudo obtener el contenido', key, err)
    return null
  }
}

/** Párrafos de una página legal: separados por línea en blanco; "# " = subtítulo. */
export function toBlocks(body: string): { heading: boolean; text: string }[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => (block.startsWith('# ') ? { heading: true, text: block.slice(2).trim() } : { heading: false, text: block }))
}
