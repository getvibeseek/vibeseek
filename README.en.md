<div align="center">

# ⚡ VibeSeek

### A DeepSeek-native desktop client for vibe coding

<p>
<code>📚 Full-repo mode</code> &nbsp; <code>🎨 A refined UI</code> &nbsp; <code>🧩 Skills work unchanged</code> &nbsp; <code>↩️ One-click rollback</code>
</p>

<sub><a href="README.md">简体中文</a> · English</sub>

<p>
<a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue"></a>
<img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D6">
<img alt="Electron" src="https://img.shields.io/badge/Electron-2B2E3A?logo=electron">
</p>

</div>

> **A Windows & macOS desktop app, DeepSeek-native.** Latest: [download v1.0.1 →](https://github.com/getvibeseek/vibeseek/releases/latest)

---

## 💡 Why VibeSeek

VibeSeek is built to do one thing well: **make you want to stay inside it and write code.** Comfortable typography, the safety of undoing a bad edit instantly, handing the whole project to the model so it locates things directly, and spend you can actually see — the things you touch every day.

---

## ✨ Features

| | Feature | What it means |
|:--:|---|---|
| 🤖 | **An assistant that edits code** | Reads files / edits code / runs commands, three permission tiers (read-only · confirm changes · double-confirm dangerous ops), plus a plan-first mode |
| ↩️ | **Undo without fear** | A restore point before every action, one click back (restore-point UX inspired by Claude Code); accept or reject each file or each hunk |
| 🧩 | **Plug into the ecosystem** | Your existing skills work with zero changes; MCP tools connect with a bit of config |
| 📚 | **Full-repo mode** | Hand the whole codebase to the model so it answers without rummaging through files |
| 🧾 | **Cost you can see** | Live balance, hit rate and spend; every task comes with a shareable **settlement receipt** |
| 🎛️ | **Thoughtful touches** | Dark / light / system theme, a resizable side panel, an embedded preview browser, cross-session recall |

---

## 📸 Screenshots

<p align="center">
  <img src="docs/screenshots/home.png" alt="VibeSeek new-task home" width="820">
</p>

<p align="center"><sub>The new-task home — savings overview, cumulative stats, and an activity heatmap at a glance</sub></p>

<!-- To add: document-flow chat · settlement receipt (need real session data) -->

---

## 📊 Measured

Real-API numbers (every case is verified by **importing the produced code and running it**; full report in **[docs/评测结果.md](docs/评测结果.md)**):

| Dimension | Result |
|---|---|
| 🎯 **Task pass rate** | **100%** — 32 cases × auto/flash/pro × 2 runs, all passed |
| 💰 **Auto-routing savings** | same result at **~40% of pure-pro's cost** (~60% cheaper) |
| 📚 **Full-repo mode** | **72/72 correct, 0 retrieval calls** — locates code straight from context |
| ⚡ **Cache hit rate** | **90–95%** in everyday sessions, **99%+** on large projects / full-repo |

<sub>📌 Reported per regime: small one-shot tasks ~88–90% (each task's new content can't be cached — a math floor); longer sessions and bigger projects go higher.</sub>

---

## 📥 Install

- **Windows**: `VibeSeek-Setup-*.exe` (x64) from the [latest Release](https://github.com/getvibeseek/vibeseek/releases/latest). Unsigned — a first-run SmartScreen prompt is expected; click **More info → Run anyway**.
- **macOS**: `VibeSeek-*-arm64.dmg` (Apple Silicon) from the same page. Unsigned — on first open, right-click → **Open**, or allow it under **System Settings → Privacy & Security**; or run `xattr -dr com.apple.quarantine /Applications/VibeSeek.app`.
- Verify downloads against the `SHA256SUMS.txt` on the same page.

### About change backups

One-click "roll back to before the task" relies on Git being installed; per-file / per-hunk accept & reject are unaffected and always work.

- Without Git: only one-click rollback is unavailable — everything else works as usual.
- Windows: install [Git for Windows](https://git-scm.com/download/win) (keep the defaults — it's added to PATH automatically).
- macOS: run `xcode-select --install` in Terminal, or `brew install git` via Homebrew.

---

## 🙏 Acknowledgements

VibeSeek stands on the shoulders of prior art:

- **[Reasonix](https://github.com/esengine/deepseek-reasonix)** — a cache-first agent design that inspired our approach
- **[DeepSeek-GUI](https://github.com/XingYu-Zhong/DeepSeek-GUI)** — an open engineering reference for cache optimization
- **[MiMo-Code](https://github.com/XiaoMi/MiMo)** — persistent memory architecture (checkpoint + full-text recall)
- **[Claude Code](https://claude.ai/code)** — interaction model and permission-system design reference

No third-party code has been copied; font and icon licenses are in **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**.

<div align="center"><sub>To contribute, see <a href="CONTRIBUTING.md">CONTRIBUTING.md</a></sub></div>

---

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=getvibeseek/vibeseek&type=Date)](https://star-history.com/#getvibeseek/vibeseek&Date)

</div>
