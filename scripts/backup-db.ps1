# PostgreSQL backup using DATABASE_URL from backend/.env
# Neon: uses direct host (not pooler) — required for pg_dump

$ErrorActionPreference = "Stop"
$backendRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $backendRoot ".env"

if (-not (Test-Path $envFile)) {
  Write-Error ".env not found at $envFile"
}

$databaseUrl = $null
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*DATABASE_URL\s*=\s*"(.+)"\s*$') {
    $databaseUrl = $Matches[1]
  }
}

if (-not $databaseUrl) {
  Write-Error "DATABASE_URL not found in .env"
}

$uri = [Uri]$databaseUrl
$dbHost = $uri.Host -replace "-pooler", ""
$user = [Uri]::UnescapeDataString($uri.UserInfo.Split(":")[0])
$pass = [Uri]::UnescapeDataString($uri.UserInfo.Split(":")[1])
$db = $uri.AbsolutePath.TrimStart("/").Split("?")[0]

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$outDesktop = Join-Path $desktop "priceHunter-backup-$stamp.sql"
$outBackend = Join-Path $backendRoot "backups\priceHunter-backup-$stamp.sql"

$backupDir = Join-Path $backendRoot "backups"
if (-not (Test-Path $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$pgDump = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"
if (-not (Test-Path $pgDump)) {
  $pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
}
if (-not $pgDump) {
  Write-Error "pg_dump not found. Install PostgreSQL client tools."
}

$env:PGPASSWORD = $pass
Write-Host "Backing up database '$db' on $dbHost ..."

& $pgDump `
  -h $dbHost `
  -U $user `
  -d $db `
  --no-owner `
  --no-acl `
  -F p `
  -f $outBackend

Copy-Item -Path $outBackend -Destination $outDesktop -Force

$sizeMb = [math]::Round((Get-Item $outBackend).Length / 1MB, 2)
Write-Host "Done ($sizeMb MB)"
Write-Host "  $outBackend"
Write-Host "  $outDesktop"

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
