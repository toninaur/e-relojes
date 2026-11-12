import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, LayoutGrid, MapPin, ShoppingBag } from 'lucide-react'
import { brand, whatsappUrl } from '@/lib/brand'
import { InstagramIcon, TikTokIcon, WhatsAppIcon } from '@/components/icons'

// Página de links para la bio de Instagram y TikTok: un solo link que reúne la
// tienda, WhatsApp, los catálogos y el local. Va sin el encabezado ni el pie
// del sitio (está fuera del grupo (site)).

export const metadata: Metadata = {
  title: 'Links',
  description: `Tienda online, WhatsApp, catálogos y ubicación de ${brand.legalName}.`,
}

const SOCIAL_ICONS: Record<string, typeof InstagramIcon> = { Instagram: InstagramIcon, TikTok: TikTokIcon }

export default function LinksPage() {
  const links = [
    { label: 'Comprar en la tienda online', href: '/', icon: ShoppingBag, primary: true, internal: true },
    { label: 'Ver todos los productos', href: '/catalogo', icon: LayoutGrid, internal: true },
    { label: 'Escribinos por WhatsApp', href: whatsappUrl(), icon: WhatsAppIcon },
    { label: 'Catálogos en PDF', href: brand.catalogsUrl, icon: BookOpen },
    { label: 'Cómo llegar al local', href: brand.location.mapsUrl, icon: MapPin },
  ]

  return (
    <main className="flex-1 bg-ink text-white px-4 pt-[clamp(2.5rem,8vw,4rem)] pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-[440px] flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo} alt={brand.name} width={112} height={80} className="h-20 w-auto mb-5" />
        <h1 className="text-[1.75rem] mb-2">{brand.legalName}</h1>
        <p className="text-white/70 mb-2 max-w-[36ch]">Relojes, perfumes y accesorios. Envíos a todo el país.</p>
        <p className="text-white/55 text-[0.9rem] mb-8">
          <span className="text-star">★</span> {brand.reviews.score} en {brand.reviews.source} · Barrio Mburicao, Asunción
        </p>

        <ul className="w-full flex flex-col gap-3 mb-9">
          {links.map(({ label, href, icon: Icon, primary, internal }) => {
            const cls = `btn w-full justify-start gap-3 py-4 text-[1rem] ${primary ? 'btn-light' : 'btn-outline-light'}`
            const content = (
              <>
                <Icon className="w-5 h-5 shrink-0" />
                <span className="flex-1 text-center pr-5">{label}</span>
              </>
            )
            return (
              <li key={label}>
                {internal ? (
                  <Link href={href} className={cls}>
                    {content}
                  </Link>
                ) : (
                  <a href={href} target="_blank" rel="noopener" className={cls}>
                    {content}
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        <ul className="flex gap-4 mb-8">
          {brand.social.map((s) => {
            const Icon = SOCIAL_ICONS[s.label]
            return (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener"
                  aria-label={`${s.label}: ${s.handle}`}
                  className="grid place-items-center w-12 h-12 rounded-full border border-white/30 text-white hover:border-white hover:bg-white/10 transition-colors"
                >
                  {Icon ? <Icon className="w-5 h-5" /> : s.label}
                </a>
              </li>
            )
          })}
        </ul>

        <address className="not-italic text-white/55 text-[0.85rem] leading-relaxed">
          {brand.location.address}
          <br />
          {brand.location.hours.join(' · ')}
        </address>
      </div>
    </main>
  )
}
