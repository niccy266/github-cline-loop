$f = "$env:USERPROFILE\.cline-docker\data\sessions\1793271810401_npon3\1793271810401_npon3.messages.json"
Write-Host "LastWrite: $((Get-Item $f).LastWriteTime)"
$d = Get-Content $f | ConvertFrom-Json
Write-Host "updated_at: $($d.updated_at)"
Write-Host "messages: $($d.messages.Count)"
$last = $d.messages[-1]
Write-Host "last role: $($last.role) ts=$($last.ts)"
