import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ArrowPath } from '@medusajs/icons'
import { Badge, Button, Container, Heading, StatusBadge, Table, Text } from '@medusajs/ui'
import { Fragment, useCallback, useEffect, useState } from 'react'

// Panel → Aronium: estado del conector con la caja del local, productos
// nuevos para completar y la bitácora de eventos (altas, bajas y
// modificaciones, con su estado).

type Change = {
  id: string
  code: string
  product_id: string | null
  product_title: string | null
  field: 'price' | 'stock' | 'created' | 'removed' | 'image'
  old_value: string | null
  new_value: string | null
}
type Run = {
  id: string
  created_at: string
  status: 'ok' | 'error'
  items_received: number
  prices_updated: number
  stock_updated: number
  created: number
  removed: number
  images_added: number
  error: string | null
  changes: Change[]
}
type Status = {
  agent: {
    last_seen_at: string | null
    version: string | null
    host: string | null
    products_total: number
    last_error: string | null
    last_error_at: string | null
    interval_minutes: number
  } | null
  drafts: { id: string; title: string; code: string; has_image: boolean; created_at: string; missing: string[] }[]
  runs: Run[]
  runs_count: number
}

// Sin noticias del agente por más de dos pasadas (y 5 minutos de margen): algo pasa.
const offlineAfterMinutes = (interval: number) => interval * 2 + 5
const PAGE_SIZE = 20

const AroniumPage = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/aronium/status?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { credentials: 'include' })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setStatus(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [page])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  if (!status) {
    return (
      <Container className="p-6">
        <Text>{error ? `No se pudo cargar el estado: ${error}` : 'Cargando…'}</Text>
      </Container>
    )
  }

  const pages = Math.max(1, Math.ceil(status.runs_count / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-y-3">
      <AgentCard status={status} onRefresh={load} />

      {status.drafts.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Productos nuevos para completar ({status.drafts.length})</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Llegaron de Aronium y están ocultos. Categoría, marca y tipo se completan solos cuando se pueden deducir del grupo y del nombre; lo que falta se carga en el producto ("Organizar" y "Filtros de la tienda") antes de publicarlo.
            </Text>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Producto</Table.HeaderCell>
                <Table.HeaderCell>Código</Table.HeaderCell>
                <Table.HeaderCell>Falta</Table.HeaderCell>
                <Table.HeaderCell>Llegó</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {status.drafts.map((d) => (
                <Table.Row key={d.id} className="cursor-pointer" onClick={() => (window.location.href = `/app/products/${d.id}`)}>
                  <Table.Cell>{d.title}</Table.Cell>
                  <Table.Cell>{d.code}</Table.Cell>
                  <Table.Cell>
                    {d.missing.length === 0 ? (
                      <Badge color="green" size="2xsmall">Listo para publicar</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {d.missing.map((m) => (
                          <Badge key={m} color="orange" size="2xsmall">
                            {m}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Table.Cell>
                  <Table.Cell>{formatDate(d.created_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Bitácora de eventos</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Cada sincronización que cambió algo en la tienda, con sus eventos: <b>alta</b> (producto nuevo en
            Aronium), <b>baja</b> (producto borrado o desactivado en Aronium: queda sin stock) y <b>modificación</b>{' '}
            (precio, stock o foto). Tocá una fila para ver el detalle. Las sincronizaciones sin cambios no se anotan.
          </Text>
        </div>
        {status.runs.length === 0 ? (
          <Text className="px-6 py-4 text-ui-fg-subtle">Todavía no hubo cambios.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Fecha</Table.HeaderCell>
                <Table.HeaderCell>Estado</Table.HeaderCell>
                <Table.HeaderCell>Eventos</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {status.runs.map((run) => (
                <Fragment key={run.id}>
                  <Table.Row className="cursor-pointer" onClick={() => setOpen(open === run.id ? null : run.id)}>
                    <Table.Cell>{formatDate(run.created_at)}</Table.Cell>
                    <Table.Cell>
                      {run.status === 'error' ? <StatusBadge color="red">Error: no se aplicó</StatusBadge> : <StatusBadge color="green">Aplicado</StatusBadge>}
                    </Table.Cell>
                    <Table.Cell>{run.status === 'error' ? run.error : summary(run)}</Table.Cell>
                  </Table.Row>
                  {open === run.id && run.changes.length > 0 && (
                    <Table.Row>
                      <td colSpan={3} className="bg-ui-bg-subtle px-6">
                        <ul className="flex flex-col gap-y-1 py-2">
                          {sortChanges(run.changes).map((c) => (
                            <li key={c.id} className="flex items-center gap-x-2">
                              <EventBadge field={c.field} />
                              <Text size="small">
                                <span className="font-medium">{c.product_title ?? c.code}</span>{' '}
                                <span className="text-ui-fg-subtle">({c.code})</span>: {describe(c)}
                              </Text>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </Table.Row>
                  )}
                </Fragment>
              ))}
            </Table.Body>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-x-2 px-6 py-3">
            <Text size="small" className="text-ui-fg-subtle">
              Página {page + 1} de {pages}
            </Text>
            <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Anterior
            </Button>
            <Button size="small" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        )}
      </Container>
    </div>
  )
}

const AgentCard = ({ status, onRefresh }: { status: Status; onRefresh: () => void }) => {
  const agent = status.agent
  const lastSeen = agent?.last_seen_at ? new Date(agent.last_seen_at) : null
  const interval = agent?.interval_minutes ?? 5
  const offlineMinutes = offlineAfterMinutes(interval)
  const offline = !lastSeen || Date.now() - lastSeen.getTime() > offlineMinutes * 60 * 1000

  let badge = <StatusBadge color="green">Conectado</StatusBadge>
  let message = `El conector está funcionando: precio y stock de Aronium se copian a la tienda cada ${interval} minutos.`
  if (!agent) {
    badge = <StatusBadge color="grey">Sin instalar</StatusBadge>
    message = 'El conector todavía no se comunicó con la tienda. Se instala en la computadora del local donde está Aronium.'
  } else if (offline) {
    badge = <StatusBadge color="red">Sin conexión</StatusBadge>
    message = `Hace más de ${offlineMinutes} minutos que el conector no se comunica. Revisá que la computadora del local esté encendida y con internet.`
  } else if (agent.last_error) {
    badge = <StatusBadge color="orange">Con errores</StatusBadge>
    message = agent.last_error
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-3">
          <Heading>Aronium</Heading>
          {badge}
        </div>
        <Button size="small" variant="secondary" onClick={onRefresh}>
          Actualizar
        </Button>
      </div>
      <div className="px-6 py-4">
        <Text className="text-ui-fg-subtle">{message}</Text>
      </div>
      {agent && (
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-4">
          <Fact label="Última conexión" value={lastSeen ? `${formatDate(lastSeen.toISOString())} (${ago(lastSeen)})` : '—'} />
          <Fact label="Productos en Aronium" value={agent.products_total.toLocaleString('es-PY')} />
          <Fact label="Sincroniza cada" value={`${interval} minutos`} />
          <Fact label="Computadora" value={agent.host ? `${agent.host}${agent.version ? ` · v${agent.version}` : ''}` : '—'} />
        </div>
      )}
    </Container>
  )
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text>{value}</Text>
  </div>
)

function summary(run: Run) {
  const modified = run.prices_updated + run.stock_updated + run.images_added
  const parts = [
    run.created && `${run.created} ${run.created === 1 ? 'alta' : 'altas'}`,
    run.removed && `${run.removed} ${run.removed === 1 ? 'baja' : 'bajas'}`,
    modified && `${modified} ${modified === 1 ? 'modificación' : 'modificaciones'}`,
  ].filter(Boolean)
  return parts.join(' · ') || 'Sin cambios'
}

const EVENT: Record<Change['field'], { label: string; color: 'green' | 'red' | 'blue' }> = {
  created: { label: 'Alta', color: 'green' },
  removed: { label: 'Baja', color: 'red' },
  price: { label: 'Modificación', color: 'blue' },
  stock: { label: 'Modificación', color: 'blue' },
  image: { label: 'Modificación', color: 'blue' },
}

const EventBadge = ({ field }: { field: Change['field'] }) => (
  <Badge color={EVENT[field].color} size="2xsmall" className="shrink-0">
    {EVENT[field].label}
  </Badge>
)

const FIELD_ORDER = { created: 0, removed: 1, price: 2, stock: 3, image: 4 }
function sortChanges(changes: Change[]) {
  return [...changes].sort((a, b) => FIELD_ORDER[a.field] - FIELD_ORDER[b.field] || a.code.localeCompare(b.code))
}

function describe(c: Change) {
  switch (c.field) {
    case 'created':
      return `producto nuevo en borrador (stock ${c.new_value})`
    case 'removed':
      return c.old_value === null || c.old_value === '0'
        ? 'borrado o desactivado en Aronium (ya estaba sin stock)'
        : `borrado o desactivado en Aronium: stock ${c.old_value} → 0`
    case 'price':
      return c.old_value === null ? `precio ${gs(c.new_value)}` : `precio ${gs(c.old_value)} → ${gs(c.new_value)}`
    case 'stock':
      return c.old_value === null ? `stock ${c.new_value}` : `stock ${c.old_value} → ${c.new_value}`
    case 'image':
      return 'foto agregada desde Aronium'
  }
}

function gs(value: string | null) {
  return value === null ? '—' : `Gs. ${Number(value).toLocaleString('es-PY')}`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })
}

function ago(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `hace ${hours} h`
  return `hace ${Math.round(hours / 24)} días`
}

export const config = defineRouteConfig({
  label: 'Aronium',
  icon: ArrowPath,
})

export default AroniumPage
