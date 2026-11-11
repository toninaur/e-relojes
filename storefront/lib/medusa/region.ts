import type { HttpTypes } from '@medusajs/types'
import { sdk } from './client'

const REVALIDATE_SECONDS = 300

// La tienda opera en una sola región (Paraguay / PYG). Si hay varias, se fija
// con NEXT_PUBLIC_MEDUSA_REGION_ID; si no, se usa la primera.
export async function getRegion(): Promise<HttpTypes.StoreRegion | null> {
  const regionId = process.env.NEXT_PUBLIC_MEDUSA_REGION_ID
  try {
    if (regionId) {
      const { region } = await sdk.client.fetch<HttpTypes.StoreRegionResponse>(`/store/regions/${regionId}`, {
        next: { revalidate: REVALIDATE_SECONDS },
      })
      return region
    }
    const { regions } = await sdk.client.fetch<HttpTypes.StoreRegionListResponse>('/store/regions', {
      query: { limit: 1 },
      next: { revalidate: REVALIDATE_SECONDS },
    })
    return regions[0] ?? null
  } catch (err) {
    console.error('[medusa] no se pudo obtener la región', err)
    return null
  }
}
