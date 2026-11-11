'use client'

import { useRouter } from 'next/navigation'

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
      <select
        value={value}
        onChange={(e) => {
          const option = options.find((o) => o.value === e.target.value)
          if (option) router.push(option.href, { scroll: false })
        }}
        className="field !w-auto !py-2 !pl-3 !pr-8 !text-[0.95rem] cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
