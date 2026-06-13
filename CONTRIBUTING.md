# Contributing to VibeSeek

感谢你的兴趣!Thanks for your interest!

## 开发环境 / Setup

```bash
pnpm install
pnpm --filter desktop dev   # run the app
pnpm -r test                # tests (real-API smokes are env-gated, zero spend by default)
pnpm lint && pnpm -r typecheck
```

## 硬规则 / Hard rules

These are enforced in review:

1. **缓存五原则 / Caching rules**: static system prompt (zero dynamic content), tool sets frozen at session start, append-only message history, batched compaction, no re-pasting file contents. Any PR that breaks the cache prefix is a rework.
2. **packages/core 禁止 Electron/React import** (ESLint enforced).
3. **No `if (model === ...)`** — everything goes through the model registry and capability flags.
4. API keys never enter the renderer, logs, or git. Log writes go through the redaction layer.
5. UI strings always via `t()` (renderer) or `tr()` (main) — both zh-CN and en.

## 提交 / Commits

- One focused change per PR; tests for behavior changes.
- Run the full verify suite before pushing: typecheck + lint (0 errors) + test + build.

## 反馈问题 / Reporting issues

设置 → 日志与诊断 → 导出诊断包 (keys auto-redacted, no code content) and attach it — it makes most issues a one-look diagnosis.
