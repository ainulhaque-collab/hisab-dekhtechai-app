[CmdletBinding()]
param([switch]$ResumeIncomplete)
$ErrorActionPreference = 'Stop'
if ([Security.Principal.WindowsIdentity]::GetCurrent().Name -match '\\CodexSandbox') {
    throw 'Run signing setup in the desktop owner Windows account, not a sandbox account. DPAPI recovery must belong to the owner.'
}
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signingRoot = Join-Path $workspaceRoot '.local-signing'
$storePath = Join-Path $signingRoot 'hisab-release.p12'
$credentialsPath = Join-Path $signingRoot 'credentials.dpapi.json'
$metadataPath = Join-Path $signingRoot 'public-certificate.json'
$keyPath = Join-Path $signingRoot 'temporary-encrypted-private.key'
$certificatePath = Join-Path $signingRoot 'release-certificate.pem'
$opensslPath = (Get-Command openssl -ErrorAction Stop).Source

if ((Test-Path -LiteralPath $signingRoot) -and !$ResumeIncomplete) {
    throw 'Signing directory already exists. Refusing to replace any signing identity. Inspect/recover the existing files instead.'
}
if ($ResumeIncomplete -and ((Test-Path -LiteralPath $storePath) -or !(Test-Path -LiteralPath $credentialsPath) -or !(Test-Path -LiteralPath $keyPath))) {
    throw 'Resume requires the existing encrypted key and credentials, with no completed keystore. No key will be regenerated.'
}
if (!(Test-Path -LiteralPath $signingRoot)) { New-Item -ItemType Directory -Path $signingRoot | Out-Null }
# Restrict both the encrypted keystore and DPAPI-wrapped password to this Windows user.
$acl = Get-Acl -LiteralPath $signingRoot
$acl.SetAccessRuleProtection($true, $false)
foreach ($existingRule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existingRule) }
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$rule = New-Object Security.AccessControl.FileSystemAccessRule($currentSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $signingRoot -AclObject $acl

$randomBytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($randomBytes)
$rng.Dispose()
$password = [Convert]::ToBase64String($randomBytes)
if ($ResumeIncomplete) {
    $savedCredentials = Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json
    $securePassword = ConvertTo-SecureString $savedCredentials.storePasswordProtected
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$previousPassword = [Environment]::GetEnvironmentVariable('HISAB_SIGNING_TEMP_PASSWORD', 'Process')
$env:HISAB_SIGNING_TEMP_PASSWORD = $password
try {
    if (!$ResumeIncomplete) {
        $protectedPassword = ConvertFrom-SecureString (ConvertTo-SecureString $password -AsPlainText -Force)
        @{ format = 1; alias = 'hisabdekhtechai'; storeType = 'PKCS12'; storePasswordProtected = $protectedPassword } |
            ConvertTo-Json | Set-Content -LiteralPath $credentialsPath -Encoding UTF8
        & $opensslPath genpkey -quiet -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -aes-256-cbc -pass env:HISAB_SIGNING_TEMP_PASSWORD -out $keyPath
        if ($LASTEXITCODE -ne 0) { throw 'Private key generation failed. Keep the directory for inspection; no key is silently regenerated.' }
    }
    & $opensslPath pkey -in $keyPath -passin env:HISAB_SIGNING_TEMP_PASSWORD -check -noout | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Existing encrypted private key failed validation. No identity was replaced.' }
    & $opensslPath req -new -x509 -key $keyPath -passin env:HISAB_SIGNING_TEMP_PASSWORD -sha256 -days 10950 -subj '/CN=Hisab DekhteChai/O=Hisab DekhteChai' -out $certificatePath 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Public certificate generation failed.' }
    & $opensslPath pkcs12 -export -inkey $keyPath -passin env:HISAB_SIGNING_TEMP_PASSWORD -in $certificatePath -name hisabdekhtechai -passout env:HISAB_SIGNING_TEMP_PASSWORD -out $storePath 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Encrypted PKCS12 keystore creation failed.' }
    $sha1 = (& $opensslPath x509 -in $certificatePath -noout -fingerprint -sha1) -replace '^.*=', ''
    if ($LASTEXITCODE -ne 0) { throw 'Certificate SHA-1 verification failed.' }
    $sha256 = (& $opensslPath x509 -in $certificatePath -noout -fingerprint -sha256) -replace '^.*=', ''
    if ($LASTEXITCODE -ne 0) { throw 'Certificate SHA-256 verification failed.' }
    $publicInfo = @{ applicationId = 'com.hisabdekhtechai.app'; alias = 'hisabdekhtechai'; storeType = 'PKCS12'; createdAtUtc = [DateTime]::UtcNow.ToString('o'); certificateSha1 = $sha1; certificateSha256 = $sha256; portableRecoveryBackup = 'PENDING: owner must retain keystore and recoverable password separately' }
    $publicInfo | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding UTF8
    $publicInfo | ConvertTo-Json
    Write-Output 'Signing identity created locally. Password is DPAPI-protected for this Windows user. No customer APK has been built or published.'
} finally {
    [Environment]::SetEnvironmentVariable('HISAB_SIGNING_TEMP_PASSWORD', $previousPassword, 'Process')
    $password = $null
    [Array]::Clear($randomBytes, 0, $randomBytes.Length)
    # This exact temporary encrypted key is inside the fixed private workspace directory.
    if ((Test-Path -LiteralPath $storePath) -and (Test-Path -LiteralPath $keyPath)) { Remove-Item -LiteralPath $keyPath }
}
