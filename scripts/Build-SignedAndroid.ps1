[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(3, 2100000000)][int]$VersionCode,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$')][string]$VersionName,
    [switch]$LowMemory,
    [switch]$BridgeTestOnly,
    [switch]$ManagedAIAccess,
    [switch]$WithoutAI,
    [switch]$CloudRecovery,
    [switch]$LiveSync,
    [string]$AIServiceOrigin = $env:VITE_AI_API_BASE_URL,
    [string]$LocalResourcesRoot
)
$ErrorActionPreference = 'Stop'
if ($LiveSync -and !$CloudRecovery) { throw 'Live sync requires cloud recovery.' }
$nativeAIOrigin = $null
if (!$BridgeTestOnly) {
    [uri]$nativeAIUri = $null
    if ([string]::IsNullOrWhiteSpace($AIServiceOrigin) -or
        ![uri]::TryCreate($AIServiceOrigin, [UriKind]::Absolute, [ref]$nativeAIUri) -or
        $nativeAIUri.Scheme -ne 'https' -or $nativeAIUri.IsLoopback -or
        $nativeAIUri.UserInfo -or $nativeAIUri.Query -or $nativeAIUri.Fragment -or
        $nativeAIUri.AbsolutePath -ne '/') {
        throw 'Android AI service origin is required. Pass -AIServiceOrigin with the approved HTTPS server origin (no path, credentials or localhost). No APK was built.'
    }
    $nativeAIOrigin = $nativeAIUri.GetLeftPart([UriPartial]::Authority)
}
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -match '\\CodexSandbox') {
    throw 'Build under the desktop owner Windows account so the private signing credentials can be decrypted.'
}
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resourcesRoot = if ($LocalResourcesRoot) { [IO.Path]::GetFullPath($LocalResourcesRoot) } else { $workspaceRoot }
$toolsEnvironment = Join-Path $resourcesRoot '.local-tools/environment.json'
if (Test-Path -LiteralPath $toolsEnvironment) {
    $toolsConfig = Get-Content -LiteralPath $toolsEnvironment -Raw | ConvertFrom-Json
    $env:JAVA_HOME = $toolsConfig.javaHome
    $env:ANDROID_HOME = $toolsConfig.androidHome
    $env:GRADLE_USER_HOME = $toolsConfig.gradleUserHome
    $env:PATH = "$(Join-Path $toolsConfig.javaHome 'bin');$env:PATH"
}
$signingRoot = Join-Path $resourcesRoot '.local-signing'
$storePath = Join-Path $signingRoot 'hisab-release.p12'
$credentialsPath = Join-Path $signingRoot 'credentials.dpapi.json'
$publicPath = Join-Path $signingRoot 'public-certificate.json'
$evidencePath = Join-Path $signingRoot 'last-signed-build.json'
$databaseSource = [IO.File]::ReadAllText((Join-Path $workspaceRoot 'src/storage/db.ts'))
if ($databaseSource -notmatch 'export const CURRENT_SCHEMA_VERSION = ([1-9][0-9]*);') { throw 'Cannot verify the source database reader version.' }
$databaseSchemaVersion = [int]$Matches[1]
foreach ($path in @($storePath, $credentialsPath, $publicPath)) {
    if (!(Test-Path -LiteralPath $path)) { throw 'Signing identity is incomplete. Run New-AndroidSigningIdentity.ps1 once as the desktop owner.' }
}
if (Test-Path -LiteralPath $evidencePath) {
    $previousBuild = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
    if (!$BridgeTestOnly -and $previousBuild.databaseSchemaVersion -and $databaseSchemaVersion -lt $previousBuild.databaseSchemaVersion) { throw 'This source cannot read the last signed database schema. Use a compatible forward fix; do not downgrade or clear user data.' }
    if (!$BridgeTestOnly -and $VersionCode -le $previousBuild.versionCode) { throw 'Choose a versionCode greater than the last successful signed build.' }
}
$javaPath = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/java.exe' } else { (Get-Command java -ErrorAction SilentlyContinue).Source }
if (!$javaPath -or !(Test-Path -LiteralPath $javaPath)) { throw 'JDK 21 is missing. Install JDK 21 and set JAVA_HOME before building an APK.' }
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if (!(Test-Path -LiteralPath $sdkRoot)) { throw 'Android SDK is missing. Install Android SDK platform 36 and build tools, then set ANDROID_HOME.' }
$signer = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'build-tools') -Directory |
    Sort-Object { [version]($_.Name -replace '-.*$', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'apksigner.bat' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$signer) { throw 'Android apksigner is missing from SDK build-tools.' }
$aapt = Join-Path (Split-Path $signer -Parent) 'aapt.exe'
if (!(Test-Path -LiteralPath $aapt)) { throw 'Android aapt is missing from SDK build-tools.' }
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
if (!$BridgeTestOnly) {
    # The owner can ship core finance without mounting AI controls or making
    # permission/provider requests. Web/Admin deployments are unaffected.
    $variables.VITE_AI_FEATURES_ENABLED = if ($WithoutAI) { 'false' } else { 'true' }
    $variables.VITE_CLOUD_RECOVERY_ENABLED = if ($CloudRecovery) { 'true' } else { 'false' }
    $variables.VITE_LIVE_SYNC_ENABLED = if ($LiveSync) { 'true' } else { 'false' }
    $variables.VITE_AI_API_BASE_URL = $nativeAIOrigin
    if ($ManagedAIAccess) {
        Push-Location $workspaceRoot
        try { $managedClientJson = & node.exe scripts/Prepare-NativeManagedAI.mjs --ai-origin $nativeAIOrigin }
        finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Managed AI public Auth configuration is invalid. No APK was built.' }
        $managedClient = $managedClientJson | ConvertFrom-Json
        foreach ($property in $managedClient.PSObject.Properties) { $variables[$property.Name] = [string]$property.Value }
    }
    # Only validated public Firebase client configuration enters the APK.
    # Capture silently: never print config/credentials in build logs.
    Push-Location $workspaceRoot
    try { $pushClientJson = & node.exe scripts/Prepare-FirebasePush.mjs --android --resources-root $resourcesRoot }
    finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Firebase client configuration is missing or invalid. No APK was built.' }
    $pushClient = $pushClientJson | ConvertFrom-Json
    foreach ($property in $pushClient.PSObject.Properties) { $variables[$property.Name] = [string]$property.Value }
}
$previousVariables = @{}
foreach ($name in $variables.Keys) { $previousVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $variables[$name], 'Process') }
function Invoke-BuildStep([string]$executable, [string[]]$arguments) {
    & $executable @arguments
    if ($LASTEXITCODE -ne 0) { throw "Build step failed: $executable (exit $LASTEXITCODE). No APK was published." }
}
Push-Location $workspaceRoot
try {
    if ($BridgeTestOnly) {
        Invoke-BuildStep 'node.exe' @('scripts/Build-CalendarProbe.mjs')
        Push-Location (Join-Path $workspaceRoot 'android')
        try {
            Invoke-BuildStep $gradleExecutable @(':app:assembleReleaseAndroidTest', '-PhisabMediaProbe', '--no-daemon', '--no-watch-fs', '--max-workers=1', '-Dorg.gradle.jvmargs=-Xmx1024m -XX:ActiveProcessorCount=2 -Dfile.encoding=UTF-8')
        } finally { Pop-Location }
        $probePath = Join-Path $workspaceRoot 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk'
        $probeSignature = & $signer verify --print-certs $probePath
        if ($LASTEXITCODE -ne 0) { throw 'Probe signature verification failed.' }
        $publicInfo = Get-Content -LiteralPath $publicPath -Raw | ConvertFrom-Json
        if (!($probeSignature -match [regex]::Escape(($publicInfo.certificateSha256 -replace ':', '').ToLowerInvariant()))) {
            throw 'Probe signing identity must match the installed release.'
        }
        return
    }
    Invoke-BuildStep 'npm.cmd' @('run', 'lint')
    if ($LowMemory) {
        # The default parallel Node test runner can exhaust memory on small Windows PCs.
        Invoke-BuildStep 'npx.cmd' @('tsx', '--test', '--test-concurrency=1', 'src/test/*.test.ts')
    } else { Invoke-BuildStep 'npm.cmd' @('test') }
    Invoke-BuildStep 'npm.cmd' @('run', 'build')
    $nativeFeatures = @{ aiEnabled = !$WithoutAI; cloudRecoveryEnabled = [bool]$CloudRecovery; liveSyncEnabled=[bool]$LiveSync }
    $nativeFeatures | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspaceRoot 'dist/native-features.json') -Encoding UTF8
    $nativeAIInBuild = Get-ChildItem -LiteralPath (Join-Path $workspaceRoot 'dist/assets') -Filter '*.js' |
        Where-Object { [IO.File]::ReadAllText($_.FullName).Contains($nativeAIOrigin) }
    if (!$nativeAIInBuild) { throw 'Android web bundle is missing its required AI service origin. No APK was built.' }
    Invoke-BuildStep 'npx.cmd' @('cap', 'sync', 'android')
    Push-Location (Join-Path $workspaceRoot 'android')
    try {
        $gradleArguments = @(':app:assembleRelease', '--no-daemon', '--no-watch-fs')
        if ($LowMemory) {
            # Limit both Gradle work and the JVM/R8 processor count on small PCs.
            $gradleArguments += @('--max-workers=1', '-Dorg.gradle.jvmargs=-Xmx1024m -XX:ActiveProcessorCount=2 -Dfile.encoding=UTF-8')
        } else { $gradleArguments += '--max-workers=2' }
        Invoke-BuildStep $gradleExecutable $gradleArguments
    }
    finally { Pop-Location }
    $apkPath = Join-Path $workspaceRoot 'android/app/build/outputs/apk/release/app-release.apk'
    if (!(Test-Path -LiteralPath $apkPath)) { throw 'Signed APK output was not found.' }
    $publicInfo = Get-Content -LiteralPath $publicPath -Raw | ConvertFrom-Json
    $badging = (& $aapt dump badging $apkPath) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'APK manifest inspection failed.' }
    $expectedPackage = [regex]::Escape($publicInfo.applicationId)
    $expectedName = [regex]::Escape($VersionName)
    if ($badging -notmatch "(?m)^package: name='$expectedPackage' versionCode='$VersionCode' versionName='$expectedName'") {
        throw 'Built APK package or version does not match the requested signed release.'
    }
    $signature = & $signer verify --verbose --print-certs $apkPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $expected = ($publicInfo.certificateSha256 -replace ':', '').ToLowerInvariant()
    if (!($signature -match [regex]::Escape($expected))) { throw 'APK signing certificate does not match the permanent key.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $nativeApk = [IO.Compression.ZipFile]::OpenRead($apkPath)
    try {
        $featureEntry = $nativeApk.GetEntry('assets/public/native-features.json')
        if (!$featureEntry) { throw 'Signed APK is missing its feature manifest.' }
        $featureReader = [IO.StreamReader]::new($featureEntry.Open())
        try { $packagedFeatures = $featureReader.ReadToEnd() | ConvertFrom-Json }
        finally { $featureReader.Dispose() }
        if ($packagedFeatures.aiEnabled -ne (!$WithoutAI)) { throw 'Signed APK AI mode does not match the requested build.' }
        if ($packagedFeatures.cloudRecoveryEnabled -ne [bool]$CloudRecovery) { throw 'Signed APK cloud recovery mode does not match the requested build.' }
        if ($packagedFeatures.liveSyncEnabled -ne [bool]$LiveSync) { throw 'Signed APK live sync mode does not match the requested build.' }
        $nativeAIInApk = $false
        foreach ($entry in $nativeApk.Entries) {
            if ($entry.FullName -match '^assets/public/assets/[^/]+\.js$') {
                $reader = [IO.StreamReader]::new($entry.Open())
                try { if ($reader.ReadToEnd().Contains($nativeAIOrigin)) { $nativeAIInApk = $true } }
                finally { $reader.Dispose() }
            }
        }
        if (!$nativeAIInApk) { throw 'Signed APK is missing its AI service origin. It will not be archived as a valid build.' }
    } finally { $nativeApk.Dispose() }
    $apkHash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash
    $archiveRoot = Join-Path $workspaceRoot 'build/test-apks'
    New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null
    $archivePath = Join-Path $archiveRoot "hisab-$VersionName-v$VersionCode.apk"
    if (Test-Path -LiteralPath $archivePath) {
        if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash -ne $apkHash) { throw 'A different preserved APK already uses this version; choose a new version.' }
    } else { Copy-Item -LiteralPath $apkPath -Destination $archivePath }
    $evidence = @{ applicationId = $publicInfo.applicationId; versionCode = $VersionCode; versionName = $VersionName; databaseSchemaVersion = $databaseSchemaVersion; commit = (git rev-parse HEAD); certificateSha256 = $publicInfo.certificateSha256; apkSha256 = $apkHash; apkPath = $archivePath; aiServiceOrigin = $nativeAIOrigin; aiEnabled = !$WithoutAI; cloudRecoveryEnabled = [bool]$CloudRecovery; liveSyncEnabled = [bool]$LiveSync; builtAtUtc = [DateTime]::UtcNow.ToString('o'); physicalDeviceAcceptance = 'PENDING'; published = $false }
    $evidence | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding UTF8
    $evidence | ConvertTo-Json
} finally {
    Pop-Location
    foreach ($name in $previousVariables.Keys) { [Environment]::SetEnvironmentVariable($name, $previousVariables[$name], 'Process') }
    $password = $null
    $variables.Clear()
}
