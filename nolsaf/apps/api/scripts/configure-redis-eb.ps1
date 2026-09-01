[CmdletBinding()]
param(
    [string]$ApplicationName = "nolsaf-api",
    [string]$EnvironmentName = "nolsaf-api-production",
    [string]$Region = "eu-north-1",
    [string]$RedisEndpoint,
    [string]$RedisUsername = "default",
    [string]$RedisCaPath,
    [switch]$Apply,
    [switch]$ConfirmTlsArtifactDeployed,
    [switch]$SkipConnectionTest
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RedisCaPath)) {
    $RedisCaPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\certs\redis_ca.pem"))
}

function Invoke-AwsCli {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $output = & aws @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($output -join [Environment]::NewLine)
    }
    return $output
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is not installed or is not available on PATH."
}

if (-not $Apply) {
    Write-Host "Dry run only. No AWS settings were changed."
    Write-Host "Target application/environment: $ApplicationName / $EnvironmentName ($Region)"
    Write-Host "Settings to configure:"
    Write-Host "  REDIS_URL=<secure prompt>"
    Write-Host "  REDIS_CA_CERT_PATH=certs/redis_ca.pem"
    Write-Host "  SOCKET_IO_REDIS_ADAPTER=true"
    Write-Host "  RUN_BACKGROUND_WORKERS=true"
    Write-Host "  REPORTS_CACHE_ENABLED=true"
    Write-Host "  WORKER_SINGLE_INSTANCE=false"
    Write-Host "  ALLOW_UNCOORDINATED_WORKERS=false"
    Write-Host "Run this script again with -Apply after signing in to AWS CLI."
    exit 0
}

if (-not $ConfirmTlsArtifactDeployed) {
    throw "Deploy the API artifact containing certs/redis_ca.pem and Redis TLS support first, then rerun with -ConfirmTlsArtifactDeployed. No AWS settings were changed."
}

if (-not (Test-Path -LiteralPath $RedisCaPath -PathType Leaf)) {
    throw "Redis CA bundle not found: $RedisCaPath"
}
$certificateCount = (Select-String -LiteralPath $RedisCaPath -Pattern '-----BEGIN CERTIFICATE-----').Count
if ($certificateCount -lt 1) {
    throw "Redis CA bundle contains no PEM certificates: $RedisCaPath"
}

try {
    $identity = Invoke-AwsCli sts get-caller-identity --output json | ConvertFrom-Json
} catch {
    throw "AWS CLI is not authenticated. Sign in with 'aws login' (or your organization's approved AWS authentication command), then retry."
}

Write-Host "Authenticated to AWS account $($identity.Account)."
Write-Host "Redis credentials are read through hidden prompts and are never written to the repository."
$secureRedisValue = $null
$redisValuePointer = [IntPtr]::Zero
$redisUrl = $null
$settingsFile = $null

try {
    if ([string]::IsNullOrWhiteSpace($RedisEndpoint)) {
        $secureRedisValue = Read-Host "Paste the Redis Cloud TLS URI (must start with rediss://)" -AsSecureString
        $redisValuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureRedisValue)
        $redisUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($redisValuePointer)
    } else {
        $endpointValue = $RedisEndpoint.Trim()
        if ($endpointValue -match 'YOUR-REDIS|HOST:PORT|example') {
            throw "Replace the RedisEndpoint placeholder with the actual Public endpoint shown by Redis Cloud (for example, a hostname followed by :port)."
        }
        if ($endpointValue -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
            $endpointValue = "rediss://$endpointValue"
        }
        try {
            $endpointUri = [Uri]$endpointValue
        } catch {
            throw "RedisEndpoint is invalid. Copy the exact Public endpoint from Redis Cloud in host:port format."
        }
        if ($endpointUri.Scheme -ne "rediss" -or [string]::IsNullOrWhiteSpace($endpointUri.Host) -or $endpointUri.Port -le 0) {
            throw "RedisEndpoint must be a valid Redis Cloud host:port value."
        }
        if ([string]::IsNullOrWhiteSpace($RedisUsername)) {
            throw "RedisUsername cannot be empty."
        }

        $secureRedisValue = Read-Host "Paste the Redis Cloud password" -AsSecureString
        $redisValuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureRedisValue)
        $redisPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($redisValuePointer)
        $escapedUsername = [Uri]::EscapeDataString($RedisUsername)
        $escapedPassword = [Uri]::EscapeDataString($redisPassword)
        $redisUrl = "rediss://${escapedUsername}:$escapedPassword@$($endpointUri.Host):$($endpointUri.Port)"
        $redisPassword = $null
        $escapedPassword = $null
    }

    $uri = [Uri]$redisUrl
    if ($uri.Scheme -ne "rediss" -or [string]::IsNullOrWhiteSpace($uri.Host) -or $uri.Port -le 0) {
        throw "A valid Redis TLS URI is required. Copy the TLS URI from Redis Cloud and ensure it starts with rediss://."
    }

    if (-not $SkipConnectionTest) {
        Write-Host "Testing the Redis TLS connection..."
        $env:NOLSAF_REDIS_SETUP_URL = $redisUrl
        $env:NOLSAF_REDIS_SETUP_CA_PATH = $RedisCaPath
        $apiDirectory = Split-Path -Parent $PSScriptRoot
        Push-Location $apiDirectory
        try {
            $testScript = @'
import fs from "node:fs";
import Redis from "ioredis";
const url = new URL(process.env.NOLSAF_REDIS_SETUP_URL);
const client = new Redis(process.env.NOLSAF_REDIS_SETUP_URL, {
  lazyConnect: true,
  connectTimeout: 10000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  tls: {
    ca: fs.readFileSync(process.env.NOLSAF_REDIS_SETUP_CA_PATH),
    rejectUnauthorized: true,
    servername: url.hostname,
  },
});
try {
  await client.connect();
  const response = await client.ping();
  if (response !== "PONG") throw new Error("Unexpected Redis response");
  await client.quit();
} catch (error) {
  try { client.disconnect(); } catch {}
  console.error(`Redis TLS connection test failed (${error?.code || error?.name || "unknown"}).`);
  process.exit(1);
}
'@
            & node --input-type=module -e $testScript
            if ($LASTEXITCODE -ne 0) {
                throw "Redis TLS connection test failed. No AWS settings were changed."
            }
        } finally {
            Pop-Location
            Remove-Item Env:NOLSAF_REDIS_SETUP_URL -ErrorAction SilentlyContinue
            Remove-Item Env:NOLSAF_REDIS_SETUP_CA_PATH -ErrorAction SilentlyContinue
        }
        Write-Host "Redis TLS connection succeeded."
    }

    $optionSettings = @(
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "REDIS_URL"
            Value      = $redisUrl
        },
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "SOCKET_IO_REDIS_ADAPTER"
            Value      = "true"
        },
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "REDIS_CA_CERT_PATH"
            Value      = "certs/redis_ca.pem"
        },
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "RUN_BACKGROUND_WORKERS"
            Value      = "true"
        },
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "REPORTS_CACHE_ENABLED"
            Value      = "true"
        },
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "WORKER_SINGLE_INSTANCE"
            Value      = "false"
        },
        @{
            Namespace  = "aws:elasticbeanstalk:application:environment"
            OptionName = "ALLOW_UNCOORDINATED_WORKERS"
            Value      = "false"
        }
    )

    $settingsFile = Join-Path ([IO.Path]::GetTempPath()) ("nolsaf-redis-eb-{0}.json" -f [Guid]::NewGuid())
    $optionSettings | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $settingsFile -Encoding utf8NoBOM

    Write-Host "Updating Elastic Beanstalk environment $EnvironmentName..."
    Invoke-AwsCli elasticbeanstalk update-environment `
        --region $Region `
        --environment-name $EnvironmentName `
        --option-settings "file://$settingsFile" `
        --query "{EnvironmentName:EnvironmentName,Status:Status,Health:Health}" `
        --output json | Write-Host

    Write-Host "Waiting for Elastic Beanstalk to finish applying the configuration..."
    Invoke-AwsCli elasticbeanstalk wait environment-updated `
        --region $Region `
        --environment-names $EnvironmentName

    $configuredNames = Invoke-AwsCli elasticbeanstalk describe-configuration-settings `
        --region $Region `
        --application-name $ApplicationName `
        --environment-name $EnvironmentName `
        --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment' && contains(['REDIS_URL','REDIS_CA_CERT_PATH','SOCKET_IO_REDIS_ADAPTER','RUN_BACKGROUND_WORKERS','REPORTS_CACHE_ENABLED','WORKER_SINGLE_INSTANCE','ALLOW_UNCOORDINATED_WORKERS'], OptionName)].OptionName" `
        --output json

    Write-Host "Configured option names (values intentionally hidden):"
    $configuredNames | Write-Host
    Write-Host "Redis configuration applied successfully."
} finally {
    if ($settingsFile -and (Test-Path -LiteralPath $settingsFile)) {
        Remove-Item -LiteralPath $settingsFile -Force
    }
    if ($redisValuePointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($redisValuePointer)
    }
    $redisUrl = $null
    $secureRedisValue = $null
}
