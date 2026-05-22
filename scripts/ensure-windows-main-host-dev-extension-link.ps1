param(
    [switch]$ForceRecreate
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$extensionRoot = Join-Path $repoRoot 'ides\vscode'
$extensionsRoot = Join-Path $env:USERPROFILE '.vscode\extensions'
$targetId = 'tiinex.ai-provenance'
$staleTargetIds = @(
    'local.ai-provenance'
    'tiinex.ai-provenance-vscode'
    'local.ai-provenance-vscode'
)
$linkPath = Join-Path $extensionsRoot $targetId
$extensionsJsonPath = Join-Path $extensionsRoot 'extensions.json'
$globalStorageRoot = Join-Path $env:APPDATA 'Code\User\globalStorage'
$packageJsonPath = Join-Path $extensionRoot 'package.json'
$distEntry = Join-Path $extensionRoot 'dist\extension.js'

function Get-VsCodeExtensionLocation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $resolvedPath = (Resolve-Path $Path).Path
    $drive = [System.IO.Path]::GetPathRoot($resolvedPath).TrimEnd('\\').TrimEnd(':').ToLowerInvariant()
    $relativePath = $resolvedPath.Substring(2).Replace('\', '/')
    $uri = [System.Uri]::new($resolvedPath)

    return [pscustomobject]@{
        '$mid' = 1
        fsPath = $resolvedPath
        external = $uri.AbsoluteUri
        path = "/${drive}:$relativePath"
        scheme = 'file'
    }
}

function Remove-StaleExtensionLinksForRepo {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExtensionsRoot,
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [Parameter(Mandatory = $true)]
        [string]$KeepPath
    )

    if (-not (Test-Path $ExtensionsRoot)) {
        return $false
    }

    $removed = $false
    $candidates = Get-ChildItem -LiteralPath $ExtensionsRoot -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -ne $KeepPath -and
            ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
            ($_.Name -like 'local.ai-vscode-*' -or $_.Name -like 'local.agent-architect-*')
        }

    foreach ($candidate in $candidates) {
        $targets = @($candidate.Target | ForEach-Object { $_.ToString() })
        if ($candidate.LinkType -eq 'Junction' -and $targets -contains $RepoRoot) {
            Remove-Item $candidate.FullName -Force -Recurse
            $removed = $true
        }
    }

    return $removed
}

function Get-ExtensionRegistryIdentifierId {
    param(
        [Parameter(Mandatory = $true)]
        $Entry
    )

    $identifier = if ($Entry -is [System.Collections.IDictionary]) {
        $Entry['identifier']
    }
    elseif ($Entry.PSObject.Properties.Match('identifier').Count -gt 0) {
        $Entry.identifier
    }
    else {
        $null
    }

    if ($null -eq $identifier) {
        return $null
    }

    if ($identifier -is [System.Collections.IDictionary]) {
        return $identifier['id']
    }

    if ($identifier.PSObject.Properties.Match('id').Count -gt 0) {
        return $identifier.id
    }

    return $null
}

function Set-ExtensionRegistryIdentifierId {
    param(
        [Parameter(Mandatory = $true)]
        $Entry,
        [Parameter(Mandatory = $true)]
        [string]$Id
    )

    $identifier = if ($Entry -is [System.Collections.IDictionary]) {
        $Entry['identifier']
    }
    elseif ($Entry.PSObject.Properties.Match('identifier').Count -gt 0) {
        $Entry.identifier
    }
    else {
        $null
    }

    if ($null -eq $identifier) {
        $identifier = [pscustomobject]@{}
    }

    if ($identifier -is [System.Collections.IDictionary]) {
        $identifier['id'] = $Id
    }
    else {
        $identifier | Add-Member -NotePropertyName id -NotePropertyValue $Id -Force
    }

    if ($Entry -is [System.Collections.IDictionary]) {
        $Entry['identifier'] = $identifier
    }
    else {
        $Entry | Add-Member -NotePropertyName identifier -NotePropertyValue $identifier -Force
    }
}

function Set-ExtensionRegistryValue {
    param(
        [Parameter(Mandatory = $true)]
        $Entry,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        $Value
    )

    if ($Entry -is [System.Collections.IDictionary]) {
        $Entry[$Name] = $Value
    }
    else {
        $Entry | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    }
}

function Get-ExtensionRegistryValue {
    param(
        [Parameter(Mandatory = $true)]
        $Entry,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($Entry -is [System.Collections.IDictionary]) {
        return $Entry[$Name]
    }

    if ($Entry.PSObject.Properties.Match($Name).Count -gt 0) {
        return $Entry.$Name
    }

    return $null
}

function ConvertFrom-JsonCompat {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RawJson
    )

    $command = Get-Command ConvertFrom-Json -ErrorAction Stop
    if ($command.Parameters.ContainsKey('Depth')) {
        return $RawJson | ConvertFrom-Json -Depth 100
    }

    return $RawJson | ConvertFrom-Json
}

function ConvertTo-JsonCompat {
    param(
        [Parameter(Mandatory = $true)]
        $Value
    )

    $command = Get-Command ConvertTo-Json -ErrorAction Stop
    if ($command.Parameters.ContainsKey('Depth')) {
        return $Value | ConvertTo-Json -Depth 100
    }

    return $Value | ConvertTo-Json
}

function New-ExtensionRegistryEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetId,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [Parameter(Mandatory = $true)]
        [string]$PackageJsonPath
    )

    $rawPackageJson = Get-Content -LiteralPath $PackageJsonPath -Raw
    $packageJson = ConvertFrom-JsonCompat -RawJson $rawPackageJson
    $metadata = [pscustomobject]@{
        installedTimestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        pinned = $false
        source = 'resource'
        isPreReleaseVersion = $false
        hasPreReleaseVersion = $false
    }

    if ($packageJson.PSObject.Properties.Match('publisher').Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($packageJson.publisher)) {
        $metadata | Add-Member -NotePropertyName publisherDisplayName -NotePropertyValue ([string]$packageJson.publisher) -Force
    }

    return [pscustomobject]@{
        identifier = [pscustomobject]@{
            id = $TargetId
        }
        version = [string]$packageJson.version
        location = Get-VsCodeExtensionLocation -Path $TargetPath
        relativeLocation = (Split-Path -Leaf $TargetPath)
        metadata = $metadata
    }
}

function Repair-ExtensionRegistryMetadata {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RegistryPath,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath,
        [Parameter(Mandatory = $true)]
        [string]$TargetId,
        [Parameter(Mandatory = $true)]
        [string]$PackageJsonPath
    )

    $registry = @()
    if (Test-Path $RegistryPath) {
        $raw = Get-Content -LiteralPath $RegistryPath -Raw
        if ($raw.Trim()) {
            $registry = ConvertFrom-JsonCompat -RawJson $raw
        }
    }

    $entries = if ($registry -is [System.Collections.IEnumerable] -and -not ($registry -is [string])) {
        @($registry)
    }
    elseif ($registry.PSObject.Properties.Match('extensions').Count -gt 0) {
        @($registry.extensions)
    }
    else {
        @()
    }

    $normalizedTargetPath = $TargetPath.Replace('\', '/').ToLowerInvariant()
    $updated = $false
    $matchedTargetEntry = $false
    foreach ($entry in $entries) {
        $desiredEntry = New-ExtensionRegistryEntry -TargetId $TargetId -TargetPath $TargetPath -PackageJsonPath $PackageJsonPath
        $location = if ($entry -is [System.Collections.IDictionary]) {
            $entry['location']
        }
        elseif ($entry.PSObject.Properties.Match('location').Count -gt 0) {
            $entry.location
        }
        else {
            $null
        }

        $locationCandidates = @()
        if ($null -ne $location) {
            if ($location -is [System.Collections.IDictionary]) {
                $locationCandidates += @($location['fsPath'], $location['path'], $location['external'])
            }
            else {
                if ($location.PSObject.Properties.Match('fsPath').Count -gt 0) {
                    $locationCandidates += $location.fsPath
                }
                if ($location.PSObject.Properties.Match('path').Count -gt 0) {
                    $locationCandidates += $location.path
                }
                if ($location.PSObject.Properties.Match('external').Count -gt 0) {
                    $locationCandidates += $location.external
                }
            }
        }

        $matchesTargetPath = $false
        foreach ($candidate in $locationCandidates) {
            if ([string]::IsNullOrWhiteSpace($candidate)) {
                continue
            }

            $normalizedCandidate = $candidate.ToString().Replace('\', '/').ToLowerInvariant()
            if ($normalizedCandidate -eq $normalizedTargetPath -or $normalizedCandidate.Contains($normalizedTargetPath)) {
                $matchesTargetPath = $true
                break
            }
        }

        if (-not $matchesTargetPath) {
            continue
        }

        $matchedTargetEntry = $true

        if ((Get-ExtensionRegistryIdentifierId -Entry $entry) -ne $TargetId) {
            Set-ExtensionRegistryIdentifierId -Entry $entry -Id $TargetId
            $updated = $true
        }

        if ((Get-ExtensionRegistryValue -Entry $entry -Name 'version') -ne $desiredEntry.version) {
            Set-ExtensionRegistryValue -Entry $entry -Name 'version' -Value $desiredEntry.version
            $updated = $true
        }

        if ((Get-ExtensionRegistryValue -Entry $entry -Name 'relativeLocation') -ne $desiredEntry.relativeLocation) {
            Set-ExtensionRegistryValue -Entry $entry -Name 'relativeLocation' -Value $desiredEntry.relativeLocation
            $updated = $true
        }

        $currentLocationJson = ConvertTo-JsonCompat -Value $location
        $desiredLocationJson = ConvertTo-JsonCompat -Value $desiredEntry.location
        if ($currentLocationJson -ne $desiredLocationJson) {
            Set-ExtensionRegistryValue -Entry $entry -Name 'location' -Value $desiredEntry.location
            $updated = $true
        }

        $currentMetadataJson = ConvertTo-JsonCompat -Value (Get-ExtensionRegistryValue -Entry $entry -Name 'metadata')
        $desiredMetadataJson = ConvertTo-JsonCompat -Value $desiredEntry.metadata
        if ($currentMetadataJson -ne $desiredMetadataJson) {
            Set-ExtensionRegistryValue -Entry $entry -Name 'metadata' -Value $desiredEntry.metadata
            $updated = $true
        }
    }

    if (-not $matchedTargetEntry) {
        $newEntry = New-ExtensionRegistryEntry -TargetId $TargetId -TargetPath $TargetPath -PackageJsonPath $PackageJsonPath
        if ($registry -is [System.Collections.IEnumerable] -and -not ($registry -is [string])) {
            $registry = @($entries + $newEntry)
        }
        elseif ($registry.PSObject.Properties.Match('extensions').Count -gt 0) {
            $registry.extensions = @($entries + $newEntry)
        }
        else {
            $registry = @($newEntry)
        }
        $updated = $true
    }

    if (-not $updated) {
        return $false
    }

    $json = ConvertTo-JsonCompat -Value $registry
    Set-Content -LiteralPath $RegistryPath -Value $json -Encoding UTF8
    return $true
}

function Remove-StaleExtensionRegistryEntries {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RegistryPath,
        [Parameter(Mandatory = $true)]
        [string[]]$StaleIds
    )

    if (-not (Test-Path $RegistryPath)) {
        return 0
    }

    $raw = Get-Content -LiteralPath $RegistryPath -Raw
    if (-not $raw.Trim()) {
        return 0
    }

    $registry = ConvertFrom-JsonCompat -RawJson $raw
    $entries = if ($registry -is [System.Collections.IEnumerable] -and -not ($registry -is [string])) {
        @($registry)
    }
    elseif ($registry.PSObject.Properties.Match('extensions').Count -gt 0) {
        @($registry.extensions)
    }
    else {
        @()
    }

    if ($entries.Count -eq 0) {
        return 0
    }

    $removedCount = 0
    $filteredEntries = @()
    foreach ($entry in $entries) {
        $id = Get-ExtensionRegistryIdentifierId -Entry $entry
        if ($StaleIds -contains $id) {
            $removedCount += 1
            continue
        }

        $filteredEntries += $entry
    }

    if ($removedCount -eq 0) {
        return 0
    }

    if ($registry -is [System.Collections.IEnumerable] -and -not ($registry -is [string])) {
        $registry = $filteredEntries
    }
    else {
        $registry.extensions = $filteredEntries
    }

    $json = ConvertTo-JsonCompat -Value $registry
    Set-Content -LiteralPath $RegistryPath -Value $json -Encoding UTF8
    return $removedCount
}

function Remove-StaleGlobalStorageDirs {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GlobalStorageRoot,
        [Parameter(Mandatory = $true)]
        [string[]]$StaleIds
    )

    if (-not (Test-Path $GlobalStorageRoot)) {
        return 0
    }

    $removedCount = 0
    foreach ($staleId in $StaleIds) {
        $stalePath = Join-Path $GlobalStorageRoot $staleId
        if (-not (Test-Path $stalePath)) {
            continue
        }

        Remove-Item -LiteralPath $stalePath -Force -Recurse
        $removedCount += 1
    }

    return $removedCount
}

New-Item -ItemType Directory -Force -Path $extensionsRoot | Out-Null

$staleLinkRemoved = Remove-StaleExtensionLinksForRepo -ExtensionsRoot $extensionsRoot -RepoRoot $extensionRoot -KeepPath $linkPath

if (Test-Path $linkPath) {
    $existing = Get-Item $linkPath -Force
    $currentTargets = @($existing.Target | ForEach-Object { $_.ToString() })
    $isExpectedTarget = $existing.LinkType -eq 'Junction' -and $currentTargets -contains $extensionRoot

    if (-not $isExpectedTarget) {
        if (-not $ForceRecreate) {
            throw "Existing path at '$linkPath' does not point to '$extensionRoot'. Re-run with -ForceRecreate to replace a mismatched reparse point."
        }

        if (-not ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Refusing to remove '$linkPath' because it is not a reparse point. Remove it manually if you intend to replace it."
        }

        Remove-Item $linkPath -Force
        New-Item -ItemType Junction -Path $linkPath -Target $extensionRoot | Out-Null
        $existing = Get-Item $linkPath -Force
        $currentTargets = @($existing.Target | ForEach-Object { $_.ToString() })
    }
}
else {
    New-Item -ItemType Junction -Path $linkPath -Target $extensionRoot | Out-Null
    $existing = Get-Item $linkPath -Force
    $currentTargets = @($existing.Target | ForEach-Object { $_.ToString() })
}

$registryUpdated = Repair-ExtensionRegistryMetadata -RegistryPath $extensionsJsonPath -TargetPath $linkPath -TargetId $targetId -PackageJsonPath $packageJsonPath
$staleRegistryEntriesRemoved = Remove-StaleExtensionRegistryEntries -RegistryPath $extensionsJsonPath -StaleIds $staleTargetIds
$staleGlobalStorageDirsRemoved = Remove-StaleGlobalStorageDirs -GlobalStorageRoot $globalStorageRoot -StaleIds $staleTargetIds

$distPresent = Test-Path $distEntry

[pscustomobject]@{
    RepoRoot = $extensionRoot
    LinkPath = $existing.FullName
    LinkType = $existing.LinkType
    Targets = ($currentTargets -join '; ')
    StaleLinkRemoved = $staleLinkRemoved
    RegistryUpdated = $registryUpdated
    StaleRegistryEntriesRemoved = $staleRegistryEntriesRemoved
    StaleGlobalStorageDirsRemoved = $staleGlobalStorageDirsRemoved
    RegistryPath = $extensionsJsonPath
    GlobalStorageRoot = $globalStorageRoot
    DistEntryPresent = $distPresent
    ReloadRequired = $true
} | Format-List | Out-String | Write-Output

if (-not $distPresent) {
    Write-Warning "Built extension entrypoint is missing at '$distEntry'. Run 'npm.cmd run build' before relying on main-host activation."
}