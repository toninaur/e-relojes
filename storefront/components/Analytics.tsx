'use client'

import { Suspense, useEffect, useRef } from 'react'
import Script from 'next/script'
import { usePathname, useSearchParams } from 'next/navigation'
import { GA_ID, META_PIXEL_ID, trackPageView, trackWhatsApp } from '@/lib/analytics'

// Carga Google Analytics 4 y el Píxel de Meta (si hay IDs configurados) y
// registra cada cambio de página y cada click a WhatsApp.
export default function Analytics() {
  if (!GA_ID && !META_PIXEL_ID) return null
  return (
    <>
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
          </Script>
        </>
      )}
      {META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`}
        </Script>
      )}
      {/* useSearchParams va dentro de Suspense para no frenar el prerender. */}
      <Suspense fallback={null}>
        <PageViews />
      </Suspense>
    </>
  )
}

function PageViews() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const query = searchParams.toString()

  const first = useRef(true)

  useEffect(() => {
    // La primera vista la registran los scripts al iniciar; acá, solo las
    // navegaciones dentro de la tienda (que no recargan la página).
    if (first.current) {
      first.current = false
      return
    }
    trackPageView(window.location.href)
  }, [pathname, query])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href*="wa.me/"]')
      if (link) trackWhatsApp(window.location.pathname)
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  return null
}
