'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { brand, whatsappUrl } from '@/lib/brand'
import { WhatsAppIcon } from './icons'

// Portada con banner rotativo. Las diapositivas se cargan en el panel
// (Banner); cada una tiene título, texto, foto del producto y un botón.
// Todas ocupan la misma celda de la grilla, así la altura no salta al rotar.

export interface HeroSlide {
  id: string
  title: string
  text: string | null
  image_url: string
  image_alt: string | null
  image_fit?: 'contain' | 'cover'
  button_label: string | null
  button_url: string | null
}

const INTERVAL_MS = 6000

export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const touchX = useRef<number | null>(null)
  const count = slides.length

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const onChange = () => setReducedMotion(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (count < 2 || paused || reducedMotion) return
    const timer = setTimeout(() => go(index + 1), INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [index, count, paused, reducedMotion, go])

  return (
    <section
      className="bg-ink text-white overflow-hidden pt-[clamp(3rem,7vw,5.5rem)] pb-[clamp(3.5rem,8vw,6rem)]"
      aria-roledescription="carrusel"
      aria-label="Novedades y promociones"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1))
      }}
    >
      <div className="wrap grid">
        {slides.map((slide, i) => {
          const active = i === index
          const Title = i === 0 ? 'h1' : 'h2'
          return (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${i + 1} de ${count}`}
              aria-hidden={!active}
              inert={!active}
              className={`[grid-area:1/1] grid gap-[clamp(2rem,5vw,4rem)] items-center min-[820px]:grid-cols-[1.15fr_1fr]
                transition-opacity duration-700 motion-reduce:transition-none ${active ? 'opacity-100' : 'opacity-0'}`}
            >
              <div>
                <Title className="text-[clamp(2.5rem,6vw,4.6rem)] mb-5">{slide.title}</Title>
                {slide.text && (
                  <p className="text-white/80 text-[clamp(1.05rem,1.6vw,1.2rem)] max-w-[46ch] mb-8">{slide.text}</p>
                )}
                <div className="flex flex-wrap gap-3">
                  {slide.button_label && slide.button_url && <SlideButton label={slide.button_label} url={slide.button_url} />}
                  <a href={whatsappUrl()} className="btn btn-outline-light" target="_blank" rel="noopener">
                    <WhatsAppIcon />
                    Escribinos por WhatsApp
                  </a>
                </div>
              </div>
              <div className="relative justify-self-center w-[min(320px,82%)] min-[820px]:w-[min(440px,100%)] aspect-square rounded-full bg-white grid place-items-center shadow-[0_0_0_10px_#1b1b1b,0_0_0_11px_#333] mt-4 min-[820px]:mt-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.image_url}
                  alt={slide.image_alt ?? ''}
                  className={
                    slide.image_fit === 'cover' ? 'w-full h-full rounded-full object-cover' : 'w-[72%] h-[72%] object-contain'
                  }
                  fetchPriority={i === 0 ? 'high' : 'low'}
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
                <a
                  href={brand.reviews.url}
                  target="_blank"
                  rel="noopener"
                  className="absolute right-[2%] bottom-[6%] bg-ink text-white border border-[#333] rounded-full px-4 py-2 font-semibold text-[0.92rem] flex gap-1.5 items-center no-underline"
                >
                  <span className="text-star">★</span> {brand.reviews.score} en {brand.reviews.source}
                </a>
              </div>
            </div>
          )
        })}
      </div>

      {count > 1 && (
        <div className="wrap flex items-center gap-4 mt-[clamp(2rem,4vw,3rem)]">
          <button type="button" onClick={() => go(index - 1)} aria-label="Anterior" className="carousel-arrow">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Ir a la diapositiva ${i + 1}: ${slide.title}`}
                aria-current={i === index}
                className={`h-2.5 rounded-full transition-all ${i === index ? 'w-8 bg-white' : 'w-2.5 bg-white/35 hover:bg-white/60'}`}
              />
            ))}
          </div>
          <button type="button" onClick={() => go(index + 1)} aria-label="Siguiente" className="carousel-arrow">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </section>
  )
}

function SlideButton({ label, url }: { label: string; url: string }) {
  // Links de la tienda con Link; los externos en otra pestaña.
  if (url.startsWith('/')) {
    return (
      <Link href={url} className="btn btn-light">
        {label}
      </Link>
    )
  }
  return (
    <a href={url} className="btn btn-light" target="_blank" rel="noopener">
      {label}
    </a>
  )
}
