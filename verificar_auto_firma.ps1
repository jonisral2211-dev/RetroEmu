# Mantenimiento de la auto-firma de JL Emulator (Sideloadly por Wi-Fi).
# Lo ejecuta el Programador de tareas cada 5 días a las 20:00 (tarea "JL Emulator - Verificar auto-firma").
# Comprueba y, si hace falta, arranca:
#   - sideloadlydaemon.exe (renueva las apps instaladas con "Auto refresh" activado en Sideloadly)
#   - su arranque automático con Windows (HKCU\...\Run)
#   - el servicio de dispositivos de Apple (app "Dispositivos Apple": AppleMobileDeviceProcess)
# y anota si el iPhone se ve por Wi-Fi. Registro: verificar_auto_firma.log (junto a este script).

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root 'verificar_auto_firma.log'
$daemon = Join-Path $env:LOCALAPPDATA 'Sideloadly\sideloadlydaemon.exe'
$ipa = Join-Path $root 'RetroEmu-unsigned.ipa'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Write-Log([string]$text) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Output $line
}

Write-Log '---- Comprobación de auto-firma ----'

# 1) Daemon de Sideloadly
if (-not (Test-Path $daemon)) {
  Write-Log "ERROR: no existe $daemon (¿Sideloadly desinstalado?)"
} else {
  if (Get-Process sideloadlydaemon -ErrorAction SilentlyContinue) {
    Write-Log 'OK: sideloadlydaemon.exe en ejecución'
  } else {
    Start-Process -FilePath $daemon -WindowStyle Hidden
    Start-Sleep -Seconds 3
    if (Get-Process sideloadlydaemon -ErrorAction SilentlyContinue) {
      Write-Log 'ARRANCADO: sideloadlydaemon.exe no estaba activo y se ha iniciado'
    } else {
      Write-Log 'ERROR: no se pudo iniciar sideloadlydaemon.exe'
    }
  }
  $run = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).'Sideloadly Daemon'
  if ($run -ne $daemon) {
    Set-ItemProperty -Path $runKey -Name 'Sideloadly Daemon' -Value $daemon
    Write-Log 'REPARADO: arranque automático del daemon en HKCU\...\Run'
  } else {
    Write-Log 'OK: el daemon arranca con Windows'
  }
}

# 2) Servicio de dispositivos de Apple (app "Dispositivos Apple" de la Microsoft Store)
if (Get-Process AppleMobileDeviceProcess -ErrorAction SilentlyContinue) {
  Write-Log 'OK: servicio de dispositivos de Apple (AppleMobileDeviceProcess) activo'
} else {
  Start-Process 'explorer.exe' 'shell:AppsFolder\AppleInc.AppleDevices_nzyj5cx40ttqa!App'
  Start-Sleep -Seconds 8
  if (Get-Process AppleMobileDeviceProcess -ErrorAction SilentlyContinue) {
    Write-Log 'ARRANCADO: se abrió Dispositivos Apple para activar su servicio'
  } else {
    Write-Log 'ERROR: el servicio de dispositivos de Apple no está activo'
  }
}
if ((Get-Service 'Bonjour Service' -ErrorAction SilentlyContinue).Status -ne 'Running') {
  Write-Log 'AVISO: el servicio Bonjour no está activo (lo necesita la detección por Wi-Fi)'
}

# 3) IPA y iPhone por Wi-Fi
if (Test-Path $ipa) {
  Write-Log ('OK: IPA presente ({0:N1} MB, {1})' -f ((Get-Item $ipa).Length / 1MB), (Get-Item $ipa).LastWriteTime)
} else {
  Write-Log "ERROR: falta $ipa"
}
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if ($py) {
  $devices = & $py (Join-Path $root 'scripts\listar_iphones.py')
  $code = $LASTEXITCODE
  foreach ($d in $devices) { Write-Log "Dispositivo: $d" }
  if ($code -eq 0) {
    Write-Log 'OK: iPhone visible por Wi-Fi: Sideloadly puede renovar sin cable'
  } elseif ($code -eq 1) {
    Write-Log 'AVISO: el iPhone no se ve por Wi-Fi ahora (iPhone y PC en la misma red, iPhone desbloqueado y "Mostrar este iPhone en Wi-Fi" activado)'
  } else {
    Write-Log 'ERROR: el servicio de dispositivos de Apple no responde'
  }
}
