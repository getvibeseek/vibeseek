import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from './settings-store'
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS } from '../../shared/settings'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-settings-'))
  file = join(dir, 'settings.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('writes defaults on first run', () => {
    const store = new SettingsStore(file)
    expect(existsSync(file)).toBe(true)
    expect(store.getAll()).toEqual(DEFAULT_SETTINGS)
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('persists a changed value and reloads it', () => {
    const store = new SettingsStore(file)
    store.set('theme', 'light')
    const reopened = new SettingsStore(file)
    expect(reopened.get('theme')).toBe('light')
  })

  it('remembers window bounds across reloads', () => {
    const store = new SettingsStore(file)
    store.set('window', { width: 1000, height: 700, x: 120, y: 80, maximized: false })
    const reopened = new SettingsStore(file)
    expect(reopened.get('window')).toEqual({
      width: 1000,
      height: 700,
      x: 120,
      y: 80,
      maximized: false,
    })
  })

  it('merges newly-added keys onto an older config', () => {
    // Simulate a config missing some keys (older app version).
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, theme: 'light' }), 'utf8')
    const store = new SettingsStore(file)
    expect(store.get('theme')).toBe('light')
    expect(store.get('baseUrl')).toBe(DEFAULT_SETTINGS.baseUrl)
    expect(store.get('window')).toEqual(DEFAULT_SETTINGS.window)
  })

  it('falls back to defaults on a corrupt file', () => {
    writeFileSync(file, '{ not valid json', 'utf8')
    const store = new SettingsStore(file)
    expect(store.getAll()).toEqual(DEFAULT_SETTINGS)
  })

  it('upgrades a pre-versioned (schemaVersion 0) config and rewrites it', () => {
    writeFileSync(file, JSON.stringify({ theme: 'light' }), 'utf8')
    new SettingsStore(file)
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('migrates v1 permissionMode "plan" to standard + planMode (1->2)', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, permissionMode: 'plan' }), 'utf8')
    const store = new SettingsStore(file)
    expect(store.get('permissionMode')).toBe('standard')
    expect(store.get('planMode')).toBe(true)
  })

  it('keeps a v1 yolo permissionMode and defaults planMode off (1->2)', () => {
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, permissionMode: 'yolo' }), 'utf8')
    const store = new SettingsStore(file)
    expect(store.get('permissionMode')).toBe('yolo')
    expect(store.get('planMode')).toBe(false)
  })
})
