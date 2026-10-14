# Signal Lab
$Samples = @(0.2, 0.8, -0.4, 0.5, 1.0)
$Mean = ($Samples | Measure-Object -Average).Average

Write-Output "Mean amplitude: $Mean"

if ($Mean -gt 0) {
    Write-Output "Positive signal"
