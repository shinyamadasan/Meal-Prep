# Approved Build Queue

> **The ONLY file the autonomous Builder reads.** It holds **only human-approved sprint items**.
>
> - Triage **never** writes here (it writes Proposals).
> - The Sprint Planner proposes a batch from `ROADMAP.md`; **you approve the batch**; only then does it land here.
> - The Builder builds what's here — it **never** triages, **never** prioritizes, and **never** reads
>   `captures/inbox/`, `PROPOSALS.md`, or `ROADMAP.md` for work. (Single responsibility.)
>
> Flow: `ROADMAP.md → AI Sprint Planner → (you approve the batch) → BUILD_QUEUE.md (here) → Builder`

## Approved sprint
*(empty — nothing approved to build. The Builder finds this empty → does nothing.)*
