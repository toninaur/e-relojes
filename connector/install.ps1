# Instala el sincronizador como tarea programada de Windows que arranca con la
# computadora (aunque nadie inicie sesión) y se reinicia sola si se cae.
# Hay que correrlo en PowerShell "como administrador", en la carpeta del
# conector y con el usuario que usa Aronium.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1             instalar
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall  quitar
param([switch]$Uninstall)

$TaskName = 'Sincronizador Aronium - Tienda'
$OldTaskName = 'Conector Aronium - Tienda'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root 'config.json'

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) { Write-Error 'Abrí PowerShell como administrador (clic derecho → Ejecutar como administrador) y volvé a correrlo.'; exit 1 }

foreach ($name in @($TaskName, $OldTaskName)) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }
}
if ($Uninstall) { Write-Host "Sincronizador quitado."; exit 0 }

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error 'No se encontró Node.js. Instalá Node 22.13 o más nuevo (nodejs.org).'; exit 1 }
$Version = [version]((& $Node -v).TrimStart('v'))
if ($Version -lt [version]'22.13.0') { Write-Error "Node $Version es viejo: hace falta 22.13 o más nuevo."; exit 1 }
if (-not (Test-Path $ConfigPath)) { Write-Error 'Falta config.json (copiá config.example.json y completalo).'; exit 1 }

# La tarea corre con la cuenta del sistema, que tiene otra carpeta
# %LOCALAPPDATA%: se fija la ruta real de la base de Aronium de este usuario.
$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$Db = if ($Config.aroniumDb) { [Environment]::ExpandEnvironmentVariables(($Config.aroniumDb -replace '/', '\')) } else { Join-Path $env:LOCALAPPDATA 'Aronium\Data\pos.db' }
if (-not (Test-Path $Db)) { Write-Error "No se encontró la base de Aronium en $Db. Revisá aroniumDb en config.json."; exit 1 }
if ($Config.aroniumDb -ne $Db) {
  if ($Config.PSObject.Properties.Name -contains 'aroniumDb') { $Config.aroniumDb = $Db } else { $Config | Add-Member -NotePropertyName aroniumDb -NotePropertyValue $Db }
  # UTF-8 sin BOM (Node no lee bien el BOM de PowerShell 5).
  [IO.File]::WriteAllText($ConfigPath, ($Config | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Write-Host "config.json: aroniumDb = $Db"
}

# Aronium listo para las ventas web (forma de pago y envío): crea
# solo lo que falte, con copia de respaldo antes.
& $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\setup.mjs')
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo preparar Aronium: revisá el mensaje de arriba.'; exit 1 }

# Prueba antes de instalar: una pasada completa.
& $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\index.mjs') --once
if ($LASTEXITCODE -ne 0) { Write-Error 'La prueba falló: revisá connector.log.'; exit 1 }

$Action = New-ScheduledTaskAction -Execute $Node `
  -Argument "--disable-warning=ExperimentalWarning `"$Root\src\index.mjs`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Listo: '$TaskName' instalado. Arranca con Windows. Registro en $Root\connector.log"
