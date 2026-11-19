import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ArrowPath } from '@medusajs/icons'
import { Badge, Button, Container, Heading, Label, Select, StatusBadge, Switch, Table, Text, toast } from '@medusajs/ui'
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react'

// Panel → Aronium: el sincronizador con la caja del local, manejado desde acá.
// - Controles: encender/apagar cada sentido, frecuencia, "Sincronizar todo ahora".
// - Pedidos web → Aronium: avisos, estado de cada pedido (proforma, venta), Reintentar, "La cargué a mano".
// - Productos nuevos para completar y bitácora de eventos.
// - Ayuda: cómo funciona, instalación (con la clave del conector) y qué hacer
//   si algo anda mal.
// Ver docs/sincronizador-aronium.md.

type Change = {
  id: string
  code: string
  product_id: string | null
  product_title: string | null
  field: 'price' | 'stock' | 'created' | 'removed' | 'image' | 'content' | 'published' | 'hidden'
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
  /** Total de cambios de la pasada (se mandan los primeros). */
  changes_total?: number
  content_updated?: number
}
type Agent = {
  last_seen_at: string | null
  version: string | null
  host: string | null
  products_total: number
  last_error: string | null
  last_error_at: string | null
  interval_minutes: number
  has_token: boolean
  token_created_at: string | null
  sync_paused: boolean
  web_sales_paused: boolean
  desired_interval: number | null
  full_requested: boolean
  write_enabled: boolean | null
  write_blocked_reason: string | null
}
type Status = {
  agent: Agent | null
  drafts: { id: string; title: string; code: string; has_image: boolean; stock?: number; created_at: string; missing: string[] }[]
  drafts_count?: number
  drafts_in_stock?: number
  runs: Run[]
  runs_count: number
  web_sale_alerts?: WebSaleAlerts
}
type Settings = Partial<{ sync_paused: boolean; web_sales_paused: boolean; interval_minutes: number | null; full_requested: boolean }>

// Sin noticias del agente por más de dos pasadas (y 5 minutos de margen): algo pasa.
const offlineAfterMinutes = (interval: number) => interval * 2 + 5
const PAGE_SIZE = 20
const INTERVALS = [1, 2, 5, 10, 15, 30]

async function saveSettings(settings: Settings) {
  const res = await fetch('/admin/aronium/settings', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
}

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
      <ControlCard agent={status.agent} onChange={load} />
      <WebSaleAlertsBanner alerts={status.web_sale_alerts} />
      <WebSalesCard />

      {status.drafts.length > 0 && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Productos nuevos para completar ({status.drafts_count ?? status.drafts.length})</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Llegaron de Aronium y están ocultos. Categoría, marca, tipo y filtros se completan solos cuando se pueden deducir; lo que falta se
              carga en el producto ("Organizar" y "Filtros de la tienda"). Se publican solos cuando tienen foto, categoría y stock (en la
              próxima pasada, o hasta 30 minutos), salvo las mallas. Un producto que se queda sin stock se oculta y vuelve solo cuando tiene;
              uno que se pasó a borrador a mano no se vuelve a publicar solo.
            </Text>
            {status.drafts_count !== undefined && (
              <Text size="small" className="text-ui-fg-subtle mt-1">
                <b>{status.drafts_in_stock}</b> con stock en el local (primero en la lista) y {status.drafts_count - (status.drafts_in_stock ?? 0)} sin stock.
                {status.drafts_count > status.drafts.length && ` Se muestran los primeros ${status.drafts.length}; el resto está en Productos, filtrando por estado "Borrador".`}
              </Text>
            )}
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Producto</Table.HeaderCell>
                <Table.HeaderCell>Código</Table.HeaderCell>
                <Table.HeaderCell>Stock</Table.HeaderCell>
                <Table.HeaderCell>Falta</Table.HeaderCell>
                <Table.HeaderCell>Llegó</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {status.drafts.map((d) => (
                <Table.Row key={d.id} className="cursor-pointer" onClick={() => (window.location.href = `/app/products/${d.id}`)}>
                  <Table.Cell>{d.title}</Table.Cell>
                  <Table.Cell>{d.code}</Table.Cell>
                  <Table.Cell>{d.stock ?? '—'}</Table.Cell>
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
          <Heading level="h2">Bitácora de Aronium → tienda</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Cada sincronización que cambió algo en la tienda: <b>alta</b> (producto nuevo en Aronium), <b>baja</b> (producto borrado en Aronium:
            queda sin stock) y <b>modificación</b> (precio, stock, foto, descripción, filtros o código de barras). Tocá una fila para ver el
            detalle.
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
                        {(run.changes_total ?? 0) > run.changes.length && (
                          <Text size="small" className="pb-2 text-ui-fg-subtle">
                            … y {(run.changes_total ?? 0) - run.changes.length} más.
                          </Text>
                        )}
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

      <HelpCard agent={status.agent} onChange={load} />
    </div>
  )
}

// ---- Controles ---------------------------------------------------------------

const ControlCard = ({ agent, onChange }: { agent: Agent | null; onChange: () => void }) => {
  const [saving, setSaving] = useState<string | null>(null)
  const lastSeen = agent?.last_seen_at ? new Date(agent.last_seen_at) : null
  const interval = agent?.interval_minutes ?? 5
  const offlineMinutes = offlineAfterMinutes(interval)
  const offline = !lastSeen || Date.now() - lastSeen.getTime() > offlineMinutes * 60 * 1000

  let badge = <StatusBadge color="green">Conectado</StatusBadge>
  let message = `Funcionando: Aronium y la tienda se sincronizan ${interval === 1 ? 'cada minuto' : `cada ${interval} minutos`}.`
  if (!agent?.last_seen_at) {
    badge = <StatusBadge color="grey">Sin instalar</StatusBadge>
    message = 'El conector todavía no se comunicó con la tienda. Se instala una sola vez en la computadora del local donde está Aronium (ver "Instalación" abajo).'
  } else if (offline) {
    badge = <StatusBadge color="red">Sin conexión</StatusBadge>
    message = `Hace más de ${offlineMinutes} minutos que el conector no se comunica. Revisá que la computadora del local esté encendida y con internet.`
  } else if (agent.last_error) {
    badge = <StatusBadge color="orange">Con errores</StatusBadge>
    message = agent.last_error
  } else if (agent.sync_paused && agent.web_sales_paused) {
    badge = <StatusBadge color="grey">En pausa</StatusBadge>
    message = 'Las dos sincronizaciones están apagadas. Las ventas web quedan en espera y se registran cuando las vuelvas a encender.'
  }

  const change = async (key: string, settings: Settings, ok: string) => {
    setSaving(key)
    try {
      await saveSettings(settings)
      toast.success(ok)
      onChange()
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
    } finally {
      setSaving(null)
    }
  }

  const writeBlocked = agent?.write_enabled === false
  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-3">
          <Heading>Sincronizador con Aronium</Heading>
          {badge}
        </div>
        <Button size="small" variant="secondary" onClick={onChange}>
          Actualizar
        </Button>
      </div>
      <div className="px-6 py-4">
        <Text className="text-ui-fg-subtle">{message}</Text>
      </div>

      <div className="flex flex-col gap-y-4 px-6 py-4">
        <Toggle
          id="sync"
          label="Copiar stock, precios y productos de Aronium a la tienda"
          hint="Apagado: la tienda deja de actualizarse con lo que pasa en la caja. Al volver a encenderlo se pone al día con todo."
          checked={!agent?.sync_paused}
          disabled={saving !== null}
          onChange={(on) => change('sync', { sync_paused: !on }, on ? 'Sincronización encendida: se pone al día en la próxima pasada.' : 'Sincronización apagada.')}
        />
        <Toggle
          id="web"
          label="Registrar las ventas web en Aronium"
          hint={
            writeBlocked
              ? `No disponible: ${agent?.write_blocked_reason ?? 'el conector no puede escribir en esta base de Aronium.'}`
              : 'Apagado: los pedidos web quedan en espera (no se pierden) y se registran cuando lo vuelvas a encender.'
          }
          checked={!agent?.web_sales_paused}
          disabled={saving !== null}
          onChange={(on) => change('web', { web_sales_paused: !on }, on ? 'Ventas web encendidas.' : 'Ventas web en pausa: los pedidos quedan en espera.')}
        />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Label weight="plus">Frecuencia</Label>
            <Text size="small" className="text-ui-fg-subtle">
              Cada cuánto el conector revisa Aronium y los pedidos web. Recomendado: cada minuto.
            </Text>
          </div>
          <Select
            size="small"
            value={agent?.desired_interval ? String(agent.desired_interval) : 'pc'}
            onValueChange={(v) =>
              change('interval', { interval_minutes: v === 'pc' ? null : Number(v) }, 'Frecuencia guardada: el conector la toma en su próxima pasada.')
            }
            disabled={saving !== null}
          >
            <Select.Trigger className="w-56">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="pc">La de la computadora del local</Select.Item>
              {INTERVALS.map((n) => (
                <Select.Item key={n} value={String(n)}>
                  {n === 1 ? 'Cada minuto' : `Cada ${n} minutos`}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Label weight="plus">Sincronizar todo ahora</Label>
            <Text size="small" className="text-ui-fg-subtle">
              Revisa todos los productos de Aronium en la próxima pasada (normalmente se revisa solo lo que cambió, y todo cada 30 minutos).
            </Text>
          </div>
          <Button
            size="small"
            variant="secondary"
            isLoading={saving === 'full'}
            disabled={saving !== null || agent?.full_requested || agent?.sync_paused}
            onClick={() => change('full', { full_requested: true }, 'Pedido: se revisa todo en la próxima pasada.')}
          >
            {agent?.full_requested ? 'Pedido, en la próxima pasada' : 'Sincronizar todo'}
          </Button>
        </div>
      </div>

      {agent?.last_seen_at && (
        <div className="grid grid-cols-1 gap-4 px-6 py-4 sm:grid-cols-4">
          <Fact label="Última conexión" value={lastSeen ? `${formatDate(lastSeen.toISOString())} (${ago(lastSeen)})` : '—'} />
          <Fact label="Productos en Aronium" value={agent.products_total.toLocaleString('es-PY')} />
          <Fact label="Ventas web en Aronium" value={writeBlocked ? 'No disponible' : agent.web_sales_paused ? 'En pausa' : agent.write_enabled ? 'Activas' : '—'} />
          <Fact label="Computadora" value={agent.host ? `${agent.host}${agent.version ? ` · v${agent.version}` : ''}` : '—'} />
        </div>
      )}
    </Container>
  )
}

const Toggle = ({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) => (
  <div className="flex items-start justify-between gap-x-4">
    <div>
      <Label htmlFor={id} weight="plus">
        {label}
      </Label>
      <Text size="small" className="text-ui-fg-subtle">
        {hint}
      </Text>
    </div>
    <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </div>
)

// ---- Pedidos web ------------------------------------------------------------

type WebSale = {
  id: string
  order_id: string
  display_id: number
  tracking_code: string
  status: 'pending' | 'quoted' | 'invoiced' | 'failed' | 'cancel_pending' | 'cancelled' | 'skipped'
  paid: boolean
  aronium_quote_number: string | null
  aronium_number: string | null
  aronium_refund_number: string | null
  last_error: string | null
  warning: string | null
  created_at: string
  customer: string | null
  total: number | null
  items: number
}

type WebSaleAlerts = { agent_outdated: boolean; pending: number; quoted: number; failed: number; cancel_pending: number; warnings: number }

/** Aviso arriba de todo: pedidos web que esperan algo del local. */
const WebSaleAlertsBanner = ({ alerts }: { alerts?: WebSaleAlerts }) => {
  if (!alerts) return null
  const lines = [
    alerts.agent_outdated &&
      "El conector de la computadora del local es de una versión anterior y no registra pedidos web: actualizalo (copiá la carpeta connector nueva y corré install.ps1). Los pedidos esperan, no se pierden.",
    alerts.quoted > 0 &&
      `${alerts.quoted} ${alerts.quoted === 1 ? 'pedido web espera' : 'pedidos web esperan'} el pago: cuando el cliente pague, marcá la proforma "Pagado" en Aronium.`,
    alerts.pending > 0 && `${alerts.pending} ${alerts.pending === 1 ? 'pedido nuevo todavía no llegó' : 'pedidos nuevos todavía no llegaron'} a Aronium.`,
    alerts.failed > 0 && `${alerts.failed} con error: revisalos abajo.`,
    alerts.cancel_pending > 0 && `${alerts.cancel_pending} cancelados en la tienda, falta anularlos en Aronium.`,
    alerts.warnings > 0 && `${alerts.warnings} con avisos para revisar.`,
  ].filter(Boolean) as string[]
  if (!lines.length) return null
  const urgent = alerts.agent_outdated || alerts.failed > 0 || alerts.warnings > 0
  return (
    <Container className={`px-6 py-4 ${urgent ? 'bg-ui-tag-orange-bg' : 'bg-ui-tag-blue-bg'}`}>
      <Heading level="h2">Pedidos web</Heading>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {lines.map((l) => (
          <li key={l}>
            <Text size="small">{l}</Text>
          </li>
        ))}
      </ul>
    </Container>
  )
}

/** Pedidos web → Aronium: cada pedido de la tienda y su estado en la caja. */
const WebSalesCard = () => {
  const [data, setData] = useState<{ web_sales: WebSale[]; count: number } | null>(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/admin/aronium/web-sales?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, { credentials: 'include' })
    if (res.ok) setData(await res.json())
  }, [page])
  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load])

  const act = async (id: string, action: 'retry' | 'skip') => {
    if (action === 'skip' && !window.confirm('¿Ya lo cargaste en Aronium por tu cuenta? El sincronizador no lo va a registrar.')) return
    setBusy(`${id}:${action}`)
    try {
      const res = await fetch(`/admin/aronium/web-sales/${id}/${action}`, { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `Error ${res.status}`)
      toast.success(action === 'retry' ? 'Se vuelve a intentar en la próxima pasada del conector.' : 'Marcado como cargado a mano.')
      load()
    } catch (e) {
      toast.error(`No se pudo: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  if (!data) return null
  const pages = Math.max(1, Math.ceil(data.count / PAGE_SIZE))
  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Pedidos web → Aronium</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Cada pedido de la tienda llega solo a Aronium como <b>proforma</b> "No pagado", con el código de seguimiento en la nota interna (
          <b>Pedido web PW-…</b>). Cuando el cliente paga, marcá la proforma <b>"Pagado"</b> en Aronium: el sincronizador crea la venta, descuenta
          el stock y marca el pedido como pagado en la tienda. Si cancelás el pedido, la proforma queda anulada (o se registra la devolución, si ya
          era venta).
        </Text>
      </div>
      {data.web_sales.length === 0 ? (
        <Text className="px-6 py-4 text-ui-fg-subtle">Todavía no hubo pedidos web.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Pedido</Table.HeaderCell>
              <Table.HeaderCell>Cliente</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              <Table.HeaderCell>En Aronium</Table.HeaderCell>
              <Table.HeaderCell>Detalle</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.web_sales.map((w) => (
              <Table.Row key={w.id}>
                <Table.Cell>
                  <a className="text-ui-fg-interactive" href={`/app/orders/${w.order_id}`}>
                    #{w.display_id}
                  </a>
                  <Text size="xsmall" className="font-mono">
                    {w.tracking_code}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {formatDate(w.created_at)}
                  </Text>
                </Table.Cell>
                <Table.Cell>{w.customer ?? '—'}</Table.Cell>
                <Table.Cell>{w.total === null ? '—' : gs(String(w.total))}</Table.Cell>
                <Table.Cell>
                  <WebSaleStatus sale={w} />
                </Table.Cell>
                <Table.Cell>
                  <div className="flex flex-col gap-y-1">
                    {w.last_error && (
                      <Text size="small" className="text-ui-fg-error">
                        {w.last_error}
                      </Text>
                    )}
                    {w.warning && (
                      <Text size="small" className="text-ui-fg-subtle">
                        {w.warning}
                      </Text>
                    )}
                    {(w.status === 'failed' || w.status === 'pending') && (
                      <div className="flex flex-wrap gap-2">
                        {w.status === 'failed' && (
                          <Button size="small" variant="secondary" isLoading={busy === `${w.id}:retry`} onClick={() => act(w.id, 'retry')}>
                            Reintentar
                          </Button>
                        )}
                        <Button size="small" variant="transparent" isLoading={busy === `${w.id}:skip`} onClick={() => act(w.id, 'skip')}>
                          La cargué a mano
                        </Button>
                      </div>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
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
  )
}

const WebSaleStatus = ({ sale }: { sale: WebSale }) => {
  switch (sale.status) {
    case 'pending':
      return <StatusBadge color="grey">Pendiente</StatusBadge>
    case 'quoted':
      return (
        <div className="flex flex-col gap-y-0.5">
          <StatusBadge color="orange">Proforma, esperando pago</StatusBadge>
          {sale.aronium_quote_number && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {sale.aronium_quote_number}
            </Text>
          )}
        </div>
      )
    case 'invoiced':
      return (
        <div className="flex flex-col gap-y-0.5">
          <StatusBadge color="green">Vendido {sale.aronium_number ?? ''}</StatusBadge>
          {sale.aronium_quote_number && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              Proforma {sale.aronium_quote_number}
            </Text>
          )}
        </div>
      )
    case 'failed':
      return <StatusBadge color="red">Con error</StatusBadge>
    case 'cancel_pending':
      return <StatusBadge color="orange">{sale.aronium_number ? 'Cancelado, falta la devolución' : 'Cancelado, falta anular la proforma'}</StatusBadge>
    case 'cancelled':
      return (
        <StatusBadge color="grey">
          {sale.aronium_refund_number
            ? `Cancelado (devolución ${sale.aronium_refund_number})`
            : sale.aronium_quote_number
              ? 'Cancelado (proforma anulada)'
              : 'Cancelado'}
        </StatusBadge>
      )
    case 'skipped':
      return <StatusBadge color="blue">Cargado a mano</StatusBadge>
  }
}

// ---- Ayuda e instalación ----------------------------------------------------

const HelpCard = ({ agent, onChange }: { agent: Agent | null; onChange: () => void }) => (
  <Container className="divide-y p-0">
    <div className="px-6 py-4">
      <Heading level="h2">Ayuda e instalación</Heading>
      <Text size="small" className="text-ui-fg-subtle">
        Tocá cada tema para abrirlo.
      </Text>
    </div>
    <Section title="Cómo funciona">
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Aronium → tienda.</b> Cada minuto, el conector mira Aronium y copia a la tienda el stock, los precios, los productos nuevos o
          borrados, la foto, la descripción y el código de barras. Una venta en la caja, una compra o un recuento se ven en la tienda en menos de
          un minuto.
        </li>
        <li>
          <b>Tienda → Aronium.</b> Cada pedido de la tienda llega solo a Aronium como <b>proforma</b> "No pagado", con el cliente y la nota
          interna "Pedido web PW-…" (el código de seguimiento). La proforma no descuenta stock; en la tienda el producto queda reservado.
        </li>
        <li>
          <b>El stock nunca se descuenta dos veces</b>, y el cliente de la tienda siempre ve lo que realmente hay.
        </li>
        <li>
          <b>Cuando el cliente paga</b>, marcá la proforma <b>"Pagado"</b> en Aronium. En menos de un minuto el conector crea la venta (con
          el pago y el stock descontado), anota "Facturado" en la proforma y marca el pedido como pagado en la tienda. Si cancelás el pedido,
          la proforma queda anulada.
        </li>
      </ul>
    </Section>
    <Section title="Cargar productos desde Aronium (descripción con filtros)">
      <Text size="small" className="mb-2">
        En la descripción del producto en Aronium se pueden agregar estas líneas, y la tienda las usa para los filtros y las características:
      </Text>
      <pre className="rounded-md bg-ui-bg-subtle p-3 text-xs">
        {'Reloj automático con cristal de zafiro.\nColor: Negro, Dorado\nMalla: Acero\nCaracterísticas: 40 mm | Zafiro | Sumergible 10 BAR'}
      </pre>
      <Text size="small" className="mt-2">
        Si no se escriben, color y malla se deducen del nombre y la descripción. Lo que edites en la ficha del producto en este panel ya no se
        pisa; el botón "Tomar de Aronium" de cada producto vuelve a copiarlo.
      </Text>
    </Section>
    <Section title="Instalación en la computadora del local (una sola vez)">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Instalar Node.js (versión LTS) desde nodejs.org.</li>
        <li>
          Copiar la carpeta <code>connector</code> a la computadora, por ejemplo en <code>C:\SincronizadorAronium</code>.
        </li>
        <li>
          Generar la clave del conector acá abajo y pegarla en <code>config.json</code> (copiado de <code>config.example.json</code>), en{' '}
          <code>"token"</code>. En <code>"storeUrl"</code> va la dirección de este panel, sin <code>/app</code>.
        </li>
        <li>
          Abrir PowerShell <b>como administrador</b> en esa carpeta y correr{' '}
          <code>powershell -ExecutionPolicy Bypass -File install.ps1</code>.
        </li>
      </ol>
      <Text size="small" className="mt-2">
        El instalador prepara Aronium solo (forma de pago "Transferencia" y el envío como servicio, con copia de respaldo antes), hace una prueba
        y deja el conector andando con Windows, aunque nadie inicie sesión. Desde ese momento todo se maneja desde esta página.
      </Text>
      <TokenSection agent={agent} onDone={onChange} />
    </Section>
    <Section title="Si algo anda mal">
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Qué pasa</Table.HeaderCell>
            <Table.HeaderCell>Qué hacer</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {TROUBLESHOOTING.map(([problem, fix]) => (
            <Table.Row key={problem}>
              <Table.Cell className="align-top">{problem}</Table.Cell>
              <Table.Cell className="whitespace-normal">{fix}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Section>
  </Container>
)

const TROUBLESHOOTING: [string, string][] = [
  ['"Sin conexión"', 'La computadora del local está apagada o sin internet. Al volver, el conector se pone al día solo; no se pierde nada.'],
  [
    'Un pedido web "Con error"',
    'Leé el detalle: casi siempre es un producto que no tiene el mismo código en Aronium y en la tienda (SKU). Corregilo y tocá "Reintentar". Si ya lo cargaste en Aronium por tu cuenta, tocá "La cargué a mano".',
  ],
  [
    'Marqué la proforma "Pagado" y no pasa nada',
    'Fijate que la proforma tenga en la nota interna "Pedido web PW-…": las proformas hechas a mano no se tocan. Si el pedido muestra un aviso, leelo: por ejemplo, falta la forma de pago en Aronium o la proforma se borró.',
  ],
  ['Ventas web "No disponible"', 'Aronium se actualizó y cambió su base de datos. El stock y los precios se siguen copiando; para volver a registrar pedidos web hay que actualizar el conector.'],
  ['Un producto no se actualiza', 'Revisá que tenga el mismo código en Aronium y en la tienda. Si cambiaste algo a mano en la ficha y querés lo de Aronium, usá "Tomar de Aronium".'],
  ['La clave dejó de andar', 'Generá una nueva acá ("Instalación") y pegala en config.json de la computadora del local.'],
]

const Section = ({ title, children }: { title: string; children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-6 py-3">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <Text weight="plus">{title}</Text>
        <Text size="small" className="text-ui-fg-subtle">
          {open ? 'Cerrar' : 'Ver'}
        </Text>
      </button>
      {open && <div className="pt-3 text-ui-fg-base txt-small">{children}</div>}
    </div>
  )
}

/** Clave del conector: se genera acá y se pega en config.json de la PC del local. */
const TokenSection = ({ agent, onDone }: { agent: Agent | null; onDone: () => void }) => {
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const generate = async () => {
    if (agent?.has_token && !window.confirm('La clave actual deja de funcionar y el conector del local se desconecta hasta que pegues la nueva. ¿Generar una nueva?')) return
    setBusy(true)
    try {
      const res = await fetch('/admin/aronium/token', { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setToken((await res.json()).token)
      onDone()
    } catch (e) {
      toast.error(`No se pudo generar la clave: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 flex flex-col gap-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-x-4">
        <div>
          <Text weight="plus">Clave del conector</Text>
          <Text size="small" className="text-ui-fg-subtle">
            {agent?.has_token
              ? `Creada el ${agent.token_created_at ? formatDate(agent.token_created_at) : '—'}. Solo sirve para sincronizar: no da acceso al panel.`
              : 'Todavía no se generó.'}
          </Text>
        </div>
        <Button size="small" variant="secondary" isLoading={busy} onClick={generate}>
          {agent?.has_token ? 'Generar una nueva' : 'Generar clave'}
        </Button>
      </div>
      {token && (
        <div className="flex flex-col gap-y-2 rounded-md bg-ui-bg-subtle p-3">
          <Text size="small">
            Copiala ahora y pegala en <code>config.json</code> del conector, en <code>"token"</code>. Por seguridad no se vuelve a mostrar.
          </Text>
          <div className="flex items-center gap-x-2">
            <code className="flex-1 break-all rounded bg-ui-bg-base px-2 py-1 text-xs">{token}</code>
            <Button size="small" variant="secondary" onClick={() => navigator.clipboard.writeText(token).then(() => toast.success('Clave copiada'))}>
              Copiar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Utilidades ---------------------------------------------------------------

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text>{value}</Text>
  </div>
)

function summary(run: Run) {
  const content = run.content_updated ?? run.changes.filter((c) => c.field === 'content').length
  const published = run.changes.filter((c) => c.field === 'published').length
  const hidden = run.changes.filter((c) => c.field === 'hidden').length
  const modified = run.prices_updated + run.stock_updated + run.images_added + content
  const parts = [
    run.created && `${run.created} ${run.created === 1 ? 'alta' : 'altas'}`,
    published && `${published} ${published === 1 ? 'publicado' : 'publicados'}`,
    hidden && `${hidden} ${hidden === 1 ? 'oculto' : 'ocultos'} sin stock`,
    run.removed && `${run.removed} ${run.removed === 1 ? 'baja' : 'bajas'}`,
    modified && `${modified} ${modified === 1 ? 'modificación' : 'modificaciones'}`,
  ].filter(Boolean)
  return parts.join(' · ') || 'Sin cambios'
}

const EVENT: Record<Change['field'], { label: string; color: 'green' | 'red' | 'blue' }> = {
  created: { label: 'Alta', color: 'green' },
  published: { label: 'Publicado', color: 'green' },
  hidden: { label: 'Oculto', color: 'red' },
  removed: { label: 'Baja', color: 'red' },
  price: { label: 'Modificación', color: 'blue' },
  stock: { label: 'Modificación', color: 'blue' },
  image: { label: 'Modificación', color: 'blue' },
  content: { label: 'Modificación', color: 'blue' },
}

const EventBadge = ({ field }: { field: Change['field'] }) => (
  <Badge color={EVENT[field].color} size="2xsmall" className="shrink-0">
    {EVENT[field].label}
  </Badge>
)

const FIELD_ORDER = { created: 0, published: 1, hidden: 2, removed: 3, price: 4, stock: 5, image: 6, content: 7 }
function sortChanges(changes: Change[]) {
  return [...changes].sort((a, b) => FIELD_ORDER[a.field] - FIELD_ORDER[b.field] || a.code.localeCompare(b.code))
}

function describe(c: Change) {
  switch (c.field) {
    case 'created':
      return `producto nuevo en borrador (stock ${c.new_value})`
    case 'published':
      return 'publicado en la tienda (ya tiene foto, categoría y stock)'
    case 'hidden':
      return 'oculto: se quedó sin stock (vuelve solo cuando tenga)'
    case 'removed':
      return c.old_value === null || c.old_value === '0'
        ? 'borrado en Aronium (ya estaba sin stock)'
        : `borrado en Aronium: stock ${c.old_value} → 0`
    case 'price':
      return c.old_value === null ? `precio ${gs(c.new_value)}` : `precio ${gs(c.old_value)} → ${gs(c.new_value)}`
    case 'stock':
      return c.old_value === null ? `stock ${c.new_value}` : `stock ${c.old_value} → ${c.new_value}`
    case 'image':
      return 'foto copiada de Aronium'
    case 'content':
      return `copiado de Aronium: ${c.new_value}`
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
