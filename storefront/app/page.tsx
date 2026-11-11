import Link from 'next/link'
import { landing } from '@/content/landing'
import { brand, whatsappUrl } from '@/lib/brand'
import { formatMoney } from '@/lib/format'
import { listBrands, listCategories, listFeaturedProducts, listProductsInCategory } from '@/lib/medusa/catalog'
import FeaturedProducts from '@/components/FeaturedProducts'
import { OrganizerIcon, ThermosIcon, WhatsAppIcon } from '@/components/icons'

function SectionHead({ title, text, dark = false }: { title: string; text?: string; dark?: boolean }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-x-12 gap-y-5 mb-[clamp(2rem,5vw,3.25rem)]">
      <h2 className="h2-display">{title}</h2>
      {text && <p className={`max-w-[58ch] text-[1.08rem] m-0 ${dark ? 'text-white/70' : 'text-muted'}`}>{text}</p>}
    </div>
  )
}

export default async function HomePage() {
  const [featured, categories, brands, combos] = await Promise.all([
    listFeaturedProducts(),
    listCategories(),
    listBrands(),
    listProductsInCategory(landing.perfumes.category),
  ])
  const brandHandle = new Map(brands.map((b) => [b.title, b.handle]))
  const accessories = categories.find((c) => c.name === 'Accesorios')

  return (
    <>
      {/* Portada */}
      <section className="bg-ink text-white overflow-hidden pt-[clamp(3rem,7vw,5.5rem)] pb-[clamp(3.5rem,8vw,6rem)]">
        <div className="wrap grid gap-[clamp(2rem,5vw,4rem)] items-center min-[820px]:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="text-[clamp(2.5rem,6vw,4.6rem)] mb-5">{landing.hero.title}</h1>
            <p className="text-white/80 text-[clamp(1.05rem,1.6vw,1.2rem)] max-w-[46ch] mb-8">{landing.hero.text}</p>
            <div className="flex flex-wrap gap-3">
              <Link href="/catalogo" className="btn btn-light">
                Ver catálogo
              </Link>
              <a href={whatsappUrl()} className="btn btn-outline-light" target="_blank" rel="noopener">
                <WhatsAppIcon />
                Escribinos por WhatsApp
              </a>
            </div>
          </div>
          <div className="relative justify-self-center w-[min(320px,82%)] min-[820px]:w-[min(440px,100%)] aspect-square rounded-full bg-white grid place-items-center shadow-[0_0_0_10px_#1b1b1b,0_0_0_11px_#333] mt-4 min-[820px]:mt-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={landing.hero.image} alt={landing.hero.imageAlt} className="w-[72%] h-[72%] object-contain" fetchPriority="high" />
            <a
              href={brand.reviews.url}
              target="_blank"
              rel="noopener"
              className="absolute right-[2%] bottom-[6%] bg-ink text-white border border-[#333] rounded-full px-4 py-2 font-semibold text-[0.92rem] flex gap-1.5 items-center no-underline"
            >
              <span className="text-star">★</span> {brand.reviews.score} en {brand.reviews.source}
            </a>
          </div>
        </div>
      </section>

      {/* Datos */}
      <div className="bg-white border-b border-line">
        <ul className="wrap grid grid-cols-2 min-[860px]:grid-cols-4">
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
          <p className="text-center text-muted text-[0.9rem] font-semibold tracking-[0.12em] uppercase mb-5">
            {landing.brands.title}
          </p>
          <ul className="flex flex-wrap justify-center gap-x-9 gap-y-2.5">
            {landing.brands.list.map((name) => {
              const handle = brandHandle.get(name)
              const cls = 'font-display font-semibold text-[clamp(1.15rem,2.2vw,1.55rem)] text-[#2b2b2b] no-underline'
              return (
                <li key={name}>
                  {handle ? (
                    <Link href={`/catalogo?marca=${handle}`} className={`${cls} hover:underline`}>
                      {name}
                    </Link>
                  ) : (
                    <span className={cls}>{name}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>

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
        <section id="categorias" className="section-y bg-ink text-white">
          <div className="wrap">
            <SectionHead title={landing.categories.title} text={landing.categories.text} dark />
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 min-[980px]:grid-cols-4">
              {categories.map((c) => (
                <div key={c.id} className="bg-ink-2 border border-ink-line rounded-[var(--radius-card)] p-6 flex flex-col gap-2.5">
                  <h3 className="text-[1.4rem]">{c.name}</h3>
                  {landing.categories.descriptions[c.name] && (
                    <p className="text-white/70 text-[0.97rem] m-0">{landing.categories.descriptions[c.name]}</p>
                  )}
                  <Link href={`/catalogo?categoria=${c.handle}`} className="btn btn-light mt-auto self-start">
                    Ver {c.name.toLowerCase()}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Perfumes */}
      <section id="perfumes" className="section-y">
        <div className="wrap grid gap-[clamp(2rem,5vw,4rem)] items-start min-[860px]:grid-cols-[1fr_1.25fr]">
          <div>
            <h2 className="h2-display">{landing.perfumes.title}</h2>
            <p className="text-muted text-[1.08rem] max-w-[58ch] mt-3.5">{landing.perfumes.text}</p>
            <div className="bg-white border border-line rounded-[var(--radius-card)] px-5 py-5 my-6">
              <strong className="block mb-1">{landing.perfumes.decantTitle}</strong>
              <p className="m-0 text-muted">{landing.perfumes.decantText}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {landing.perfumes.photos.map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.src} src={photo.src} alt={photo.alt} loading="lazy" className="rounded-[var(--radius-card)] aspect-square object-cover w-full" />
              ))}
            </div>
          </div>
          {combos.length > 0 && (
            <div>
              <h3 className="text-[1.35rem] mb-4">{landing.perfumes.combosTitle}</h3>
              <div className="grid gap-3">
                {combos.map((combo) => (
                  <div
                    key={combo.id}
                    className="flex justify-between items-center gap-4 bg-white border border-line rounded-[var(--radius-card)] px-[1.15rem] py-4"
                  >
                    <div>
                      <h4 className="font-sans text-[1.02rem] font-bold mb-0.5">{combo.title}</h4>
                      {combo.description && <p className="m-0 text-muted text-[0.9rem]">{combo.description}</p>}
                    </div>
                    <div className="text-right flex-none">
                      {combo.originalPrice && (
                        <s className="block text-muted text-[0.85rem]">{formatMoney(combo.originalPrice, combo.currency)}</s>
                      )}
                      <strong className="text-[1.1rem]">{formatMoney(combo.price, combo.currency)}</strong>
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

      {/* Más que relojes */}
      <section className="section-y bg-white border-y border-line">
        <div className="wrap">
          <SectionHead title={landing.more.title} text={landing.more.text} />
          <div className="grid gap-4 grid-cols-2 min-[980px]:grid-cols-4">
            {landing.more.items.map((item) => {
              const body = (
                <>
                  {'image' in item && item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt={item.alt} loading="lazy" className="aspect-[4/3] object-cover w-full" />
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
              return accessories ? (
                <Link
                  key={item.title}
                  href={`/catalogo?categoria=${accessories.handle}`}
                  className="rounded-[var(--radius-card)] overflow-hidden bg-paper flex flex-col no-underline hover:shadow-md transition-shadow"
                >
                  {body}
                </Link>
              ) : (
                <div key={item.title} className="rounded-[var(--radius-card)] overflow-hidden bg-paper flex flex-col">
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
          <div className="grid gap-4 min-[900px]:grid-cols-3">
            {landing.howToBuy.steps.map((step, i) => {
              const external = step.cta.href === 'whatsapp'
              const href = external ? whatsappUrl() : step.cta.href
              const cls = `btn ${step.cta.style === 'dark' ? 'btn-dark' : 'btn-outline'} mt-auto self-start`
              return (
                <div key={step.title} className="bg-white border border-line rounded-[var(--radius-card)] p-[1.6rem] flex flex-col gap-3">
                  <span className="w-10 h-10 rounded-full bg-ink text-white grid place-items-center font-bold">{i + 1}</span>
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
          <div className="grid gap-6 items-center mt-5 bg-white border border-line rounded-[var(--radius-card)] p-4 sm:grid-cols-[auto_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={landing.howToBuy.gift.image}
              alt={landing.howToBuy.gift.alt}
              loading="lazy"
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
      <section id="resenas" className="section-y bg-ink text-white">
        <div className="wrap">
          <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
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
          <div className="grid gap-4 min-[900px]:grid-cols-3">
            {landing.reviews.map((r) => (
              <blockquote key={r.author} className="m-0 bg-ink-2 border border-ink-line rounded-[var(--radius-card)] p-6 flex flex-col gap-4">
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
          <div className="grid gap-4 min-[860px]:grid-cols-[1.4fr_1fr]">
            <div className="rounded-[var(--radius-card)] overflow-hidden border border-line min-h-[320px] min-[860px]:min-h-[420px] bg-[#e8e6e1]">
              <iframe
                title={`Mapa de ${brand.name}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                src={brand.location.mapEmbedUrl}
                className="w-full h-full min-h-[320px] min-[860px]:min-h-[420px] border-0 block"
              />
            </div>
            <div className="bg-white border border-line rounded-[var(--radius-card)] p-[1.6rem] flex flex-col gap-[1.1rem]">
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.location.doorPhoto} alt="" loading="lazy" className="w-[90px] h-[110px] object-cover rounded-lg" />
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
