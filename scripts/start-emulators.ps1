<#
.SYNOPSIS
    Menjalankan emulator lokal yang dibutuhkan fi-drive: Cosmos DB (vNext) dan Azurite (blob).

.DESCRIPTION
    Idempoten: bila container dengan nama tersebut sudah ada, script menjalankan
    `docker start` alih-alih `docker run`. Script menunggu health probe Cosmos
    (http://localhost:8080/ready) sebelum keluar.
#>
[CmdletBinding()]
param(
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'

$CosmosContainer = 'fi-drive-cosmos'
$AzuriteContainer = 'fi-drive-azurite'
$CosmosImage = 'mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-latest'
$AzuriteImage = 'mcr.microsoft.com/azure-storage/azurite'

function Test-DockerAvailable {
    try {
        docker info 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Get-ContainerState {
    param([string]$Name)

    $state = docker inspect --format '{{.State.Status}}' $Name 2>$null
    if ($LASTEXITCODE -ne 0) {
        return 'missing'
    }
    return $state.Trim()
}

function Start-EmulatorContainer {
    param(
        [string]$Name,
        [string]$Image,
        [string[]]$DockerArgs
    )

    $state = Get-ContainerState -Name $Name

    if ($state -eq 'missing') {
        Write-Host "[$Name] container belum ada, menjalankan image $Image"
        docker run -d --name $Name @DockerArgs | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Gagal menjalankan container $Name"
        }
        return
    }

    if ($state -eq 'running') {
        Write-Host "[$Name] sudah berjalan"
        return
    }

    Write-Host "[$Name] ada tapi berstatus '$state', menjalankan docker start"
    docker start $Name | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Gagal menjalankan ulang container $Name"
    }
}

function Wait-ForCosmosReady {
    param([int]$TimeoutSeconds)

    $readyUrl = 'http://localhost:8080/ready'
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    Write-Host "Menunggu Cosmos siap di $readyUrl (maksimum $TimeoutSeconds detik)..."

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $readyUrl -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                Write-Host "Cosmos siap."
                return $true
            }
        } catch {
            # Emulator masih menyala; coba lagi.
        }
        Start-Sleep -Seconds 3
    }

    return $false
}

if (-not (Test-DockerAvailable)) {
    throw 'Docker tidak tersedia atau Docker Desktop belum berjalan. Jalankan Docker Desktop lalu ulangi.'
}

Start-EmulatorContainer -Name $CosmosContainer -Image $CosmosImage -DockerArgs @(
    '-p', '8081:8081',
    '-p', '8080:8080',
    '-p', '1234:1234',
    $CosmosImage
)

Start-EmulatorContainer -Name $AzuriteContainer -Image $AzuriteImage -DockerArgs @(
    '-p', '10000:10000',
    $AzuriteImage, 'azurite-blob', '--blobHost', '0.0.0.0', '--blobPort', '10000'
)

if (-not (Wait-ForCosmosReady -TimeoutSeconds $TimeoutSeconds)) {
    Write-Warning "Cosmos belum melaporkan siap dalam $TimeoutSeconds detik. Periksa dengan: docker logs $CosmosContainer"
    exit 1
}

Write-Host ''
Write-Host 'Emulator siap:'
Write-Host '  Cosmos gateway   : http://localhost:8081'
Write-Host '  Cosmos health    : http://localhost:8080/ready'
Write-Host '  Cosmos Explorer  : http://localhost:1234'
Write-Host '  Azurite blob     : http://127.0.0.1:10000'
