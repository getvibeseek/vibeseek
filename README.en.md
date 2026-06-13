<div align="center">

# ⚡ VibeSeek

### A DeepSeek-native desktop client for vibe coding

<p>
<code>📚 Full-repo mode</code> &nbsp; <code>🎨 A refined UI</code> &nbsp; <code>🧩 Skills work unchanged</code> &nbsp; <code>↩️ One-click rollback</code>
</p>

<sub><a href="README.md">简体中文</a> · English</sub>

<!--
  Badges and the star-history chart turn on once the repo is public (neither
  renders for a private repo):

  ![License](https://img.shields.io/badge/license-MIT-blue)
  ![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
  ![Made with Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron)

  [![Star History Chart](https://api.star-history.com/svg?repos=qjg23/vibeseek&type=Date)](https://star-history.com/#qjg23/vibeseek&Date)
-->

</div>

> 🚧 **In development — release coming soon.** A Windows desktop app, DeepSeek-native.

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

## 🙏 Acknowledgements

VibeSeek stands on the shoulders of prior art:

- **[Reasonix](https://github.com/esengine/deepseek-reasonix)** — a cache-first agent design that inspired our approach
- **[DeepSeek-GUI](https://github.com/XingYu-Zhong/DeepSeek-GUI)** — an open engineering reference for cache optimization
- **[MiMo-Code](https://github.com/XiaoMi/MiMo)** — persistent memory architecture (checkpoint + full-text recall)
- **[Claude Code](https://claude.ai/code)** — interaction model and permission-system design reference

No third-party code has been copied; font and icon licenses are in **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**.

<div align="center"><sub>To contribute, see <a href="CONTRIBUTING.md">CONTRIBUTING.md</a></sub></div>
