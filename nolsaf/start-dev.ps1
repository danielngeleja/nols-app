# Start development servers
Write-Host "Starting NoLSAF development servers..." -ForegroundColor Green

# Check if ports are in use
$portsToFree = @(3000, 4000)
foreach ($port in $portsToFree) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) { continue }

    $pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($pids.Count -eq 0) { continue }

    Write-Host "Port $port is already in use. Stopping PID(s): $($pids -join ', ')" -ForegroundColor Yellow
    foreach ($processId in $pids) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

# Change to project directory
Set-Location $PSScriptRoot

# Best-effort: ensure Redis is running in Docker for local caching.
# If Docker isn't available, we continue (API already falls back gracefully).
try {
    $redisScript = Join-Path $PSScriptRoot 'start-redis.ps1'
    if (Test-Path $redisScript) {
        Write-Host "Ensuring Redis is running (Docker)..." -ForegroundColor Cyan
        & $redisScript | Out-Host
    }
} catch {
    Write-Host "Redis auto-start skipped: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Clean Next.js build output to prevent stale asset references (e.g. /_next/static/css/app/layout.css errors)
$webNextPath = Join-Path $PSScriptRoot "apps\web\.next"
if (Test-Path $webNextPath) {
    Write-Host "Cleaning apps/web/.next..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force $webNextPath -ErrorAction SilentlyContinue
}

# Silence Node.js warnings in dev (e.g. DEP0060 util._extend)
# NODE_NO_WARNINGS disables all process warnings; NODE_OPTIONS provides CLI-equivalent flags.
$env:NODE_NO_WARNINGS = "1"
$env:NODE_OPTIONS = (($env:NODE_OPTIONS + ' ') + '--no-warnings').Trim()

# Best-effort: make Mapbox token available to the API process.
# In this repo, the token is often stored in apps/web/.env.local as NEXT_PUBLIC_MAPBOX_TOKEN.
# The API expects MAPBOX_ACCESS_TOKEN (preferred) or NEXT_PUBLIC_MAPBOX_TOKEN.
if (-not $env:MAPBOX_ACCESS_TOKEN) {
    $webEnvPath = Join-Path $PSScriptRoot "apps\web\.env.local"
    if (Test-Path $webEnvPath) {
        try {
            $lines = Get-Content $webEnvPath -ErrorAction Stop
            foreach ($line in $lines) {
                $safeLine = ""
                if ($null -ne $line) { $safeLine = [string]$line }
                $trimmed = $safeLine.Trim()
                if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }

                # Basic dotenv parsing: KEY=VALUE
                $m = [regex]::Match($trimmed, '^(?<k>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<v>.*)$')
                if (-not $m.Success) { continue }
                $k = $m.Groups['k'].Value
                $v = $m.Groups['v'].Value.Trim()
                if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
                    $v = $v.Substring(1, $v.Length - 2)
                }

                if ($k -ieq "MAPBOX_ACCESS_TOKEN" -and $v) { $env:MAPBOX_ACCESS_TOKEN = $v; break }
                if ($k -ieq "NEXT_PUBLIC_MAPBOX_TOKEN" -and $v) { $env:MAPBOX_ACCESS_TOKEN = $v; break }
            }

            if ($env:MAPBOX_ACCESS_TOKEN) {
                Write-Host "Loaded MAPBOX_ACCESS_TOKEN for API (from apps/web/.env.local)." -ForegroundColor Cyan
            }
        } catch {
            Write-Host "Mapbox token auto-load skipped: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

Write-Host "Starting API + Web dev servers..." -ForegroundColor Cyan

npm run dev

