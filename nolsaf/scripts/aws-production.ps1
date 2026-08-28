<#!
.SYNOPSIS
Manual NoLSAF AWS production operations without a CI/CD runner.

.DESCRIPTION
Provides one local entry point for read-only inspection, bundle validation,
deployment, health checks, logs, SSH, and AWS Console links. Production deploys
remain guarded: they require a clean main branch matching origin/main, an
explicit production acknowledgement, and an explicit database-change state.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\aws-production.ps1 preflight

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\aws-production.ps1 deploy -ConfirmProduction -DatabaseChange None
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet("help", "preflight", "status", "validate", "deploy", "health", "events", "logs", "ssh", "open", "console")]
    [string]$Action = "help",

    [string]$Profile,
    [string]$Region = "eu-north-1",
    [string]$ApplicationName = "nolsaf-api",
    [string]$EnvironmentName = "nolsaf-api-production",
    [string]$RdsInstance = "database-1",
    [string]$ApiUrl = "https://api.nolsaf.com",

    [ValidateSet("Unspecified", "None", "AppliedAndVerified")]
    [string]$DatabaseChange = "Unspecified",

    [switch]$ConfirmProduction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $RepoRoot "apps\api"
$DeployScript = Join-Path $ApiDir "scripts\deploy-eb.ps1"
$KnownEbCli = "C:\Users\NoLS Tanzania\AppData\Roaming\Python\Python312\Scripts\eb.exe"

if ($Profile) {
    $env:AWS_PROFILE = $Profile
    $env:AWS_EB_PROFILE = $Profile
}
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
$env:PYTHONUTF8 = "1"

function Write-Section {
    param([string]$Title)
    Write-Host "`n=== $Title ===" -ForegroundColor Cyan
}

function Resolve-EbCli {
    $command = Get-Command eb -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    if (Test-Path -LiteralPath $KnownEbCli -PathType Leaf) {
        return $KnownEbCli
    }
    throw "Elastic Beanstalk CLI was not found. Install it with 'py -m pip install --user --upgrade awsebcli', then retry."
}

function Assert-CommandAvailable {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Get-GitValue {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $value = & git @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
    return ($value | Out-String).Trim()
}

function Assert-ReleaseCheckout {
    Write-Section "Release checkout guard"
    Push-Location -LiteralPath $RepoRoot
    try {
        $branch = Get-GitValue @("branch", "--show-current")
        $head = Get-GitValue @("rev-parse", "HEAD")
        $remoteMain = Get-GitValue @("rev-parse", "origin/main")
        $status = (& git status --porcelain --untracked-files=all | Out-String).Trim()

        Write-Host "Branch: $branch"
        Write-Host "HEAD:   $head"
        Write-Host "Remote: $remoteMain (local origin/main reference)"

        if ($branch -ne "main") {
            throw "Production deployment is allowed only from main; current branch is '$branch'."
        }
        if ($status) {
            throw "Production deployment requires a clean working tree. Review 'git status --short'."
        }
        if ($head -ne $remoteMain) {
            throw "HEAD does not match origin/main. Fetch and reconcile main before deploying."
        }
    } finally {
        Pop-Location
    }
}

function Assert-AwsIdentity {
    Assert-CommandAvailable "aws"
    Write-Section "AWS identity"
    $arguments = @(
        "sts", "get-caller-identity",
        "--region", $Region,
        "--query", "{Account:Account,Arn:Arn}",
        "--output", "table",
        "--no-cli-pager"
    )
    Invoke-Native "aws" @arguments
}

function Show-Preflight {
    Write-Section "Local tooling"
    Assert-CommandAvailable "git"
    Assert-CommandAvailable "node"
    Assert-CommandAvailable "npm"
    Assert-CommandAvailable "aws"
    $eb = Resolve-EbCli

    Write-Host "Repository:  $RepoRoot"
    Write-Host "API:         $ApiDir"
    Write-Host "AWS CLI:     $((Get-Command aws).Source)"
    Write-Host "EB CLI:      $eb"
    Write-Host "Region:      $Region"
    Write-Host "Environment: $EnvironmentName"
    if ($Profile) {
        Write-Host "Profile:     $Profile"
    } else {
        Write-Host "Profile:     AWS default credential provider chain"
    }

    if (-not (Test-Path -LiteralPath $DeployScript -PathType Leaf)) {
        throw "Deployment script is missing: $DeployScript"
    }
    $ebConfig = Join-Path $ApiDir ".elasticbeanstalk\config.yml"
    if (-not (Test-Path -LiteralPath $ebConfig -PathType Leaf)) {
        throw "Local EB configuration is missing: $ebConfig. Run 'eb init nolsaf-api --region $Region' from apps/api."
    }

    Push-Location -LiteralPath $RepoRoot
    try {
        Write-Host "Branch:      $(Get-GitValue @('branch', '--show-current'))"
        Write-Host "Commit:      $(Get-GitValue @('rev-parse', '--short=12', 'HEAD'))"
        $status = (& git status --porcelain --untracked-files=all | Out-String).Trim()
        Write-Host "Tree:        $(if ($status) { 'DIRTY' } else { 'clean' })"
    } finally {
        Pop-Location
    }

    Assert-AwsIdentity
}

function Show-AwsStatus {
    Show-Preflight

    Write-Section "Elastic Beanstalk"
    $ebArguments = @(
        "elasticbeanstalk", "describe-environments",
        "--region", $Region,
        "--application-name", $ApplicationName,
        "--environment-names", $EnvironmentName,
        "--query", "Environments[0].{Environment:EnvironmentName,Status:Status,Health:Health,HealthStatus:HealthStatus,Version:VersionLabel,CNAME:CNAME,Platform:PlatformArn}",
        "--output", "table",
        "--no-cli-pager"
    )
    Invoke-Native "aws" @ebArguments

    Write-Section "RDS"
    $rdsArguments = @(
        "rds", "describe-db-instances",
        "--region", $Region,
        "--db-instance-identifier", $RdsInstance,
        "--query", "DBInstances[0].{Instance:DBInstanceIdentifier,Status:DBInstanceStatus,Engine:Engine,Version:EngineVersion,Encrypted:StorageEncrypted,MultiAZ:MultiAZ,Public:PubliclyAccessible}",
        "--output", "table",
        "--no-cli-pager"
    )
    Invoke-Native "aws" @rdsArguments

    Show-Health
}

function Show-Health {
    Write-Section "Public API health"
    foreach ($path in @("health", "ready", "live")) {
        $uri = "$($ApiUrl.TrimEnd('/'))/$path"
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 30
            Write-Host "$uri -> HTTP $($response.StatusCode)"
            if ($response.Content) {
                Write-Host $response.Content
            }
        } catch {
            Write-Warning "$uri -> $($_.Exception.Message)"
            if ($path -eq "health") {
                throw
            }
        }
    }
}

function Show-Help {
    @"
Manual NoLSAF AWS operations

  help       Show this command list.
  preflight  Verify local tools, EB config, Git state, and AWS identity.
  status     Show EB, RDS, and public API health without changing AWS.
  validate   Build and validate the exact EB bundle without deploying it.
  deploy     Deploy API to EB; requires -ConfirmProduction and -DatabaseChange.
  health     Call /health, /ready, and /live.
  events     Show recent EB environment events.
  logs       Download full EB logs through the EB CLI.
  ssh        Open an interactive SSH session to the EB environment.
  open       Open the EB environment URL in the default browser.
  console    Print direct AWS Console links for this production stack.

Authentication options accepted by AWS and EB CLI:
  - default or named AWS CLI profile (-Profile <name>);
  - IAM Identity Center / SSO cached profile;
  - temporary or long-lived environment credentials;
  - EC2 instance-role credentials when run on an authorized AWS host.

Examples:
  .\scripts\aws-production.ps1 preflight -Profile nolsaf-production
  .\scripts\aws-production.ps1 validate
  .\scripts\aws-production.ps1 deploy -ConfirmProduction -DatabaseChange None
  .\scripts\aws-production.ps1 deploy -ConfirmProduction -DatabaseChange AppliedAndVerified
"@ | Write-Host
}

switch ($Action) {
    "help" { Show-Help }
    "preflight" { Show-Preflight }
    "status" { Show-AwsStatus }
    "validate" {
        Write-Section "Elastic Beanstalk bundle validation"
        Push-Location -LiteralPath $ApiDir
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $DeployScript -ValidateOnly -EnvironmentName $EnvironmentName
            if ($LASTEXITCODE -ne 0) {
                throw "Bundle validation failed with exit code $LASTEXITCODE."
            }
        } finally {
            Pop-Location
        }
    }
    "deploy" {
        if (-not $ConfirmProduction) {
            throw "Deployment requires -ConfirmProduction."
        }
        if ($DatabaseChange -eq "Unspecified") {
            throw "Specify -DatabaseChange None or -DatabaseChange AppliedAndVerified. See API_DEPLOYMENT_GUIDE.md for schema-bearing releases."
        }
        Show-Preflight
        Assert-ReleaseCheckout
        if ($DatabaseChange -eq "AppliedAndVerified") {
            Write-Host "Database state acknowledged as migrated and verified by the designated runner."
        } else {
            Write-Host "Release acknowledged as application-only with no Prisma/schema compatibility change."
        }
        Write-Section "Production API deployment"
        Push-Location -LiteralPath $ApiDir
        try {
            & powershell -NoProfile -ExecutionPolicy Bypass -File $DeployScript -EnvironmentName $EnvironmentName
            if ($LASTEXITCODE -ne 0) {
                throw "Elastic Beanstalk deployment failed with exit code $LASTEXITCODE."
            }
        } finally {
            Pop-Location
        }
        Show-AwsStatus
    }
    "health" { Show-Health }
    "events" {
        Assert-AwsIdentity
        Write-Section "Recent Elastic Beanstalk events"
        $arguments = @(
            "elasticbeanstalk", "describe-events",
            "--region", $Region,
            "--application-name", $ApplicationName,
            "--environment-name", $EnvironmentName,
            "--max-items", "50",
            "--query", "Events[].{Time:EventDate,Severity:Severity,Message:Message}",
            "--output", "table",
            "--no-cli-pager"
        )
        Invoke-Native "aws" @arguments
    }
    "logs" {
        $eb = Resolve-EbCli
        Assert-AwsIdentity
        Write-Section "Elastic Beanstalk logs"
        Push-Location -LiteralPath $ApiDir
        try {
            Invoke-Native $eb "logs" $EnvironmentName "--all"
        } finally {
            Pop-Location
        }
    }
    "ssh" {
        $eb = Resolve-EbCli
        Assert-AwsIdentity
        Push-Location -LiteralPath $ApiDir
        try {
            Invoke-Native $eb "ssh" $EnvironmentName
        } finally {
            Pop-Location
        }
    }
    "open" {
        $eb = Resolve-EbCli
        Assert-AwsIdentity
        Push-Location -LiteralPath $ApiDir
        try {
            Invoke-Native $eb "open" $EnvironmentName
        } finally {
            Pop-Location
        }
    }
    "console" {
        Write-Section "AWS Console"
        Write-Host "Elastic Beanstalk: https://$Region.console.aws.amazon.com/elasticbeanstalk/home?region=$Region#/environment/dashboard?applicationName=$ApplicationName&environmentId=$EnvironmentName"
        Write-Host "RDS:               https://$Region.console.aws.amazon.com/rds/home?region=$Region#database:id=$RdsInstance;is-cluster=false"
        Write-Host "CloudWatch Logs:   https://$Region.console.aws.amazon.com/cloudwatch/home?region=$Region#logsV2:log-groups"
        Write-Host "S3:                https://s3.console.aws.amazon.com/s3/home?region=$Region"
        Write-Host "IAM:               https://console.aws.amazon.com/iam/home"
        Write-Host "Billing:           https://console.aws.amazon.com/billing/home"
    }
}
