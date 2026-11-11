import Link from 'next/link'
import type { UiProduct } from '@/lib/medusa/products'
import AddToCartButton from './AddToCartButton'
import Price from './Price'

export default function ProductCard({ product }: { product: UiProduct }) {
  const href = `/producto/${product.slug}`
  const image = product.images[0]
  const name = product.name

  return (
    <article className="bg-white border border-line rounded-[var(--radius-card)] overflow-hidden flex flex-col">
      <Link href={href} className="relative block aspect-square bg-white border-b border-line overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 hover:scale-[1.03]"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center bg-ink text-white font-display px-4 text-center">
            {name}
          </span>
        )}
        {product.originalPrice && (
          <span className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-accent text-white text-[0.72rem] sm:text-[0.8rem] font-bold px-2.5 py-1 rounded-full">
            Oferta
          </span>
        )}
      </Link>

      <div className="p-3 sm:px-[1.15rem] sm:pt-[1.1rem] sm:pb-5 flex flex-col gap-1.5 sm:gap-2 flex-1">
        {product.brand && (
          <span className="text-[0.75rem] sm:text-[0.82rem] font-bold tracking-[0.08em] uppercase text-muted">
            {product.brand}
          </span>
        )}
        <h3 className="text-[1.05rem] sm:text-[1.25rem]">
          <Link href={href} className="no-underline hover:underline">
            {product.model}
          </Link>
        </h3>
        {product.ref && <span className="hidden sm:block text-[0.85rem] text-muted">Ref. {product.ref}</span>}
        {product.specs.length > 0 && (
          <ul className="hidden sm:flex flex-wrap gap-1.5 mt-0.5 mb-1.5">
            {product.specs.map((spec) => (
              <li key={spec} className="text-[0.82rem] bg-paper rounded-full px-2.5 py-1">
                {spec}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-auto">
          <Price amount={product.price} original={product.originalPrice} currency={product.currency} />
        </div>
        <AddToCartButton product={product} className="w-full mt-2 sm:mt-3 !px-2 sm:!px-[1.4rem] max-sm:!py-[0.7rem] max-sm:!text-[0.9rem]" />
      </div>
    </article>
  )
}

export function ProductGrid({ products }: { products: UiProduct[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:gap-5">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  )
}
