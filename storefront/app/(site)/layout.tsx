import SiteHeader from '@/components/SiteHeader'
import SiteFooter from '@/components/SiteFooter'
import WhatsAppFloat from '@/components/WhatsAppFloat'

// Encabezado, pie y botón de WhatsApp de todas las páginas de la tienda. La
// página de links (/links) queda afuera: es la que se pone en Instagram y TikTok.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <WhatsAppFloat />
    </>
  )
}
