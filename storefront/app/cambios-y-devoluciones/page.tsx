import LegalPage, { legalMetadata } from '@/components/legal/LegalPage'

// Texto editable en el panel → Páginas.
export const generateMetadata = () => legalMetadata('pagina-cambios-y-devoluciones', '/cambios-y-devoluciones')

export default function Page() {
  return <LegalPage contentKey="pagina-cambios-y-devoluciones" />
}
