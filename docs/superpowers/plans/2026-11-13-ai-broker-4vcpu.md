# AI broker on 4 vCPU (durable_object policy)

> **Verdict:** CI's AI broker moves from 2 vCPU (Container class, deprecated "default" policy) to 4 vCPU at the same 6 GiB on the durable_object policy, about $0 extra (CPU billed by use). Sketch: https://claude.ai/artifact/5VjUb6hFs8CAhG6eS85sve

Owner, 13 Nov 2026: "then, explore and try"; "Measure, then migrate (Recommended)"; "Ok, do it then in 2 PRs" · "the 2nd one will do the cleanup" · "and eventually the switch".
Measured: with 16 Claude slots the 2 vCPU container peaked at 1.94-1.99 vCPU (00:21, 00:25Z), memory 2.2 of 6 GiB.

## PRs
1. **1/2 New broker beside the old, state copy, switch.** `AiBroker` (lib/do-container.mjs) beside `CodexBroker`; `/admin/copy`; the Worker setting `BROKER_ACTIVE=next`. CI unchanged until the switch.
2. **2/2 Cleanup.** `AiBroker` is the only broker: the old class becomes a tombstone, its container application is deleted, `BROKER_ACTIVE` and `/old/...` go.

## Progress
- [ ] 1/2 merged and released
- [ ] `/next/health` up; one Claude call through `/admin/next/call`
- [ ] `/admin/copy`; one Codex call
- [ ] `BROKER_ACTIVE=next`; first Claude-heavy round: CPU per minute, waits, errors
- [ ] 2/2 merged
