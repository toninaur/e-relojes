import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getContent, toBlocks, type ContentKey } from '@/lib/medusa/content'

// Página legal (términos, cambios y devoluciones, privacidad). El título y el
// texto se editan en el panel → Páginas. Sin texto cargado se ve solo el título.

type LegalKey = Extract<ContentKey, `pagina-${string}`>

export const LEGAL_PAGES: { key: LegalKey; path: string; label: string }[] = [
  { key: 'pagina-terminos', path: '/terminos', label: 'Términos y condiciones' },
  { key: 'pagina-cambios-y-devoluciones', path: '/cambios-y-devoluciones', label: 'Cambios y devoluciones' },
  { key: 'pagina-privacidad', path: '/privacidad', label: 'Privacidad' },
]

export async function legalMetadata(key: LegalKey, path: string): Promise<Metadata> {
  const content = await getContent(key)
  if (!content) return {}
  const empty = !content.data.body.trim()
  return {
    title: content.data.title,
    alternates: { canonical: path },
    // Vacía no se manda a Google.
    ...(empty ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function LegalPage({ contentKey }: { contentKey: LegalKey }) {
  const content = await getContent(contentKey)
  if (!content) notFound()
  const blocks = toBlocks(content.data.body)

  return (
    <section className="section-y">
      <div className="wrap max-w-[46rem]">
        <h1 className="text-[clamp(2rem,5vw,3rem)] mb-8">{content.data.title}</h1>
        {blocks.map((block, i) =>
          block.heading ? (
            <h2 key={i} className="font-sans text-[1.2rem] font-bold mt-8 mb-3">
              {block.text}
            </h2>
          ) : (
            <p key={i} className="text-[1.02rem] leading-[1.7] whitespace-pre-line mb-4">
              {block.text}
            </p>
          ),
        )}
      </div>
    </section>
  )
}
