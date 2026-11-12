import Link from 'next/link'
import { brand, whatsappUrl } from '@/lib/brand'

export default function SiteFooter() {
  return (
    <footer className="bg-ink text-white/75 pt-12 pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="wrap flex flex-wrap justify-between items-start gap-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logo} alt={brand.name} width={78} height={56} loading="lazy" className="h-14 w-auto" />
        <nav className="flex flex-wrap gap-x-7 gap-y-5" aria-label="Pie">
          <Link href="/catalogo" className="text-white font-medium no-underline hover:underline">
            Catálogo
          </Link>
          <a href={brand.catalogsUrl} target="_blank" rel="noopener" className="text-white font-medium no-underline hover:underline">
            Catálogos PDF
          </a>
          {brand.social.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener" className="text-white font-medium no-underline hover:underline">
              {s.label}
            </a>
          ))}
          <a href={whatsappUrl()} target="_blank" rel="noopener" className="text-white font-medium no-underline hover:underline">
            WhatsApp
          </a>
        </nav>
        <small className="block w-full text-[0.85rem] text-white/55 border-t border-[#262626] pt-6">
          © {new Date().getFullYear()} {brand.legalName}. Los precios están sujetos a variaciones y el stock de cada
          modelo es limitado.
        </small>
      </div>
    </footer>
  )
}
