<#
.SYNOPSIS
    Monitors a Cline session for errors and logs them to a file (deduplicated).

.DESCRIPTION
    Watches the session's messages.json file for tool_result errors and logs
    new unique errors to a log file. Uses a hash-based deduplication to avoid
    logging the same error multiple times.

.PARAMETER SessionId
    The Cline session ID to monitor (e.g., "1793373078488_zg0ea")

.PARAMETER IntervalMs
    Polling interval in milliseconds (default: 5000)

.PARAMETER LogFile
    Path to the error log file (default: ".\session-errors.log")

.EXAMPLE
    .\monitor-session-errors.ps1 -SessionId "1793373078488_zg0ea"

.EXAMPLE
    .\monitor-session-errors.ps1 -SessionId "1793373078488_zg0ea" -IntervalMs 10000 -LogFile "C:\logs\errors.log"
#>

param(
    [Parameter(Mandatory=$true)][string]$SessionId,
    [int]$IntervalMs = 5000,
    [string]$LogFile = ".\session-errors.log"
)

# Resolve session directory
$base = "$env:USERPROFILE\.cline-docker\data\sessions\$SessionId"
$file = "$base\$SessionId.messages.json"

if (-not (Test-Path $file)) {
    Write-Error "Session file not found: $file"
    exit 1
}

Write-Host "Monitoring session: $SessionId" -ForegroundColor Cyan
Write-Host "Messages file: $file" -ForegroundColor Gray
Write-Host "Error log: $LogFile" -ForegroundColor Gray
Write-Host "Polling every $IntervalMs ms (Ctrl+C to stop)" -ForegroundColor Gray
Write-Host ""

# Track seen errors by hash
$seenErrors = @{}

# Initialize log file if it doesn't exist
if (-not (Test-Path $LogFile)) {
    New-Item -ItemType File -Path $LogFile -Force | Out-Null
    "=== Session Error Log Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -FilePath $LogFile -Encoding utf8
    "Session: $SessionId`n" | Out-File -FilePath $LogFile -Encoding utf8 -Append
}

$lastSize = 0

try {
    while ($true) {
        try {
            $fi = Get-Item $file -ErrorAction Stop
            
            if ($fi.Length -eq $lastSize) {
                Start-Sleep -Milliseconds $IntervalMs
                continue
            }
            $lastSize = $fi.Length

            $raw = Get-Content -Path $file -Raw -ErrorAction Stop
            if (-not $raw) { continue }

            $data = $raw | ConvertFrom-Json
            
            foreach ($m in $data.messages) {
                foreach ($c in $m.content) {
                    if ($c.type -eq 'tool_result' -and $c.is_error -eq $true) {
                        # Create a hash of the error to detect duplicates
                        $errorKey = ($m.id + "::" + $c.tool_use_id + "::" + $c.name + "::" + ($c.content | Out-String)).GetHashCode()
                        
                        if (-not $seenErrors.ContainsKey($errorKey)) {
                            $seenErrors[$errorKey] = $true
                            
                            $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($m.ts).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
                            $errorMsg = "[${ts}] TOOL: $($c.name) | ID: $($c.tool_use_id) | Error: $($c.content)"
                            
                            # Console output
                            Write-Host "[$ts] NEW ERROR: $($c.name)" -ForegroundColor Red
                            
                            # File output
                            $errorMsg | Out-File -FilePath $LogFile -Encoding utf8 -Append
                        }
                    }
                }
            }
        }
        catch {
            Write-Warning "Error reading session file: $_"
        }
        
        Start-Sleep -Milliseconds $IntervalMs
    }
}
finally {
    Write-Host "`nMonitoring stopped. Errors logged to: $LogFile" -ForegroundColor Cyan
}