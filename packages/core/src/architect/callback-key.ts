import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Persists the HMAC key used to sign/verify architect merge-approval callback
 * tokens, mirroring api/routes/admin.ts's getOrCreateAdminToken pattern.
 */
export function getOrCreateCallbackKey(dataDir: string): Buffer {
  const envKey = process.env.CC_ARCHITECT_CALLBACK_KEY
  if (envKey) return Buffer.from(envKey, 'hex')

  const keyFile = join(dataDir, '.architect-callback-key')
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'hex')

  const key = randomBytes(32)
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 })
  console.log(`[coastal-ai] Architect callback signing key written to ${keyFile}`)
  return key
}
