import { defineRouteConfig } from '@medusajs/admin-sdk'
import { House, PhotoSolid } from '@medusajs/icons'
import { Button, Container, Heading, Input, Text, Textarea, toast } from '@medusajs/ui'
import { useEffect, useState } from 'react'
import { Field } from '../../components/field'
import { ProductPicker } from '../../components/product-picker'
import { api, uploadImage, type Content } from '../../lib/api'

// Panel → Portada: lo que el cliente cambia de la página de inicio, además del
// banner (que tiene su propia página). Se guarda en el módulo site-content
// (backend/src/lib/site-content.ts).

const MAX_FEATURED = 8
const MAX_COMBOS = 12
const FEATURED_TAG = 'destacado'

type Featured = { product_ids: string[] }
type Perfumes = {
  title: string
  text: string
  decant_title: string
  decant_text: string
  photos: { url: string; alt: string }[]
  combos_title: string
  combo_product_ids: string[]
}

const PortadaPage = () => (
  <div className="flex flex-col gap-y-3">
    <Container className="px-6 py-4">
      <Heading>Portada de la tienda</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Lo que se muestra en la página de inicio. El banner rotativo se cambia en la página Banner. Los cambios aparecen
        en la tienda en un minuto, aproximadamente.
      </Text>
    </Container>
    <FeaturedSection />
    <PerfumesSection />
  </div>
)

const FeaturedSection = () => {
  const [ids, setIds] = useState<string[] | null>(null)
  const [configured, setConfigured] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { content } = await api<{ content: Content<Featured> }>('/admin/content/portada-destacados')
      setConfigured(content.configured)
      if (content.configured) return setIds(content.data.product_ids)
      // Nunca se guardó: se arranca con los que tienen la etiqueta "destacado".
      const { product_tags } = await api<{ product_tags: { id: string }[] }>(
        `/admin/product-tags?value=${FEATURED_TAG}&fields=id`,
      )
      if (!product_tags[0]) return setIds([])
      const { products } = await api<{ products: { id: string }[] }>(
        `/admin/products?tag_id[]=${product_tags[0].id}&status[]=published&fields=id&limit=${MAX_FEATURED}`,
      )
      setIds(products.map((p) => p.id))
    })().catch((e) => {
      toast.error(`No se pudieron cargar los destacados: ${(e as Error).message}`)
      setIds([])
    })
  }, [])

  const save = async () => {
    if (!ids) return
    setSaving(true)
    try {
      await api('/admin/content/portada-destacados', { method: 'POST', body: JSON.stringify({ product_ids: ids }) })
      setConfigured(true)
      toast.success('Destacados guardados')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Productos destacados</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Hasta {MAX_FEATURED} productos, en este orden. Los productos ocultos no se muestran.
            {!configured && ' Todavía no se guardó esta lista: abajo están los que hoy aparecen en la tienda.'}
          </Text>
        </div>
        <Button size="small" onClick={save} isLoading={saving} disabled={!ids}>
          Guardar
        </Button>
      </div>
      <div className="px-6 py-4">
        {ids ? <ProductPicker value={ids} onChange={setIds} max={MAX_FEATURED} /> : <Text>Cargando…</Text>}
      </div>
    </Container>
  )
}

const PerfumesSection = () => {
  const [data, setData] = useState<Perfumes | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<number | null>(null)

  useEffect(() => {
    api<{ content: Content<Perfumes> }>('/admin/content/portada-perfumes')
      .then(({ content }) => setData(content.data))
      .catch((e) => toast.error(`No se pudo cargar la sección: ${(e as Error).message}`))
  }, [])

  if (!data) {
    return (
      <Container className="px-6 py-4">
        <Text>Cargando…</Text>
      </Container>
    )
  }

  const set = <K extends keyof Perfumes>(key: K, value: Perfumes[K]) => setData((d) => (d ? { ...d, [key]: value } : d))
  const setPhoto = (index: number, photo: { url: string; alt: string } | null) => {
    const photos = [...data.photos]
    if (photo) photos[index] = photo
    else photos.splice(index, 1)
    set('photos', photos.filter((p) => p?.url))
  }

  const upload = async (index: number, file: File) => {
    setUploading(index)
    try {
      const url = await uploadImage(file)
      setPhoto(index, { url, alt: data.photos[index]?.alt ?? '' })
    } catch (e) {
      toast.error(`No se pudo subir la foto: ${(e as Error).message}`)
    } finally {
      setUploading(null)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await api('/admin/content/portada-perfumes', { method: 'POST', body: JSON.stringify(data) })
      toast.success('Sección guardada')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Sección "Perfumes y decants"</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Textos, fotos y los combos que se presentan en la portada.
          </Text>
        </div>
        <Button size="small" onClick={save} isLoading={saving} disabled={uploading !== null || !data.title.trim()}>
          Guardar
        </Button>
      </div>
      <div className="grid gap-4 px-6 py-4 md:grid-cols-2">
        <div className="flex flex-col gap-y-4">
          <Field label="Título">
            <Input value={data.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Texto">
            <Textarea rows={3} value={data.text} onChange={(e) => set('text', e.target.value)} />
          </Field>
          <Field label="Recuadro: título" hint="Dejalo vacío para no mostrar el recuadro.">
            <Input value={data.decant_title} onChange={(e) => set('decant_title', e.target.value)} />
          </Field>
          <Field label="Recuadro: texto">
            <Textarea rows={3} value={data.decant_text} onChange={(e) => set('decant_text', e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-y-4">
          <Field label="Fotos (hasta 2)" hint="Cuadradas, por ejemplo 800 × 800.">
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => {
                const photo = data.photos[i]
                // Las fotos que vienen con la tienda están en el sitio, no en el panel.
                const local = photo?.url.startsWith('/')
                return (
                  <div key={i} className="flex flex-col gap-y-2">
                    <div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-ui-bg-subtle">
                      {photo && !local ? (
                        <img src={photo.url} alt="" className="h-full w-full object-cover" />
                      ) : photo ? (
                        <Text size="xsmall" className="px-2 text-center text-ui-fg-subtle">
                          Foto de fábrica ({photo.url.split('/').pop()})
                        </Text>
                      ) : (
                        <PhotoSolid className="text-ui-fg-muted" />
                      )}
                    </div>
                    <div className="flex gap-x-2">
                      <label className="flex-1 cursor-pointer">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          disabled={i > data.photos.length}
                          onChange={(e) => e.target.files?.[0] && upload(i, e.target.files[0])}
                        />
                        <span className="txt-compact-small-plus block rounded-md border px-2 py-1 text-center shadow-buttons-neutral">
                          {uploading === i ? 'Subiendo…' : photo ? 'Cambiar' : 'Subir'}
                        </span>
                      </label>
                      {photo && (
                        <Button size="small" variant="secondary" onClick={() => setPhoto(i, null)}>
                          Quitar
                        </Button>
                      )}
                    </div>
                    {photo && (
                      <Input
                        size="small"
                        placeholder="Descripción de la foto"
                        value={photo.alt}
                        onChange={(e) => setPhoto(i, { ...photo, alt: e.target.value })}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </Field>
        </div>
      </div>
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <Field label="Combos: título" hint="Por ejemplo: Combos de 5 decants de 10 ml.">
          <Input value={data.combos_title} onChange={(e) => set('combos_title', e.target.value)} />
        </Field>
        <Field
          label={`Combos que se presentan (hasta ${MAX_COMBOS})`}
          hint="Cada combo es un producto de la tienda: se muestra con su nombre, descripción, precio y un link para verlo. Sin combos elegidos, la lista no aparece."
        >
          <ProductPicker value={data.combo_product_ids} onChange={(ids) => set('combo_product_ids', ids)} max={MAX_COMBOS} />
        </Field>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: 'Portada',
  icon: House,
})

export default PortadaPage
