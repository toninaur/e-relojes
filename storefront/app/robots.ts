import type { MetadataRoute } from 'next'
import { absoluteUrl, brand } from '@/lib/brand'

// /robots.txt. En modo demo, nada se indexa (además del noindex de las páginas).
export default function robots(): MetadataRoute.Robots {
  if (brand.demo) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/carrito', '/api/'] },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
