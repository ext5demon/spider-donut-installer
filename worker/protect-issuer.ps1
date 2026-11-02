param([ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $inputText = [Console]::In.ReadToEnd()
    $entropy = [Text.Encoding]::UTF8.GetBytes('Spider Donut issuer storage v1')
    if ($Mode -eq 'Protect') {
        $plain = [Text.Encoding]::UTF8.GetBytes($inputText)
        try {
            $protected = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
            [Console]::Out.Write([Convert]::ToBase64String($protected))
        } finally { [Array]::Clear($plain, 0, $plain.Length) }
    } else {
        $protected = [Convert]::FromBase64String($inputText)
        $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain)) }
        finally { [Array]::Clear($plain, 0, $plain.Length) }
    }
} catch {
    [Console]::Error.Write('Windows account protection could not complete this operation.')
    exit 1
}
