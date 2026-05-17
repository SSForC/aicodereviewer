$ErrorActionPreference = "Stop"

$suffix = Get-Random
$email = "test$suffix@example.com"
$password = "Password123"
$base = "http://127.0.0.1:8000"

$health = Invoke-RestMethod -Uri "$base/health"

$registerBody = @{
  username = "test$suffix"
  email = $email
  password = $password
} | ConvertTo-Json

$registered = Invoke-RestMethod `
  -Uri "$base/api/v1/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $registerBody

$loginBody = @{
  email = $email
  password = $password
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Uri "$base/api/v1/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginBody

$headers = @{ Authorization = "Bearer $($login.access_token)" }

$me = Invoke-RestMethod -Uri "$base/api/v1/auth/me" -Headers $headers

$projectBody = @{ name = "Local Smoke Project" } | ConvertTo-Json
$project = Invoke-RestMethod `
  -Uri "$base/api/v1/projects/" `
  -Method Post `
  -ContentType "application/json" `
  -Headers $headers `
  -Body $projectBody

[pscustomobject]@{
  health = $health.status
  registered = $registered.email
  currentUser = $me.username
  project = $project.name
  projectStatus = $project.status
} | ConvertTo-Json
