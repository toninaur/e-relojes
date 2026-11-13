import LegalPage, { legalMetadata } from '@/components/legal/LegalPage'

// Texto editable en el panel → Páginas.
export const generateMetadata = () => legalMetadata('pagina-terminos', '/terminos')

export default function Page() {
  return <LegalPage contentKey="pagina-terminos" />
}
