import { formatMoney } from '@/lib/format'

export default function Price({
  amount,
  original,
  currency,
  size = 'md',
}: {
  amount: number
  original: number | null
  currency: string
  size?: 'md' | 'lg'
}) {
  const strong = size === 'lg' ? 'text-[1.7rem]' : 'text-[1.02rem] sm:text-[1.3rem]'
  const strike = size === 'lg' ? 'text-[1.05rem]' : 'text-[0.8rem] sm:text-[0.95rem]'
  return (
    <div className="flex items-baseline gap-x-2.5 flex-wrap">
      <strong className={`${strong} font-bold`}>{formatMoney(amount, currency)}</strong>
      {original && <s className={`${strike} text-muted`}>{formatMoney(original, currency)}</s>}
    </div>
  )
}
