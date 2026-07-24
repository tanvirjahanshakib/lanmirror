<#
.SYNOPSIS
    Virtual Display Driver Manager script.
#>

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet('install','uninstall','status','enable','disable')]
    [string]$Action = 'status',

    [Parameter(Mandatory=$false)]
    [switch]$Json,

    [Parameter(Mandatory=$false)]
    [switch]$Silent
)

function Get-VDDStatus {
    $dev = Get-PnpDevice -FriendlyName "*Virtual Display*" -ErrorAction SilentlyContinue
    $installed = $null -ne $dev
    $enabled = $false
    if ($installed) {
        $enabled = ($dev.Status -eq 'OK')
    }
    
    if ($Json) {
        @{ Installed = $installed; Enabled = $enabled } | ConvertTo-Json -Compress
    } else {
        Write-Host "Installed: $installed, Enabled: $enabled"
    }
}

switch ($Action) {
    'status' { Get-VDDStatus }
    'install' {
        $infPath = Join-Path $PSScriptRoot "..\VirtualDisplayDriver.inf"
        if (Test-Path $infPath) {
            pnputil /add-driver "$infPath" /install
        } else {
            Write-Error "INF file not found at $infPath"
        }
    }
    'uninstall' {
        $dev = Get-PnpDevice -FriendlyName "*Virtual Display*" -ErrorAction SilentlyContinue
        if ($dev) {
            pnputil /delete-driver $dev.DriverKeyName /uninstall /force
        }
    }
}
