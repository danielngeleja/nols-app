# deploy-eb.ps1
# Vendors workspace packages so EB can resolve them without pnpm workspaces,
# then runs `eb deploy` and cleans up.
#
# Usage (from apps/api):
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-eb.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-eb.ps1 -ValidateOnly

param(
    [switch]$ValidateOnly,
    [string]$EnvironmentName = "nolsaf-api-production"
)

Set-StrictMode -Off
$ErrorActionPreference = "Stop"

$ApiDir = $PSScriptRoot | Split-Path -Parent
$RepoRoot = $ApiDir | Split-Path -Parent | Split-Path -Parent
$VendorRoot = "$ApiDir\_workspace"
$SchemaDir = "$ApiDir\prisma"
$DocsDir = "$ApiDir\docs"
$PkgJsonPath = "$ApiDir\package.json"
$PkgJsonBackup = "$ApiDir\package.json.predeploy-bak"
$PkgLockPath = "$ApiDir\package-lock.json"
$EbLockArtifact = "$ApiDir\scripts\eb-package-lock.json"
$EbLockScript = "$ApiDir\scripts\prepare-eb-package-lock.mjs"
$PrismaTypeScriptCompiler = "$RepoRoot\packages\prisma\node_modules\typescript\bin\tsc"
$SharedTypeScriptCompiler = "$RepoRoot\packages\shared\node_modules\typescript\bin\tsc"
$ApiTypeScriptCompiler = "$ApiDir\node_modules\typescript\bin\tsc"
$RedisCaCertPath = "$ApiDir\certs\redis_ca.pem"
$SocketProxyConfigPath = "$ApiDir\.platform\nginx\conf.d\elasticbeanstalk\01_socket_io.conf"

$RuntimeArtifacts = @(
    [PSCustomObject]@{
        Source = "$RepoRoot\docs\NoLSAF_Sales_Partner_Agreement.md"
        Destination = "$DocsDir\NoLSAF_Sales_Partner_Agreement.md"
    },
    [PSCustomObject]@{
        Source = "$RepoRoot\docs\NoLSAF_Sales_Partner_Agreement.fields.json"
        Destination = "$DocsDir\NoLSAF_Sales_Partner_Agreement.fields.json"
    },
    [PSCustomObject]@{
        Source = "$RepoRoot\docs\NoLSAF_Operator_Mutual_NDA.md"
        Destination = "$DocsDir\NoLSAF_Operator_Mutual_NDA.md"
    },
    [PSCustomObject]@{
        Source = "$RepoRoot\docs\NoLSAF_Operator_Mutual_NDA.fields.json"
        Destination = "$DocsDir\NoLSAF_Operator_Mutual_NDA.fields.json"
    }
)

$VendorCreated = $false
$SchemaCreated = $false
$DocsCreated = $false
$PackageBackupCreated = $false

function Assert-CommandSucceeded {
    param([string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Invoke-InDirectory {
    param(
        [string]$Path,
        [scriptblock]$Action
    )

    Push-Location -LiteralPath $Path
    try {
        & $Action
    } finally {
        Pop-Location
    }
}

Write-Host "=== [deploy-eb] API dir  : $ApiDir"
Write-Host "=== [deploy-eb] Repo root: $RepoRoot"

try {
    foreach ($temporaryPath in @($VendorRoot, $SchemaDir, $DocsDir, $PkgJsonBackup, $PkgLockPath)) {
        if (Test-Path -LiteralPath $temporaryPath) {
            throw "Temporary deployment path already exists: $temporaryPath. Inspect and remove the stale path before retrying."
        }
    }
    foreach ($compiler in @($PrismaTypeScriptCompiler, $SharedTypeScriptCompiler, $ApiTypeScriptCompiler)) {
        if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
            throw "Workspace TypeScript compiler not found: $compiler. Run npm ci from $RepoRoot before deploying."
        }
    }

    # 1. Rebuild workspace packages with CJS output.
    Write-Host "`n-- Building @nolsaf/prisma ..."
    Invoke-InDirectory "$RepoRoot\packages\prisma" {
        node $PrismaTypeScriptCompiler -p tsconfig.json
        Assert-CommandSucceeded "Building @nolsaf/prisma"
    }

    Write-Host "-- Building @nolsaf/shared ..."
    Invoke-InDirectory "$RepoRoot\packages\shared" {
        node $SharedTypeScriptCompiler -p tsconfig.json
        Assert-CommandSucceeded "Building @nolsaf/shared"
    }

    # 2. Copy packages into apps/api/_workspace (vendor dir).
    Write-Host "`n-- Vendoring packages into $VendorRoot ..."
    New-Item -ItemType Directory -Path $VendorRoot -Force | Out-Null
    $VendorCreated = $true

    foreach ($pkg in @("prisma", "shared")) {
        $src = "$RepoRoot\packages\$pkg"
        $dst = "$VendorRoot\@nolsaf\$pkg"

        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item "$src\package.json" -Destination $dst -Force
        Copy-Item "$src\dist" -Destination $dst -Recurse -Force
    }

    # 3. Materialize the deterministic EB-only package manifest and lock.
    Write-Host "-- Materializing deterministic EB package manifest and lock ..."
    Copy-Item $PkgJsonPath $PkgJsonBackup -Force
    $PackageBackupCreated = $true
    node $EbLockScript --materialize
    Assert-CommandSucceeded "Materializing deterministic EB package manifest and lock"

    # 4. Build the API (TypeScript to dist).
    Write-Host "`n-- Building @nolsaf/api ..."
    Invoke-InDirectory $ApiDir {
        Remove-Item "$ApiDir\dist" -Recurse -Force -ErrorAction SilentlyContinue
        node $ApiTypeScriptCompiler -p tsconfig.build.json
        Assert-CommandSucceeded "Building @nolsaf/api"
        node scripts/fix-esm-imports.mjs
        Assert-CommandSucceeded "Fixing API ESM imports"
        node scripts/write-release-metadata.mjs
        Assert-CommandSucceeded "Embedding API release metadata"
    }

    # 5. Stage Prisma schema and migrations into the EB bundle.
    # The on-instance predeploy hook runs relative to apps/api.
    $PrismaSrc = "$RepoRoot\prisma"
    $SchemaSrc = "$PrismaSrc\schema.prisma"
    $MigrationsSrc = "$PrismaSrc\migrations"
    if (-not (Test-Path -LiteralPath $SchemaSrc -PathType Leaf)) {
        throw "Prisma schema not found: $SchemaSrc"
    }
    if (-not (Test-Path -LiteralPath $MigrationsSrc -PathType Container)) {
        throw "Prisma migrations directory not found: $MigrationsSrc"
    }

    Write-Host "`n-- Staging Prisma schema and migrations into $SchemaDir ..."
    New-Item -ItemType Directory -Path $SchemaDir -Force | Out-Null
    $SchemaCreated = $true
    Copy-Item $SchemaSrc -Destination "$SchemaDir\schema.prisma" -Force
    Copy-Item $MigrationsSrc -Destination "$SchemaDir\migrations" -Recurse -Force

    # 6. Stage every controlled runtime document into the EB bundle.
    foreach ($runtimeArtifact in $RuntimeArtifacts) {
        if (-not (Test-Path -LiteralPath $runtimeArtifact.Source -PathType Leaf)) {
            throw "Runtime source artifact not found: $($runtimeArtifact.Source)"
        }
    }

    Write-Host "-- Staging controlled runtime documents into $DocsDir ..."
    New-Item -ItemType Directory -Path $DocsDir -Force | Out-Null
    $DocsCreated = $true
    foreach ($runtimeArtifact in $RuntimeArtifacts) {
        Copy-Item $runtimeArtifact.Source -Destination $runtimeArtifact.Destination -Force
    }

    # 7. Validate every deployment-critical artifact before invoking EB.
    Write-Host "-- Validating deployment bundle ..."
    $requiredFiles = @(
        "$ApiDir\dist\src\index.js",
        "$ApiDir\dist\scripts\backfill-rooms-spec-codes.js",
        "$ApiDir\dist\release.json",
        "$VendorRoot\@nolsaf\prisma\package.json",
        "$VendorRoot\@nolsaf\prisma\dist\index.js",
        "$VendorRoot\@nolsaf\shared\package.json",
        "$SchemaDir\schema.prisma",
        $PkgLockPath,
        $EbLockArtifact,
        "$ApiDir\.platform\hooks\predeploy\generate-prisma.sh",
        $RedisCaCertPath,
        $SocketProxyConfigPath
    )
    $requiredFiles += @($RuntimeArtifacts | ForEach-Object { $_.Destination })
    foreach ($requiredFile in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Deployment bundle is missing required file: $requiredFile"
        }
    }

    $migrationFiles = @(Get-ChildItem "$SchemaDir\migrations" -Filter "migration.sql" -File -Recurse)
    if ($migrationFiles.Count -eq 0) {
        throw "Deployment bundle contains no Prisma migration.sql files."
    }
    Write-Host "   Bundle contains $($migrationFiles.Count) Prisma migration files."

    $compiledJavaScript = @(
        Get-ChildItem "$ApiDir\dist\src" -Filter "*.js" -File -Recurse
        Get-Item "$ApiDir\dist\scripts\backfill-rooms-spec-codes.js"
    )
    if ($compiledJavaScript.Count -eq 0) {
        throw "Deployment bundle contains no compiled API JavaScript files."
    }
    $missingSourceMaps = @(
        $compiledJavaScript | Where-Object {
            -not (Test-Path -LiteralPath "$($_.FullName).map" -PathType Leaf)
        }
    )
    if ($missingSourceMaps.Count -gt 0) {
        throw "Deployment bundle is missing $($missingSourceMaps.Count) adjacent API source maps."
    }
    foreach ($excludedBuildPath in @("$ApiDir\dist\src\__tests__", "$ApiDir\dist\src\dev")) {
        if (Test-Path -LiteralPath $excludedBuildPath) {
            throw "Production API build contains excluded test/development output: $excludedBuildPath"
        }
    }
    Write-Host "   Bundle contains $($compiledJavaScript.Count) production JavaScript files with adjacent source maps."

    if ($ValidateOnly) {
        Write-Host "`n-- ValidateOnly selected; skipping Elastic Beanstalk deployment."
    } else {
        # 8. Deploy explicitly to the production environment.
        Write-Host "`n-- Deploying to Elastic Beanstalk environment $EnvironmentName ..."
        Invoke-InDirectory $ApiDir {
            $ebCmd = Get-Command eb -ErrorAction SilentlyContinue
            if ($ebCmd) {
                $eb = $ebCmd.Source
            } else {
                $eb = "C:\Users\NoLS Tanzania\AppData\Roaming\Python\Python312\Scripts\eb.exe"
            }
            if (-not (Test-Path -LiteralPath $eb -PathType Leaf)) {
                throw "Elastic Beanstalk CLI not found. Install awsebcli or update the fallback path in this script."
            }

            $env:PYTHONUTF8 = "1"
            & $eb deploy $EnvironmentName
            Assert-CommandSucceeded "Elastic Beanstalk deployment"
        }
    }
} finally {
    # Always restore the source tree, including when build or deployment fails.
    if ($PackageBackupCreated -and (Test-Path -LiteralPath $PkgJsonBackup -PathType Leaf)) {
        Write-Host "`n-- Restoring package.json ..."
        Move-Item $PkgJsonBackup $PkgJsonPath -Force
    }

    if (Test-Path -LiteralPath $PkgLockPath -PathType Leaf) {
        Write-Host "-- Cleaning staged package-lock.json ..."
        Remove-Item $PkgLockPath -Force
    }

    if ($VendorCreated -and (Test-Path -LiteralPath $VendorRoot -PathType Container)) {
        Write-Host "-- Cleaning vendor dir ..."
        Remove-Item $VendorRoot -Recurse -Force
    }

    if ($SchemaCreated -and (Test-Path -LiteralPath $SchemaDir -PathType Container)) {
        Write-Host "-- Cleaning staged Prisma schema ..."
        Remove-Item $SchemaDir -Recurse -Force
    }

    if ($DocsCreated -and (Test-Path -LiteralPath $DocsDir -PathType Container)) {
        Write-Host "-- Cleaning staged runtime documents ..."
        Remove-Item $DocsDir -Recurse -Force
    }
}

if ($ValidateOnly) {
    Write-Host "`n=== [deploy-eb] Validation passed; no AWS deployment was performed. ==="
} else {
    Write-Host "`n=== [deploy-eb] Deployment completed. ==="
}
