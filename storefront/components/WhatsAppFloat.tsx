'use client'

import { usePathname } from 'next/navigation'
import { whatsappUrl } from '@/lib/brand'
import { WhatsAppIcon } from './icons'

// Botón flotante de WhatsApp. En el celular no se muestra en la ficha de
// producto ni en el carrito: ahí tapaba "Agregar al carrito" y los botones del
// pedido, y esas páginas ya tienen su propio botón de WhatsApp.
export default function WhatsAppFloat() {
  const pathname = usePathname()
  const hideOnPhone = pathname.startsWith('/producto/') || pathname.startsWith('/carrito')
  return (
    <a
      href={whatsappUrl()}
      target="_blank"
      rel="noopener"
      aria-label="Escribir por WhatsApp"
      className={`${hideOnPhone ? 'max-sm:hidden ' : ''}fixed right-[calc(1.1rem+env(safe-area-inset-right))] bottom-[calc(1.1rem+env(safe-area-inset-bottom))] z-[60] grid place-items-center w-[58px] h-[58px] rounded-full bg-whatsapp text-white shadow-[0_6px_22px_rgba(0,0,0,.3)] transition-transform hover:scale-105`}
    >
      <WhatsAppIcon className="w-[30px] h-[30px]" />
    </a>
  )
}
