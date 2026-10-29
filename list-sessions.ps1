$base = "$env:USERPROFILE\.cline-docker\data\sessions"
Get-ChildItem $base -Directory | ForEach-Object {
  $meta = Get-Content "$($_.FullName)\$($_.Name).json" | ConvertFrom-Json
  $status = $meta.status
  if ($status -eq "running" -and $meta.ended_at) {
    if ($meta.exit_code -eq 0) { $status = "finished" } else { $status = "failed (exit $($meta.exit_code))" }
  }
  [pscustomobject]@{
    Session = $_.Name
    Status  = $status
    Issue   = if ($meta.prompt -match 'Issue #(\d+)') { $Matches[1] } else { '?' }
    Cwd     = $meta.cwd
    Started = $meta.started_at
  }
} | Format-Table