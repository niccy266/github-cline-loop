# Watch a Cline session's messages.json and print new agent "thinking" blocks as they arrive.
# Usage: .\watch-thoughts.ps1 -SessionId 1793270942901_h868h
param(
  [Parameter(Mandatory=$true)][string]$SessionId,
  [int]$IntervalMs = 2000
)

$base = "$env:USERPROFILE\.cline-docker\data\sessions\$SessionId"
$file = "$base\$SessionId.messages.json"
if (-not (Test-Path $file)) { throw "Not found: $file" }

$seen = @{}
$lastSize = 0
Write-Host "Watching $file (Ctrl+C to stop)`n"

while ($true) {
  try {
    $fi = Get-Item $file -ErrorAction Stop
    if ($fi.Length -eq $lastSize) { Start-Sleep -Milliseconds $IntervalMs; continue }
    $lastSize = $fi.Length
    $raw = Get-Content -Path $file -Raw -ErrorAction Stop
    if ($raw) {
      $data = $raw | ConvertFrom-Json
      foreach ($m in $data.messages) {
        if ($m.role -ne 'assistant') { continue }
        foreach ($c in $m.content) {
          if ($c.type -eq 'thinking') {
            $hash = ($m.id + "::" + $c.thinking).GetHashCode()
            if (-not $seen.ContainsKey($hash)) {
              $seen[$hash] = $true
              $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($m.ts).ToLocalTime().ToString('HH:mm:ss')
              Write-Host "[$ts] THOUGHT: $($c.thinking)" -ForegroundColor Cyan
            }
          } elseif ($c.type -eq 'tool_use') {
            $hash = ($m.id + "::" + $c.id).GetHashCode()
            if (-not $seen.ContainsKey($hash)) {
              $seen[$hash] = $true
              $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($m.ts).ToLocalTime().ToString('HH:mm:ss')
              Write-Host "[$ts] TOOL: $($c.name)" -ForegroundColor Yellow
            }
          }
        }
      }
    }
  } catch { }
  Start-Sleep -Milliseconds $IntervalMs
}
