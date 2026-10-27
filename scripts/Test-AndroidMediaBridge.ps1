[CmdletBinding()]
param([string]$Serial)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$adb = Join-Path $workspaceRoot '.local-tools/android-sdk/platform-tools/adb.exe'
$probe = Join-Path $workspaceRoot 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk'
$deviceArgs = if ($Serial) { @('-s', $Serial) } else { @() }
if (!(Test-Path -LiteralPath $probe)) { throw 'Build the signed release probe with -BridgeTestOnly first.' }
# Only the test package is installed. No app-data clearing, permission grants,
# sensor access, DOM inspection or authenticated network requests are performed.
& $adb @deviceArgs install -r --user 0 $probe
if ($LASTEXITCODE -ne 0) { throw 'Could not install the read-only probe.' }
$output = & $adb @deviceArgs shell am instrument -w com.hisabdekhtechai.app.test/com.hisabdekhtechai.app.MediaBridgeProbe
$output | Write-Output
if ($LASTEXITCODE -ne 0 -or !($output -match '^INSTRUMENTATION_RESULT: probe_status=PASS$')) {
    throw 'Installed release media bridge did not pass. Do not mark physical acceptance complete.'
}
