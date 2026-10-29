$base = "$env:USERPROFILE\.cline-docker\data\sessions"
Get-ChildItem $base -Directory | ForEach-Object {
  $meta = Get-Content "$($_.FullName)\$($_.Name).json" | ConvertFrom-Json
  [pscustomobject]@{
    Session = $_.Name
    Status  = $meta.status
    Issue   = if ($meta.prompt -match 'Issue #(\d+)') { $Matches[1] } else { '?' }
    Cwd     = $meta.cwd
    Started = $meta.started_at
  }
} | Format-Table
