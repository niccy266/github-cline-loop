$f = "$env:USERPROFILE\.cline-docker\data\sessions\1793270651775_vx64q\1793270651775_vx64q.messages.json"
Write-Host "LastWrite: $((Get-Item $f).LastWriteTime)"
$d = Get-Content $f | ConvertFrom-Json
Write-Host "updated_at: $($d.updated_at)"
Write-Host "messages: $($d.messages.Count)"
