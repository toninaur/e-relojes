// Qué imágenes puede optimizar next/image. Tiene que coincidir con
// `images.remotePatterns` y `images.localPatterns` de next.config.ts: una URL
// que no esté permitida ahí daría error 400, así que se muestra sin optimizar.

const BACKEND = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ?? 'http://localhost:9000')
  } catch {
    return null
  }
})()

const LOCAL_PREFIXES = ['/images/', '/brand/']

export function canOptimize(src: string): boolean {
  if (src.startsWith('/') && !src.startsWith('//')) {
    return !src.includes('?') && LOCAL_PREFIXES.some((prefix) => src.startsWith(prefix))
  }
  if (!BACKEND) return false
  try {
    const url = new URL(src)
    return url.origin === BACKEND.origin && url.pathname.startsWith('/static/') && !url.search && !url.pathname.endsWith('.svg')
  } catch {
    return false
  }
}
