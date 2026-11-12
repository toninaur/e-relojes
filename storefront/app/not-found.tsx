import Link from 'next/link'
import SiteLayout from './(site)/layout'

// Está fuera del grupo (site), así que lleva el encabezado y el pie a mano.
export default function NotFound() {
  return (
    <SiteLayout>
      <section className="section-y">
        <div className="wrap text-center">
          <h1 className="text-[clamp(2rem,5vw,3rem)] mb-4">No encontramos esta página</h1>
          <p className="text-muted mb-8">Puede que el producto ya no esté disponible.</p>
          <Link href="/catalogo" className="btn btn-dark">
            Ver el catálogo
          </Link>
        </div>
      </section>
    </SiteLayout>
  )
}
