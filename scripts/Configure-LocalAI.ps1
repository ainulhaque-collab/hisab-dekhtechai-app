param(
    [string]$Model = 'auto',
    [string]$WebClientId = '271505920973-an5igoqnn715b3j39g05r7vausnqhat2.apps.googleusercontent.com'
)
$ErrorActionPreference = 'Stop'
$projectFolder = Split-Path -Parent $PSScriptRoot
$configFile = Join-Path $projectFolder '.env.ai.local'
if ($Model -ne 'auto' -and $Model -notmatch '^gemini-[A-Za-z0-9._-]+$') { throw 'Use auto or a valid Gemini model name.' }
if ($WebClientId -notmatch '^[\w-]+\.apps\.googleusercontent\.com$') { throw 'Enter this project''s public Web OAuth client ID.' }
$secret = Read-Host 'Gemini API key (hidden; do not paste it into chat)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($plainKey -notmatch '^[A-Za-z0-9_-]{20,200}$') { throw 'The API key format is invalid.' }
    # Dedicated ignored server config. Does not overwrite existing OAuth/app .env.
    $content = @"
GEMINI_API_KEY="$plainKey"
GEMINI_MODEL="$Model"
AI_PROVIDER="gemini"
GOOGLE_OAUTH_CLIENT_IDS="$WebClientId"
AI_ENABLED="true"
AI_LOCAL_DEVELOPMENT="true"
AI_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,https://localhost"
AI_PER_MINUTE="3"
AI_PER_DAY="10"
AI_GLOBAL_PER_DAY="100"
"@
    [IO.File]::WriteAllText($configFile, $content, [Text.UTF8Encoding]::new($false))
    Write-Host 'Local AI configuration saved. No key was printed. Run npm run dev:api in a separate terminal.'
} finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plainKey = $null; $content = $null; $secret.Dispose()
}
