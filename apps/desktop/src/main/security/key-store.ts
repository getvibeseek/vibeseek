import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { maskApiKey } from '@vibeseek/core'
import type { ApiKeyStatus } from '../../shared/ipc'

/**
 * Encrypted API key storage. The key is encrypted with Electron safeStorage
 * (Windows DPAPI) and written to a standalone file in userData — never into
 * settings.json, never in plaintext, never exposed to the renderer (§ security
 * rule 1). The renderer only ever receives a masked form.
 */
export class KeyStore {
  constructor(private readonly file: string) {}

  /** True if OS-backed encryption is available (DPAPI/Keychain/libsecret). */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** Persist a new key (encrypted). Returns the masked status for the renderer. */
  set(key: string): ApiKeyStatus {
    const trimmed = key.trim()
    if (!trimmed) return this.status()
    if (!this.isAvailable()) {
      throw new Error('OS encryption (safeStorage) is not available on this system')
    }
    const encrypted = safeStorage.encryptString(trimmed)
    writeFileSync(this.file, encrypted)
    return { hasKey: true, masked: maskApiKey(trimmed) }
  }

  /** Decrypt and return the plaintext key. MAIN PROCESS ONLY — never over IPC. */
  get(): string | null {
    if (!existsSync(this.file)) return null
    try {
      return safeStorage.decryptString(readFileSync(this.file))
    } catch {
      return null
    }
  }

  status(): ApiKeyStatus {
    const key = this.get()
    return key ? { hasKey: true, masked: maskApiKey(key) } : { hasKey: false, masked: null }
  }

  clear(): void {
    rmSync(this.file, { force: true })
  }
}
