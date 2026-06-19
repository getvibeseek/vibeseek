/**
 * User-facing changelog (设置 → 更新历史). Curated, plain-language highlights —
 * NOT a technical changelog. Keep each entry short; describe what changed for
 * the user, not how. Add a new object to the TOP of the array per release.
 */
export interface ChangelogEntry {
  version: string
  /** Release date, YYYY-MM-DD. */
  date: string
  zh: string[]
  en: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.1',
    date: '2026-06-20',
    zh: ['macOS 适配', 'macOS 下改动备份与一键回滚现已可用'],
    en: ['macOS support', 'Change backup & one-click rollback now work on macOS'],
  },
  {
    version: '1.0.0',
    date: '2026-06-15',
    zh: [
      '首个公开版本 🎉',
      '会改代码的助手:读 / 改 / 跑命令,三档权限 + 计划模式',
      '全库模式、跨会话记忆召回、改坏一键回滚(逐文件 / 逐段接受拒绝)',
      '首次启动引导、个性化记忆、输入框「+」(附件 / 技能 / MCP)',
      '成本透明:实时余额、命中率、可截图分享的结算小票',
    ],
    en: [
      'First public release 🎉',
      'A code-editing assistant: read / edit / run, three permission tiers + plan mode',
      'Full-repo mode, cross-session memory recall, one-click rollback (per-file / per-hunk)',
      'First-run onboarding, personalization memory, and a composer “+” (files / skills / MCP)',
      'Cost transparency: live balance, hit rate, and a shareable settlement receipt',
    ],
  },
]
