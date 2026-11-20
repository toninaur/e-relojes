import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ShoppingBag } from '@medusajs/icons'
import { Button, Container, Heading, Input, Label, Select, StatusBadge, Switch, Table, Text, toast } from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'

// Panel → ContiMarket: el conector tienda → ContiMarket, aparte del de
// Aronium (que es prioritario). Encender, pausar, qué productos van, precio
// especial, regla de la última unidad, "Sincronizar todo ahora", productos que
// ContiMarket rechazó y las últimas pasadas. Las credenciales no van acá:
// son variables de Railway (CONTIMARKET_URL, CONTIMARKET_USER, CONTIMARKET_PASSWORD).

type Settings = {
  enabled: boolean
  paused: boolean
  products: 'all' | 'tagged'
  price_rule: 'same' | 'offer' | 'percent'
  price_percent: number
  min_stock: number
  full_requested: boolean
  last_run_at: string | null
  last_full_at: string | null
  last_error: string | null
  last_error_at: string | null
}
type Status = {
  has_credentials: boolean
  settings: Settings
  products_ok: number
  products_rejected: number
  rejected: { code: string; title: string | null; product_id: string | null; error: string | null; updated_at: string }[]
  runs: { id: string; created_at: string; status: 'ok' | 'error'; full: boolean; reason: string | null; sent: number; rejected: number; error: string | null }[]
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const ContimarketPage = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState('')

  const load = useCallback(async () => {
    try {
      const s = await api<Status>('/admin/contimarket/status')
      setStatus(s)
      setPercent(String(s.settings.price_percent || ''))
    } catch (e) {
      toast.error(`No se pudo cargar: ${(e as Error).message}`)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const save = async (patch: Partial<Settings>, ok = 'Guardado. Se aplica en la próxima pasada.') => {
    setBusy(true)
    try {
      setStatus(await api<Status>('/admin/contimarket/settings', { method: 'POST', body: JSON.stringify(patch) }))
      toast.success(ok)
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const syncAll = async () => {
    setBusy(true)
    try {
      setStatus(await api<Status>('/admin/contimarket/sync', { method: 'POST' }))
      toast.success('Se manda todo a ContiMarket en unos segundos.')
    } catch (e) {
      toast.error(`No se pudo: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <Container className="p-6">
        <Text>Cargando…</Text>
      </Container>
    )
  }
  const s = status.settings
  const state = !status.has_credentials
    ? { color: 'red' as const, text: 'Faltan las credenciales' }
    : !s.enabled
      ? { color: 'grey' as const, text: 'Apagado' }
      : s.paused
        ? { color: 'orange' as const, text: 'En pausa' }
        : s.last_error
          ? { color: 'red' as const, text: 'Con error' }
          : { color: 'green' as const, text: 'Funcionando' }

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <Heading level="h1">ContiMarket</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Manda a ContiMarket los productos de la tienda con el mismo precio y stock. Aparte de Aronium: si ContiMarket falla, la tienda y la caja siguen igual.
            </Text>
          </div>
          <StatusBadge color={state.color}>{state.text}</StatusBadge>
        </div>
        {!status.has_credentials && (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-error">
              Para conectarse hacen falta el email y la contraseña del panel de ContiMarket del local, cargados en Railway (servicio backend → Variables): CONTIMARKET_URL, CONTIMARKET_USER y CONTIMARKET_PASSWORD. No se guardan en el panel.
            </Text>
          </div>
        )}
        {s.last_error && (
          <div className="px-6 py-4">
            <Text size="small" className="text-ui-fg-error">
              {s.last_error} ({formatDate(s.last_error_at)})
            </Text>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 px-6 py-4 md:grid-cols-4">
          <Fact label="Productos en ContiMarket" value={String(status.products_ok)} />
          <Fact label="Rechazados" value={String(status.products_rejected)} />
          <Fact label="Último envío" value={formatDate(s.last_run_at)} />
          <Fact label="Último envío completo" value={formatDate(s.last_full_at)} />
        </div>
      </Container>

      <Container className="flex flex-col gap-y-5 px-6 py-4">
        <Heading level="h2">Controles</Heading>
        <Toggle id="cm-enabled" label="Mandar productos a ContiMarket" hint="Apagado no manda nada." checked={s.enabled} disabled={busy} onChange={(v) => save({ enabled: v }, v ? 'Encendido.' : 'Apagado.')} />
        <Toggle id="cm-paused" label="Pausa" hint="En pausa no manda nada; al reanudar manda lo que cambió." checked={s.paused} disabled={busy || !s.enabled} onChange={(v) => save({ paused: v }, v ? 'En pausa.' : 'Reanudado.')} />
        <Row label="Qué productos van" hint='Todos los publicados en la web, o solo los que tienen la etiqueta "contimarket".'>
          <Select value={s.products} onValueChange={(v) => save({ products: v as Settings['products'] })} disabled={busy}>
            <Select.Trigger className="w-64">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">Todos los publicados</Select.Item>
              <Select.Item value="tagged">Solo con la etiqueta "contimarket"</Select.Item>
            </Select.Content>
          </Select>
        </Row>
        <Row label="Precio especial en ContiMarket" hint="El precio de catálogo es siempre el normal de Aronium.">
          <div className="flex items-center gap-x-2">
            <Select value={s.price_rule} onValueChange={(v) => save({ price_rule: v as Settings['price_rule'] })} disabled={busy}>
              <Select.Trigger className="w-64">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="same">El mismo precio</Select.Item>
                <Select.Item value="offer">El de oferta de la web</Select.Item>
                <Select.Item value="percent">Un porcentaje menos</Select.Item>
              </Select.Content>
            </Select>
            {s.price_rule === 'percent' && (
              <>
                <Input className="w-20" type="number" min={0} max={90} value={percent} onChange={(e) => setPercent(e.target.value)} onBlur={() => save({ price_percent: Math.min(90, Math.max(0, Number(percent) || 0)) })} />
                <Text size="small">%</Text>
              </>
            )}
          </div>
        </Row>
        <Row label="Última unidad" hint="ContiMarket no avisa sus ventas: con 2 o más, la última unidad queda solo para la web y el local.">
          <Select value={String(s.min_stock)} onValueChange={(v) => save({ min_stock: Number(v) })} disabled={busy}>
            <Select.Trigger className="w-64">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="1">Publicar desde 1 unidad</Select.Item>
              <Select.Item value="2">Publicar desde 2 unidades</Select.Item>
              <Select.Item value="3">Publicar desde 3 unidades</Select.Item>
            </Select.Content>
          </Select>
        </Row>
        <div>
          <Button size="small" variant="secondary" isLoading={busy} disabled={!s.enabled || s.paused || !status.has_credentials} onClick={syncAll}>
            Sincronizar todo ahora
          </Button>
        </div>
      </Container>

      {status.rejected.length > 0 && (
        <Container className="p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Rechazados por ContiMarket</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Se vuelven a mandar solos cuando el producto cambie o en el envío completo del día.
            </Text>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Código</Table.HeaderCell>
                <Table.HeaderCell>Producto</Table.HeaderCell>
                <Table.HeaderCell>Motivo</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {status.rejected.map((r) => (
                <Table.Row key={r.code}>
                  <Table.Cell>{r.code}</Table.Cell>
                  <Table.Cell>{r.product_id ? <a href={`/app/products/${r.product_id}`}>{r.title ?? r.code}</a> : (r.title ?? '—')}</Table.Cell>
                  <Table.Cell>{r.error ?? '—'}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Container>
      )}

      <Container className="p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Últimos envíos</Heading>
        </div>
        {status.runs.length === 0 ? (
          <Text size="small" className="px-6 pb-4 text-ui-fg-subtle">
            Todavía no se mandó nada.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Fecha</Table.HeaderCell>
                <Table.HeaderCell>Tipo</Table.HeaderCell>
                <Table.HeaderCell>Enviados</Table.HeaderCell>
                <Table.HeaderCell>Rechazados</Table.HeaderCell>
                <Table.HeaderCell>Detalle</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {status.runs.map((r) => (
                <Table.Row key={r.id}>
                  <Table.Cell>{formatDate(r.created_at)}</Table.Cell>
                  <Table.Cell>{r.full ? 'Completo' : 'Cambios'}</Table.Cell>
                  <Table.Cell>{r.sent}</Table.Cell>
                  <Table.Cell>{r.rejected}</Table.Cell>
                  <Table.Cell>{r.status === 'error' ? <span className="text-ui-fg-error">{r.error}</span> : (r.reason ?? '')}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div>
    <Text size="small" className="text-ui-fg-subtle">
      {label}
    </Text>
    <Text weight="plus">{value}</Text>
  </div>
)

const Row = ({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-x-4">
    <div>
      <Label weight="plus">{label}</Label>
      <Text size="small" className="text-ui-fg-subtle">
        {hint}
      </Text>
    </div>
    {children}
  </div>
)

const Toggle = ({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) => (
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

export const config = defineRouteConfig({
  label: 'ContiMarket',
  icon: ShoppingBag,
})

export default ContimarketPage
