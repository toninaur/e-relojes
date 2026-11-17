import { defineWidgetConfig } from '@medusajs/admin-sdk'
import type { AdminProduct, DetailWidgetProps } from '@medusajs/framework/types'
import { Badge, Button, Container, Heading, Text, toast } from '@medusajs/ui'
import { useState } from 'react'

// Panel → Productos → un producto: "Aronium". Muestra, dato por dato, si viene
// de Aronium o si se editó en la tienda (y entonces Aronium ya no lo pisa), y
// el botón "Tomar de Aronium" para volver a copiarlo todo. Ver
// docs/sincronizador-aronium.md, "Contenido del producto".

type Synced = Partial<Record<'description' | 'color' | 'malla' | 'specs' | 'barcode' | 'image_url', string>>

const FIELDS: { key: keyof Synced; label: string }[] = [
  { key: 'description', label: 'Descripción' },
  { key: 'color', label: 'Color' },
  { key: 'malla', label: 'Malla' },
  { key: 'specs', label: 'Características' },
  { key: 'barcode', label: 'Código de barras' },
  { key: 'image_url', label: 'Foto principal' },
]

const ProductAronium = ({ data: product }: DetailWidgetProps<AdminProduct>) => {
  const [busy, setBusy] = useState(false)
  const metadata = (product.metadata ?? {}) as Record<string, unknown>
  const codes = (product.variants ?? []).map((v) => v.sku).filter(Boolean) as string[]
  if (!codes.length) return null

  const synced = (metadata.aronium_synced && typeof metadata.aronium_synced === 'object' ? metadata.aronium_synced : {}) as Synced
  const pending = metadata.aronium_resync === true || metadata.aronium_resync === 'true'

  const storeValue = (key: keyof Synced): string => {
    switch (key) {
      case 'description':
        return (product.description ?? '').trim()
      case 'barcode':
        return (product.variants?.[0]?.barcode ?? '').trim()
      case 'image_url':
        return product.thumbnail ?? ''
      default:
        return String(metadata[key] ?? '').trim()
    }
  }

  const resync = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/admin/aronium/products/${product.id}/resync`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      toast.success('Listo: en la próxima pasada del conector (en menos de un minuto) se copia de Aronium. Recargá la página para verlo.')
    } catch (e) {
      toast.error(`No se pudo pedir: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Aronium</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Código {codes.join(', ')}. Precio y stock vienen siempre de Aronium.
          </Text>
        </div>
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        {FIELDS.map(({ key, label }) => {
          const last = synced[key]
          const value = storeValue(key)
          const state =
            last === undefined ? (value ? 'store' : 'empty') : value === (last ?? '').trim() ? (value ? 'aronium' : 'empty') : 'store'
          return (
            <div key={key} className="flex items-center justify-between gap-x-2">
              <Text size="small">{label}</Text>
              {state === 'aronium' ? (
                <Badge size="2xsmall" color="green">De Aronium</Badge>
              ) : state === 'store' ? (
                <Badge size="2xsmall" color="blue">Editado en la tienda</Badge>
              ) : (
                <Badge size="2xsmall" color="grey">Vacío</Badge>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Lo editado en la tienda no se pisa. Para volver a tomar todo de Aronium (foto, descripción, filtros, características y código de barras):
        </Text>
        <Button size="small" variant="secondary" isLoading={busy} disabled={pending} onClick={resync}>
          {pending ? 'Pedido: se copia en la próxima pasada' : 'Tomar de Aronium'}
        </Button>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: 'product.details.side.after',
})

export default ProductAronium
