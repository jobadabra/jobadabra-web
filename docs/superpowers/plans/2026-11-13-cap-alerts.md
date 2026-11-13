# Telegram alerts on every cap

> **Verdict:** every line that stops or slows something tells the owner twice: a 🟠 medium card when approaching, a 🔴 critical card when reached, once per period, through one cap registry (`shared/cap-alerts.js`) and the switchboard (`alertOwner`). Sketch and inventory: https://claude.ai/artifact/PVB8Su2LfyX8uQc27duLhC

Owner, 13 Nov 2026: "Let's add Telegram alerts to all the caps/limits/stops.. One medium when we approaching the limit/cap and another one, ciritical, when we reached it" (the Free AI $10-a-day stop was reached in silence).
Asked via AskUserQuestion: "why not doing for all of them, both approaching and reached ?", then "Grouped hourly (Recommended)": per-install lines get both cards too, grouped each hour, only when something happened.

## PRs
1. **1/3 The registry and Free AI's lines.** `capCheck` + `capCard`; day, month, Workers AI allowance and board web search month. The three old alert functions move onto it, and a refusal also checks the 🔴 card.
2. **2/3 The AI broker's lines and the form reports' day total.** Codex week, Claude week, the Free AI fallback day, the drift lane's day, `ALL_REPORTS_PER_DAY`, all on the same registry. The broker sends through the site's `/ops/notify`, as it does today.
3. **3/3 Per-install lines, grouped hourly.** The trial, install day and month, per-minute, Pro credit, cloud checks, a night's cost, web search per day, and the request quotas: each hour one 🟠 card (installs approaching) and one 🔴 card (installs that reached a line), only when not zero.

## Progress
- [ ] 1/3 merged
- [ ] 2/3 merged
- [ ] 3/3 merged
