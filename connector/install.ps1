# Instala el sincronizador como tarea programada de Windows que arranca con la
# computadora (aunque nadie inicie sesión) y se reinicia sola si se cae.
# Hay que correrlo en PowerShell "como administrador", en la carpeta del
# conector y con el usuario que usa Aronium.
#
# También instala el programa de la PC (Sincronizador.exe, carpeta panel\):
# ícono junto al reloj con el estado, la bitácora, los pedidos web y la
# configuración. Se abre solo al iniciar sesión y desde el menú Inicio o el
# escritorio ("Sincronizador Aronium"). Reemplaza al viejo avisos.ps1.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1             instalar
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Prueba     solo revisar (no instala ni toca nada)
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall  quitar
param([switch]$Uninstall, [switch]$Prueba)

$TaskName = 'Sincronizador Aronium - Tienda'
$AlertsTaskName = 'Avisos pedidos web - Tienda'  # la del viejo avisos.ps1 (lo reemplaza Sincronizador.exe): se quita
$OldTaskName = 'Conector Aronium - Tienda'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root 'config.json'
$Exe = Join-Path $Root 'Sincronizador.exe'
$ShortcutName = 'Sincronizador Aronium.lnk'
$Shortcuts = @(
  @{ Path = Join-Path ([Environment]::GetFolderPath('CommonStartup')) $ShortcutName; Args = '--oculto' },
  @{ Path = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) $ShortcutName; Args = '' },
  @{ Path = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) $ShortcutName; Args = '' }
)
# Grupo "Usuarios" por SID (sirve con Windows en cualquier idioma).
$UsersSid = 'S-1-5-32-545'

# Cierra el programa de la PC y el viejo avisos.ps1 (para reemplazarlos o quitarlos).
function Stop-Programa {
  Get-Process Sincronizador -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe } | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'avisos\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# -Prueba: revisa todo (Node, config.json, Aronium, la tienda, el reloj) sin
# instalar ni escribir nada. No hace falta ser administrador.
if ($Prueba) {
  $Node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $Node) { Write-Error 'No se encontró Node.js. Instalá Node 22.13 o más nuevo (nodejs.org, versión LTS).'; exit 1 }
  & $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\check.mjs')
  exit $LASTEXITCODE
}

if (-not $IsAdmin) { Write-Error 'Abrí PowerShell como administrador (clic derecho → Ejecutar como administrador) y volvé a correrlo.'; exit 1 }

foreach ($name in @($TaskName, $OldTaskName, $AlertsTaskName)) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }
}
Stop-Programa
if ($Uninstall) {
  foreach ($s in $Shortcuts) { Remove-Item $s.Path -ErrorAction SilentlyContinue }
  Write-Host "Sincronizador quitado (la tarea, el programa de la PC y sus accesos directos). La carpeta queda como está."
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error 'No se encontró Node.js. Instalá Node 22.13 o más nuevo (nodejs.org).'; exit 1 }
$Version = [version]((& $Node -v).TrimStart('v'))
if ($Version -lt [version]'22.13.0') { Write-Error "Node $Version es viejo: hace falta 22.13 o más nuevo."; exit 1 }
if (-not (Test-Path $ConfigPath)) { Write-Error 'Falta config.json (copiá config.example.json y completalo).'; exit 1 }
# OneDrive (Escritorio, Documentos) bloquea los archivos mientras sincroniza.
if ($Root -match 'OneDrive') { Write-Warning "La carpeta está dentro de OneDrive ($Root). Conviene moverla a C:\SincronizadorAronium y volver a instalar." }

# La tarea corre con la cuenta del sistema, que tiene otra carpeta
# %LOCALAPPDATA%: se fija la ruta real de la base de Aronium de este usuario.
# -Encoding UTF8: sin esto PowerShell 5 lee "Itaú" como "ItaÃº" y, al guardar
# abajo, la forma de pago queda mal escrita (las ventas por transferencia
# saldrían sin pago y el setup crearía una forma de pago "ItaÃº").
$Config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Db = if ($Config.aroniumDb) { [Environment]::ExpandEnvironmentVariables(($Config.aroniumDb -replace '/', '\')) } else { Join-Path $env:LOCALAPPDATA 'Aronium\Data\pos.db' }
if (-not (Test-Path $Db)) { Write-Error "No se encontró la base de Aronium en $Db. Revisá aroniumDb en config.json."; exit 1 }
if ($Config.aroniumDb -ne $Db) {
  if ($Config.PSObject.Properties.Name -contains 'aroniumDb') { $Config.aroniumDb = $Db } else { $Config | Add-Member -NotePropertyName aroniumDb -NotePropertyValue $Db }
  # UTF-8 sin BOM (Node no lee bien el BOM de PowerShell 5).
  [IO.File]::WriteAllText($ConfigPath, ($Config | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Write-Host "config.json: aroniumDb = $Db"
}

# Revisión completa antes de tocar nada (la misma que -Prueba).
& $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\check.mjs')
if ($LASTEXITCODE -ne 0) { Write-Error 'Hay cosas para arreglar (las marcadas con ✖ arriba). No se instaló nada.'; exit 1 }

# Aronium listo para las ventas web (forma de pago y envío): crea
# solo lo que falte, con copia de respaldo antes.
& $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\setup.mjs')
if ($LASTEXITCODE -ne 0) { Write-Error 'No se pudo preparar Aronium: revisá el mensaje de arriba.'; exit 1 }

# Prueba antes de instalar: una pasada completa.
& $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\index.mjs') --once
if ($LASTEXITCODE -ne 0) { Write-Error 'La prueba falló: revisá connector.log.'; exit 1 }

$Action = New-ScheduledTaskAction -Execute $Node `
  -Argument "--disable-warning=ExperimentalWarning `"$Root\src\index.mjs`"" -WorkingDirectory $Root
# Arranca con Windows y, además, cada 5 minutos: "reiniciar si falla" de
# Windows solo actúa si la tarea no arranca, no si el programa se cierra
# después. Con IgnoreNew, si ya está corriendo no se abre otro; si se cerró,
# vuelve solo en 5 minutos.
$Trigger = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Principal $Principal -Force | Out-Null
$Started = Get-Date
Start-ScheduledTask -TaskName $TaskName

# Verificación: la tarea quedó corriendo y el agente escribió que arrancó.
Start-Sleep -Seconds 15
$State = (Get-ScheduledTask -TaskName $TaskName).State
$LogPath = Join-Path $Root 'connector.log'
$Running = $State -eq 'Running' -and (Test-Path $LogPath) -and ((Get-Item $LogPath).LastWriteTime -ge $Started)
if ($Running) {
  Write-Host "Listo: '$TaskName' instalado y corriendo. Arranca con Windows. Registro en $LogPath"
} else {
  Write-Warning "La tarea '$TaskName' quedó instalada pero no se ve corriendo (estado: $State). Revisá $LogPath y el Programador de tareas."
}

# ---- Programa de la PC (Sincronizador.exe) ------------------------------------
# Corre con el usuario que inició sesión (los avisos de Windows no se pueden
# mostrar desde la tarea del sistema). Para que la cajera pueda manejarlo sin
# ser administradora:
# - iniciar o reiniciar la tarea (leer y ejecutar; no puede cambiarla, porque
#   corre como sistema);
# - guardar config.json (solo ese archivo: el código de src\ lo sigue
#   cambiando solo un administrador, porque corre como sistema);
# - dejar órdenes en comandos\ ("Sincronizar ahora").
try {
  $Service = New-Object -ComObject Schedule.Service
  $Service.Connect()
  $Task = $Service.GetFolder('\').GetTask($TaskName)
  $Sddl = $Task.GetSecurityDescriptor(4)  # 4 = solo los permisos (DACL)
  if ($Sddl -notmatch '\(A;;GRGX;;;BU\)') { $Task.SetSecurityDescriptor($Sddl + '(A;;GRGX;;;BU)', 0) }
} catch {
  Write-Warning "No se pudo dar permiso a los usuarios para iniciar la tarea ($($_.Exception.Message)): el programa va a pedir la clave de administrador para iniciarla."
}
icacls $ConfigPath /grant "*${UsersSid}:(M)" | Out-Null
$Commands = Join-Path $Root 'comandos'
New-Item -ItemType Directory -Force $Commands | Out-Null
icacls $Commands /grant "*${UsersSid}:(OI)(CI)(M)" | Out-Null

& (Join-Path $Root 'panel\build.ps1') -Out $Exe
if (-not (Test-Path $Exe)) { Write-Error 'No se pudo compilar Sincronizador.exe: el sincronizador quedó instalado y andando igual, pero sin el programa de la PC.'; exit 1 }

$Shell = New-Object -ComObject WScript.Shell
foreach ($s in $Shortcuts) {
  $link = $Shell.CreateShortcut($s.Path)
  $link.TargetPath = $Exe
  $link.Arguments = $s.Args
  $link.WorkingDirectory = $Root
  $link.IconLocation = "$Exe,0"
  $link.Description = 'Estado, bitácora, pedidos web y configuración del sincronizador Aronium ↔ tienda'
  $link.Save()
}
# Se abre con el usuario de la sesión, no como administrador (explorer.exe lo
# lanza sin permisos elevados).
Start-Process explorer.exe -ArgumentList "`"$Exe`""
Write-Host "Listo: programa 'Sincronizador Aronium' instalado (ícono junto al reloj; también en el menú Inicio y el escritorio)."