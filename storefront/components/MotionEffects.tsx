'use client'

import { useEffect } from 'react'

// Movimiento de toda la tienda, con un solo observador y un solo listener (no
// uno por tarjeta). Los estilos están en app/globals.css.
//
// - Aparición al hacer scroll: un elemento con `data-reveal` aparece la
//   primera vez que entra en pantalla; los hijos de `data-reveal-stagger`,
//   escalonados. También sirve para lo que se agrega después (navegar a otra
//   página, cargar más productos).
// - Relieve: una `.tilt-card` se inclina hacia el mouse (solo con mouse; con
//   "reducir movimiento", la mitad).

const REVEAL_SELECTOR = '[data-reveal],[data-reveal-stagger]'
const MAX_TILT_DEG = 4

export default function MotionEffects() {
  useEffect(() => {
    const root = document.documentElement

    // Sin IntersectionObserver (navegadores muy viejos): todo visible, como
    // viene del servidor.
    if (!('IntersectionObserver' in window)) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    )

    const watched = new WeakSet<Element>()
    // `showInView`: en la primera pasada, lo que ya está en pantalla (o más
    // arriba) se marca visible sin animar, antes de activar .reveal-ready. Así
    // la página carga tal cual llegó del servidor y solo se animan las
    // secciones de más abajo, al llegar a ellas. Lo que se agrega después
    // (otra página, más productos) sí entra animado.
    const scan = (showInView: boolean) => {
      document.querySelectorAll(REVEAL_SELECTOR).forEach((el) => {
        if (watched.has(el)) return
        watched.add(el)
        if (el.hasAttribute('data-reveal-stagger')) {
          Array.from(el.children).forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)))
        }
        if (showInView && el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add('is-visible')
          return
        }
        io.observe(el)
      })
    }
    scan(true)
    root.classList.add('reveal-ready')

    let scanQueued = false
    const mo = new MutationObserver(() => {
      if (scanQueued) return
      scanQueued = true
      requestAnimationFrame(() => {
        scanQueued = false
        scan(false)
      })
    })
    mo.observe(document.body, { childList: true, subtree: true })

    // Relieve de las tarjetas. Con "reducir movimiento", la mitad de inclinación.
    const canTilt = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const maxTilt = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? MAX_TILT_DEG / 2 : MAX_TILT_DEG
    let current: HTMLElement | null = null
    let frame = 0
    let last: PointerEvent | null = null

    const reset = (el: HTMLElement) => {
      el.style.removeProperty('--rx')
      el.style.removeProperty('--ry')
    }
    const apply = () => {
      frame = 0
      if (!current || !last) return
      const box = current.getBoundingClientRect()
      const x = (last.clientX - box.left) / box.width
      const y = (last.clientY - box.top) / box.height
      current.style.setProperty('--ry', `${((x - 0.5) * 2 * maxTilt).toFixed(2)}deg`)
      current.style.setProperty('--rx', `${((0.5 - y) * 2 * maxTilt).toFixed(2)}deg`)
      current.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
      current.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const card = (e.target as Element | null)?.closest<HTMLElement>('.tilt-card') ?? null
      if (card !== current) {
        if (current) reset(current)
        current = card
      }
      if (!current) return
      last = e
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const onLeaveWindow = () => {
      if (current) reset(current)
      current = null
    }
    if (canTilt) {
      document.addEventListener('pointermove', onMove, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeaveWindow)
    }

    return () => {
      io.disconnect()
      mo.disconnect()
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeaveWindow)
    }
  }, [])

  return null
}
