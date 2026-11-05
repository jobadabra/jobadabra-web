# Plan: one Codex conversation per persona goal

Spec: `docs/superpowers/specs/2026-11-05-broker-codex-resume-design.md`. Progress = the PRs below (owner, 3 Nov 2026: three levels only).

| # | PR | Repo | Owner | What the owner gets |
|---|---|---|---|---|
| 1/2 | [bf] The broker keeps one Codex conversation per persona goal | jobadabra-web | bf | a persona step costs ~2–4k of the Codex week instead of ~16.5k, once the caller sends `session` |
| 2/2 | [ag] The persona sends a session id and only its new turn | jobadabra (`desktop/e2e`) | ag-ai-user-agents-f1 | a 250k run gets ~6 goals × ~14 steps instead of ~1 goal |
| after | Measure on the first real persona run | – | ag + bf | read the per-turn `input`/`cached`/`counted` for the +3.5k/+2.6k jump (spec, open question) |

Order: 1/2 first. A request with `session` to an old broker is a plain fresh call, so nothing breaks in either order.
