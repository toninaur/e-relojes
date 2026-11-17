'use client'

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import StoreImage from '@/components/StoreImage'

// Fotos del producto. Se muestran enteras (object-contain), sin recortar el
// reloj. En el celular se pasan deslizando con el dedo; en la computadora, con
// las miniaturas o las flechas.
export default function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0)
  // Deslizar con el dedo: solo si el gesto es más horizontal que vertical (si
  // no, la persona estaba bajando por la página).
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const count = images.length

  if (count === 0) {
    return (
      <div className="aspect-square rounded-[var(--radius-card)] bg-ink grid place-items-center">
        <span className="text-white font-display text-xl px-6 text-center">{alt}</span>
      </div>
    )
  }

  const go = (next: number) => setActive(((next % count) + count) % count)

  return (
    <div className="flex flex-col-reverse md:flex-row gap-3">
      {count > 1 && (
        <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto md:max-h-[560px]">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Ver foto ${i + 1}`}
              aria-current={active === i}
              className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 bg-white ${
                active === i ? 'border-ink' : 'border-line hover:border-muted'
              }`}
            >
              <StoreImage src={src} alt="" width={64} height={64} className="w-full h-full object-contain" />
            </button>
          ))}
        </div>
      )}
      <div
        className="group relative flex-1 aspect-square rounded-[var(--radius-card)] overflow-hidden bg-white border border-line shadow-lift"
        onTouchStart={(e) => (touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const start = touchStart.current
          touchStart.current = null
          if (!start || count < 2) return
          const dx = e.changedTouches[0].clientX - start.x
          const dy = e.changedTouches[0].clientY - start.y
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(active + (dx < 0 ? 1 : -1))
        }}
        onTouchCancel={() => (touchStart.current = null)}
      >
        <StoreImage
          src={images[active]}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 620px, 100vw"
          loading="eager"
          fetchPriority="high"
          className="object-contain p-4 sm:p-6"
        />
        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(active - 1)}
              aria-label="Foto anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 grid place-items-center w-10 h-10 rounded-full bg-white/90 border border-line shadow-sm md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => go(active + 1)}
              aria-label="Foto siguiente"
              className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-10 h-10 rounded-full bg-white/90 border border-line shadow-sm md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <span className="md:hidden absolute bottom-2 left-1/2 -translate-x-1/2 bg-ink/70 text-white text-[0.8rem] font-semibold rounded-full px-2.5 py-0.5">
              {active + 1} / {count}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
