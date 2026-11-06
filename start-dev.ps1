# Starts BuildOS for local use and for other devices on the same network.
# Usage (PowerShell, from C:\dev\buildos):  .\start-dev.ps1
# Requires: Docker Desktop running, Supabase CLI and pnpm installed.

param([switch]$Https)   # -Https: serve over https (needed for the microphone / camera from a phone)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host 'Starting Supabase (database, auth, storage)...'
supabase start | Out-Null

# Edge Functions (meeting summaries, e-mail, document text): serve loads the secrets from supabase/functions/.env
Write-Host 'Starting Edge Functions...'
Start-Job -ScriptBlock { Set-Location $using:PSScriptRoot; supabase functions serve } | Out-Null

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*WSL*' -and $_.InterfaceAlias -notlike '*vEthernet*' } |
  Select-Object -First 1).IPAddress

$scheme = if ($Https) { 'https' } else { 'http' }
if ($Https) { $env:DEV_HTTPS = '1'; Write-Host 'HTTPS mode: the browser will warn about the certificate once - choose Advanced / Continue.' }
Write-Host ''
Write-Host "On this computer:       ${scheme}://localhost:5173"
if ($ip) { Write-Host "From other devices:     ${scheme}://${ip}:5173   (same Wi-Fi / network)" }
Write-Host 'Demo login: pm1@demo.test / demo-pass-2026   (more users: see supabase/seed.sql)'
Write-Host 'Stop with Ctrl+C. Supabase keeps running; stop it with: supabase stop'
Write-Host ''

Set-Location apps\web
pnpm exec vite
