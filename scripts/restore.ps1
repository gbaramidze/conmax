# Restores the local BuildOS data from a backup made by backup.ps1.
# DESTRUCTIVE: replaces ALL current data (database rows and uploaded files) with the backup contents.
# Usage (PowerShell, from C:\dev\buildos):  .\scripts\restore.ps1 -From C:\dev\backups\20261023-135458 -Yes
# The database structure is not touched: it must already be at the same migration level as the backup
# (run "supabase migration up" first if the backup is older/newer than the code).

param(
  [Parameter(Mandatory = $true)][string]$From,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$db = 'supabase_db_buildos'
$storage = 'supabase_storage_buildos'

if (-not (Test-Path (Join-Path $From 'db.dump'))) { throw "No db.dump in $From" }
if (-not $Yes) {
  Write-Host "This replaces ALL current data with the backup in $From." -ForegroundColor Yellow
  Write-Host 'Run again with -Yes to continue.'
  exit 1
}

# 1. Empty every table of the backed-up schemas (structure stays)
$truncateSql = @"
do `$`$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('public', 'private', 'auth', 'storage') loop
    execute format('truncate table %I.%I cascade', r.schemaname, r.tablename);
  end loop;
end `$`$;
"@
docker exec $db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c $truncateSql | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'could not empty the tables' }

# 2. Load the data (triggers off so that restoring does not fire audit/notification logic again)
docker cp (Join-Path $From 'db.dump') "${db}:/tmp/restore.dump"
docker exec $db pg_restore -U supabase_admin -d postgres --data-only --disable-triggers --no-owner --exit-on-error /tmp/restore.dump
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed - the database may be partly restored; fix the cause and run again' }
docker exec $db rm /tmp/restore.dump | Out-Null

# 3. Uploaded files
if (Test-Path (Join-Path $From 'storage-files')) {
  docker exec $storage sh -c 'rm -rf /mnt/stub/stub/files && mkdir -p /mnt/stub/stub'
  docker cp (Join-Path $From 'storage-files') "${storage}:/mnt/stub/stub/files"
  if ($LASTEXITCODE -ne 0) { throw 'could not restore the uploaded files' }
}

# 4. Compare row counts with the ones recorded at backup time
$bad = @()
foreach ($line in (Get-Content (Join-Path $From 'counts.csv'))) {
  if (-not $line) { continue }
  $name, $expected = $line.Split(',')
  $schema, $table = $name.Split('.')
  $sql = "select count(*) from $schema.`"$table`""
  $got = docker exec $db psql -U supabase_admin -d postgres -tA -c $sql
  if ([int64]$got -ne [int64]$expected) { $bad += "$name expected=$expected got=$got" }
}
if ($bad.Count -gt 0) {
  $bad | ForEach-Object { Write-Host "MISMATCH $_" -ForegroundColor Red }
  throw 'row counts differ from the backup'
}
Write-Host 'Restore complete: every table has the same number of rows as in the backup.' -ForegroundColor Green
Write-Host 'Restart the Edge Functions (supabase functions serve) and reload the app; users will need to sign in again.'
