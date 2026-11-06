# Backup of the local BuildOS data: database (public, private, auth, storage schemas) + uploaded files.
# Usage (PowerShell, from C:\dev\buildos):  .\scripts\backup.ps1 [-OutDir C:\dev\backups] [-Keep 14]
# Requires Docker Desktop running with the Supabase containers started (supabase start).
# Each run creates a folder <OutDir>\<timestamp> with db.dump, storage-files\ and counts.csv, then checks
# that the dump contains exactly as many rows per table as the live database had at dump time.

param(
  [string]$OutDir = 'C:\dev\backups',
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$db = 'supabase_db_buildos'
$storage = 'supabase_storage_buildos'
$schemas = @('public', 'private', 'auth', 'storage')

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dir = Join-Path $OutDir $stamp
New-Item -ItemType Directory -Force $dir | Out-Null

Write-Host "Backup folder: $dir"

# 1. Row counts of the live database (taken in the same transaction as the dump would be ideal; the dev DB is quiet enough)
$countSql = @"
select table_schema || '.' || table_name || ',' ||
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE' and table_schema in ('public', 'private', 'auth', 'storage')
 order by 1;
"@
$counts = docker exec $db psql -U supabase_admin -d postgres -tA -c $countSql
if ($LASTEXITCODE -ne 0) { throw 'could not read row counts' }
$counts | Set-Content -Encoding ascii (Join-Path $dir 'counts.csv')

# 2. Database dump (custom format: compressed, restorable table by table)
$schemaArgs = $schemas | ForEach-Object { "--schema=$_" }
docker exec $db pg_dump -U supabase_admin -d postgres -Fc @schemaArgs -f /tmp/buildos.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
docker cp "${db}:/tmp/buildos.dump" (Join-Path $dir 'db.dump')
if ($LASTEXITCODE -ne 0) { throw 'could not copy the dump out of the container' }

# 3. Check: count rows per table inside the dump and compare with the live counts
$inDump = @{}
$table = $null
$n = 0
docker exec $db pg_restore --data-only -f - /tmp/buildos.dump | ForEach-Object {
  if ($_ -match '^COPY (\S+) ') { $table = $Matches[1].Replace('"', ''); $n = 0 }
  elseif ($_ -eq '\.' -and $table) { $inDump[$table] = $n; $table = $null }
  elseif ($table) { $n++ }
}
docker exec $db rm /tmp/buildos.dump | Out-Null

$bad = @()
foreach ($line in $counts) {
  if (-not $line) { continue }
  $name, $live = $line.Split(',')
  $got = if ($inDump.ContainsKey($name)) { $inDump[$name] } else { 0 }
  if ([int64]$live -ne [int64]$got) { $bad += "$name live=$live dump=$got" }
}
if ($bad.Count -gt 0) {
  $bad | ForEach-Object { Write-Host "MISMATCH $_" -ForegroundColor Red }
  throw 'the dump does not match the database; keep the previous backup'
}
$rows = ($inDump.Values | Measure-Object -Sum).Sum
Write-Host ("Database: {0} tables, {1} rows - dump verified" -f $inDump.Count, $rows)

# 4. Uploaded files (photos, documents, meeting recordings)
docker cp "${storage}:/mnt/stub/stub/files" (Join-Path $dir 'storage-files')
if ($LASTEXITCODE -ne 0) { throw 'could not copy the uploaded files' }
$files = @(Get-ChildItem -Recurse -File (Join-Path $dir 'storage-files')).Count
Write-Host "Files: $files"

# 5. Keep only the newest $Keep backups
Get-ChildItem $OutDir -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep | ForEach-Object {
  Remove-Item -Recurse -Force $_.FullName
  Write-Host "Removed old backup $($_.Name)"
}

$size = [math]::Round(((Get-ChildItem -Recurse -File $dir | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Host "Done: $dir ($size MB)" -ForegroundColor Green
