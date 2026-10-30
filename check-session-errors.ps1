<#
.SYNOPSIS
    Checks a Cline session for NEW errors since last run (deduplicated).

.DESCRIPTION
    Reads the session's messages.json and logs any new tool_result errors
    to a log file. Uses a persistent hash file to track seen errors across runs.

.PARAMETER SessionId
    The Cline session ID to check (e.g., "1793373078488_zg0ea")

.PARAMETER LogFile
    Path to the error log file (default: ".\session-errors.log")

.PARAMETER HashFile
    Path to the hash tracking file (default: ".\session-errors-hashes.txt")

.EXAMPLE
    .\check-session-errors.ps1 -SessionId "1793373078488_zg0ea"

.EXAMPLE
    .\check-session-errors.ps1 -SessionId "1793373078488_zg0ea" -LogFile "C:\logs\errors.log"
#>

param(
    [Parameter(Mandatory=$true)][string]$SessionId,
    [string]$LogFile = ".\session-errors.log",
    [string]$HashFile = ".\session-errors-hashes.txt"
)

# Resolve session directory
$base = "$env:USERPROFILE\.cline-docker\data\sessions\$SessionId"
$file = "$base\$SessionId.messages.json"

if (-not (Test-Path $file)) {
    Write-Error "Session file not found: $file"
    exit 1
}

# Load seen hashes
$seenHashes = @{}
if (Test-Path $HashFile) {
    Get-Content $HashFile | ForEach-Object { $seenHashes[$_.Trim()] = $true }
}

# Initialize log file if it doesn't exist
if (-not (Test-Path $LogFile)) {
    New-Item -ItemType File -Path $LogFile -Force | Out-Null
    "=== Session Error Log Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -FilePath $LogFile -Encoding utf8
    "Session: $SessionId`n" | Out-File -FilePath $LogFile -Encoding utf8 -Append
}

$raw = Get-Content -Path $file -Raw -ErrorAction Stop
if (-not $raw) { exit 0 }

$data = $raw | ConvertFrom-Json
$newErrors = 0

foreach ($m in $data.messages) {
    foreach ($c in $m.content) {
        if ($c.type -eq 'tool_result' -and $c.is_error -eq $true) {
            # Create a deterministic hash of the error to detect duplicates (SHA256)
            $sha256 = [System.Security.Cryptography.SHA256]::Create()
            $inputStr = $m.id + "::" + $c.tool_use_id + "::" + $c.name + "::" + ($c.content | Out-String)
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($inputStr)
            $hashBytes = $sha256.ComputeHash($bytes)
            $errorKey = [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLower()
            
            if (-not $seenHashes.ContainsKey($errorKey)) {
                $seenHashes[$errorKey] = $true
                $newErrors++
                
                $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($m.ts).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
                $errorMsg = "[${ts}] TOOL: $($c.name) | ID: $($c.tool_use_id) | Error: $($c.content)"
                
                # Console output
                Write-Host "NEW ERROR [$ts]: $($c.name)" -ForegroundColor Red
                
                # File output
                $errorMsg | Out-File -FilePath $LogFile -Encoding utf8 -Append
            }
        }
    }
}

# Save updated hashes
$seenHashes.Keys | Out-File -FilePath $HashFile -Encoding utf8

if ($newErrors -gt 0) {
    Write-Host "Logged $newErrors new error(s) to $LogFile" -ForegroundColor Green
}
else {
    Write-Host "No new errors found" -ForegroundColor Gray
}