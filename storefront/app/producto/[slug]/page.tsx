import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { absoluteUrl } from '@/lib/brand'
import { getProductBySlug, listProducts } from '@/lib/medusa/products'
import { listBrands, listCategories } from '@/lib/medusa/catalog'
import ProductGallery from '@/components/ProductGallery'
import ProductPurchase from '@/components/ProductPurchase'
import { ProductGrid } from '@/components/ProductCard'
import { t } from '@/lib/texts'
import { formatMoney } from '@/lib/format'
import { jsonLd, productJsonLd } from '@/lib/seo'

type Params = Promise<{ slug: string }>

const RELATED = 4

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return {}
  const name = product.name
  // Al compartir por WhatsApp o Instagram, la vista previa muestra el precio.
  const price = formatMoney(product.price, product.currency)
  const detail = product.description ?? (product.specs.join(' · ') || null)
  const description = [price, detail].filter(Boolean).join(' · ')
  const image = product.images.slice(0, 1)
  return {
    title: name,
    description,
    alternates: { canonical: `/producto/${slug}` },
    openGraph: {
      type: 'website',
      title: name,
      description,
      url: absoluteUrl(`/producto/${slug}`),
      images: image.map((url) => ({ url, alt: name })),
    },
    twitter: { card: 'summary_large_image', title: name, description, images: image },
  }
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) notFound()

  const name = product.name
  const mainCategory = product.categories[0]
  const [categories, brands] = await Promise.all([listCategories(), listBrands()])
  const categoryId = mainCategory ? categories.find((c) => c.handle === mainCategory.handle)?.id : undefined
  const brandId = product.brandHandle ? brands.find((b) => b.handle === product.brandHandle)?.id : undefined

  // Relacionados: primero la misma marca, después la misma categoría.
  const [sameBrand, sameCategory] = await Promise.all([
    brandId ? listProducts({ collectionId: brandId, limit: RELATED + 1 }) : null,
    categoryId ? listProducts({ categoryId, limit: RELATED * 2 }) : null,
  ])
  const related = [...(sameBrand?.products ?? []), ...(sameCategory?.products ?? [])]
    .filter((p, i, all) => p.id !== product.id && all.findIndex((q) => q.id === p.id) === i)
    .slice(0, RELATED)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(productJsonLd(product)) }} />
      <section className="py-8 sm:py-12">
        <div className="wrap">
          <nav aria-label="Ruta" className="text-[0.92rem] text-muted mb-6 flex flex-wrap gap-1.5">
            <Link href="/catalogo" className="no-underline hover:underline">
              Catálogo
            </Link>
            {mainCategory && (
              <>
                <span aria-hidden>/</span>
                <Link href={`/catalogo?categoria=${mainCategory.handle}`} className="no-underline hover:underline">
                  {mainCategory.name}
                </Link>
              </>
            )}
            <span aria-hidden>/</span>
            <span className="text-ink">{name}</span>
          </nav>

          <div className="grid gap-10 lg:gap-14 lg:grid-cols-[1.1fr_1fr]">
            <ProductGallery images={product.images} alt={name} />

            <div>
              {product.brand && (
                <Link
                  href={product.brandHandle ? `/catalogo?marca=${product.brandHandle}` : '/catalogo'}
                  className="text-[0.85rem] font-bold tracking-[0.08em] uppercase text-muted no-underline hover:text-ink"
                >
                  {product.brand}
                </Link>
              )}
              <h1 className="text-[clamp(2rem,4vw,2.8rem)] mt-1 mb-2">{product.model}</h1>
              {product.ref && <p className="text-muted text-[0.95rem] mb-5">Ref. {product.ref}</p>}

              {product.originalPrice && (
                <span className="inline-block bg-accent text-white text-[0.8rem] font-bold px-2.5 py-1 rounded-full mb-3">
                  Oferta
                </span>
              )}

              <ProductPurchase product={product} />

              {product.specs.length > 0 && (
                <div className="mt-8">
                  <h2 className="font-sans text-[1rem] font-bold mb-3">Características</h2>
                  <ul className="flex flex-wrap gap-2">
                    {product.specs.map((spec) => (
                      <li key={spec} className="text-[0.9rem] bg-white border border-line rounded-full px-3 py-1.5">
                        {spec}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {product.description && (
                <div className="mt-8">
                  <h2 className="font-sans text-[1rem] font-bold mb-2">Descripción</h2>
                  <p className="text-muted whitespace-pre-line">{product.description}</p>
                </div>
              )}

              {(product.sizeChartImage || product.sizeChartText) && (
                <details className="mt-6">
                  <summary className="cursor-pointer font-semibold">{t.sizeGuide}</summary>
                  <div className="mt-3">
                    {product.sizeChartImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.sizeChartImage} alt={t.sizeGuide} className="max-w-full rounded-lg border border-line" />
                    )}
                    {product.sizeChartText && <p className="text-muted whitespace-pre-line">{product.sizeChartText}</p>}
                  </div>
                </details>
              )}

              <ul className="mt-8 pt-6 border-t border-line text-[0.95rem] text-muted space-y-1.5">
                <li>🚚 Envíos a todo el país, o retiro gratis en el local.</li>
                <li>🎁 ¿Es un regalo? Avisanos y lo preparamos para la ocasión.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="pb-16 sm:pb-24">
          <div className="wrap">
            <h2 className="text-[clamp(1.6rem,3vw,2.2rem)] mb-6">Productos relacionados</h2>
            <ProductGrid products={related} />
          </div>
        </section>
      )}
    </>
  )
}
