/**
 * Main-process strings: notices, notifications, native menu, and the
 * model-facing scaffolding prompts. The renderer has react-i18next; the main
 * process just needs a locale-keyed table — `tr()` reads the locale set at
 * boot (and on settings change) from settings.locale.
 *
 * Caching note: none of these strings enter the static system prompt. The
 * model-facing ones live in per-turn user content or the semi-stable layer
 * (frozen once per session), so a locale switch never breaks an existing
 * session's prefix.
 */

type Locale = 'zh-CN' | 'en'

let current: Locale = 'zh-CN'

export function setMainLocale(locale: string): void {
  current = locale === 'en' ? 'en' : 'zh-CN'
}

const zh = {
  // run() preconditions / busy guard
  'err.noProject': '未选择项目目录',
  'err.projectGone': '项目目录不存在（可能已被删除或移动）。请重新选择项目。',
  'err.noKey': '未设置 API key',
  'err.noSession': '无法创建会话',
  'err.busy': '这个会话的上一个任务还在运行——等它完成，或先点「停止」再发送',
  // titles & labels
  'fork.suffix': '(分叉)',
  'receipt.sessionFallback': '对话结算',
  'receipt.monthBill': '{y}年{m}月账单',
  untitled: '未命名对话',
  'mem.user': '用户',
  // transcript notices
  'notice.compacted':
    '上下文已达阈值，历史已压缩为接力快照（用户指令逐字保留）：本轮按未命中计费，之后恢复命中',
  'notice.rolledBack':
    '已还原所有文件改动到任务前（对话保留）。如需撤销此操作，在变更面板点「恢复改动」。',
  'notice.redone': '已恢复文件改动（撤销了回滚）。',
  'notice.autoRoute': '自动路由：{model} · 思考{think}（{src} · {tier}）',
  'notice.override': '指令覆盖：{model} · 思考{think}',
  'route.triage': '分诊',
  'route.heuristic': '启发式',
  'think.off': '关',
  'think.high': '高',
  'think.max': '最大',
  'notice.repoOn':
    '全库模式已开启：{files} 个文件 / 约 {kt}K tokens 已进入上下文，本轮首次约 ¥{yuan}（未命中），之后每轮几乎全命中、近乎免费。模型无需再 grep/读取。',
  'notice.repoOver':
    '全库模式已开启，但项目约 {kt}K tokens 超过 300K 预算，本会话回退到普通模式（按需检索）。',
  'notice.repoEmpty': '全库模式已开启，但该项目暂无可读源码，本会话按普通模式运行（按需检索）。',
  'notice.coldRestore':
    '恢复的历史会话：服务端缓存已过期，本轮约 {kt}K tokens 将按未命中计费（约 ¥{yuan}），首个响应可能要等较久',
  'notice.stopped': '已停止：本次任务被中断，已完成的改动保留在变更面板',
  'notice.maxIter': '已达单轮最大步数上限：任务可能还没做完，发一句「继续」让它接着做。',
  'notice.hitDrop':
    '缓存命中率骤降：{prev}% → {cur}%，本轮多数输入按未命中计费（常见原因：缓存过期 / 工具集变更 / 长输入未对齐缓存单元）',
  'notice.budget': '已接近单任务预算上限 ¥{cap}，后续轮次自动降级为 v4-flash · 思考关',
  'notice.drift': '前缀漂移：{layer}（第 {at} 字节处分歧），本轮起缓存将重新累积',
  'drift.tools': '工具集发生变更',
  'drift.system': 'system prompt 发生变更',
  // system notifications
  'notify.failedTitle': 'VibeSeek · 任务失败',
  'notify.doneTitle': 'VibeSeek · 任务完成 ¥{cost}',
  'notify.doneBody': '{text}\n已省 ¥{saved}（{pct}%）',
  'notify.confirmTitle': 'VibeSeek · 需要确认',
  'notify.dayCostTitle': 'VibeSeek · 当日费用提醒',
  'notify.dayCostBody': '今天已花费 ¥{cost}',
  'notify.lowBalanceTitle': 'VibeSeek · 余额预警',
  'notify.lowBalanceBody': 'API 余额仅剩 ¥{n}，记得充值',
  // native menu
  'menu.help': '帮助',
  'menu.openLogs': '打开日志目录',
  'menu.about': '关于 {name}',
  'menu.edit': '编辑',
  'menu.undo': '撤销',
  'menu.redo': '重做',
  'menu.cut': '剪切',
  'menu.copy': '复制',
  'menu.paste': '粘贴',
  'menu.selectAll': '全选',
  'menu.window': '窗口',
  // tray
  'tray.open': '打开 VibeSeek',
  'tray.quit': '退出',
  'tray.balance': 'VibeSeek · 余额 ¥{n}',
  // /skill manual invocation
  'notice.skillForced': '已指定技能：{name}（本轮强制加载并按其执行）',
  'note.skillForced':
    '【技能指定】用户为本轮指定了技能「{name}」。先调用 use_skill("{name}") 加载它的完整说明，然后严格按照说明执行下面的任务。',
  // model-facing scaffolding
  'sub.noKey': '(子代理不可用：未设置 API key)',
  'ctx.memoryHeader':
    '项目记忆（来自 .vibeseek/MEMORY.md，由历史任务自动萃取，用户可在设置→记忆编辑）：',
  'ctx.memoryGlobalHeader':
    '全局个性化记忆（来自 ~/.vibeseek/MEMORY.md，由用户手动维护，跨所有项目生效）：',
  'ctx.repoHeader':
    '=== 全库模式：以下是本项目的全部源码（{files} 个文件，约 {kt}K tokens）。已在上下文中，无需再 grep/读取来查找；直接据此作答和修改。 ===',
  'note.rolledBack':
    '【工作区状态变化】此前的文件改动已被用户回滚到任务前状态。请不要假设文件仍是你之前编辑后的样子——后续任何修改前，先重新读取相关文件，以当前磁盘内容为准。',
  'note.redone':
    '【工作区状态变化】刚才的回滚已被撤销，文件改动已恢复到回滚前状态。后续任何修改前，先重新读取相关文件确认当前内容。',
  'compact.header':
    '[上下文已压缩] 以下是此前对话的接力快照与用户的全部原始指令（逐字保留），在此基础上继续工作：',
  'compact.snapshot': '## 会话快照',
  'compact.noSnapshot': '（无快照，凭下方指令推断上下文）',
  'compact.requests': '## 用户历史指令（逐字）',
  'compact.none': '（无）',
  'prompt.checkpoint': `[后台任务·会话快照] 忽略之前任务的进行状态，为本会话写一份接力快照（markdown，≤40 行，只写事实）：
## 目标
## 已完成
## 进行中与下一步
## 关键文件与决策
## 坑与约定
只输出快照内容本身，不要任何客套或解释。`,
  'prompt.memory': `[后台任务·项目记忆] 从本会话提炼值得长期记住的项目知识：架构决策、约定、踩过的坑、用户偏好。与下面的现有记忆合并去重，输出完整的新版 MEMORY.md（markdown，≤60 行）。没有新增知识就只输出 NO_UPDATE。

现有 MEMORY.md：
{existing}

只输出新版文件内容或 NO_UPDATE，不要任何解释。`,
  'prompt.memoryEmpty': '（空）',
  'prompt.plan': `[计划模式 / PLAN MODE]
现在处于计划模式：只读分析，禁止修改文件或执行任何改动型命令（这些工具会被拒绝）。
请用只读工具（read_file / grep / glob）调查清楚，然后输出一份具体、分步、可执行的方案：
- 要改哪些文件、各自改什么、为什么
- 涉及的命令或验证步骤
- 风险与注意点
不要现在动手。等我看完方案确认后，再切换到执行模式来落实。

任务：
`,
} as const

const en: Record<keyof typeof zh, string> = {
  'err.noProject': 'No project folder selected',
  'err.projectGone':
    'The project folder no longer exists (deleted or moved). Pick a project again.',
  'err.noKey': 'No API key set',
  'err.noSession': 'Could not create a conversation',
  'err.busy':
    'The previous task in this conversation is still running — wait for it to finish, or hit Stop first',
  'fork.suffix': '(fork)',
  'receipt.sessionFallback': 'Conversation receipt',
  'receipt.monthBill': 'Bill for {y}-{m}',
  untitled: 'Untitled conversation',
  'mem.user': 'User',
  'notice.compacted':
    'Context reached the threshold; history was compacted into a hand-off snapshot (your requests kept verbatim). This turn bills as cache misses, then hits resume.',
  'notice.rolledBack':
    'All file changes restored to the pre-task state (conversation kept). To undo, click "Restore edits" in the Changes panel.',
  'notice.redone': 'File edits restored (rollback undone).',
  'notice.autoRoute': 'Auto-routed: {model} · thinking {think} ({src} · {tier})',
  'notice.override': 'Directive override: {model} · thinking {think}',
  'route.triage': 'triage',
  'route.heuristic': 'heuristic',
  'think.off': 'off',
  'think.high': 'high',
  'think.max': 'max',
  'notice.repoOn':
    'Full-repo mode is on: {files} files / ~{kt}K tokens loaded into context. This first turn costs ~¥{yuan} (cache misses); afterwards nearly every turn is a cache hit and close to free. The model no longer needs to grep or read files.',
  'notice.repoOver':
    'Full-repo mode is on, but the project is ~{kt}K tokens — over the 300K budget. This conversation falls back to normal mode (on-demand search).',
  'notice.repoEmpty':
    'Full-repo mode is on, but this project has no readable source yet — this conversation runs in normal mode (on-demand search).',
  'notice.coldRestore':
    'Restored conversation: the server-side cache has expired, so this turn bills ~{kt}K tokens as misses (~¥{yuan}). The first response may take a while.',
  'notice.stopped': 'Stopped: the task was interrupted; finished edits remain in the Changes panel',
  'notice.maxIter':
    'Hit the per-task step limit — the task may be unfinished. Send "continue" to let it keep going.',
  'notice.hitDrop':
    'Cache hit rate dropped sharply: {prev}% → {cur}%. Most input this turn bills as misses (common causes: cache expiry / tool-set change / long input not aligned to cache units)',
  'notice.budget':
    'Approaching the per-task budget cap ¥{cap}; later turns auto-downgrade to v4-flash with thinking off',
  'notice.drift':
    'Prefix drift: {layer} (diverged at byte {at}); the cache rebuilds from this turn',
  'drift.tools': 'the tool set changed',
  'drift.system': 'the system prompt changed',
  'notify.failedTitle': 'VibeSeek · Task failed',
  'notify.doneTitle': 'VibeSeek · Task done ¥{cost}',
  'notify.doneBody': '{text}\nSaved ¥{saved} ({pct}%)',
  'notify.confirmTitle': 'VibeSeek · Approval needed',
  'notify.dayCostTitle': 'VibeSeek · Daily cost alert',
  'notify.dayCostBody': 'Spent ¥{cost} today',
  'notify.lowBalanceTitle': 'VibeSeek · Low balance',
  'notify.lowBalanceBody': 'Only ¥{n} left on the API balance — time to top up',
  'menu.help': 'Help',
  'menu.openLogs': 'Open log folder',
  'menu.about': 'About {name}',
  'menu.edit': 'Edit',
  'menu.undo': 'Undo',
  'menu.redo': 'Redo',
  'menu.cut': 'Cut',
  'menu.copy': 'Copy',
  'menu.paste': 'Paste',
  'menu.selectAll': 'Select All',
  'menu.window': 'Window',
  'tray.open': 'Open VibeSeek',
  'tray.quit': 'Quit',
  'tray.balance': 'VibeSeek · balance ¥{n}',
  'notice.skillForced': 'Skill pinned: {name} (force-loaded for this turn)',
  'note.skillForced':
    '[Skill pinned] The user pinned the skill "{name}" for this turn. First call use_skill("{name}") to load its full instructions, then follow them strictly while doing the task below.',
  'sub.noKey': '(Sub-agent unavailable: no API key set)',
  'ctx.memoryHeader':
    'Project memory (from .vibeseek/MEMORY.md, distilled automatically from past tasks; editable under Settings → Memory):',
  'ctx.memoryGlobalHeader':
    'Global personalization memory (from ~/.vibeseek/MEMORY.md, maintained manually by the user; applies across all projects):',
  'ctx.repoHeader':
    '=== Full-repo mode: below is the entire source of this project ({files} files, ~{kt}K tokens). It is already in context — do not grep or re-read files to find things; answer and edit based on this directly. ===',
  'note.rolledBack':
    '[Workspace state change] The user rolled back your earlier file edits to the pre-task state. Do not assume files still contain your edits — before any further modification, re-read the relevant files and treat the current disk content as the truth.',
  'note.redone':
    '[Workspace state change] The rollback was undone; the file edits are back to their pre-rollback state. Before any further modification, re-read the relevant files to confirm their current content.',
  'compact.header':
    "[Context compacted] Below is the hand-off snapshot of the earlier conversation plus all of the user's original requests (verbatim). Continue working from here:",
  'compact.snapshot': '## Session snapshot',
  'compact.noSnapshot': '(no snapshot — infer context from the requests below)',
  'compact.requests': "## User's past requests (verbatim)",
  'compact.none': '(none)',
  'prompt.checkpoint': `[Background task · session snapshot] Ignore the state of any ongoing task and write a hand-off snapshot for this session (markdown, ≤40 lines, facts only):
## Goal
## Done
## In progress & next steps
## Key files & decisions
## Pitfalls & conventions
Output only the snapshot itself — no pleasantries, no explanation.`,
  'prompt.memory': `[Background task · project memory] Distill project knowledge worth remembering long-term from this session: architecture decisions, conventions, pitfalls hit, user preferences. Merge and dedupe with the existing memory below, then output the complete new MEMORY.md (markdown, ≤60 lines). If there is nothing new, output only NO_UPDATE.

Existing MEMORY.md:
{existing}

Output only the new file content or NO_UPDATE — no explanation.`,
  'prompt.memoryEmpty': '(empty)',
  'prompt.plan': `[PLAN MODE]
You are in plan mode: read-only analysis; modifying files or running mutating commands is forbidden (those tools will be denied).
Investigate with read-only tools (read_file / grep / glob), then produce a concrete, step-by-step, actionable plan:
- Which files to change, what changes in each, and why
- Commands or verification steps involved
- Risks and caveats
Do not start working now. Wait until I review and confirm the plan, then we switch to execution mode.

Task:
`,
}

export type MainStringKey = keyof typeof zh

export function tr(key: MainStringKey, params?: Record<string, string | number>): string {
  let s: string = (current === 'en' ? en : zh)[key]
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}
