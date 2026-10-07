$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:WSL_UTF8 = '1'
$cs = Get-CimInstance Win32_ComputerSystem
$name = ("$($cs.Manufacturer)-$($cs.Model)" -replace '[^\w-]+', '-').ToLower()
$dir = Join-Path $PSScriptRoot "..\tests\fixtures\$name"
New-Item -ItemType Directory -Force $dir | Out-Null
function Save($file, $text) { Set-Content -LiteralPath (Join-Path $dir $file) -Value $text -Encoding UTF8; "  $file" }

"Capture vers $dir"
Save 'winget-upgrade.txt' ((winget upgrade --accept-source-agreements --disable-interactivity) -join "`n")
Save 'winget-show.txt' ((winget show --id Git.Git --exact --accept-source-agreements --disable-interactivity) -join "`n")
Save 'pnputil-enum-drivers.txt' ((pnputil.exe /enum-drivers) -join "`n")
Save 'tpmtool.txt' ((tpmtool.exe getdeviceinformation) -join "`n")
if (Get-Command cargo -ErrorAction SilentlyContinue) { Save 'cargo-install-list.txt' ((cargo install --list) -join "`n") }
if (Get-Command dotnet -ErrorAction SilentlyContinue) { Save 'dotnet-tool-list.txt' ((dotnet tool list -g) -join "`n") }
if (Get-Command code -ErrorAction SilentlyContinue) { Save 'code-extensions.txt' ((code --list-extensions --show-versions) -join "`n") }
Save 'wsl-version.txt' ((wsl.exe --version) -join "`n")

"  Windows Update (recherche, 1 à 3 min)…"
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher(); $searcher.ServerSelection = 2
$out = foreach ($h in 0, 1) {
  foreach ($u in $searcher.Search("IsInstalled=0 and IsHidden=$h").Updates) {
    [pscustomobject]@{
      Id = $u.Identity.UpdateID; Driver = ($u.Type -eq 2); Title = $u.Title; Hidden = [bool]$h
      DriverClass = $u.DriverClass; Manufacturer = $u.DriverManufacturer; Model = $u.DriverModel; HardwareId = $u.DriverHardwareID
      VerDate = if ($u.Type -eq 2 -and $u.DriverVerDate) { $u.DriverVerDate.ToString('yyyy-MM-dd') } else { $null }
      Size = [double]$u.MaxDownloadSize; Reboot = [bool]($u.InstallationBehavior.RebootBehavior -ne 0)
      Current = $null; CurrentDate = $null; DeviceName = $null; Present = $false
      Description = $u.Description; SupportUrl = $u.SupportUrl
      Kb = (@($u.KBArticleIDs) | ForEach-Object { "KB$_" }) -join ','; Severity = $u.MsrcSeverity
      Categories = (@($u.Categories) | ForEach-Object { $_.Name }) -join ', '; Cves = (@($u.CveIDs)) -join ','
      Deployed = if ($u.LastDeploymentChangeTime) { $u.LastDeploymentChangeTime.ToString('o') } else { $null }
      BrowseOnly = [bool]$u.BrowseOnly
    }
  }
}
Save 'windows-update.json' (ConvertTo-Json -InputObject @($out) -Depth 3)
"Terminé."
