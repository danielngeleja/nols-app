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
$AgreementTemplateSrc = "$RepoRoot\docs\NoLSAF_Sales_Partner_Agreement.md"
$AgreementDictionarySrc = "$RepoRoot\docs\NoLSAF_Sales_Partner_Agreement.fields.json"
$PrismaTypeScriptCompiler = "$RepoRoot\packages\prisma\node_modules\typescript\bin\tsc"
$SharedTypeScriptCompiler = "$RepoRoot\packages\shared\node_modules\typescript\bin\tsc"
$ApiTypeScriptCompiler = "$ApiDir\node_modules\typescript\bin\tsc"

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
    foreach ($temporaryPath in @($VendorRoot, $SchemaDir, $DocsDir, $PkgJsonBackup)) {
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

    # 3. Patch apps/api/package.json to install the vendored packages.
    # These dependencies are not present in the source manifest, so replacing
    # existing file: entries is insufficient. Add or overwrite them explicitly.
    Write-Host "-- Patching package.json ..."
    Copy-Item $PkgJsonPath $PkgJsonBackup -Force
    $PackageBackupCreated = $true

    $packageJson = Get-Content $PkgJsonPath -Raw | ConvertFrom-Json
    if ($null -eq $packageJson.dependencies) {
        $packageJson | Add-Member -MemberType NoteProperty -Name dependencies -Value ([PSCustomObject]@{})
    }

    $vendoredDependencies = [ordered]@{
        "@nolsaf/prisma" = "file:./_workspace/@nolsaf/prisma"
        "@nolsaf/shared" = "file:./_workspace/@nolsaf/shared"
    }

    foreach ($dependency in $vendoredDependencies.GetEnumerator()) {
        $existingProperty = $packageJson.dependencies.PSObject.Properties[$dependency.Key]
        if ($null -eq $existingProperty) {
            $packageJson.dependencies | Add-Member -MemberType NoteProperty -Name $dependency.Key -Value $dependency.Value
        } else {
            $existingProperty.Value = $dependency.Value
        }
    }

    $patchedContent = ($packageJson | ConvertTo-Json -Depth 100) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($PkgJsonPath, $patchedContent, [System.Text.UTF8Encoding]::new($false))

    $patchedPackageJson = Get-Content $PkgJsonPath -Raw | ConvertFrom-Json
    foreach ($dependency in $vendoredDependencies.GetEnumerator()) {
        if ($patchedPackageJson.dependencies.PSObject.Properties[$dependency.Key].Value -ne $dependency.Value) {
            throw "Failed to wire $($dependency.Key) to $($dependency.Value)."
        }
    }

    # 4. Build the API (TypeScript to dist).
    Write-Host "`n-- Building @nolsaf/api ..."
    Invoke-InDirectory $ApiDir {
        Remove-Item "$ApiDir\dist" -Recurse -Force -ErrorAction SilentlyContinue
        node $ApiTypeScriptCompiler -p tsconfig.json
        Assert-CommandSucceeded "Building @nolsaf/api"
        node scripts/fix-esm-imports.mjs
        Assert-CommandSucceeded "Fixing API ESM imports"
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

    # 6. Stage runtime sales agreement artifacts into the EB bundle.
    foreach ($agreementArtifact in @($AgreementTemplateSrc, $AgreementDictionarySrc)) {
        if (-not (Test-Path -LiteralPath $agreementArtifact -PathType Leaf)) {
            throw "Sales agreement source artifact not found: $agreementArtifact"
        }
    }

    Write-Host "-- Staging sales agreement artifacts into $DocsDir ..."
    New-Item -ItemType Directory -Path $DocsDir -Force | Out-Null
    $DocsCreated = $true
    Copy-Item $AgreementTemplateSrc -Destination "$DocsDir\NoLSAF_Sales_Partner_Agreement.md" -Force
    Copy-Item $AgreementDictionarySrc -Destination "$DocsDir\NoLSAF_Sales_Partner_Agreement.fields.json" -Force

    # 7. Validate every deployment-critical artifact before invoking EB.
    Write-Host "-- Validating deployment bundle ..."
    $requiredFiles = @(
        "$ApiDir\dist\src\index.js",
        "$VendorRoot\@nolsaf\prisma\package.json",
        "$VendorRoot\@nolsaf\prisma\dist\index.js",
        "$VendorRoot\@nolsaf\shared\package.json",
        "$SchemaDir\schema.prisma",
        "$DocsDir\NoLSAF_Sales_Partner_Agreement.md",
        "$DocsDir\NoLSAF_Sales_Partner_Agreement.fields.json",
        "$ApiDir\.platform\hooks\predeploy\generate-prisma.sh"
    )
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

    if ($VendorCreated -and (Test-Path -LiteralPath $VendorRoot -PathType Container)) {
        Write-Host "-- Cleaning vendor dir ..."
        Remove-Item $VendorRoot -Recurse -Force
    }

    if ($SchemaCreated -and (Test-Path -LiteralPath $SchemaDir -PathType Container)) {
        Write-Host "-- Cleaning staged Prisma schema ..."
        Remove-Item $SchemaDir -Recurse -Force
    }

    if ($DocsCreated -and (Test-Path -LiteralPath $DocsDir -PathType Container)) {
        Write-Host "-- Cleaning staged sales agreement artifacts ..."
        Remove-Item $DocsDir -Recurse -Force
    }
}

if ($ValidateOnly) {
    Write-Host "`n=== [deploy-eb] Validation passed; no AWS deployment was performed. ==="
} else {
    Write-Host "`n=== [deploy-eb] Deployment completed. ==="
}
