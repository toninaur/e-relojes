import type { Metadata, Viewport } from 'next'
import { Figtree, Fraunces } from 'next/font/google'
import { brand } from '@/lib/brand'
import { CartProvider } from '@/lib/CartContext'
import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import WhatsAppFloat from '@/components/WhatsAppFloat'
import MotionEffects from '@/components/MotionEffects'
import './globals.css'

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' })
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL(brand.siteUrl),
  title: { default: `${brand.legalName} | Relojes, perfumes y accesorios en Asunción`, template: `%s | ${brand.name}` },
  description: brand.description,
  openGraph: { type: 'website', siteName: brand.legalName, locale: 'es_PY', images: ['/images/seiko-gmt.jpg'] },
  twitter: { card: 'summary_large_image' },
  // iPhone: que Safari no convierta en links de llamada los números de la
  // página (referencias, RUC, precios). El teléfono de contacto ya es un link
  // a WhatsApp.
  formatDetection: { telephone: false, address: false, email: false },
  // Nombre corto al agregar la tienda a la pantalla de inicio del iPhone (el
  // ícono es app/apple-icon.png).
  appleWebApp: { title: brand.name },
  ...(brand.demo ? { robots: { index: false, follow: false } } : {}),
}

export const viewport: Viewport = {
  themeColor: '#0d0d0d',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${fraunces.variable} ${figtree.variable}`}>
      {/* Columna de alto completo: con poco contenido (carrito vacío, 404) el
          pie queda abajo de la pantalla en vez de subir. */}
      <body className="min-h-dvh flex flex-col">
        {brand.demo && (
          <div className="bg-star text-ink text-center text-xs sm:text-sm font-medium px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            Sitio de demostración: los productos, precios y pedidos no son reales.
          </div>
        )}
        <CartProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <WhatsAppFloat />
        </CartProvider>
        <MotionEffects />
      </body>
    </html>
  )
}
