import { defineWidgetConfig } from '@medusajs/admin-sdk'
import type { AdminProduct, DetailWidgetProps } from '@medusajs/framework/types'
import { Button, Container, Heading, Label, Select, Text, Textarea, toast } from '@medusajs/ui'
import { useState } from 'react'
import { COLORS, STRAPS } from '../../lib/catalog-taxonomy'

// Panel → Productos → un producto: "Filtros de la tienda". Color y malla salen
// de listas cerradas (lib/catalog-taxonomy.ts), las mismas que muestra el
// filtro del catálogo, así no se cargan variantes como "negra" o "black".
// Se guardan en la metadata del producto: `color` ("Negro | Dorado"), `malla`
// y `specs` (características, una por línea en el formulario).
// Tipo de producto, categoría y marca (colección) se eligen en "Organizar".

const NO_STRAP = '__ninguna'

function listOf(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean)
    : []
}

const ProductStoreFilters = ({ data: product }: DetailWidgetProps<AdminProduct>) => {
  const metadata = (product.metadata ?? {}) as Record<string, unknown>
  const [colors, setColors] = useState<string[]>(listOf(metadata.color))
  const [strap, setStrap] = useState<string>(typeof metadata.malla === 'string' && metadata.malla ? metadata.malla : NO_STRAP)
  const [specs, setSpecs] = useState<string>(listOf(metadata.specs).join('\n'))
  const [saving, setSaving] = useState(false)

  // Valores viejos que no están en la lista: se muestran para poder sacarlos.
  const unknownColors = colors.filter((c) => !(COLORS as readonly string[]).includes(c))
  const strapOptions = strap !== NO_STRAP && !(STRAPS as readonly string[]).includes(strap) ? [...STRAPS, strap] : STRAPS

  const toggle = (color: string) =>
    setColors((current) => (current.includes(color) ? current.filter((c) => c !== color) : [...current, color]))

  const save = async () => {
    setSaving(true)
    try {
      const next: Record<string, unknown> = { ...metadata }
      const specList = specs
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      // Vacío = se borra la clave (Medusa la elimina con "").
      next.color = colors.length ? colors.join(' | ') : ''
      next.malla = strap === NO_STRAP ? '' : strap
      next.specs = specList.length ? specList.join(' | ') : ''
      const res = await fetch(`/admin/products/${product.id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metadata: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      toast.success('Filtros guardados. La tienda los muestra en unos segundos.')
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Filtros de la tienda</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Color, malla y características que usa el catálogo para filtrar. Tipo, categoría y marca se eligen en
            "Organizar".
          </Text>
        </div>
        <Button size="small" onClick={save} isLoading={saving}>
          Guardar
        </Button>
      </div>

      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Label>Color</Label>
        <Text size="xsmall" className="text-ui-fg-subtle">
          El del dial y la caja en un reloj, el del marco en unos lentes, el del producto en lo demás. Se puede elegir más
          de uno.
        </Text>
        <div className="flex flex-wrap gap-2">
          {[...COLORS, ...unknownColors].map((color) => {
            const on = colors.includes(color)
            return (
              <button
                key={color}
                type="button"
                onClick={() => toggle(color)}
                aria-pressed={on}
                className={`txt-compact-small rounded-full border px-3 py-1 transition-colors ${
                  on
                    ? 'border-ui-fg-base bg-ui-fg-base text-ui-bg-base'
                    : 'border-ui-border-base text-ui-fg-subtle hover:border-ui-fg-muted'
                }`}
              >
                {color}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Label>Malla</Label>
        <div className="max-w-xs">
          <Select value={strap} onValueChange={setStrap}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value={NO_STRAP}>Sin malla (no es un reloj)</Select.Item>
              {strapOptions.map((s) => (
                <Select.Item key={s} value={s}>
                  {s}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <Text size="xsmall" className="text-ui-fg-subtle">
          Acero incluye las metálicas; Silicona, las de goma o caucho; Tela, las de lona.
        </Text>
      </div>

      <div className="flex flex-col gap-y-2 px-6 py-4">
        <Label>Características</Label>
        <Textarea
          rows={5}
          value={specs}
          onChange={(e) => setSpecs(e.target.value)}
          placeholder={'Una por línea, por ejemplo:\nCristal de zafiro\n40 mm\nSumergible 10 BAR'}
        />
        <Text size="xsmall" className="text-ui-fg-subtle">
          Se muestran como etiquetas en la tarjeta y en la ficha del producto.
        </Text>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: 'product.details.after',
})

export default ProductStoreFilters
