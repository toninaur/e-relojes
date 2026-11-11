import { whatsappUrl } from '@/lib/brand'
import { WhatsAppIcon } from './icons'

export default function WhatsAppFloat() {
  return (
    <a
      href={whatsappUrl()}
      target="_blank"
      rel="noopener"
      aria-label="Escribir por WhatsApp"
      className="fixed right-[1.1rem] bottom-[calc(1.1rem+env(safe-area-inset-bottom))] z-[60] grid place-items-center w-[58px] h-[58px] rounded-full bg-whatsapp text-white shadow-[0_6px_22px_rgba(0,0,0,.3)] transition-transform hover:scale-105"
    >
      <WhatsAppIcon className="w-[30px] h-[30px]" />
    </a>
  )
}
