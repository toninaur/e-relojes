# Avisos de pedidos web en la PC del local.
#
# Ícono junto al reloj de Windows que avisa cuando entra un pedido de la
# tienda ("Pedido web PW-1042-K7 — Juan Pérez — Gs. 1.250.000") y muestra los
# que esperan que la cajera marque la proforma "Pagado" en Aronium.
#
# Lo instala install.ps1: arranca solo al iniciar sesión. Lee avisos.json, que
# escribe el sincronizador (el sincronizador corre como tarea del sistema y
# Windows no lo deja mostrar nada en pantalla). No toca Aronium ni la tienda.
#
#   powershell -ExecutionPolicy Bypass -File avisos.ps1

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AlertsPath = Join-Path $Root 'avisos.json'
$ConfigPath = Join-Path $Root 'config.json'
$SeenDir = Join-Path $env:APPDATA 'SincronizadorAronium'
$SeenPath = Join-Path $SeenDir 'avisos-vistos.txt'
$StaleMinutes = 10

# Uno solo por sesión.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\AvisosPedidosWebAronium', [ref]$created)
if (-not $created) { exit 0 }

$PanelUrl = $null
try {
  $cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.storeUrl) { $PanelUrl = ($cfg.storeUrl.TrimEnd('/')) + '/app/aronium' }
} catch {}

# Pedidos ya avisados (para no repetir el aviso al reiniciar la PC).
$Seen = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $SeenPath) { Get-Content $SeenPath -Encoding UTF8 | ForEach-Object { [void]$Seen.Add($_) } }
function Save-Seen {
  New-Item -ItemType Directory -Force $SeenDir | Out-Null
  # Solo los últimos 500.
  @($Seen) | Select-Object -Last 500 | Set-Content $SeenPath -Encoding UTF8
}

function Format-Money($amount, $currency) {
  if ($null -eq $amount) { return '' }
  $n = [math]::Round([double]$amount)
  $text = $n.ToString('N0', [Globalization.CultureInfo]::GetCultureInfo('es-PY'))
  if ($currency -and $currency -ne 'PYG') { return "$currency $text" }
  return "Gs. $text"
}

function Read-Alerts {
  if (-not (Test-Path $AlertsPath)) { return $null }
  try { return Get-Content $AlertsPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

# ---- Ícono y menú -----------------------------------------------------------

$Icon = New-Object System.Windows.Forms.NotifyIcon
$Icon.Icon = [System.Drawing.SystemIcons]::Information
$Icon.Text = 'Pedidos web: cargando…'
$Icon.Visible = $true

$Menu = New-Object System.Windows.Forms.ContextMenuStrip
$ItemList = $Menu.Items.Add('Ver pedidos que esperan pago')
$ItemPanel = $Menu.Items.Add('Abrir el panel de la tienda')
$ItemPanel.Enabled = [bool]$PanelUrl
[void]$Menu.Items.Add('-')
$ItemExit = $Menu.Items.Add('Cerrar avisos')
$Icon.ContextMenuStrip = $Menu

$script:Current = $null

function Show-List {
  $data = $script:Current
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Pedidos web'
  $form.Size = New-Object System.Drawing.Size(760, 420)
  $form.StartPosition = 'CenterScreen'
  $form.TopMost = $true

  $label = New-Object System.Windows.Forms.Label
  $label.Dock = 'Top'
  $label.Height = 44
  $label.Padding = New-Object System.Windows.Forms.Padding(10, 8, 10, 0)
  $label.Text = 'Cuando el cliente pague, buscá la proforma en Aronium (por el código PW-…) y marcala "Pagado": la venta se crea sola.'

  $list = New-Object System.Windows.Forms.ListView
  $list.View = 'Details'
  $list.FullRowSelect = $true
  $list.Dock = 'Fill'
  foreach ($col in @(@('Código', 120), @('Cliente', 220), @('Total', 120), @('Proforma', 120), @('Fecha', 140))) {
    [void]$list.Columns.Add($col[0], $col[1])
  }
  if ($data) {
    foreach ($p in @($data.pending)) {
      $date = ''
      if ($p.created_at) { try { $date = ([datetime]$p.created_at).ToLocalTime().ToString('dd/MM HH:mm') } catch {} }
      $row = New-Object System.Windows.Forms.ListViewItem($p.code)
      [void]$row.SubItems.Add([string]$p.customer)
      [void]$row.SubItems.Add((Format-Money $p.total $p.currency))
      [void]$row.SubItems.Add([string]$p.quote)
      [void]$row.SubItems.Add($date)
      [void]$list.Items.Add($row)
    }
    foreach ($e in @($data.errors)) {
      $row = New-Object System.Windows.Forms.ListViewItem($e.code)
      [void]$row.SubItems.Add("CON ERROR: $($e.message)")
      $row.ForeColor = [System.Drawing.Color]::DarkRed
      [void]$list.Items.Add($row)
    }
  }
  if ($list.Items.Count -eq 0) { $label.Text = 'No hay pedidos web esperando pago.' }
  if ($data -and $data.blocked) { $label.Text = "PEDIDOS WEB EN PAUSA: $($data.blocked)" ; $label.ForeColor = [System.Drawing.Color]::DarkRed }

  $form.Controls.Add($list)
  $form.Controls.Add($label)
  [void]$form.ShowDialog()
}

$ItemList.add_Click({ Show-List })
$Icon.add_DoubleClick({ Show-List })
$Icon.add_BalloonTipClicked({ Show-List })
$ItemPanel.add_Click({ if ($PanelUrl) { Start-Process $PanelUrl } })
$ItemExit.add_Click({
  $Icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

# ---- Revisión periódica -----------------------------------------------------

$script:StaleWarned = $false

function Update-Alerts {
  $data = Read-Alerts
  $script:Current = $data
  if (-not $data) {
    $Icon.Icon = [System.Drawing.SystemIcons]::Information
    $Icon.Text = 'Pedidos web: sin datos del sincronizador'
    return
  }

  $pending = @($data.pending)
  $errors = @($data.errors)

  # ¿El sincronizador sigue andando?
  $stale = $false
  # Con la frecuencia del panel en 30 minutos, 10 minutos sin novedades es normal.
  $limit = $StaleMinutes
  if ($data.interval_minutes) { $limit = [math]::Max($StaleMinutes, 2 * [double]$data.interval_minutes + 2) }
  try { $stale = ((Get-Date).ToUniversalTime() - ([datetime]$data.updated_at).ToUniversalTime()).TotalMinutes -gt $limit } catch {}
  if ($stale) {
    $Icon.Icon = [System.Drawing.SystemIcons]::Warning
    $Icon.Text = 'Sincronizador sin responder: revisá la PC o internet'
    if (-not $script:StaleWarned) {
      $Icon.ShowBalloonTip(10000, 'Sincronizador sin responder', "Hace más de $limit minutos que no revisa los pedidos web. Revisá que haya internet.", 'Warning')
      $script:StaleWarned = $true
    }
    return
  }
  $script:StaleWarned = $false

  # El sincronizador anda pero no puede registrar pedidos (reloj de la PC mal,
  # Aronium actualizado): se dice por qué, una vez.
  if ($data.blocked) {
    $Icon.Icon = [System.Drawing.SystemIcons]::Warning
    $Icon.Text = 'Pedidos web en pausa: abrí los avisos para ver por qué'
    if ($script:BlockedWarned -ne $data.blocked) {
      $Icon.ShowBalloonTip(15000, 'Pedidos web en pausa', [string]$data.blocked, 'Warning')
      $script:BlockedWarned = $data.blocked
    }
  } else {
    $script:BlockedWarned = $null
  }

  $Icon.Icon = if ($errors.Count -or $data.blocked) { [System.Drawing.SystemIcons]::Warning } else { [System.Drawing.SystemIcons]::Information }
  $text = if ($pending.Count -eq 1) { 'Pedidos web: 1 esperando pago' } else { "Pedidos web: $($pending.Count) esperando pago" }
  if ($errors.Count) { $text += ", $($errors.Count) con error" }
  if ($data.blocked) { $text = "EN PAUSA. $text" }
  $Icon.Text = $text.Substring(0, [math]::Min(63, $text.Length))

  # Avisos nuevos.
  $new = @($pending | Where-Object { $_.code -and -not $Seen.Contains($_.code) })
  $newErrors = @($errors | Where-Object { $_.code -and -not $Seen.Contains("error:$($_.code)") })
  if ($new.Count -eq 1) {
    $p = $new[0]
    $Icon.ShowBalloonTip(15000, "Pedido web $($p.code)", "$($p.customer) — $(Format-Money $p.total $p.currency)`nProforma $($p.quote) en Aronium: marcala ""Pagado"" cuando cobres.", 'Info')
  } elseif ($new.Count -gt 1) {
    $Icon.ShowBalloonTip(15000, "$($new.Count) pedidos web nuevos", (($new | ForEach-Object { "$($_.code) — $($_.customer)" }) -join "`n"), 'Info')
  } elseif ($newErrors.Count) {
    $e = $newErrors[0]
    $Icon.ShowBalloonTip(15000, "Pedido web $($e.code) con error", [string]$e.message, 'Warning')
  }
  if ($new.Count -or $newErrors.Count) {
    foreach ($p in $new) { [void]$Seen.Add($p.code) }
    foreach ($e in $newErrors) { [void]$Seen.Add("error:$($e.code)") }
    Save-Seen
  }
}

$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = 15000
$Timer.add_Tick({ Update-Alerts })
$Timer.Start()
Update-Alerts

[System.Windows.Forms.Application]::Run()
$Icon.Dispose()
$mutex.ReleaseMutex()
