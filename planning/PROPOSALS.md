# Proposal Queue — pending product judgment

> **Triage writes here. Nothing here is built.** Each capture becomes a *proposal* with evidence and an
> AI-recommended priority, and waits for **your approval**.
> **You** approve → it moves to `ROADMAP.md` (the approved backlog). Park/Reject is recorded and dropped.
>
> Single responsibility: **Triage routes captures into this queue — it never schedules or builds.**
>
> Flow: `captures/inbox/ → Triage → PROPOSALS.md (here) → you approve → ROADMAP.md`

## Pending

### PROP-001 — Job #5 "cheapest": descope vs build store-compare
- type: decision · source: alpha audit
- evidence: the last external-testing blocker; Price Book implies "find cheapest" but only shows reference prices.
- options: **(A) descope** — reframe Price Book honestly as a price *reference* (no build, ~10 min);
  **(B) build** a minimal basket-total-per-store compare (real work, expands surface during alpha).
- effort: A=S · B=M · dependencies: none · confidence: high · AI-recommended priority: P1
- status: **pending** — your call (Approve A / Approve B / Park / Reject)

---

## Proposal entry format
*(triage fills these in; the rich evidence fields land in Phase 1)*
```
### PROP-NNN — <title>
- type: feature | bug | chore | decision · source captures: <ids> (×N duplicates)
- evidence: <recurring friction · dup count · roadmap/goal alignment · similar past work>
- effort: S|M|L · dependencies: <...> · confidence: high|med|low · ambiguity: <none|...>
- AI-recommended priority: P0..P3
- status: pending
```
