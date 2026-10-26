[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(3, 2100000000)][int]$VersionCode,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$')][string]$VersionName
)
$ErrorActionPreference = 'Stop'
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -match '\\CodexSandbox') {
    throw 'Build under the desktop owner Windows account so the private signing credentials can be decrypted.'
}
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsEnvironment = Join-Path $workspaceRoot '.local-tools/environment.json'
if (Test-Path -LiteralPath $toolsEnvironment) {
    $toolsConfig = Get-Content -LiteralPath $toolsEnvironment -Raw | ConvertFrom-Json
    $env:JAVA_HOME = $toolsConfig.javaHome
    $env:ANDROID_HOME = $toolsConfig.androidHome
    $env:GRADLE_USER_HOME = $toolsConfig.gradleUserHome
    $env:PATH = "$(Join-Path $toolsConfig.javaHome 'bin');$env:PATH"
}
$signingRoot = Join-Path $workspaceRoot '.local-signing'
$storePath = Join-Path $signingRoot 'hisab-release.p12'
$credentialsPath = Join-Path $signingRoot 'credentials.dpapi.json'
$publicPath = Join-Path $signingRoot 'public-certificate.json'
$evidencePath = Join-Path $signingRoot 'last-signed-build.json'
foreach ($path in @($storePath, $credentialsPath, $publicPath)) {
    if (!(Test-Path -LiteralPath $path)) { throw 'Signing identity is incomplete. Run New-AndroidSigningIdentity.ps1 once as the desktop owner.' }
}
if (Test-Path -LiteralPath $evidencePath) {
    $previousBuild = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
    if ($VersionCode -le $previousBuild.versionCode) { throw 'Choose a versionCode greater than the last successful signed build.' }
}
$javaPath = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/java.exe' } else { (Get-Command java -ErrorAction SilentlyContinue).Source }
if (!$javaPath -or !(Test-Path -LiteralPath $javaPath)) { throw 'JDK 21 is missing. Install JDK 21 and set JAVA_HOME before building an APK.' }
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!(Test-Path -LiteralPath $sdkRoot)) { throw 'Android SDK is missing. Install Android SDK platform 36 and build tools, then set ANDROID_HOME.' }
$signer = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$signer) { throw 'Android apksigner is missing from SDK build-tools.' }
$gradleWrapper = Join-Path $workspaceRoot 'android/gradlew.bat'
if (!(Test-Path -LiteralPath $gradleWrapper)) { throw 'Gradle wrapper is missing. Run Setup-AndroidTools.ps1 before building.' }
$gradleExecutable = $gradleWrapper
$wrapperProperties = Get-Content -LiteralPath (Join-Path $workspaceRoot 'android/gradle/wrapper/gradle-wrapper.properties') -Raw
if ($toolsConfig -and $toolsConfig.gradleHome -and $wrapperProperties -match 'gradle-([0-9.]+)-bin\.zip') {
    $localGradle = Join-Path $toolsConfig.gradleHome 'bin/gradle.bat'
    if ((Split-Path $toolsConfig.gradleHome -Leaf) -eq "gradle-$($Matches[1])" -and (Test-Path -LiteralPath $localGradle)) {
        # Setup verified this same pinned distribution; avoid downloading it twice.
        $gradleExecutable = $localGradle
    }
}
$credentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
$securePassword = ConvertTo-SecureString $credentials.storePasswordProtected
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
$variables = @{
    HISAB_ANDROID_KEYSTORE_FILE = $storePath
    HISAB_ANDROID_STORE_PASSWORD = $password
    HISAB_ANDROID_KEY_PASSWORD = $password
    HISAB_ANDROID_KEY_ALIAS = $credentials.alias
    HISAB_ANDROID_VERSION_CODE = [string]$VersionCode
    HISAB_ANDROID_VERSION_NAME = $VersionName
}
$previousVariables = @{}
foreach ($name in $variables.Keys) { $previousVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $variables[$name], 'Process') }
function Invoke-BuildStep([string]$executable, [string[]]$arguments) {
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) { throw "Build step failed: $executable (exit $LASTEXITCODE). No APK was published." }
}
Push-Location $workspaceRoot
try {
    Invoke-BuildStep 'npm.cmd' @('run', 'lint')
    Invoke-BuildStep 'npm.cmd' @('test')
    Invoke-BuildStep 'npm.cmd' @('run', 'build')
    Invoke-BuildStep 'npx.cmd' @('cap', 'sync', 'android')
    Push-Location (Join-Path $workspaceRoot 'android')
    try { Invoke-BuildStep $gradleExecutable @('assembleRelease', '--no-daemon', '--no-watch-fs', '--max-workers=2') }
    finally { Pop-Location }
    $apkPath = Join-Path $workspaceRoot 'android/app/build/outputs/apk/release/app-release.apk'
    if (!(Test-Path -LiteralPath $apkPath)) { throw 'Signed APK output was not found.' }
    $signature = & $signer verify --verbose --print-certs $apkPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $publicInfo = Get-Content -LiteralPath $publicPath -Raw | ConvertFrom-Json
    $expected = ($publicInfo.certificateSha256 -replace ':', '').ToLowerInvariant()
    if (!($signature -match [regex]::Escape($expected))) { throw 'APK signing certificate does not match the permanent key.' }
    $evidence = @{ applicationId = $publicInfo.applicationId; versionCode = $VersionCode; versionName = $VersionName; commit = (git rev-parse HEAD); certificateSha256 = $publicInfo.certificateSha256; apkSha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash; apkPath = $apkPath; builtAtUtc = [DateTime]::UtcNow.ToString('o'); physicalDeviceAcceptance = 'PENDING'; published = $false }
    $evidence | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding UTF8
    $evidence | ConvertTo-Json
} finally {
    Pop-Location
    foreach ($name in $previousVariables.Keys) { [Environment]::SetEnvironmentVariable($name, $previousVariables[$name], 'Process') }
    $password = $null
    $variables.Clear()
}
