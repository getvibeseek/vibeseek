import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS, type Settings } from '../../shared/settings'

/**
 * Forward-only migrations. Index i migrates a settings object from
 * schemaVersion i to i+1. Add a function here when CURRENT_SCHEMA_VERSION bumps;
 * never mutate or delete existing entries.
 */
const MIGRATIONS: Array<(s: Record<string, unknown>) => Record<string, unknown>> = [
  // 0 -> 1: baseline. Nothing to migrate; pre-versioned configs are merged onto
  // defaults below, so this slot exists only to anchor the version sequence.
  (s) => s,
  // 1 -> 2: "plan" was a permission level; it is now a collaboration-mode toggle
  // (planMode) and permissionMode keeps only the access levels standard|yolo.
  (s) => {
    if (s.permissionMode === 'plan') {
      s.permissionMode = 'standard'
      s.planMode = true
    }
    return s
  },
  // 2 -> 3: onboarding was added. An existing config means the user is already
  // up and running, so mark them onboarded — only fresh installs see the flow.
  (s) => {
    s.onboarded = true
    return s
  },
]

/**
 * JSON-file-backed settings with schemaVersion + forward-only migrations.
 * Electron-free by design (takes an explicit file path) so it can be unit
 * tested without an Electron runtime; main resolves userData and passes it in.
 */
export class SettingsStore {
  private readonly file: string
  private data: Settings

  constructor(file: string) {
    this.file = file
    this.data = this.load()
  }

  private load(): Settings {
    if (!existsSync(this.file)) {
      // Write defaults on first run so the file always exists afterwards.
      const defaults = structuredClone(DEFAULT_SETTINGS)
      this.persist(defaults)
      return defaults
    }

    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      // Corrupt file — fall back to defaults rather than crash.
      const defaults = structuredClone(DEFAULT_SETTINGS)
      this.persist(defaults)
      return defaults
    }

    const startVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
    let version = startVersion
    while (version < CURRENT_SCHEMA_VERSION) {
      const migrate = MIGRATIONS[version]
      if (migrate) raw = migrate(raw)
      version += 1
    }

    // Merge onto defaults so newly-added keys always have a value.
    const merged: Settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...(raw as Partial<Settings>),
      window: { ...DEFAULT_SETTINGS.window, ...((raw.window as object) ?? {}) },
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }

    if (startVersion !== CURRENT_SCHEMA_VERSION) this.persist(merged)
    return merged
  }

  private persist(data: Settings): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8')
  }

  getAll(): Settings {
    return structuredClone(this.data)
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key]
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.data[key] = value
    this.persist(this.data)
  }
}
