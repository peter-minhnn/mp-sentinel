<#
.SYNOPSIS
  MP Sentinel branch review runner (Max Recall).
.DESCRIPTION
  Loads .env, rebuilds the source index, then runs mp-sentinel in branch-diff
  mode.  Outputs timestamped Markdown + JSON reports under reports/.
.PARAMETER Ai
  Enable AI review (default: deterministic/dry-run only).
.PARAMETER CompareBranch
  Branch to compare against (default: origin/main).
.PARAMETER TargetBranch
  Target branch override (falls back to CI_MERGE_REQUEST_TARGET_BRANCH_NAME or origin/main).
.PARAMETER SeverityThreshold
  FAIL threshold for the gate: CRITICAL, WARNING, or INFO (default: INFO for max recall).
.PARAMETER Concurrency
  Max parallel AI requests (default: from config or 2).
.EXAMPLE
  .\scripts\run-review.ps1 -Ai
  .\scripts\run-review.ps1 -Ai -CompareBranch origin/develop
  .\scripts\run-review.ps1                           # deterministic only
#>

[CmdletBinding()]
param(
  [switch]$Ai,
  [string]$CompareBranch,
  [string]$TargetBranch,
  [ValidateSet('CRITICAL', 'WARNING', 'INFO')]
  [string]$SeverityThreshold = 'INFO',
  [int]$Concurrency = 0
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path "$scriptDir\.."

# ── 1. Load .env ──────────────────────────────────────────────────────────────
Write-Host "==> Loading .env ..." -ForegroundColor Cyan
$envFile = Join-Path $projectRoot '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $key, $value = $line -split '=', 2
      $key = $key.Trim()
      $value = $value.Trim()
      if ($key -and (-not (Test-Path "Env:$key"))) {
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
      }
    }
  }
  Write-Host "   .env loaded ($envFile)" -ForegroundColor Gray
} else {
  Write-Warning ".env not found at $envFile — using existing environment"
}

# ── 2. Ensure dist is built ────────────────────────────────────────────────────
$distIndex = Join-Path $projectRoot 'dist' 'index.js'
if (-not (Test-Path $distIndex)) {
  Write-Host "==> Building dist ..." -ForegroundColor Cyan
  Push-Location $projectRoot
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
  } finally {
    Pop-Location
  }
}

# ── 3. Rebuild index to avoid stale index ──────────────────────────────────────
Write-Host "==> Rebuilding source index ..." -ForegroundColor Cyan
Push-Location $projectRoot
try {
  node dist/index.js indexing --force
  if ($LASTEXITCODE -ne 0) { throw "Indexing failed" }

  # Index health check (informational only)
  node dist/index.js indexing --health
} finally {
  Pop-Location
}

# ── 4. Determine target branch ─────────────────────────────────────────────────
if (-not $TargetBranch) {
  $TargetBranch = $env:CI_MERGE_REQUEST_TARGET_BRANCH_NAME
}
if (-not $TargetBranch) {
  $TargetBranch = 'origin/main'
}
if (-not $CompareBranch) {
  $CompareBranch = $TargetBranch
}

Write-Host "==> Comparing against: $CompareBranch" -ForegroundColor Cyan

# ── 5. Timestamped output paths ────────────────────────────────────────────────
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportsDir = Join-Path $projectRoot 'reports'
if (-not (Test-Path $reportsDir)) {
  New-Item -ItemType Directory -Path $reportsDir -Force | Out-Null
}
$mdReport   = Join-Path $reportsDir "review-$timestamp.md"
$jsonReport = Join-Path $reportsDir "review-$timestamp.json"

# ── 6. Run mp-sentinel ─────────────────────────────────────────────────────────
$args = @(
  'dist/index.js',
  '--branch-diff',
  '--compare-branch', $CompareBranch,
  '--fetch',
  '--no-cache',
  '--severity-threshold', $SeverityThreshold,
  '--format', 'json',
  '--output', $mdReport
)

if ($Ai) {
  $args += '--ai'
  Write-Host "==> Running AI branch review (max recall) ..." -ForegroundColor Cyan
} else {
  $args += '--no-ai', '--dry-run'
  Write-Host "==> Running deterministic branch review ..." -ForegroundColor Cyan
}

if ($Concurrency -gt 0) {
  $args += '--concurrency', $Concurrency
}

Push-Location $projectRoot
try {
  $jsonOutput = & node $args 2>&1
  $exitCode = $LASTEXITCODE

  # Write JSON report
  $jsonOutput | Out-File -FilePath $jsonReport -Encoding utf8

  Write-Host "`n==> Reports:" -ForegroundColor Green
  Write-Host "   Markdown : $mdReport"
  Write-Host "   JSON     : $jsonReport"

  if ($exitCode -ne 0) {
    Write-Host "`n==> Review found issues (exit code: $exitCode)" -ForegroundColor Yellow
  } else {
    Write-Host "`n==> Review passed — no findings above threshold" -ForegroundColor Green
  }

  # Also output the JSON to stdout for CI artifact capture
  Write-Output $jsonOutput

  exit $exitCode
} finally {
  Pop-Location
}
