import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ArrowDownMini, ArrowUpMini, PhotoSolid } from '@medusajs/icons'
import {
  Button,
  Container,
  Drawer,
  Heading,
  IconButton,
  Input,
  Label,
  StatusBadge,
  Switch,
  Table,
  Text,
  Textarea,
  toast,
  usePrompt,
} from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'

// Panel → Banner: las diapositivas que rotan en la portada de la tienda.

type Banner = {
  id: string
  title: string
  text: string | null
  image_url: string
  image_alt: string | null
  image_fit: 'contain' | 'cover'
  button_label: string | null
  button_url: string | null
  rank: number
  is_active: boolean
  starts_at: string | null
  ends_at: string | null
}

type Draft = Omit<Banner, 'id' | 'rank' | 'starts_at' | 'ends_at'> & { starts_at: string; ends_at: string }

const EMPTY: Draft = {
  title: '',
  text: '',
  image_url: '',
  image_alt: '',
  image_fit: 'contain',
  button_label: 'Ver catálogo',
  button_url: '/catalogo',
  is_active: true,
  starts_at: '',
  ends_at: '',
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `Error ${res.status}`)
  }
  return res.json()
}

const BannerPage = () => {
  const [banners, setBanners] = useState<Banner[] | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null)
  const prompt = usePrompt()

  const load = useCallback(async () => {
    try {
      const { banners } = await api<{ banners: Banner[] }>('/admin/banners')
      setBanners(banners)
    } catch (e) {
      toast.error(`No se pudo cargar el banner: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const move = async (index: number, delta: -1 | 1) => {
    if (!banners) return
    const a = banners[index]
    const b = banners[index + delta]
    if (!a || !b) return
    // Rangos únicos aunque vengan repetidos: se reasigna el orden completo.
    const order = banners.map((x) => x.id)
    order.splice(index, 1)
    order.splice(index + delta, 0, a.id)
    await Promise.all(order.map((id, rank) => api(`/admin/banners/${id}`, { method: 'POST', body: JSON.stringify({ rank }) })))
    load()
  }

  const toggle = async (banner: Banner) => {
    await api(`/admin/banners/${banner.id}`, { method: 'POST', body: JSON.stringify({ is_active: !banner.is_active }) })
    load()
  }

  const remove = async (banner: Banner) => {
    const ok = await prompt({
      title: 'Eliminar diapositiva',
      description: `"${banner.title}" deja de aparecer en la portada. No se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
    })
    if (!ok) return
    await api(`/admin/banners/${banner.id}`, { method: 'DELETE' })
    toast.success('Diapositiva eliminada')
    load()
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>Banner de la portada</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Las diapositivas rotan arriba de todo en el inicio de la tienda, en este orden. Sin diapositivas activas se
            muestra la portada fija.
          </Text>
        </div>
        <Button size="small" onClick={() => setEditing({ id: null, draft: EMPTY })}>
          Nueva diapositiva
        </Button>
      </div>

      {banners === null ? (
        <Text className="px-6 py-4">Cargando…</Text>
      ) : banners.length === 0 ? (
        <Text className="px-6 py-4 text-ui-fg-subtle">Todavía no hay diapositivas.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Orden</Table.HeaderCell>
              <Table.HeaderCell>Imagen</Table.HeaderCell>
              <Table.HeaderCell>Título</Table.HeaderCell>
              <Table.HeaderCell>Estado</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Acciones</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {banners.map((b, i) => (
              <Table.Row key={b.id}>
                <Table.Cell>
                  <div className="flex gap-x-1">
                    <IconButton size="small" variant="transparent" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                      <ArrowUpMini />
                    </IconButton>
                    <IconButton
                      size="small"
                      variant="transparent"
                      disabled={i === banners.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Bajar"
                    >
                      <ArrowDownMini />
                    </IconButton>
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <img src={b.image_url} alt="" className="h-12 w-12 rounded-md border object-contain bg-white" />
                </Table.Cell>
                <Table.Cell>{b.title}</Table.Cell>
                <Table.Cell>
                  <StateBadge banner={b} />
                </Table.Cell>
                <Table.Cell>
                  <div className="flex justify-end gap-x-2">
                    <Button size="small" variant="secondary" onClick={() => toggle(b)}>
                      {b.is_active ? 'Ocultar' : 'Mostrar'}
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          id: b.id,
                          draft: {
                            ...b,
                            text: b.text ?? '',
                            image_alt: b.image_alt ?? '',
                            button_label: b.button_label ?? '',
                            button_url: b.button_url ?? '',
                            starts_at: toLocalInput(b.starts_at),
                            ends_at: toLocalInput(b.ends_at),
                          },
                        })
                      }
                    >
                      Editar
                    </Button>
                    <Button size="small" variant="danger" onClick={() => remove(b)}>
                      Eliminar
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {editing && (
        <BannerForm
          id={editing.id}
          initial={editing.draft}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </Container>
  )
}

const StateBadge = ({ banner }: { banner: Banner }) => {
  const now = Date.now()
  if (!banner.is_active) return <StatusBadge color="grey">Oculta</StatusBadge>
  if (banner.starts_at && new Date(banner.starts_at).getTime() > now)
    return <StatusBadge color="blue">Desde el {formatDate(banner.starts_at)}</StatusBadge>
  if (banner.ends_at && new Date(banner.ends_at).getTime() <= now) return <StatusBadge color="orange">Vencida</StatusBadge>
  return (
    <StatusBadge color="green">
      Visible{banner.ends_at ? ` hasta el ${formatDate(banner.ends_at)}` : ''}
    </StatusBadge>
  )
}

const BannerForm = ({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string | null
  initial: Draft
  onClose: () => void
  onSaved: () => void
}) => {
  const [draft, setDraft] = useState<Draft>(initial)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('files', file)
      const { files } = await api<{ files: { url: string }[] }>('/admin/uploads', { method: 'POST', body: form })
      set('image_url', files[0].url)
    } catch (e) {
      toast.error(`No se pudo subir la imagen: ${(e as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = JSON.stringify({
        ...draft,
        starts_at: draft.starts_at ? new Date(draft.starts_at).toISOString() : null,
        ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
      })
      await api(id ? `/admin/banners/${id}` : '/admin/banners', { method: 'POST', body })
      toast.success(id ? 'Diapositiva guardada' : 'Diapositiva creada')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{id ? 'Editar diapositiva' : 'Nueva diapositiva'}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <Field label="Imagen" hint="Cuadrada, por ejemplo 900 × 900. Se muestra dentro de un círculo blanco.">
            <div className="flex items-center gap-x-3">
              <div className="grid h-20 w-20 place-items-center rounded-md border bg-white">
                {draft.image_url ? (
                  <img
                    src={draft.image_url}
                    alt=""
                    className={`h-full w-full ${draft.image_fit === 'cover' ? 'rounded-full object-cover' : 'object-contain p-2'}`}
                  />
                ) : (
                  <PhotoSolid className="text-ui-fg-muted" />
                )}
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
                <span className="txt-compact-small-plus rounded-md border px-3 py-1.5 shadow-buttons-neutral">
                  {uploading ? 'Subiendo…' : draft.image_url ? 'Cambiar imagen' : 'Subir imagen'}
                </span>
              </label>
            </div>
          </Field>
          <div className="flex items-start gap-x-2">
            <Switch
              id="banner-fit"
              checked={draft.image_fit === 'cover'}
              onCheckedChange={(v) => set('image_fit', v ? 'cover' : 'contain')}
            />
            <div>
              <Label htmlFor="banner-fit">La foto llena todo el círculo</Label>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Para fotos con fondo de color o flyers. Apagado: producto sobre fondo blanco, con margen.
              </Text>
            </div>
          </div>
          <Field label="Título">
            <Input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Ej.: 20% en relojes Casio" />
          </Field>
          <Field label="Texto">
            <Textarea value={draft.text ?? ''} onChange={(e) => set('text', e.target.value)} rows={3} />
          </Field>
          <Field label="Descripción de la imagen" hint="Para buscadores y lectores de pantalla. Ej.: Reloj Casio Edifice plateado.">
            <Input value={draft.image_alt ?? ''} onChange={(e) => set('image_alt', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Texto del botón">
              <Input value={draft.button_label ?? ''} onChange={(e) => set('button_label', e.target.value)} />
            </Field>
            <Field label="Link del botón" hint="Ej.: /catalogo?oferta=1">
              <Input value={draft.button_url ?? ''} onChange={(e) => set('button_url', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mostrar desde (opcional)">
              <Input type="datetime-local" value={draft.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
            </Field>
            <Field label="Mostrar hasta (opcional)">
              <Input type="datetime-local" value={draft.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
            </Field>
          </div>
          <div className="flex items-center gap-x-2">
            <Switch id="banner-active" checked={draft.is_active} onCheckedChange={(v) => set('is_active', v)} />
            <Label htmlFor="banner-active">Visible en la tienda</Label>
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary">Cancelar</Button>
          </Drawer.Close>
          <Button onClick={save} isLoading={saving} disabled={uploading || !draft.title.trim() || !draft.image_url}>
            Guardar
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-y-1.5">
    <Label>{label}</Label>
    {children}
    {hint && (
      <Text size="xsmall" className="text-ui-fg-subtle">
        {hint}
      </Text>
    )}
  </div>
)

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-PY', { day: 'numeric', month: 'short' })
}

export const config = defineRouteConfig({
  label: 'Banner',
  icon: PhotoSolid,
})

export default BannerPage
