# Instala el conector como tarea programada de Windows: arranca solo al
# iniciar sesión el usuario que usa Aronium y se reinicia si se cae.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1             instalar
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall  quitar
param([switch]$Uninstall)

$TaskName = 'Conector Aronium - Tienda'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea '$TaskName' eliminada."
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error 'No se encontró Node.js. Instalá Node 22.13 o más nuevo (nodejs.org).'; exit 1 }
$Version = [version]((& $Node -v).TrimStart('v'))
if ($Version -lt [version]'22.13.0') { Write-Error "Node $Version es viejo: hace falta 22.13 o más nuevo."; exit 1 }
if (-not (Test-Path (Join-Path $Root 'config.json'))) { Write-Error 'Falta config.json (copiá config.example.json y completalo).'; exit 1 }

# Prueba antes de instalar: una pasada completa.
& $Node --disable-warning=ExperimentalWarning (Join-Path $Root 'src\index.mjs') --once
if ($LASTEXITCODE -ne 0) { Write-Error 'La prueba falló: revisá connector.log.'; exit 1 }

$Action = New-ScheduledTaskAction -Execute $Node `
  -Argument "--disable-warning=ExperimentalWarning `"$Root\src\index.mjs`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
  -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Listo: '$TaskName' instalada y corriendo. Registro en $Root\connector.log"
