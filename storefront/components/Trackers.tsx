'use client'

import { useEffect } from 'react'
import { trackSearch, trackViewItem, type AnalyticsItem } from '@/lib/analytics'

// Eventos de medición que dispara una página del servidor al mostrarse.

export function ViewItemTracker({ item }: { item: AnalyticsItem }) {
  useEffect(() => {
    trackViewItem(item)
    // Una vez por producto, aunque el objeto se vuelva a crear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])
  return null
}

export function SearchTracker({ term }: { term: string }) {
  useEffect(() => {
    if (term) trackSearch(term)
  }, [term])
  return null
}
