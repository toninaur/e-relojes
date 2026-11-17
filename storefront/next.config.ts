import type { NextConfig } from 'next'

// Optimización de imágenes (next/image): las fotos de productos que sirve el
// backend (`<backend>/static/...`) y las imágenes propias de la tienda
// (public/images y public/brand) se achican y se pasan a WebP/AVIF según la
// pantalla. Cualquier otra URL (por ejemplo una foto externa cargada en el
// banner) se muestra tal cual: ver lib/images.ts.
const backend = new URL(process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? 'http://localhost:9000')
const backendIsLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(backend.hostname)

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: backend.protocol === 'https:' ? 'https' : 'http',
        hostname: backend.hostname,
        port: backend.port,
        pathname: '/static/**',
      },
    ],
    localPatterns: [
      { pathname: '/images/**', search: '' },
      { pathname: '/brand/**', search: '' },
    ],
    // Obligatorio desde Next 16: las calidades permitidas.
    qualities: [75],
    formats: ['image/avif', 'image/webp'],
    // Medusa guarda cada foto subida con un nombre nuevo, así que una foto
    // optimizada no cambia: se puede cachear un mes.
    minimumCacheTTL: 2_678_400,
    // Next 16 no optimiza imágenes de IPs locales (protección SSRF). Solo se
    // permite cuando el backend es localhost, o sea en desarrollo.
    dangerouslyAllowLocalIP: backendIsLocal,
  },
}

export default nextConfig
