'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

// Selector de orden del catálogo. La flecha es propia (el campo no usa el
// estilo nativo, que en iPhone se ve distinto); la letra es de 16 px en el
// celular para que Safari no haga zoom al tocarlo (globals.css).
export default function SortSelect({
  value,
  options,
}: {
  value: string
  options: { value: string; label: string; href: string }[]
}) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-2 text-[0.95rem]">
      <span className="font-semibold whitespace-nowrap">Ordenar</span>
      <span className="relative">
        <select
          value={value}
          onChange={(e) => {
            const option = options.find((o) => o.value === e.target.value)
            if (option) router.push(option.href, { scroll: false })
          }}
          className="field !w-auto !py-2 !pl-3 !pr-9 sm:!text-[0.95rem] cursor-pointer"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
      </span>
    </label>
  )
}
