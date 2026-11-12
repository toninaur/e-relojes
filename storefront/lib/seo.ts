import { absoluteUrl, brand } from './brand'
import type { UiProduct } from './medusa/products'

// Datos estructurados (schema.org) para Google: el local y cada producto. Con
// esto Google puede mostrar precio, stock y la ficha del negocio en los
// resultados.

/** Para <script type="application/ld+json">: escapa "<" para no cerrar el script. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function storeJsonLd() {
  const { location } = brand
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': absoluteUrl('/#tienda'),
    name: brand.legalName,
    description: brand.description,
    url: absoluteUrl('/'),
    logo: absoluteUrl(brand.logo),
    image: absoluteUrl(brand.logo),
    telephone: `+${brand.whatsapp.number}`,
    priceRange: '₲₲',
    currenciesAccepted: 'PYG',
    paymentAccepted: 'Efectivo, transferencia bancaria',
    address: {
      '@type': 'PostalAddress',
      streetAddress: location.address.split(',')[0],
      addressLocality: location.city,
      addressCountry: 'PY',
    },
    geo: { '@type': 'GeoCoordinates', latitude: location.geo.lat, longitude: location.geo.lng },
    hasMap: location.mapsUrl,
    openingHoursSpecification: location.openingHours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
    sameAs: brand.social.map((s) => s.url),
  }
}

export function productJsonLd(product: UiProduct) {
  const url = absoluteUrl(`/producto/${product.slug}`)
  const inStock = product.variants.some((v) => v.stock > 0)
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? (product.specs.join(' · ') || undefined),
    image: product.images,
    sku: product.ref ?? undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    category: product.categories[0]?.name,
    url,
    offers: {
      '@type': 'Offer',
      url,
      price: product.price,
      priceCurrency: product.currency.toUpperCase(),
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': absoluteUrl('/#tienda') },
    },
  }
}
