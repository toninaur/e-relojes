import Link from 'next/link'

// Cinta de marcas que se desliza sola (portada → "Algunas de las marcas que
// trabajamos"). Por ahora son los nombres en la tipografía de la página; si el
// local consigue los logos con permiso de uso, se cambia el contenido de cada
// ítem por la imagen.
//
// La lista va dos veces seguidas y la animación corre la mitad del total, así
// el bucle no tiene salto. La segunda copia es solo visual: se oculta a los
// lectores de pantalla y no se puede enfocar con el teclado. Se frena con el
// mouse o el foco; con "reducir movimiento" va más lenta (estilos en
// app/globals.css, `.marquee`).

export interface MarqueeBrand {
  name: string
  href: string | null
}

// Velocidad pareja aunque cambie la cantidad de marcas.
const SECONDS_PER_BRAND = 3.5

export default function BrandMarquee({ brands }: { brands: MarqueeBrand[] }) {
  const duration = `${Math.max(20, brands.length * SECONDS_PER_BRAND)}s`
  return (
    <div className="marquee overflow-hidden" style={{ ['--marquee-duration' as string]: duration }}>
      <div className="marquee-track">
        <BrandList brands={brands} />
        <BrandList brands={brands} copy />
      </div>
    </div>
  )
}

function BrandList({ brands, copy = false }: { brands: MarqueeBrand[]; copy?: boolean }) {
  const cls =
    'font-display font-semibold text-[clamp(1.35rem,2.6vw,1.9rem)] text-[#2b2b2b] no-underline whitespace-nowrap transition-colors duration-300'
  return (
    <ul className="flex items-center shrink-0 m-0 p-0 list-none" aria-hidden={copy || undefined}>
      {brands.map((b) => (
        <li key={b.name} className="flex items-center px-[clamp(1.25rem,3vw,2.25rem)]">
          {b.href ? (
            <Link href={b.href} tabIndex={copy ? -1 : undefined} className={`${cls} hover:text-accent`}>
              {b.name}
            </Link>
          ) : (
            <span className={cls}>{b.name}</span>
          )}
          <span aria-hidden className="ml-[clamp(1.25rem,3vw,2.25rem)] text-[0.7rem] text-[#c9c4ba]">
            ◆
          </span>
        </li>
      ))}
    </ul>
  )
}
