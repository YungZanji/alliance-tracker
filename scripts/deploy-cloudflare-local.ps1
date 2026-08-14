$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CloudflareDir = Join-Path $RepoRoot 'cloudflare'
$LogPath = Join-Path $RepoRoot 'cloudflare-deploy.log'

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host $Text -ForegroundColor Cyan
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $Command @Arguments
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    if ($code -ne 0) { throw "Command failed with exit code $code`: $Command $($Arguments -join ' ')" }
}

function Get-WranglerWhoamiText {
    $output = (& npx wrangler whoami 2>&1 | Out-String).Trim()
    if ($output) { Write-Host $output }
    return $output
}

function Test-WranglerAuthenticated([string]$WhoamiText) {
    if ([string]::IsNullOrWhiteSpace($WhoamiText)) { return $false }
    if ($WhoamiText -match '(?i)not authenticated') { return $false }
    if ($WhoamiText -match '(?i)please run\s+`?wrangler login`?') { return $false }
    return ($WhoamiText -match '(?i)logged in|associated with|account')
}

$transcriptStarted = $false
try {
    New-Item -ItemType File -Path $LogPath -Force | Out-Null
    Start-Transcript -Path $LogPath -Append | Out-Null
    $transcriptStarted = $true

    Write-Host '============================================================'
    Write-Host '  Alliance Tracker - Local Cloudflare Deploy'
    Write-Host '============================================================'
    Write-Host ''
    Write-Host 'This deploys the current checkout to the production Worker/D1 project.'
    Write-Host "Log file: $LogPath"

    if (-not (Test-Path $CloudflareDir -PathType Container)) { throw "Cloudflare project folder was not found: $CloudflareDir" }
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue) -or -not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw 'Node.js/npm/npx were not found. Install the current Node.js LTS release and run this file again.'
    }

    Push-Location $CloudflareDir
    try {
        Write-Step '[1/8] Installing/updating Wrangler dependencies...'
        Invoke-Native npm install

        Write-Step '[2/8] Validating Worker and portal JavaScript...'
        Invoke-Native npm run check

        Write-Step '[3/8] Checking Cloudflare login...'
        $whoami = Get-WranglerWhoamiText
        if (-not (Test-WranglerAuthenticated $whoami)) {
            Write-Host 'Wrangler is not authenticated. Opening the Cloudflare login flow.' -ForegroundColor Yellow
            Invoke-Native npx wrangler login
            $whoami = Get-WranglerWhoamiText
        }
        if (-not (Test-WranglerAuthenticated $whoami)) { throw 'Wrangler login did not complete successfully.' }

        Write-Step '[4/8] Finding production D1 database...'
        $d1Output = & npx wrangler d1 list --json
        if ($LASTEXITCODE -ne 0) { throw 'Unable to list Cloudflare D1 databases.' }
        $databases = (($d1Output | Out-String).Trim() | ConvertFrom-Json)
        $database = @($databases) | Where-Object { $_.name -eq 'alliance-tracker-db' } | Select-Object -First 1
        if (-not $database) { throw 'alliance-tracker-db was not found in the authorized Cloudflare account.' }
        $dbId = if ($database.PSObject.Properties.Name -contains 'uuid' -and $database.uuid) { [string]$database.uuid } elseif ($database.PSObject.Properties.Name -contains 'id' -and $database.id) { [string]$database.id } else { '' }
        if (-not $dbId) { throw 'Found alliance-tracker-db, but Wrangler did not return its database ID.' }
        Invoke-Native node scripts\render-wrangler.mjs $dbId

        Write-Step '[5/8] Testing pending migrations locally...'
        Invoke-Native npx wrangler d1 migrations apply alliance-tracker-db --local --config wrangler.generated.jsonc

        Write-Host ''
        Write-Host 'Local migration test passed. The next step changes production.' -ForegroundColor Yellow
        $answer = Read-Host 'Type DEPLOY to continue'
        if ($answer -cne 'DEPLOY') { throw 'Production deployment cancelled. No remote migration or deploy was started.' }

        Write-Step '[6/8] Applying pending production migrations...'
        Invoke-Native npx wrangler d1 migrations apply alliance-tracker-db --remote --config wrangler.generated.jsonc

        Write-Step '[7/8] Deploying Worker and portal assets...'
        Invoke-Native npx wrangler deploy --config wrangler.generated.jsonc

        Write-Step '[8/8] Checking the live health endpoint...'
        $health = Invoke-RestMethod -Uri 'https://wdz.state305.cc/api/health' -TimeoutSec 20
        if (-not $health.ok) { throw 'Health endpoint returned ok=false.' }

        Write-Host ''
        Write-Host 'Deployment complete: https://wdz.state305.cc' -ForegroundColor Green
        exit 0
    }
    finally { Pop-Location }
}
catch {
    Write-Host ''
    Write-Host 'DEPLOY FAILED' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Full deployment log: $LogPath" -ForegroundColor Yellow
    exit 1
}
finally {
    if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
}
