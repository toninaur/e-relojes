import Image, { type ImageProps } from 'next/image'
import { canOptimize } from '@/lib/images'

// next/image para toda la tienda: optimiza las fotos del backend y las de
// public/; cualquier otra URL (cargada a mano en el panel) va sin optimizar en
// vez de romperse.
export default function StoreImage({ src, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  return <Image src={src} unoptimized={!canOptimize(src)} {...props} />
}
