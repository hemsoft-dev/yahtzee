# Launch Third Roll — Convex backend + Electron desktop app (same terminal)
Set-Location "$PSScriptRoot"

Write-Host "Starting Convex backend..." -ForegroundColor Cyan
$convex = Start-Process bun -ArgumentList "run", "dev:convex" -NoNewWindow -PassThru

Start-Sleep 3

try {
    Write-Host "Starting desktop app..." -ForegroundColor Cyan
    bun run dev:desktop
} finally {
    Write-Host "Stopping Convex backend..." -ForegroundColor Cyan
    $convex | Stop-Process -Force
}
