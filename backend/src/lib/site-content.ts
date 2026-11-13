import { MedusaContainer } from '@medusajs/framework'
import { MedusaError } from '@medusajs/framework/utils'
import { z } from 'zod'
import { SITE_CONTENT_MODULE } from '../modules/site-content'
import type SiteContentModuleService from '../modules/site-content/service'

// Contenido de la tienda que el cliente edita en el panel:
// - Páginas → páginas legales (términos, cambios y devoluciones, privacidad).
// - Portada → productos destacados y la sección "Perfumes y decants".
// Cada bloque tiene una clave fija, sus campos y lo que se muestra mientras
// nadie lo guardó. La tienda lo lee en GET /store/content/:key.

export const MAX_FEATURED = 8
export const MAX_COMBOS = 12

const text = (max: number) => z.string().trim().max(max)

const legalSchema = z.object({
  title: text(120).min(1, 'Falta el título'),
  // Texto libre: párrafos separados por una línea en blanco; una línea que
  // empieza con "# " es un subtítulo.
  body: z.string().max(100_000),
})

const featuredSchema = z.object({
  product_ids: z.array(z.string().min(1)).max(MAX_FEATURED, `Máximo ${MAX_FEATURED} productos destacados`),
})

const perfumesSchema = z.object({
  title: text(120).min(1, 'Falta el título'),
  text: text(1000),
  decant_title: text(120),
  decant_text: text(1000),
  photos: z.array(z.object({ url: z.string().trim().min(1), alt: text(200) })).max(2, 'Máximo 2 fotos'),
  combos_title: text(120),
  combo_product_ids: z.array(z.string().min(1)).max(MAX_COMBOS, `Máximo ${MAX_COMBOS} combos`),
})

function legal(title: string) {
  return { schema: legalSchema, defaults: { title, body: '' } }
}

export const CONTENT = {
  'pagina-terminos': legal('Términos y condiciones'),
  'pagina-cambios-y-devoluciones': legal('Cambios y devoluciones'),
  'pagina-privacidad': legal('Política de privacidad'),
  // Sin guardar, la tienda muestra los productos con el tag "destacado".
  'portada-destacados': { schema: featuredSchema, defaults: { product_ids: [] as string[] } },
  'portada-perfumes': {
    schema: perfumesSchema,
    defaults: {
      title: 'Perfumes y decants',
      text: 'Perfumes árabes como Afnan, Armaf y Al Haramain, y de diseñador como Paco Rabanne, Jean Paul Gaultier, Armani y Valentino.',
      decant_title: '¿Qué es un decant?',
      decant_text:
        'Es una porción del perfume original en un frasco chico de 3, 5 o 10 ml. Ideal para probar una fragancia antes de comprar el frasco completo, o para llevar en la cartera o el bolso.',
      // Fotos que vienen con la tienda (carpeta public/images del storefront).
      photos: [
        { url: '/images/perfume-9pm.jpg', alt: 'Perfume Afnan 9PM con su decant de 10 ml' },
        { url: '/images/perfume-million.jpg', alt: 'Perfume Paco Rabanne 1 Million Elixir' },
      ],
      combos_title: 'Combos de 5 decants de 10 ml',
      combo_product_ids: [] as string[],
    },
  },
} as const

export type ContentKey = keyof typeof CONTENT

export function isContentKey(key: string): key is ContentKey {
  return Object.prototype.hasOwnProperty.call(CONTENT, key)
}

function assertKey(key: string): asserts key is ContentKey {
  if (!isContentKey(key)) throw new MedusaError(MedusaError.Types.NOT_FOUND, `No existe el contenido "${key}"`)
}

/** El bloque guardado, o el de fábrica. `configured`: si alguien lo guardó. */
export async function getContent(container: MedusaContainer, key: string) {
  assertKey(key)
  const service: SiteContentModuleService = container.resolve(SITE_CONTENT_MODULE)
  const [row] = await service.listSiteContents({ key }, { take: 1 })
  const { schema, defaults } = CONTENT[key]
  const parsed = row ? schema.safeParse(row.data) : null
  return {
    key,
    configured: Boolean(row),
    data: parsed?.success ? parsed.data : defaults,
    updated_at: row?.updated_at ?? null,
  }
}

export async function setContent(container: MedusaContainer, key: string, body: unknown) {
  assertKey(key)
  const parsed = CONTENT[key].schema.safeParse(body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => i.message).join('; '))
  }
  const service: SiteContentModuleService = container.resolve(SITE_CONTENT_MODULE)
  const [row] = await service.listSiteContents({ key }, { take: 1 })
  if (row) await service.updateSiteContents({ id: row.id, data: parsed.data })
  else await service.createSiteContents({ key, data: parsed.data })
  return getContent(container, key)
}
