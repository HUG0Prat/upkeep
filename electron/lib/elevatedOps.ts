import { createHash } from 'node:crypto';

export type ElevatedOp =
  | { op: 'wu-install'; type: 'Driver' | 'Software'; ids: string[]; downloadOnly?: boolean }
  | { op: 'wu-unhide'; ids: string[] }
  | { op: 'driver-rollback'; hardwareId: string }
  | { op: 'forget-device'; hardwareId: string }
  | { op: 'choco-upgrade'; id: string; version?: string }
  | { op: 'lenovo-install'; ids: string[]; module: string }
  | { op: 'dell-apply'; types: string[] }
  | { op: 'hp-install'; categories: string[] }
  | { op: 'run-installer'; vendor: 'nvidia' | 'asus' | 'dell' | 'hp'; path: string; sha256: string }
  | { op: 'wsl-update'; prerelease: boolean }
  | { op: 'psgallery-update'; names: string[] }
  | { op: 'psgallery-install-allusers'; name: 'LSUClient' | 'Microsoft.WinGet.Client' }
  | { op: 'restore-point' }
  | { op: 'bitlocker-suspend' }
  | { op: 'security-state' }
  | { op: 'cleanup-wu-cache' }
  | { op: 'driver-delete'; inf: string }
  | { op: 'cleanup-system'; target: 'delivery-optimization' | 'system-temp' | 'system-crash' | 'component-store' | 'windows-old' }
  | { op: 'driver-cab-install'; path: string; sha256: string }
  | { op: 'reboot-firmware' }
  | { op: 'disk-scan'; drive: string }
  | { op: 'simulate'; text: string };

export interface OpsJob {
  id: string;
  ops: ElevatedOp[];
}

export const OPS_LIBRARY = String.raw`
$REBOOT = 'REDÉMARRAGE REQUIS'
$ReGuid = '^[0-9a-fA-F-]{36}$'
$ReId = '^[A-Za-z0-9][\w.+-]{0,127}$'
$ReHw = '^[\w\\&.-]{4,200}$'
$ReInf = '^oem\d{1,5}\.inf$'
function Assert-Match($value, $regex, $what) { if ("$value" -notmatch $regex) { throw "Paramètre refusé ($what) : $value" } }

function Invoke-UkWuInstall($type, $ids, $downloadOnly) {
  if ($type -notin 'Driver', 'Software') { throw "Type refusé : $type" }
  foreach ($i in $ids) { Assert-Match $i $ReGuid 'identifiant Windows Update' }
  $session = New-Object -ComObject Microsoft.Update.Session
  $searcher = $session.CreateUpdateSearcher(); $searcher.ServerSelection = 2
  "Recherche des mises à jour Windows sélectionnées…"
  $coll = New-Object -ComObject Microsoft.Update.UpdateColl
  foreach ($h in 0, 1) {
    foreach ($u in $searcher.Search("IsInstalled=0 and Type='$type' and IsHidden=$h").Updates) {
      if ($ids -contains $u.Identity.UpdateID) { if (-not $u.EulaAccepted) { $u.AcceptEula() }; [void]$coll.Add($u); "  + " + $u.Title }
    }
  }
  if ($coll.Count -eq 0) { "Aucune mise à jour correspondante (déjà installée ?)"; $global:JobExitCode = 2; return }
  "Téléchargement de $($coll.Count) mise(s) à jour…"
  $dl = $session.CreateUpdateDownloader(); $dl.Updates = $coll; $dlRes = $dl.Download()
  "Téléchargement : code $($dlRes.ResultCode) (100%)"
  if ($downloadOnly) { "Téléchargé : l’installation pourra se faire hors ligne."; return }
  "Installation…"
  $inst = $session.CreateUpdateInstaller(); $inst.Updates = $coll; $res = $inst.Install()
  $codes = @{ 2 = 'réussie'; 3 = 'réussie avec erreurs'; 4 = 'échec'; 5 = 'annulée' }
  for ($i = 0; $i -lt $coll.Count; $i++) {
    $r = $res.GetUpdateResult($i)
    "  " + $coll.Item($i).Title + " : " + $codes[[int]$r.ResultCode] + " (HRESULT " + ('0x{0:X8}' -f $r.HResult) + ")"
  }
  if ($res.RebootRequired) { $REBOOT }
  if ($res.ResultCode -ne 2) { $global:JobExitCode = 1 }
}

function Invoke-UkWuUnhide($ids) {
  foreach ($i in $ids) { Assert-Match $i $ReGuid 'identifiant Windows Update' }
  $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher(); $searcher.ServerSelection = 2
  foreach ($u in $searcher.Search("IsInstalled=0 and IsHidden=1").Updates) {
    if ($ids -contains $u.Identity.UpdateID) { $u.IsHidden = $false; "Réaffichée : " + $u.Title }
  }
}

function Find-UkDevice($hw, [switch]$All) {
  $hw = "$hw".ToLower()
  Get-PnpDevice -PresentOnly:(-not $All) -ErrorAction SilentlyContinue | Where-Object {
    $ids = @((Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_HardwareIds, DEVPKEY_Device_CompatibleIds -ErrorAction SilentlyContinue).Data) | ForEach-Object { "$_".ToLower() }
    $ids -contains $hw
  }
}

function Invoke-UkDriverRollback($hw) {
  Assert-Match $hw $ReHw 'identifiant matériel'
  $dev = Find-UkDevice $hw | Select-Object -First 1
  if (-not $dev) { "Périphérique introuvable (débranché ?)"; $global:JobExitCode = 1; return }
  $drv = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceID -eq $dev.InstanceId } | Select-Object -First 1
  if (-not $drv -or $drv.InfName -notmatch $ReInf) { "Le pilote actuel est intégré à Windows : rien à restaurer."; $global:JobExitCode = 1; return }
  "Périphérique : " + $dev.FriendlyName
  "Pilote actuel : " + $drv.DriverVersion + " (" + $drv.InfName + ")"
  pnputil.exe /delete-driver $drv.InfName /uninstall /force
  pnputil.exe /scan-devices
  $after = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceID -eq $dev.InstanceId } | Select-Object -First 1
  "Pilote après restauration : " + $after.DriverVersion
  $REBOOT
}

function Invoke-UkForgetDevice($hw) {
  Assert-Match $hw $ReHw 'identifiant matériel'
  $devs = @(Find-UkDevice $hw -All | Where-Object { -not $_.Present })
  if (-not $devs.Count) { "Aucun périphérique absent ne correspond (déjà oublié ?)"; return }
  foreach ($d in $devs) {
    "Oubli de : " + $d.FriendlyName + " (" + $d.InstanceId + ")"
    pnputil.exe /remove-device $d.InstanceId
    if ($LASTEXITCODE) { $global:JobExitCode = $LASTEXITCODE }
  }
}

function Invoke-UkChoco($id, $version) {
  Assert-Match $id $ReId 'paquet Chocolatey'
  $choco = Join-Path $env:ProgramData 'chocolatey\bin\choco.exe'
  if (-not (Test-Path $choco)) { throw 'Chocolatey introuvable' }
  $cargs = @('upgrade', $id, '-y', '--no-progress')
  if ($version) { Assert-Match $version '^[\w.+-]{1,64}$' 'version'; $cargs += @('--version', $version, '--allow-downgrade') }
  & $choco @cargs
  if ($LASTEXITCODE -in 1641, 3010) { $REBOOT } elseif ($LASTEXITCODE) { $global:JobExitCode = $LASTEXITCODE }
}

function Invoke-UkLenovo($ids, $module) {
  foreach ($i in $ids) { Assert-Match $i $ReId 'paquet Lenovo' }
  if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem -and "$module" -notlike "$env:ProgramFiles\*") {
    throw 'LSUClient doit être installé pour tous les utilisateurs (Sources › Lenovo) pour être utilisé par l''assistant administrateur.'
  }
  if ("$module" -notmatch 'LSUClient\.psd1$' -or -not (Test-Path -LiteralPath $module)) { throw "Module LSUClient introuvable : $module" }
  Import-Module -Name $module
  "Recherche des paquets Lenovo sélectionnés…"
  $updates = @(Get-LSUpdate | Where-Object { $ids -contains $_.ID })
  if (-not $updates.Count) { "Aucune mise à jour correspondante (déjà installée ?)"; $global:JobExitCode = 2; return }
  $updates | ForEach-Object { "  + " + $_.Title }
  "Téléchargement…"; $updates | Save-LSUpdate -ShowProgress:$false
  "Installation…"
  foreach ($r in @($updates | Install-LSUpdate -SaveBIOSUpdateInfoToRegistry)) {
    "  " + $r.Title + " : " + $(if ($r.Success) { 'réussie' } else { 'échec ' + $r.FailureReason }) + " " + ($r.PendingAction -join ',')
    if (-not $r.Success) { $global:JobExitCode = 1 }
    if ([string]$r.PendingAction -match 'REBOOT|SHUTDOWN') { $REBOOT }
  }
}

function Invoke-UkDell($types) {
  foreach ($t in $types) { if ($t -notin 'bios', 'firmware', 'driver', 'application', 'utility', 'others') { throw "Type Dell refusé : $t" } }
  $cli = @("$env:ProgramFiles\Dell\CommandUpdate\dcu-cli.exe", (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Dell\CommandUpdate\dcu-cli.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $cli) { throw 'dcu-cli introuvable' }
  "Remarque : Dell Command | Update applique toutes les mises à jour des types sélectionnés."
  $a = @('/applyUpdates', '-silent', '-reboot=disable'); if ($types) { $a += "-updateType=$($types -join ',')" }
  & $cli @a
  if ($LASTEXITCODE -in 1, 5) { $REBOOT } elseif ($LASTEXITCODE -notin 0, 500) { $global:JobExitCode = $LASTEXITCODE }
}

function Invoke-UkHp($cats) {
  foreach ($c in $cats) { if ($c -notin 'BIOS', 'Firmware', 'Drivers', 'Software') { throw "Catégorie HP refusée : $c" } }
  $exe = @('C:\SWSetup\HPImageAssistant\HPImageAssistant.exe', "$env:ProgramFiles\HP\HPIA\HPImageAssistant.exe", "$env:ProgramFiles\HP\HP Image Assistant\HPImageAssistant.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { throw 'HP Image Assistant introuvable' }
  $report = Join-Path $env:ProgramData 'UpKeep\hpia'; New-Item -ItemType Directory -Force $report | Out-Null
  "Remarque : HP Image Assistant installe toutes les mises à jour des catégories : $($cats -join ', ')."
  & $exe /Operation:Analyze /Action:Install /Selection:All "/Category:$($cats -join ',')" /Silent "/ReportFolder:$report" "/SoftpaqDownloadFolder:$report"
  if ($LASTEXITCODE -eq 3010) { $REBOOT } elseif ($LASTEXITCODE -notin 0, 256) { $global:JobExitCode = $LASTEXITCODE }
}

$Installers = @{
  nvidia = @{ Signer = 'NVIDIA Corporation'; Args = @('-s', '-noreboot', '-noeula'); Interactive = $false }
  asus   = @{ Signer = 'ASUSTeK'; Args = @(); Interactive = $true }
  dell   = @{ Signer = 'Dell'; Args = @('/s'); Interactive = $false }
  hp     = @{ Signer = 'HP Inc'; Args = @('/s'); Interactive = $false }
}

function Invoke-UkInstaller($vendor, $path, $sha) {
  $def = $Installers[$vendor]; if (-not $def) { throw "Éditeur refusé : $vendor" }
  Assert-Match $sha '^[0-9a-fA-F]{64}$' 'empreinte SHA-256'
  if ("$path" -notmatch '\.exe$' -or -not (Test-Path -LiteralPath $path)) { throw "Installeur introuvable : $path" }
  $safe = Join-Path $env:ProgramData 'UpKeep\installers'; New-Item -ItemType Directory -Force $safe | Out-Null
  $dest = Join-Path $safe ([IO.Path]::GetFileName($path))
  Copy-Item -LiteralPath $path -Destination $dest -Force
  if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $sha.ToUpper()) { throw 'Empreinte SHA-256 différente : installation bloquée.' }
  $sig = Get-AuthenticodeSignature -LiteralPath $dest
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch [regex]::Escape($def.Signer)) { throw "Signature invalide ou éditeur inattendu ($($sig.Status)) : installation bloquée." }
  "Signature vérifiée : " + $sig.SignerCertificate.Subject
  $p = if ($def.Interactive) { Start-Process -FilePath $dest -Wait -PassThru } else { Start-Process -FilePath $dest -ArgumentList $def.Args -Wait -PassThru }
  "Code de sortie : $($p.ExitCode)"
  Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
  if ($p.ExitCode -in 1, 3010 -or $def.Interactive) { $REBOOT } elseif ($p.ExitCode -ne 0) { $global:JobExitCode = $p.ExitCode }
}

function Invoke-UkPsGallery($names, [switch]$Install) {
  foreach ($n in $names) { Assert-Match $n $ReId 'module PowerShell' }
  if ($Install) {
    if ($names[0] -notin 'LSUClient', 'Microsoft.WinGet.Client') { throw "Module refusé : $($names[0])" }
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers | Out-Null
    Install-Module $names[0] -Scope AllUsers -Force -AllowClobber; "Module installé pour tous les utilisateurs."
  } else { Update-Module -Name $names -Force -AcceptLicense }
}

function Invoke-UkRestorePoint {
  "Création d’un point de restauration…"
  try {
    Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
    Checkpoint-Computer -Description 'UpKeep - avant mises à jour' -RestorePointType MODIFY_SETTINGS -WarningVariable w
    if ($w) { "Point de restauration : $w" } else { 'Point de restauration créé.' }
  } catch { 'Point de restauration impossible : ' + $_.Exception.Message }
}

function Invoke-UkSecurityState {
  $sb = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -ErrorAction SilentlyContinue).UEFISecureBootEnabled
  "Secure Boot : " + $(if ($sb -eq 1) { 'activé' } elseif ($sb -eq 0) { 'désactivé' } else { 'inconnu' })
  try { $tpm = Get-Tpm; "TPM : présent=$($tpm.TpmPresent) prêt=$($tpm.TpmReady)" } catch { 'TPM : ' + $_.Exception.Message }
  try { $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop; "BitLocker : $($bl.ProtectionStatus)" } catch { 'BitLocker : non disponible' }
}

function Invoke-UkBitLockerSuspend {
  try {
    $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
    if ($bl.ProtectionStatus -eq 'On') { Suspend-BitLocker -MountPoint $env:SystemDrive -RebootCount 1 | Out-Null; 'BitLocker suspendu jusqu''au prochain redémarrage.' }
    else { 'BitLocker n''est pas actif.' }
  } catch { 'BitLocker : ' + $_.Exception.Message }
}

function Invoke-UkCleanupWuCache {
  "Arrêt du service Windows Update…"
  Stop-Service wuauserv -Force -ErrorAction SilentlyContinue
  $dir = Join-Path $env:SystemRoot 'SoftwareDistribution\Download'
  $size = (Get-ChildItem $dir -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  Remove-Item (Join-Path $dir '*') -Recurse -Force -ErrorAction SilentlyContinue
  Start-Service wuauserv -ErrorAction SilentlyContinue
  "Cache Windows Update vidé : {0:N0} Mo libérés." -f ($size / 1MB)
}

function Invoke-UkDriverDelete($inf) {
  Assert-Match $inf $ReInf 'paquet de pilote'
  pnputil.exe /delete-driver $inf
  if ($LASTEXITCODE) { "$inf est encore utilisé : conservé." }
}

function Remove-UkOldFiles($dir, $days) {
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  $limit = (Get-Date).AddDays(-$days); $freed = 0
  Get-ChildItem -LiteralPath $dir -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $limit } | ForEach-Object {
    $len = $_.Length
    try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $freed += $len } catch { }
  }
  Get-ChildItem -LiteralPath $dir -Recurse -Force -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) } | Remove-Item -Force -ErrorAction SilentlyContinue
  "{0} : {1:N0} Mo libérés" -f $dir, ($freed / 1MB)
}

function Invoke-UkCleanupSystem($target) {
  switch ($target) {
    'delivery-optimization' { Delete-DeliveryOptimizationCache -Force -ErrorAction Stop; 'Cache d''optimisation de la distribution vidé.' }
    'system-temp' { Remove-UkOldFiles (Join-Path $env:SystemRoot 'Temp') 1 }
    'system-crash' {
      foreach ($d in (Join-Path $env:SystemRoot 'Minidump'), (Join-Path $env:SystemRoot 'LiveKernelReports'), (Join-Path $env:ProgramData 'Microsoft\Windows\WER')) { Remove-UkOldFiles $d 0 }
      $dmp = Join-Path $env:SystemRoot 'MEMORY.DMP'
      if (Test-Path -LiteralPath $dmp) { Remove-Item -LiteralPath $dmp -Force -ErrorAction SilentlyContinue; 'MEMORY.DMP supprimé.' }
    }
    'component-store' {
      'Nettoyage du magasin de composants (DISM), cela peut durer plusieurs minutes…'
      Dism.exe /Online /Cleanup-Image /StartComponentCleanup /NoRestart
      if ($LASTEXITCODE -eq 3010) { $REBOOT } elseif ($LASTEXITCODE) { $global:JobExitCode = $LASTEXITCODE }
    }
    'windows-old' {
      $old = Join-Path $env:SystemDrive 'Windows.old'
      if (-not (Test-Path -LiteralPath $old)) { 'Windows.old est déjà supprimé.'; return }
      'Prise de possession de Windows.old…'
      takeown.exe /F $old /R /A /D O | Out-Null
      icacls.exe $old /grant '*S-1-5-32-544:F' /T /C /Q | Out-Null
      Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $old) { 'Certains fichiers de Windows.old n''ont pas pu être supprimés.'; $global:JobExitCode = 1 } else { 'Windows.old supprimé.' }
    }
    default { throw "Nettoyage refusé : $target" }
  }
}

function Invoke-UkDriverCab($path, $sha) {
  Assert-Match $sha '^[0-9a-fA-F]{64}$' 'empreinte SHA-256'
  if ("$path" -notmatch '\.cab$' -or -not (Test-Path -LiteralPath $path)) { throw "Paquet de pilote introuvable : $path" }
  $safe = Join-Path $env:ProgramData 'UpKeep\drivers'; New-Item -ItemType Directory -Force $safe | Out-Null
  $name = [IO.Path]::GetFileNameWithoutExtension($path) -replace '[^\w.-]', '_'
  $cab = Join-Path $safe "$name.cab"; $dir = Join-Path $safe $name
  Copy-Item -LiteralPath $path -Destination $cab -Force
  if ((Get-FileHash -LiteralPath $cab -Algorithm SHA256).Hash -ne $sha.ToUpper()) { throw 'Empreinte SHA-256 différente : installation bloquée.' }
  $sig = Get-AuthenticodeSignature -LiteralPath $cab
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "Signature invalide ou éditeur inattendu ($($sig.Status)) : installation bloquée." }
  "Signature vérifiée : " + $sig.SignerCertificate.Subject
  if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
  New-Item -ItemType Directory -Force $dir | Out-Null
  expand.exe -F:* $cab $dir | Out-Null
  $infs = @(Get-ChildItem -LiteralPath $dir -Recurse -Filter *.inf)
  if (-not $infs.Count) { throw 'Aucun fichier .inf dans le paquet.' }
  "Installation de $($infs.Count) fichier(s) .inf…"
  pnputil.exe /add-driver (Join-Path $dir '*.inf') /subdirs /install
  $code = $LASTEXITCODE
  Remove-Item -LiteralPath $cab -Force -ErrorAction SilentlyContinue
  if ($code -eq 3010) { $REBOOT }
  elseif ($code -eq 259) { 'Pilote ajouté au magasin, mais aucun périphérique présent ne l''utilise (ou un pilote plus récent est déjà installé).' }
  elseif ($code) { $global:JobExitCode = $code }
}

function Invoke-UkRebootFirmware {
  if ("$env:firmware_type" -ne 'UEFI') { throw 'Redémarrage vers le firmware impossible : PC en mode BIOS hérité.' }
  shutdown.exe /r /fw /t 15 /c 'UpKeep : redémarrage vers les réglages UEFI dans 15 secondes.'
  if ($LASTEXITCODE) { $global:JobExitCode = $LASTEXITCODE } else { 'Redémarrage vers les réglages UEFI dans 15 secondes.' }
}

function Invoke-UkDiskScan($drive) {
  Assert-Match $drive '^[A-Za-z]:$' 'lecteur'
  "Analyse en ligne de $drive (chkdsk /scan, sans redémarrage)…"
  chkdsk.exe $drive /scan
  if ($LASTEXITCODE -ge 3) { $global:JobExitCode = $LASTEXITCODE; "Des erreurs ont été trouvées : lancez « chkdsk $drive /f » puis redémarrez pour les réparer." }
}

function Invoke-UkOp($o) {
  switch ($o.op) {
    'wu-install' { Invoke-UkWuInstall $o.type @($o.ids) ([bool]$o.downloadOnly) }
    'wu-unhide' { Invoke-UkWuUnhide @($o.ids) }
    'driver-rollback' { Invoke-UkDriverRollback $o.hardwareId }
    'forget-device' { Invoke-UkForgetDevice $o.hardwareId }
    'choco-upgrade' { Invoke-UkChoco $o.id $o.version }
    'lenovo-install' { Invoke-UkLenovo @($o.ids) $o.module }
    'dell-apply' { Invoke-UkDell @($o.types) }
    'hp-install' { Invoke-UkHp @($o.categories) }
    'run-installer' { Invoke-UkInstaller $o.vendor $o.path $o.sha256 }
    'wsl-update' { if ($o.prerelease) { wsl.exe --update --pre-release } else { wsl.exe --update }; if ($LASTEXITCODE) { $global:JobExitCode = $LASTEXITCODE }; "Redémarrez WSL (wsl --shutdown) pour utiliser la nouvelle version." }
    'psgallery-update' { Invoke-UkPsGallery @($o.names) }
    'psgallery-install-allusers' { Invoke-UkPsGallery @($o.name) -Install }
    'restore-point' { Invoke-UkRestorePoint }
    'bitlocker-suspend' { Invoke-UkBitLockerSuspend }
    'security-state' { Invoke-UkSecurityState }
    'cleanup-wu-cache' { Invoke-UkCleanupWuCache }
    'driver-delete' { Invoke-UkDriverDelete $o.inf }
    'cleanup-system' { Invoke-UkCleanupSystem $o.target }
    'driver-cab-install' { Invoke-UkDriverCab $o.path $o.sha256 }
    'reboot-firmware' { Invoke-UkRebootFirmware }
    'disk-scan' { Invoke-UkDiskScan $o.drive }
    'simulate' { "[simulation] " + $o.text }
    default { throw "Opération inconnue : $($o.op)" }
  }
}

function Invoke-UkJobs($jobs) {
  foreach ($j in $jobs) {
    Assert-Match $j.id '^[\w-]{1,64}$' 'identifiant de tâche'
    "@@JOB $($j.id) START"
    $global:JobExitCode = 0
    try { foreach ($o in @($j.ops)) { Invoke-UkOp $o } } catch { "ERREUR: " + $_.Exception.Message; $global:JobExitCode = 1 }
    "@@JOB $($j.id) END $global:JobExitCode"
  }
}
`;

export function opsScript(jobs: OpsJob[]): string {
  const json = JSON.stringify(jobs).replace(/'/g, "''");
  return `${OPS_LIBRARY}\nInvoke-UkJobs (ConvertFrom-Json '${json}')\n`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
