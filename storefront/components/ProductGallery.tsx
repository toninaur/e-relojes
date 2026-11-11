'use client'

import { useState } from 'react'

export default function ProductGallery({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0)

  if (images.length === 0) {
    return (
      <div className="aspect-square rounded-[var(--radius-card)] bg-ink grid place-items-center">
        <span className="text-white font-display text-xl px-6 text-center">{alt}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col-reverse md:flex-row gap-3">
      {images.length > 1 && (
        <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-y-auto md:max-h-[560px]">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Ver foto ${i + 1}`}
              className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 bg-white ${
                active === i ? 'border-ink' : 'border-line hover:border-muted'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 aspect-square rounded-[var(--radius-card)] overflow-hidden bg-white border border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[active]} alt={alt} className="w-full h-full object-cover" />
      </div>
    </div>
  )
}
