import { cost, savings as savingsOf, type Usage, type Pricing } from '@vibeseek/core'
import type { Db } from './database'

export const INSERT_USAGE = `
  INSERT INTO usage_log (ts, session, model, hit, miss, output, thinking, cost)
  VALUES (@ts, @session, @model, @hit, @miss, @output, @thinking, @cost)
`

export const SELECT_TOTALS = `
  SELECT
    COUNT(*)               AS requests,
    COALESCE(SUM(hit), 0)  AS hit,
    COALESCE(SUM(miss), 0) AS miss,
    COALESCE(SUM(output), 0) AS output,
    COALESCE(SUM(cost), 0) AS cost
  FROM usage_log
`

export const SELECT_BY_MODEL = `
  SELECT
    model,
    COUNT(*) AS requests,
    COALESCE(SUM(hit), 0)  AS hit,
    COALESCE(SUM(miss), 0) AS miss,
    COALESCE(SUM(output), 0) AS output,
    COALESCE(SUM(thinking), 0) AS thinking,
    COALESCE(SUM(cost), 0) AS cost
  FROM usage_log
  WHERE ts >= @since
  GROUP BY model
`

export const SELECT_SESSION_BY_MODEL = `
  SELECT
    model,
    COUNT(*) AS requests,
    COALESCE(SUM(hit), 0)  AS hit,
    COALESCE(SUM(miss), 0) AS miss,
    COALESCE(SUM(output), 0) AS output,
    COALESCE(SUM(thinking), 0) AS thinking,
    COALESCE(SUM(cost), 0) AS cost
  FROM usage_log
  WHERE session = @session
  GROUP BY model
`

/** Per-day activity since an ISO timestamp — drives the heatmap and streak. */
export const SELECT_DAILY = `
  SELECT
    substr(ts, 1, 10) AS day,
    COUNT(*) AS requests
  FROM usage_log
  WHERE ts >= @since
  GROUP BY day
  ORDER BY day
`

/** Per-day, per-model token sums — drives the stacked daily chart. */
export const SELECT_DAILY_BY_MODEL = `
  SELECT
    substr(ts, 1, 10) AS day,
    model,
    COUNT(*) AS requests,
    COALESCE(SUM(hit), 0)  AS hit,
    COALESCE(SUM(miss), 0) AS miss,
    COALESCE(SUM(output), 0) AS output,
    COALESCE(SUM(thinking), 0) AS thinking,
    COALESCE(SUM(cost), 0) AS cost
  FROM usage_log
  WHERE ts >= @since
  GROUP BY day, model
  ORDER BY day
`

/** Per-session, per-model sums in a range — drives the session cost ranking. */
export const SELECT_SESSIONS_RANGE = `
  SELECT
    session,
    model,
    COUNT(*) AS requests,
    COALESCE(SUM(hit), 0)  AS hit,
    COALESCE(SUM(miss), 0) AS miss,
    COALESCE(SUM(output), 0) AS output,
    COALESCE(SUM(thinking), 0) AS thinking,
    COALESCE(SUM(cost), 0) AS cost
  FROM usage_log
  WHERE ts >= @since
  GROUP BY session, model
`

/** Requests per UTC hour-of-day across all time — drives the peak-hour card. */
export const SELECT_HOURLY = `
  SELECT
    substr(ts, 12, 2) AS hour,
    COUNT(*) AS requests
  FROM usage_log
  GROUP BY hour
`

/** Per-day activity of one project — the project-home heatmap. */
export const SELECT_PROJECT_DAILY = `
  SELECT
    substr(u.ts, 1, 10) AS day,
    COUNT(*) AS requests
  FROM usage_log u
  JOIN sessions s ON s.id = u.session
  WHERE s.project_dir = @dir
  GROUP BY day
  ORDER BY day
`

/** Raw per-request rows of one conversation — the cost timeline. */
export const SELECT_REQUESTS_OF_SESSION = `
  SELECT ts, model, hit, miss, output
  FROM usage_log
  WHERE session = @session
  ORDER BY id
`

/** All usage of one project: every session whose project_dir matches. */
export const SELECT_PROJECT_BY_MODEL = `
  SELECT
    u.model AS model,
    COUNT(*) AS requests,
    COALESCE(SUM(u.hit), 0)  AS hit,
    COALESCE(SUM(u.miss), 0) AS miss,
    COALESCE(SUM(u.output), 0) AS output,
    COALESCE(SUM(u.thinking), 0) AS thinking,
    COALESCE(SUM(u.cost), 0) AS cost
  FROM usage_log u
  JOIN sessions s ON s.id = u.session
  WHERE s.project_dir = @dir
  GROUP BY u.model
`

export interface UsageTotals {
  requests: number
  hitTokens: number
  missTokens: number
  outputTokens: number
  cost: number
}

/** One day's request count (UTC date, matching the stored ISO ts). */
export interface DayUsage {
  day: string
  requests: number
}

/** Per-day per-model aggregate (UTC day). */
export interface DayModelAggregate extends ModelAggregate {
  day: string
}

/** Per-session per-model aggregate. */
export interface SessionModelAggregate extends ModelAggregate {
  session: string
}

/** One raw request of a conversation (for the cost timeline). */
export interface RequestRow {
  ts: string
  model: string
  hit: number
  miss: number
  output: number
}

export interface ModelAggregate {
  model: string
  requests: number
  hitTokens: number
  missTokens: number
  outputTokens: number
  thinkingTokens: number
  cost: number
}

interface AggRow {
  model: string
  requests: number
  hit: number
  miss: number
  output: number
  thinking: number
  cost: number
}

function toAggregate(r: AggRow): ModelAggregate {
  return {
    model: r.model,
    requests: r.requests,
    hitTokens: r.hit,
    missTokens: r.miss,
    outputTokens: r.output,
    thinkingTokens: r.thinking,
    cost: r.cost,
  }
}

/** Per-request accounting: one usage_log row per model turn. */
export class UsageStore {
  private readonly insertStmt
  private readonly totalsStmt
  private readonly byModelStmt
  private readonly dailyStmt
  private readonly dailyByModelStmt
  private readonly sessionByModelStmt
  private readonly sessionsRangeStmt
  private readonly requestsOfStmt
  private readonly projectByModelStmt
  private readonly hourlyStmt
  private readonly projectDailyStmt
  // Running savings, accumulated from the same usage rows we persist.
  private savings = 0

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(INSERT_USAGE)
    this.totalsStmt = db.prepare(SELECT_TOTALS)
    this.byModelStmt = db.prepare(SELECT_BY_MODEL)
    this.dailyStmt = db.prepare(SELECT_DAILY)
    this.dailyByModelStmt = db.prepare(SELECT_DAILY_BY_MODEL)
    this.sessionByModelStmt = db.prepare(SELECT_SESSION_BY_MODEL)
    this.sessionsRangeStmt = db.prepare(SELECT_SESSIONS_RANGE)
    this.requestsOfStmt = db.prepare(SELECT_REQUESTS_OF_SESSION)
    this.projectByModelStmt = db.prepare(SELECT_PROJECT_BY_MODEL)
    this.hourlyStmt = db.prepare(SELECT_HOURLY)
    this.projectDailyStmt = db.prepare(SELECT_PROJECT_DAILY)
  }

  record(model: string, usage: Usage, pricing: Pricing, session = 'main'): void {
    this.insertStmt.run({
      ts: new Date().toISOString(),
      session,
      model,
      hit: usage.cacheHitTokens,
      miss: usage.cacheMissTokens,
      output: usage.completionTokens,
      thinking: usage.reasoningTokens,
      cost: cost(usage, pricing),
    })
    this.savings += savingsOf(usage, pricing)
  }

  totals(): UsageTotals {
    const r = this.totalsStmt.get() as {
      requests: number
      hit: number
      miss: number
      output: number
      cost: number
    }
    return {
      requests: r.requests,
      hitTokens: r.hit,
      missTokens: r.miss,
      outputTokens: r.output,
      cost: r.cost,
    }
  }

  get saved(): number {
    return this.savings
  }

  /** Per-model aggregates since an ISO timestamp (''=all time). */
  byModel(sinceIso = ''): ModelAggregate[] {
    return (this.byModelStmt.all({ since: sinceIso }) as AggRow[]).map(toAggregate)
  }

  /** Per-day request counts since an ISO timestamp (''=all time), oldest first. */
  daily(sinceIso = ''): DayUsage[] {
    return this.dailyStmt.all({ since: sinceIso }) as DayUsage[]
  }

  /** Per-model aggregates for one conversation (for restoring session totals). */
  sessionByModel(sessionId: string): ModelAggregate[] {
    return (this.sessionByModelStmt.all({ session: sessionId }) as AggRow[]).map(toAggregate)
  }

  /** Per-model aggregates across every conversation of one project. */
  projectByModel(projectDir: string): ModelAggregate[] {
    return (this.projectByModelStmt.all({ dir: projectDir }) as AggRow[]).map(toAggregate)
  }

  /** Per-day per-model token sums since an ISO timestamp, oldest first. */
  dailyByModel(sinceIso = ''): DayModelAggregate[] {
    return (this.dailyByModelStmt.all({ since: sinceIso }) as Array<AggRow & { day: string }>).map(
      (r) => ({ ...toAggregate(r), day: r.day })
    )
  }

  /** Per-session per-model sums since an ISO timestamp (ranking source). */
  sessionsSince(sinceIso = ''): SessionModelAggregate[] {
    return (
      this.sessionsRangeStmt.all({ since: sinceIso }) as Array<AggRow & { session: string }>
    ).map((r) => ({ ...toAggregate(r), session: r.session }))
  }

  /** Raw request rows of one conversation, oldest first (cost timeline). */
  requestsOf(sessionId: string): RequestRow[] {
    return this.requestsOfStmt.all({ session: sessionId }) as RequestRow[]
  }

  /** Request counts bucketed by UTC hour-of-day, all time. */
  hourly(): Array<{ hour: string; requests: number }> {
    return this.hourlyStmt.all() as Array<{ hour: string; requests: number }>
  }

  /** Per-day request counts of one project, oldest first (project heatmap). */
  projectDaily(projectDir: string): DayUsage[] {
    return this.projectDailyStmt.all({ dir: projectDir }) as DayUsage[]
  }

  /** Wipe ALL usage history (settings → reset stats). Irreversible. */
  reset(): void {
    this.db.prepare('DELETE FROM usage_log').run()
    this.savings = 0
  }
}
