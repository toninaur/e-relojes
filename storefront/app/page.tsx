import Link from 'next/link'
import { landing } from '@/content/landing'
import { brand, whatsappUrl } from '@/lib/brand'
import { formatMoney } from '@/lib/format'
import { listBrands, listCategories, listCombos, listFeaturedProducts } from '@/lib/medusa/catalog'
import { getContent } from '@/lib/medusa/content'
import { listProducts } from '@/lib/medusa/products'
import { ProductGrid } from '@/components/ProductCard'
import { listBanners } from '@/lib/medusa/banners'
import { jsonLd, storeJsonLd } from '@/lib/seo'
import FeaturedProducts from '@/components/FeaturedProducts'
import HeroCarousel, { type HeroSlide } from '@/components/HeroCarousel'
import { OrganizerIcon, ThermosIcon } from '@/components/icons'
import StoreImage from '@/components/StoreImage'
import BrandMarquee from '@/components/BrandMarquee'

function SectionHead({ title, text, dark = false }: { title: string; text?: string; dark?: boolean }) {
  return (
    <div data-reveal className="flex flex-wrap justify-between items-end gap-x-12 gap-y-5 mb-[clamp(2rem,5vw,3.25rem)]">
      <h2 className="h2-display">{title}</h2>
      {text && <p className={`max-w-[58ch] text-[1.08rem] m-0 ${dark ? 'text-white/70' : 'text-muted'}`}>{text}</p>}
    </div>
  )
}

const NEW_ARRIVALS = 4

export default async function HomePage() {
  const [banners, newArrivals, featured, categories, brands, perfumesContent] = await Promise.all([
    listBanners(),
    // Los últimos publicados (la tienda solo devuelve productos publicados).
    listProducts({ order: '-created_at', limit: NEW_ARRIVALS }).then((r) => r.products),
    listFeaturedProducts(),
    listCategories(),
    listBrands(),
    getContent('portada-perfumes'),
  ])
  // Sección "Perfumes y decants": textos, fotos y combos del panel → Portada.
  const perfumes = perfumesContent?.data ?? null
  const combos = perfumesContent
    ? await listCombos(perfumesContent.configured, perfumesContent.data.combo_product_ids)
    : []
  const brandHandle = new Map(brands.map((b) => [b.title, b.handle]))
  // Sin diapositivas cargadas en el panel, la portada fija de content/landing.ts.
  const slides: HeroSlide[] = banners.length
    ? banners
    : [
        {
          id: 'portada',
          title: landing.hero.title,
          text: landing.hero.text,
          image_url: landing.hero.image,
          image_alt: landing.hero.imageAlt,
          button_label: 'Ver catálogo',
          button_url: '/catalogo',
        },
      ]

  return (
    <>
      {/* Ficha del local para Google (dirección, horarios, mapa, redes). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(storeJsonLd()) }} />

      {/* Portada: banner rotativo (panel → Banner) */}
      <HeroCarousel slides={slides} />

      {/* Datos */}
      <div className="bg-white border-b border-line">
        <ul data-reveal-stagger className="wrap grid grid-cols-2 min-[860px]:grid-cols-4">
          {landing.facts.map((f, i) => (
            <li
              key={f.title}
              className={`py-5 pr-4 ${i % 2 ? 'pl-4 border-l border-line' : ''} ${i >= 2 ? 'border-t border-line min-[860px]:border-t-0' : ''} ${i === 2 ? 'min-[860px]:pl-4 min-[860px]:border-l' : ''}`}
            >
              <strong className="block font-display text-[1.3rem] font-semibold leading-tight">{f.title}</strong>
              <span className="text-muted text-[0.93rem]">{f.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Marcas */}
      <div className="py-10 border-b border-line">
        <div className="wrap">
          <p data-reveal className="text-center text-muted text-[0.9rem] font-semibold tracking-[0.12em] uppercase mb-6">
            {landing.brands.title}
          </p>
        </div>
        <BrandMarquee
          brands={landing.brands.list.map((name) => {
            const handle = brandHandle.get(name)
            return { name, href: handle ? `/catalogo?marca=${handle}` : null }
          })}
        />
      </div>

      {/* Nuevos ingresos */}
      {newArrivals.length > 0 && (
        <section id="nuevos" className="section-y bg-white border-b border-line">
          <div className="wrap">
            <SectionHead title={landing.newArrivals.title} text={landing.newArrivals.text} />
            <ProductGrid products={newArrivals} />
            <p className="mt-8 mb-0 text-center">
              <Link href="/catalogo?orden=nuevos" className="btn btn-outline">
                {landing.newArrivals.link}
              </Link>
            </p>
          </div>
        </section>
      )}

      {/* Destacados */}
      {featured.length > 0 && (
        <section id="destacados" className="section-y">
          <div className="wrap">
            <SectionHead title={landing.featured.title} text={landing.featured.text} />
            <FeaturedProducts products={featured} />
            <p className="text-muted text-[0.9rem] mt-6">{landing.featured.note}</p>
          </div>
        </section>
      )}

      {/* Categorías */}
      {categories.length > 0 && (
        <section id="categorias" className="section-y bg-ink text-white glow-dark">
          <div className="wrap">
            <SectionHead title={landing.categories.title} text={landing.categories.text} dark />
            <div data-reveal-stagger className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map((c) => (
                <div key={c.id} className="dark-card border border-ink-line rounded-[var(--radius-card)] p-6 flex flex-col gap-2.5">
                  <h3 className="text-[1.4rem]">{c.name}</h3>
                  {landing.categories.descriptions[c.name] && (
                    <p className="text-white/70 text-[0.97rem] m-0">{landing.categories.descriptions[c.name]}</p>
                  )}
                  <Link href={`/catalogo?categoria=${c.handle}`} className="btn btn-light mt-auto self-start">
                    Ver {c.name}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Perfumes y decants (panel → Portada) */}
      {perfumes && (
        <section id="perfumes" className="section-y">
          <div className="wrap grid gap-[clamp(2rem,5vw,4rem)] items-start min-[860px]:grid-cols-[1fr_1.25fr]">
            <div data-reveal>
              <h2 className="h2-display">{perfumes.title}</h2>
              {perfumes.text && <p className="text-muted text-[1.08rem] max-w-[58ch] mt-3.5 whitespace-pre-line">{perfumes.text}</p>}
              {perfumes.decant_title && (
                <div className="bg-white border border-line rounded-[var(--radius-card)] px-5 py-5 mt-6 shadow-card">
                  <strong className="block mb-1">{perfumes.decant_title}</strong>
                  {perfumes.decant_text && <p className="m-0 text-muted whitespace-pre-line">{perfumes.decant_text}</p>}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 mt-6">
                {perfumes.photos.map((photo) => (
                  <StoreImage
                    key={photo.url}
                    src={photo.url}
                    alt={photo.alt}
                    width={600}
                    height={600}
                    sizes="(min-width: 860px) 22vw, 45vw"
                    className="rounded-[var(--radius-card)] aspect-square object-cover w-full h-auto shadow-lift"
                  />
                ))}
              </div>
            </div>
            {combos.length > 0 && (
              <div data-reveal>
                {perfumes.combos_title && <h3 className="text-[1.35rem] mb-4">{perfumes.combos_title}</h3>}
                <div data-reveal-stagger className="grid gap-3">
                  {combos.map((combo) => (
                    <div
                      key={combo.id}
                      className="lift-card flex justify-between items-center gap-4 bg-white border border-line rounded-[var(--radius-card)] px-[1.15rem] py-4"
                    >
                      <div>
                        <h4 className="font-sans text-[1.02rem] font-bold mb-0.5">{combo.title}</h4>
                        {combo.description && <p className="m-0 text-muted text-[0.9rem]">{combo.description}</p>}
                      </div>
                      <div className="text-right flex-none">
                        {combo.originalPrice && (
                          <s className="block text-muted text-[0.85rem]">{formatMoney(combo.originalPrice, combo.currency)}</s>
                        )}
                        <strong className="text-[1.1rem]">{combo.price > 0 ? formatMoney(combo.price, combo.currency) : 'Consultar precio'}</strong>
                        <br />
                        <Link href={`/producto/${combo.slug}`} className="text-[0.88rem] font-semibold text-accent no-underline hover:underline">
                          Ver combo
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Más que relojes */}
      <section className="section-y bg-white border-y border-line">
        <div className="wrap">
          <SectionHead title={landing.more.title} text={landing.more.text} />
          <div data-reveal-stagger className="grid gap-4 grid-cols-2 min-[980px]:grid-cols-4">
            {landing.more.items.map((item) => {
              const body = (
                <>
                  {'image' in item && item.image ? (
                    <StoreImage
                      src={item.image}
                      alt={item.alt}
                      width={600}
                      height={450}
                      sizes="(min-width: 980px) 25vw, 50vw"
                      className="aspect-[4/3] object-cover w-full h-auto transition-transform duration-700 ease-out group-hover:scale-[1.05] motion-reduce:group-hover:scale-100"
                    />
                  ) : (
                    <div className="aspect-[4/3] grid place-items-center bg-ink text-white" aria-hidden>
                      {'icon' in item && item.icon === 'thermos' ? <ThermosIcon className="w-16 h-16" /> : <OrganizerIcon className="w-16 h-16" />}
                    </div>
                  )}
                  <div className="px-[1.1rem] pt-4 pb-5">
                    <h3 className="text-[1.2rem] mb-1">{item.title}</h3>
                    <p className="m-0 text-muted text-[0.93rem]">{item.text}</p>
                  </div>
                </>
              )
              const category = categories.find((c) => c.handle === item.category)
              return category ? (
                <Link
                  key={item.title}
                  href={`/catalogo?categoria=${category.handle}`}
                  className="group lift-card rounded-[var(--radius-card)] overflow-hidden bg-paper flex flex-col no-underline"
                >
                  {body}
                </Link>
              ) : (
                <div key={item.title} className="rounded-[var(--radius-card)] overflow-hidden bg-paper flex flex-col shadow-card">
                  {body}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Cómo comprar */}
      <section id="comprar" className="section-y">
        <div className="wrap">
          <SectionHead title={landing.howToBuy.title} text={landing.howToBuy.text} />
          <div data-reveal-stagger className="grid gap-4 min-[900px]:grid-cols-3">
            {landing.howToBuy.steps.map((step, i) => {
              const external = step.cta.href === 'whatsapp'
              const href = external ? whatsappUrl() : step.cta.href
              const cls = `btn ${step.cta.style === 'dark' ? 'btn-dark' : 'btn-outline'} mt-auto self-start`
              return (
                <div key={step.title} className="lift-card bg-white border border-line rounded-[var(--radius-card)] p-[1.6rem] flex flex-col gap-3">
                  <span className="w-10 h-10 rounded-full bg-ink text-white grid place-items-center font-bold shadow-[0_6px_14px_-4px_rgb(0_0_0/0.45)]">{i + 1}</span>
                  <h3 className="text-[1.35rem]">{step.title}</h3>
                  <ul className="m-0 pl-[1.1rem] list-disc text-muted text-[0.96rem] space-y-1.5">
                    {step.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                  {external ? (
                    <a href={href} className={cls} target="_blank" rel="noopener">
                      {step.cta.label}
                    </a>
                  ) : (
                    <Link href={href} className={cls}>
                      {step.cta.label}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
          <div data-reveal className="grid gap-6 items-center mt-5 bg-white border border-line rounded-[var(--radius-card)] p-4 sm:grid-cols-[auto_1fr] shadow-card">
            <StoreImage
              src={landing.howToBuy.gift.image}
              alt={landing.howToBuy.gift.alt}
              width={629}
              height={800}
              sizes="(min-width: 640px) 150px, 100vw"
              className="w-full aspect-[16/10] sm:w-[150px] sm:aspect-square object-cover rounded-[10px]"
            />
            <div>
              <h3 className="text-[1.35rem] mb-1.5">{landing.howToBuy.gift.title}</h3>
              <p className="m-0 text-muted">{landing.howToBuy.gift.text}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Reseñas */}
      <section id="resenas" className="section-y bg-ink text-white glow-dark">
        <div className="wrap">
          <div data-reveal className="flex flex-wrap items-end justify-between gap-6 mb-10">
            <div className="flex items-baseline gap-4">
              <strong className="font-display text-[clamp(4rem,10vw,6rem)] leading-[0.9]">{brand.reviews.score}</strong>
              <div>
                <span className="text-star tracking-[0.15em]" aria-hidden>
                  ★★★★★
                </span>
                <small className="block text-white/70 text-[0.95rem]">
                  {brand.reviews.count} reseñas en {brand.reviews.source}
                </small>
              </div>
            </div>
            <a className="text-white font-semibold" href={brand.reviews.url} target="_blank" rel="noopener">
              Ver todas las reseñas
            </a>
          </div>
          <div data-reveal-stagger className="grid gap-4 min-[900px]:grid-cols-3">
            {landing.reviews.map((r) => (
              <blockquote key={r.author} className="m-0 dark-card border border-ink-line rounded-[var(--radius-card)] p-6 flex flex-col gap-4">
                <p className="m-0 text-[1.02rem] leading-[1.55]">“{r.text}”</p>
                <cite className="not-italic text-white/65 text-[0.92rem] mt-auto">{r.author}</cite>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* Ubicación */}
      <section id="ubicacion" className="section-y">
        <div className="wrap">
          <SectionHead title={landing.location.title} text={landing.location.text} />
          <div data-reveal-stagger className="grid gap-4 min-[860px]:grid-cols-[1.4fr_1fr]">
            <div className="rounded-[var(--radius-card)] overflow-hidden border border-line min-h-[320px] min-[860px]:min-h-[420px] bg-[#e8e6e1] shadow-lift">
              <iframe
                title={`Mapa de ${brand.name}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={brand.location.mapEmbedUrl}
                className="w-full h-full min-h-[320px] min-[860px]:min-h-[420px] border-0 block"
              />
            </div>
            <div className="bg-white border border-line rounded-[var(--radius-card)] p-[1.6rem] flex flex-col gap-[1.1rem] shadow-lift">
              <dl className="m-0 grid gap-4">
                <div>
                  <dt className="field-label !mb-0">Dirección</dt>
                  <dd className="mt-1 ml-0">{brand.location.address}</dd>
                </div>
                <div>
                  <dt className="field-label !mb-0">Horario</dt>
                  <dd className="mt-1 ml-0">
                    {brand.location.hours.map((h) => (
                      <span key={h} className="block">
                        {h}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="field-label !mb-0">WhatsApp y llamadas</dt>
                  <dd className="mt-1 ml-0">
                    <a href={whatsappUrl()} target="_blank" rel="noopener" className="font-semibold no-underline">
                      {brand.whatsapp.display}
                    </a>
                  </dd>
                </div>
              </dl>
              <div className="grid grid-cols-[90px_1fr] gap-4 items-center bg-paper rounded-[10px] p-3">
                <StoreImage src={brand.location.doorPhoto} alt="" width={90} height={110} className="w-[90px] h-[110px] object-cover rounded-lg" />
                <p className="m-0 text-[0.93rem] text-muted">{brand.location.doorHint}</p>
              </div>
              <a className="btn btn-dark" href={brand.location.mapsUrl} target="_blank" rel="noopener">
                Cómo llegar
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
