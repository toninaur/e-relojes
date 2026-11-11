import Link from 'next/link'

export default function NotFound() {
  return (
    <section className="section-y">
      <div className="wrap text-center">
        <h1 className="text-[clamp(2rem,5vw,3rem)] mb-4">No encontramos esta página</h1>
        <p className="text-muted mb-8">Puede que el producto ya no esté disponible.</p>
        <Link href="/catalogo" className="btn btn-dark">
          Ver el catálogo
        </Link>
      </div>
    </section>
  )
}
