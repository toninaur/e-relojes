import Link from 'next/link'
import type { UiProduct } from '@/lib/medusa/products'
import { brand, whatsappUrl } from '@/lib/brand'
import AddToCartButton from './AddToCartButton'
import Price from './Price'
import StockBadge, { stockOf } from './StockBadge'
import { WhatsAppIcon } from './icons'

export default function ProductCard({ product }: { product: UiProduct }) {
  const href = `/producto/${product.slug}`
  const image = product.images[0]
  const name = product.name
  const stock = stockOf(product.variants)
  const waMessage = `${brand.whatsapp.greeting} Me interesa el ${name}${product.ref ? ` (ref. ${product.ref})` : ''} que vi en la web. ¿Está disponible?`

  return (
    <article className="group bg-white border border-line rounded-[var(--radius-card)] overflow-hidden flex flex-col transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_14px_32px_rgb(0_0_0/0.08)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <Link href={href} className="relative block aspect-square bg-white border-b border-line overflow-hidden">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
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
          <StockBadge units={stock.units} className="text-[0.78rem] sm:text-[0.85rem] mt-1" />
        </div>
        <div className="flex gap-2 mt-2 sm:mt-3">
          <AddToCartButton product={product} className="flex-1 min-w-0 !px-2 sm:!px-[1.4rem] max-sm:!py-[0.7rem] max-sm:!text-[0.9rem]" />
          <a
            href={whatsappUrl(waMessage)}
            target="_blank"
            rel="noopener"
            aria-label={`Consultar por WhatsApp: ${name}`}
            title="Consultar por WhatsApp"
            className="shrink-0 grid place-items-center w-[2.6rem] sm:w-12 rounded-full border-[1.5px] border-whatsapp text-[#128c4b] hover:bg-whatsapp hover:text-white transition-colors"
          >
            <WhatsAppIcon className="w-5 h-5" />
          </a>
        </div>
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
