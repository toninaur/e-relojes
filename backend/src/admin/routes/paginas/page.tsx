import { defineRouteConfig } from '@medusajs/admin-sdk'
import { DocumentText } from '@medusajs/icons'
import { Badge, Button, Container, Drawer, Heading, Input, Table, Text, Textarea, toast } from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'
import { Field } from '../../components/field'
import { api, type Content } from '../../lib/api'

// Panel → Páginas: los textos de las páginas legales de la tienda (links al
// pie de todas las páginas). Se guardan en el módulo site-content.

type Page = { title: string; body: string }

const PAGES = [
  { key: 'pagina-terminos', path: '/terminos' },
  { key: 'pagina-cambios-y-devoluciones', path: '/cambios-y-devoluciones' },
  { key: 'pagina-privacidad', path: '/privacidad' },
] as const

type Row = (typeof PAGES)[number] & { content: Content<Page> }

const PaginasPage = () => {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)

  const load = useCallback(async () => {
    try {
      const contents = await Promise.all(
        PAGES.map((p) => api<{ content: Content<Page> }>(`/admin/content/${p.key}`).then((r) => r.content)),
      )
      setRows(PAGES.map((p, i) => ({ ...p, content: contents[i] })))
    } catch (e) {
      toast.error(`No se pudieron cargar las páginas: ${(e as Error).message}`)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Páginas</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Textos de las páginas legales. Los links están al pie de todas las páginas de la tienda.
        </Text>
      </div>
      {rows === null ? (
        <Text className="px-6 py-4">Cargando…</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Página</Table.HeaderCell>
              <Table.HeaderCell>Dirección en la tienda</Table.HeaderCell>
              <Table.HeaderCell>Estado</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.key} className="cursor-pointer" onClick={() => setEditing(row)}>
                <Table.Cell>{row.content.data.title}</Table.Cell>
                <Table.Cell>{row.path}</Table.Cell>
                <Table.Cell>
                  {row.content.data.body.trim() ? (
                    <Badge color="green" size="2xsmall">
                      Con texto
                      {row.content.updated_at ? ` · ${new Date(row.content.updated_at).toLocaleDateString('es-PY')}` : ''}
                    </Badge>
                  ) : (
                    <Badge color="orange" size="2xsmall">
                      Vacía
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">
                  <Button size="small" variant="secondary">
                    Editar
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
      {editing && (
        <PageEditor
          row={editing}
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

const PageEditor = ({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) => {
  const [draft, setDraft] = useState<Page>(row.content.data)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await api(`/admin/content/${row.key}`, { method: 'POST', body: JSON.stringify(draft) })
      toast.success('Página guardada')
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content className="max-w-2xl">
        <Drawer.Header>
          <Drawer.Title>Editar página</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-y-auto">
          <Field label="Título">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field
            label="Texto"
            hint={
              <>
                Dejá una línea en blanco entre párrafos. Para un subtítulo, empezá la línea con <code>#</code> y un
                espacio, por ejemplo: <code># Plazos de cambio</code>.
              </>
            }
          >
            <Textarea rows={22} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary">Cancelar</Button>
          </Drawer.Close>
          <Button onClick={save} isLoading={saving} disabled={!draft.title.trim()}>
            Guardar
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

export const config = defineRouteConfig({
  label: 'Páginas',
  icon: DocumentText,
})

export default PaginasPage
