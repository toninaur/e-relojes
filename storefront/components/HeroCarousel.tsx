'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { brand, whatsappUrl } from '@/lib/brand'
import { WhatsAppIcon } from './icons'
import StoreImage from '@/components/StoreImage'

// Portada con banner rotativo. Las diapositivas se cargan en el panel
// (Banner); cada una tiene título, texto, foto del producto y un botón.
// Todas ocupan la misma celda de la grilla, así la altura no salta al rotar.
//
// Rotación: la línea de progreso de abajo es una animación CSS de
// INTERVAL_MS; cuando termina, pasa a la siguiente. Así la línea y el cambio
// van siempre juntos, y pausar es frenar la animación. Se pausa con el botón
// de pausa, con el foco del teclado adentro, con la portada fuera de pantalla
// o con la pestaña oculta (el navegador frena las animaciones). Pasar el mouse
// o tocar NO la pausa: la portada ocupa la pantalla y nunca giraría.
//
// El reloj queda quieto, con un halo detrás (seguir al mouse se veía a
// saltitos en algunas PC).

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

// Cada diapositiva queda 8 s y el cambio es un fundido de 1,4 s.
const INTERVAL_MS = 8000

export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0)
  const [userPaused, setUserPaused] = useState(false)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const [offscreen, setOffscreen] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  // Deslizar con el dedo: solo cuenta si el gesto es más horizontal que
  // vertical (si no, era scroll de la página).
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const count = slides.length
  const running = count > 1 && !userPaused && !keyboardFocus && !offscreen

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count])

  // Fuera de pantalla no gira (al volver, sigue donde estaba).
  useEffect(() => {
    const el = sectionRef.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={sectionRef}
      className="relative bg-ink text-white overflow-hidden pt-[clamp(3rem,7vw,5.5rem)] pb-[clamp(3.5rem,8vw,6rem)] glow-dark"
      aria-roledescription="carrusel"
      aria-label="Novedades y promociones"
      // Solo el foco del teclado pausa (un click en una flecha no).
      onFocusCapture={(e) => setKeyboardFocus((e.target as HTMLElement).matches(':focus-visible'))}
      onBlurCapture={() => setKeyboardFocus(false)}
      onTouchStart={(e) => (touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const start = touchStart.current
        touchStart.current = null
        if (!start) return
        const dx = e.changedTouches[0].clientX - start.x
        const dy = e.changedTouches[0].clientY - start.y
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1))
      }}
      onTouchCancel={() => (touchStart.current = null)}
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
                transition-opacity duration-[1400ms] ease-in-out ${active ? 'opacity-100' : 'opacity-0'}`}
            >
              {/* El texto entra subiendo apenas; la foto, con un acercamiento
                  sutil. El texto y los botones no siguen al mouse: Chrome
                  redondea el texto a píxeles enteros y se veía a saltitos
                  (además, un botón no debería correrse al ir a tocarlo). */}
              <div
                className={'transition-transform duration-[1400ms] ease-out motion-reduce:transition-none ' + (active ? 'translate-y-0' : 'translate-y-4')}
              >
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
              <div className="relative justify-self-center w-[min(320px,82%)] min-[820px]:w-[min(440px,100%)] mt-4 min-[820px]:mt-0">
                <div className="hero-glow" aria-hidden />
                {/* Aro negro: un círculo oscuro con la foto adentro (antes eran
                    sombras alrededor de un círculo blanco, y en el borde
                    quedaba un hilo claro y serruchado). */}
                <div
                  className={
                    'transition-transform duration-[2000ms] ease-out motion-reduce:transition-none ' +
                    (active ? 'scale-100' : 'scale-[0.96]') +
                    ' relative rounded-full p-[10px] bg-[#1b1b1b] shadow-[0_0_0_1px_#333,0_40px_80px_-20px_rgb(0_0_0/0.75)]'
                  }
                >
                  <div
                    className={`relative aspect-square rounded-full overflow-hidden grid place-items-center ${
                      slide.image_fit === 'cover' ? 'bg-[#1b1b1b]' : 'bg-white'
                    }`}
                  >
                    <StoreImage
                      src={slide.image_url}
                      alt={slide.image_alt ?? ''}
                      fill
                      sizes="(min-width: 820px) 440px, 82vw"
                      className={slide.image_fit === 'cover' ? 'object-cover' : 'object-contain p-[14%]'}
                      fetchPriority={i === 0 ? 'high' : 'low'}
                      loading={i === 0 ? 'eager' : 'lazy'}
                    />
                  </div>
                  <a
                    href={brand.reviews.url}
                    target="_blank"
                    rel="noopener"
                    className="absolute right-[2%] bottom-[6%] bg-ink text-white border border-[#333] rounded-full px-4 py-2 font-semibold text-[0.92rem] flex gap-1.5 items-center no-underline shadow-[0_10px_24px_-8px_rgb(0_0_0/0.6)]"
                  >
                    <span className="text-star">★</span> {brand.reviews.score} en {brand.reviews.source}
                  </a>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {count > 1 && (
        <div className="wrap relative flex items-center gap-4 mt-[clamp(2rem,4vw,3rem)]">
          <button type="button" onClick={() => go(index - 1)} aria-label="Anterior" className="carousel-arrow">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex gap-2">
            {slides.map((slide, i) => {
              const active = i === index
              return (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Ir a la diapositiva ${i + 1}: ${slide.title}`}
                  aria-current={active}
                  className={`relative h-2.5 rounded-full after:absolute after:-inset-y-4 after:-inset-x-1 transition-all duration-500 ease-out ${
                    active ? 'w-8 bg-white' : 'w-2.5 bg-white/35 hover:bg-white/60'
                  }`}
                />
              )
            })}
          </div>
          <button type="button" onClick={() => go(index + 1)} aria-label="Siguiente" className="carousel-arrow">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setUserPaused((p) => !p)}
            aria-label={userPaused ? 'Reanudar el banner' : 'Pausar el banner'}
            aria-pressed={userPaused}
            className="carousel-arrow ml-1"
          >
            {userPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>
        </div>
      )}

      {/* Progreso: línea fina a lo ancho de la portada. Recorre toda la
          pantalla en INTERVAL_MS, así el movimiento se ve continuo (en un punto
          de 48 px avanzaba 6 px por segundo y se notaba a saltitos). Cuando
          termina, pasa a la siguiente diapositiva. */}
      {count > 1 && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10 overflow-hidden">
          <span
            // La key reinicia la animación en cada cambio de diapositiva.
            key={index}
            onAnimationEnd={() => go(index + 1)}
            className="slide-progress block h-full w-full bg-gradient-to-r from-white/40 via-white/80 to-white"
            style={{
              animation: `slide-progress ${INTERVAL_MS}ms linear forwards`,
              animationPlayState: running ? 'running' : 'paused',
            }}
          />
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
