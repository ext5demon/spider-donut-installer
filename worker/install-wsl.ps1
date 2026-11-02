$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath "$env:WINDIR\System32\wsl.exe" -ArgumentList @('--install','--no-distribution','--web-download') -Verb RunAs -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -notin @(0,3010)) { throw "Windows could not install its Linux components (exit $($process.ExitCode))." }
