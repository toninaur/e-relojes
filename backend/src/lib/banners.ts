import { MedusaError } from '@medusajs/framework/utils'
import { z } from 'zod'

// Banner rotativo de la portada: se carga en el panel (Banner) y la tienda lo
// lee en /store/banners.

const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))

const optionalDate = z
  .string()
  .nullish()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), 'Fecha inválida')

export const bannerSchema = z
  .object({
    title: z.string().trim().min(1, 'Falta el título'),
    text: optionalText,
    image_url: z.string().trim().min(1, 'Falta la imagen'),
    image_alt: optionalText,
    image_fit: z.enum(['contain', 'cover']).default('contain'),
    button_label: optionalText,
    button_url: optionalText,
    is_active: z.boolean().default(true),
    starts_at: optionalDate,
    ends_at: optionalDate,
  })
  .refine((b) => !b.button_label || b.button_url, { message: 'El botón necesita un link', path: ['button_url'] })

export const bannerUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  text: optionalText.optional(),
  image_url: z.string().trim().min(1).optional(),
  image_alt: optionalText.optional(),
  image_fit: z.enum(['contain', 'cover']).optional(),
  button_label: optionalText.optional(),
  button_url: optionalText.optional(),
  is_active: z.boolean().optional(),
  rank: z.number().int().optional(),
  starts_at: optionalDate.optional(),
  ends_at: optionalDate.optional(),
})

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => i.message).join('; '))
  }
  return parsed.data
}
