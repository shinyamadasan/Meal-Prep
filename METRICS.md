# METRICS â€” Weekly Engineering Metrics

> A simple weekly log to replace intuition with evidence. After a month you can answer: *Is QA getting
> better? Is Self Review reducing reverts? Is autonomous development actually saving time?*
>
> **Honesty rule (same as QA.md / SELF_REVIEW.md):** every number is tagged by source. **Auto** = an
> agent can compute it from git + the repo files. **Manual** = needs a human signal â€” don't fabricate;
> leave `â€”` until you have a real number. Never report a metric you can't actually measure.

## How each metric is sourced
| Metric | Source | Type |
|---|---|---|
| Features shipped | `git log --since feat:` / `planning/DONE.md` | Auto |
| Bugs fixed | `git log --since fix:` | Auto |
| Reverts | `git log --since` reverts | Auto |
| Ideas captured | `captures/processed/**` dated in the week | Auto |
| Ideas implemented | captured items that reached `DONE.md` | Auto |
| Autonomous success rate | runs completing without Blocked Ã· runs (`claude-session.log` / STATUS) | Auto* |
| Bugs escaped QA | bugs found **after** ship (by you or users) | Manual |
| Avg review time | wall-clock per task, if tracked | Manual |

\* approximate from STATUS entries until run-logging exists.

## Week template â€” copy per week, newest at top
```
## Week of YYYY-MM-DD
- Features shipped: N
- Bugs fixed: N
- Bugs escaped QA: N        (manual)
- Reverts: N
- Autonomous success rate: N%
- Ideas captured: N
- Ideas implemented: N
- Avg review time: â€”        (manual)
- Notes: <what changed Â· what to watch next week>
```

*(Auto metrics can be filled by a future `/report` prompt â€” parked in ROADMAP â†’ Research.)*

---

## Log

## Week of 2026-06-25 â€” OS bootstrap (baseline, not steady-state)
- Features shipped: **1** user-facing (recipe count) â€” the rest of the week was infrastructure
- Bugs fixed: **3** (cloud-data wipe on deploy Â· light-only rendering Â· n8n auth type)
- Bugs escaped QA: **0** known
- Reverts: **0**
- Autonomous success rate: **â€”** (no autonomous feature build yet â€” all interactive this week)
- Ideas captured: **4** (1 real validation feature + 3 test/noise â€” all triaged correctly)
- Ideas implemented: **1**
- Avg review time: â€”
- Notes: This week built the **AI Dev OS itself** (docs system, capture pipeline, Self Review + QA + metrics) plus the light-only fix. Real steady-state numbers begin once the scheduled runs start building queued features. Treat this as the baseline, not a performance read.
