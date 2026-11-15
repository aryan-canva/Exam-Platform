# Starts two judge workers (judge-1, judge-2) on a Windows judge host with Docker Desktop.
#   .\start-workers.ps1 -Server http://203.0.113.5:8080 -Token <worker-token>
param([Parameter(Mandatory=$true)][string]$Server, [string]$Token = "dev-worker-token")
$dir = Join-Path $PSScriptRoot "worker"
foreach ($id in "judge-1", "judge-2") {
  Start-Process -FilePath "node" -WorkingDirectory $dir -ArgumentList @("worker.js","--server",$Server,"--id",$id,"--token",$Token,"--sandbox","docker")
}
Write-Host "Started judge-1 and judge-2 in separate windows. Close the windows to stop them."
