# Compila Sincronizador.exe (el programa de la PC: ícono junto al reloj, estado,
# bitácora, pedidos web y configuración) con el compilador de C# que trae
# Windows (.NET Framework 4). No hace falta instalar nada. Lo corre install.ps1;
# también se puede correr solo:
#
#   powershell -ExecutionPolicy Bypass -File panel\build.ps1
#
# Deja Sincronizador.exe en la carpeta del sincronizador (al lado de config.json).
param([string]$Out)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here
if (-not $Out) { $Out = Join-Path $Root 'Sincronizador.exe' }
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null

$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $Csc)) { $Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $Csc)) { throw 'No se encontró el compilador de C# de Windows (.NET Framework 4).' }

# Ícono del programa (el mismo dibujo que el del reloj, en azul): un .ico con
# PNG adentro, en tres tamaños.
Add-Type -AssemblyName System.Drawing
function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 32.0
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(37, 99, 175))), 1 * $s, 1 * $s, 30 * $s, 30 * $s)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (3.2 * $s)
  $g.DrawArc($pen, 8 * $s, 8 * $s, 16 * $s, 16 * $s, 200, 140)
  $g.DrawArc($pen, 8 * $s, 8 * $s, 16 * $s, 16 * $s, 20, 140)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.FillPolygon($white, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF (24.5 * $s), (9 * $s)), (New-Object System.Drawing.PointF (26.5 * $s), (17 * $s)), (New-Object System.Drawing.PointF (19 * $s), (14.5 * $s))))
  $g.FillPolygon($white, [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF (7.5 * $s), (23 * $s)), (New-Object System.Drawing.PointF (5.5 * $s), (15 * $s)), (New-Object System.Drawing.PointF (13 * $s), (17.5 * $s))))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return , $ms.ToArray()
}
$Sizes = @(16, 32, 48, 256)
$Pngs = @($Sizes | ForEach-Object { , (New-IconPng $_) })
$IconPath = Join-Path ([IO.Path]::GetTempPath()) "sincronizador-$PID.ico"
$fs = [IO.File]::Create($IconPath)
$w = New-Object IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$Sizes.Count)
$offset = 6 + 16 * $Sizes.Count
for ($i = 0; $i -lt $Sizes.Count; $i++) {
  $dim = if ($Sizes[$i] -ge 256) { 0 } else { $Sizes[$i] }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$Pngs[$i].Length); $w.Write([uint32]$offset)
  $offset += $Pngs[$i].Length
}
foreach ($png in $Pngs) { $w.Write([byte[]]$png) }
$w.Close()

$Source = Join-Path $Here 'Sincronizador.cs'
$output = & $Csc /nologo /target:winexe /optimize+ /codepage:65001 "/out:$Out" "/win32icon:$IconPath" `
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
  $Source 2>&1
$code = $LASTEXITCODE
Remove-Item $IconPath -ErrorAction SilentlyContinue
if ($code -ne 0) { $output | Write-Host; throw 'No se pudo compilar Sincronizador.exe (errores arriba).' }
Write-Host "Sincronizador.exe listo: $Out"
