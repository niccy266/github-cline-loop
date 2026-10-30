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
              Write-Host "[$ts] TOOL CALL: $($c.name)" -ForegroundColor Yellow
            }
          } elseif ($c.type -eq 'tool_result') {
            $hash = ($m.id + "::" + $c.tool_use_id).GetHashCode()
            if (-not $seen.ContainsKey($hash)) {
              $seen[$hash] = $true
              $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($m.ts).ToLocalTime().ToString('HH:mm:ss')
              # ToolResultContent.content can be a string or an array of
              # TextContent/ImageContent/FileContent blocks.  Normalize to
              # plain text for display.
              $resultText = ''
              if ($c.content -is [string]) {
                $resultText = $c.content
              } elseif ($null -ne $c.content) {
                $parts = @()
                foreach ($item in @($c.content)) {
                  if ($item.type -eq 'text' -and $item.text) {
                    $parts += $item.text
                  } elseif ($item.type -eq 'image') {
                    $parts += "<image: $($item.mediaType)>"
                  } elseif ($item.type -eq 'file') {
                    $parts += "<file: $($item.path)>"
                  } else {
                    $parts += ($item | Out-String)
                  }
                }
                $resultText = ($parts -join "`n")
              }
              # Truncate very long results to keep the output readable
              $maxLen = 3000
              if ($resultText.Length -gt $maxLen) {
                $resultText = $resultText.Substring(0, $maxLen) + "`n  ...[truncated]"
              }
              $is_error = $c.is_error -eq $true
              $color = if ($is_error) { 'Red' } else { 'DarkGray' }
              $label = if ($is_error) { "TOOL RESULT ERROR [$($c.name)]" } else { "TOOL RESULT [$($c.name)]" }
              Write-Host "[$ts] $label" -ForegroundColor $(if ($is_error) { 'Red' } else { 'Green' })
              Write-Host "  $resultText" -ForegroundColor $color
            }
          } else {
            # Surface any other content block types (e.g. plain text in user messages)
            if ($c.type -eq 'text' -and $c.text) {
              $hash = ($m.id + "::" + $c.text.Substring(0, [Math]::Min(200, $c.text.Length))).GetHashCode()
              if (-not $seen.ContainsKey($hash)) {
                $seen[$hash] = $true
                $ts = [DateTimeOffset]::FromUnixTimeMilliseconds($m.ts).ToLocalTime().ToString('HH:mm:ss')
                Write-Host "[$ts] USER MSG: $($c.text)" -ForegroundColor DarkGray
              }
            }
          }
        }
      }
    }
  } catch { }
  Start-Sleep -Milliseconds $IntervalMs
}
