[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsRoot = Join-Path $workspaceRoot '.local-tools'
$downloadsRoot = Join-Path $toolsRoot 'downloads'
$sdkRoot = Join-Path $toolsRoot 'android-sdk'
New-Item -ItemType Directory -Force -Path $downloadsRoot, $sdkRoot | Out-Null
function Get-VerifiedArchive([string]$url, [string]$sha256, [string]$name) {
    $target = Join-Path $downloadsRoot $name
    if (!(Test-Path -LiteralPath $target)) {
        $partial = "$target.download"
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $partial
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256.ToLowerInvariant()) { throw "Checksum mismatch for $name. Archive was not executed." }
        Move-Item -LiteralPath $partial -Destination $target
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sha256.ToLowerInvariant()) { throw "Cached archive checksum mismatch: $name" }
    return $target
}
Write-Output 'Preparing official JDK 21 (verified download; workspace-local installation).'
$jdkMetadata = (Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse')[0]
$jdkArchive = Get-VerifiedArchive $jdkMetadata.binary.package.link $jdkMetadata.binary.package.checksum 'temurin-21.zip'
$jdkRoot = Join-Path $toolsRoot 'jdk'
if (!(Test-Path -LiteralPath $jdkRoot)) { Expand-Archive -LiteralPath $jdkArchive -DestinationPath $jdkRoot }
$javaRoot = (Get-ChildItem -LiteralPath $jdkRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1).FullName
if (!$javaRoot) { throw 'Verified JDK archive did not contain java.exe.' }
$env:JAVA_HOME = $javaRoot
$env:ANDROID_HOME = $sdkRoot
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-cache'
$env:PATH = "$(Join-Path $javaRoot 'bin');$env:PATH"
Write-Output 'Preparing official Android command-line tools (verified download).'
$sdkArchive = Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a' 'android-commandline.zip'
$cliRoot = Join-Path $sdkRoot 'cmdline-tools/latest'
if (!(Test-Path -LiteralPath (Join-Path $cliRoot 'bin/sdkmanager.bat'))) {
    $extractionRoot = Join-Path $toolsRoot 'sdk-extract'
    if (!(Test-Path -LiteralPath (Join-Path $extractionRoot 'cmdline-tools/bin/sdkmanager.bat'))) { Expand-Archive -LiteralPath $sdkArchive -DestinationPath $extractionRoot -Force }
    New-Item -ItemType Directory -Force -Path $cliRoot | Out-Null
    $source = [IO.Path]::GetFullPath((Join-Path $extractionRoot 'cmdline-tools'))
    if (!$source.StartsWith($toolsRoot) -or !$cliRoot.StartsWith($toolsRoot)) { throw 'SDK extraction paths escape workspace tools directory.' }
    Get-ChildItem -LiteralPath $source | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $cliRoot -Recurse -Force }
}
$sdkManager = Join-Path $cliRoot 'bin/sdkmanager.bat'
Write-Output 'Installing Android platform 36, build-tools and platform-tools. SDK license/install output is retained in .local-tools.'
$previousErrorPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    1..100 | ForEach-Object { 'y' } | & $sdkManager "--sdk_root=$sdkRoot" --licenses *> (Join-Path $toolsRoot 'sdk-licenses.log')
    if ($LASTEXITCODE -ne 0) { throw 'Android SDK licenses could not be accepted; review sdk-licenses.log.' }
    & $sdkManager "--sdk_root=$sdkRoot" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' *> (Join-Path $toolsRoot 'sdk-install.log')
    if ($LASTEXITCODE -ne 0) { throw 'Android SDK package installation failed; review sdk-install.log.' }
} finally { $ErrorActionPreference = $previousErrorPreference }
Write-Output 'Preparing Gradle 8.13 (verified download).'
$hashResponse = (Invoke-WebRequest -UseBasicParsing -Uri 'https://services.gradle.org/distributions/gradle-8.13-bin.zip.sha256').Content
$gradleHash = if ($hashResponse -is [byte[]]) { [Text.Encoding]::UTF8.GetString($hashResponse).Trim() } else { ([string]$hashResponse).Trim() }
if ($gradleHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Official Gradle checksum response is invalid.' }
$gradleArchive = Get-VerifiedArchive 'https://services.gradle.org/distributions/gradle-8.13-bin.zip' $gradleHash 'gradle-8.13.zip'
$gradleRoot = Join-Path $toolsRoot 'gradle'
if (!(Test-Path -LiteralPath $gradleRoot)) { Expand-Archive -LiteralPath $gradleArchive -DestinationPath $gradleRoot }
$gradle = Join-Path $gradleRoot 'gradle-8.13/bin/gradle.bat'
if (!(Test-Path -LiteralPath (Join-Path $workspaceRoot 'android/gradlew.bat'))) {
    Push-Location (Join-Path $workspaceRoot 'android')
    try { & $gradle wrapper --gradle-version 8.13 --gradle-distribution-sha256-sum $gradleHash --no-daemon *> (Join-Path $toolsRoot 'gradle-wrapper.log'); if ($LASTEXITCODE -ne 0) { throw 'Gradle wrapper generation failed; review gradle-wrapper.log.' } }
    finally { Pop-Location }
}
@{ javaHome = $javaRoot; androidHome = $sdkRoot; gradleHome = (Join-Path $gradleRoot 'gradle-8.13'); gradleUserHome = $env:GRADLE_USER_HOME } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $toolsRoot 'environment.json') -Encoding UTF8
Write-Output 'Workspace-local Android build tools are ready. No app or customer release has been published.'
