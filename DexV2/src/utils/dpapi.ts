import { execSync } from 'child_process';

export function encrypt(plainText: string): string {
  if (process.platform !== 'win32') {
    // Non-windows fallback for development/testing environments
    return Buffer.from(plainText, 'utf8').toString('base64');
  }

  const b64Input = Buffer.from(plainText, 'utf8').toString('base64');
  const cmd = `Add-Type -AssemblyName System.Security; ` +
              `$plainBytes = [System.Convert]::FromBase64String('${b64Input}'); ` +
              `$protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
              `[System.Convert]::ToBase64String($protectedBytes)`;

  const output = execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  return output.trim();
}

export function decrypt(cipherTextB64: string): string {
  if (process.platform !== 'win32') {
    // Non-windows fallback
    return Buffer.from(cipherTextB64, 'base64').toString('utf8');
  }

  const cmd = `Add-Type -AssemblyName System.Security; ` +
              `$protectedBytes = [System.Convert]::FromBase64String('${cipherTextB64}'); ` +
              `$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
              `[System.Convert]::ToBase64String($plainBytes)`;

  const output = execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  return Buffer.from(output.trim(), 'base64').toString('utf8');
}
