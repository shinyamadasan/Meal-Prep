# Synchronization Audit & Hardening Report

**Status:** audit only — no code changed in this pass (per the hardening-sprint rule: prove correctness first).
**Scope:** every pathway that reads/writes/merges/deletes cloud or local data, seeds defaults, restores backups,
or changes auth state. Source of truth: `app.js`. Stable anchors are function names (never line numbers, per D-008).

---

## 1. Pathway inventory

| Action | Function(s) | What it does |
|---|---|---|
| **Read cloud** | `loadFromFirestore` (getDoc) · realtime `onSnapshot` (in `setupRealtimeListeners`) · `loadProfile` · `loadPhotoDocsIntoCache` | Pull the `users/{uid}` doc / live updates. |
| **Write cloud** | `saveToFirestore` (runTransaction `tx.set`; `setDoc` fallback) · `initializeUserData` (→ saveToFirestore) · `deleteDoc` (in `clearLocalStorage`) · `saveUsername` (profiles) · `savePhotoDoc`/`deletePhotoDoc` | Persist AppState; delete the whole doc on Clear. |
| **Read local** | `loadFromLocalStorage` · the union read in `loadUserData` · `restoreBackup` (BACKUP_KEY) | Read `STORAGE_KEY` / backup. |
| **Write local** | `saveToLocalStorage` · `createBackup` (BACKUP_KEY) · `clearLocalStorage` (`removeItem`) | Persist AppState / snapshot / wipe. |
| **Merge** | `loadUserData` (sign-in **union + tombstones**) · `mergeCloudConflict` (concurrent save) · `onSnapshot` (version-gated replace + tombstones) · import `unionById` · `mergeWeeklyPlan` (fill-empty-slots) | Combine local + cloud. |
| **Delete** | per-item handlers (`deleteRecipe`, `removeFromPantry`, `deleteIngredient`, …) → detected by `recordLocalDeletions` (baseline diff) → **tombstones** · `deductIngredientsForRecipe` (auto-remove depleted) · `clearLocalStorage` (deleteDoc) | Remove items; tombstone the curated lists. |
| **Seed defaults** | `seedPantryIfEmpty` (Kitchen-Setup modal, gated by `pantryOnboardingDone`) · `recipes.length===0 → sampleRecipes` (inside `loadFromLocalStorage` **and** `loadFromFirestore`) | Inject starter content when empty. |
| **Restore** | `restoreBackup` (BACKUP_KEY → replace AppState → saveData) | One-click undo of Clear/Import. |
| **Sign in** | `signIn` (→ loadUserData) · `onAuthStateChanged(user)` (cloudReady=false → loadUserData → setupRealtimeListeners) · `signUp` → `initializeUserData` | Load + merge the account. |
| **Sign out** | `signOut` (→ loadFromLocalStorage) · `onAuthStateChanged(null)` (loadFromLocalStorage + seed + render) | Fall back to local. |
| **Clear** | `clearLocalStorage` (createBackup → removeItem(STORAGE_KEY) → deleteDoc(users/uid) → reload) | Wipe + reset to defaults. |

**Guards in place:** `cloudReady` (no write before the cloud baseline is read — D-010) · optimistic `version` (concurrency)
· `unionById` (non-destructive merge) · `deletions` tombstones (D-018) · `isOnline` (recently relaxed for reads).

---

## 2. Synchronization state diagram

```
                          page load / auth change
                                   │
                    ┌──────────────┴───────────────┐
              onAuthStateChanged(user)        onAuthStateChanged(null)
                    │                               │
        cloudReady=false                     loadFromLocalStorage()
        loadUserData() ───────┐              seedPantryIfEmpty() · render
        setupRealtimeListeners│                     (signed-out view = STORAGE_KEY)
                    │         │
                    ▼         ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ loadUserData()                                               │
        │   isOnline = navigator.onLine                                │
        │   status = loadFromFirestore()  ── getDoc(users/uid)         │
        │     ├─ 'loaded'  → AppState = cloud; load+apply tombstones    │
        │     │              UNION localStorage in (unionById);         │
        │     │              mergeDeletions(local); applyTombstones();  │
        │     │              if changed → saveData() ↑                  │
        │     ├─ 'empty'    → cloudReady=true; loadFromLocalStorage();  │
        │     │              saveToFirestore() ↑  (seed cloud)          │
        │     └─ 'error'    → cloudReady stays FALSE; loadFromLocal     │
        │   seedPantryIfEmpty(); applyTombstones(); snapshotIdBaseline()│
        └─────────────────────────────────────────────────────────────┘
                    │                                  ▲
        user edits / deletes                           │ live updates
                    │                                  │
                    ▼                                  │
        saveData() → saveToLocalStorage()        onSnapshot(users/uid)
                  → saveToFirestore():             if remoteVersion>dataVersion:
                      recordLocalDeletions()          adopt remote lists+deletions
                      tx.get → if remoteVer>local:    applyTombstones()
                         mergeCloudConflict +         snapshotIdBaseline()
                         mergeDeletions + filter
                      tx.set(payload, version+1)

        Clear: clearLocalStorage → createBackup → removeItem(STORAGE_KEY)
               → deleteDoc(users/uid) → location.reload()
```

---

## 3. Failure-path analysis

Legend: ❌ broken · ⚠️ works-but-fragile/edge · 🎛️ intended-but-confusing.

| ID | Failure mode | Path | Status |
|---|---|---|---|
| **F1** | **Clear All Data returns** *(reported)* | `clearLocalStorage` deletes the doc, but (a) a 2nd signed-in device re-pushes its copy and re-creates the doc, and/or (b) `deleteDoc` fails offline (caught) → doc survives → reload reloads it. Deleting the doc never propagates the *intent* to clear. | ❌ |
| **F2** | **Defaults overwrite user data** | `recipes.length===0 → sampleRecipes` fired in *both* `loadFromLocalStorage` and `loadFromFirestore`. A user who deleted all recipes (or a just-cleared account) got samples injected, which then saved up. | **✅ FIXED (R2)** — first-run gate (`isFirstRun`/`markInitialized`/`ensureStarterRecipes`): samples seed only when no cloud doc *and* no local record exists; a saved/empty account is respected. *Device-pending.* |
| **F3** | **Cross-device duplication** | The same logical item added independently on two devices gets two different ids (`Date.now()+random`); `unionById` keeps both. The name-dup check in `addToPantry` is local-only. | ⚠️ |
| **F4** | **Double load on sign-in** | `signIn()` called `loadUserData()` **and** `onAuthStateChanged(user)` called it again → two union+save passes; `dataVersion` race window. | **✅ FIXED (R5)** — `signIn` no longer loads; `onAuthStateChanged` is the single entry. *Residual:* `signUp`→`initializeUserData`→`loadUserData` (new-account path, low-frequency) is a separate double-init, not in F4 scope — noted for a follow-up. *Device-pending.* |
| **F5** | **Signed-in / signed-out share one key** | Single `STORAGE_KEY`. Scratch edits made signed-out persist and are then merged into the next account by the sign-in union. | ⚠️ |
| **F6** | **Auto-depletion tombstones** | `deductIngredientsForRecipe` removes depleted items → `recordLocalDeletions` tombstones them. Semantically ok (depleted = gone on a shared pantry) but inflates the tombstone map and conflates auto-removal with user-delete. | 🎛️ |
| **F7** | **Old-code devices ignore tombstones** | A device on the pre-D-018 build neither writes nor honors `deletions` → it can resurrect on union and won't propagate deletes. The guarantee holds only once **all** devices update. | ⚠️ |
| **F8** | **Plan/grocery not delete-aware** | `groceryList` is excluded from tombstones (regenerates from the plan); `mergeWeeklyPlan` only *fills empty slots* → clearing a planned slot may not propagate / a slot can reappear. | ⚠️ |
| **F9** | **Replace-vs-merge depends on version** | `saveToFirestore` *replaces* unless `remoteVersion>dataVersion` (then merges). Now that deletes are explicit (tombstones), the version-gated replace is unnecessary complexity and the remaining loss-window. | ⚠️ |
| **F10** | **Restore then vanish** | `restoreBackup` replaces AppState and saves, but does **not** clear tombstones for restored ids. A restored item whose id is tombstoned reappears, then `applyTombstones` removes it on next load. | ⚠️ |

---

## 3a. Investigation log

### INV-1 — `signUp → initializeUserData` double-initialization (R5 residual)
**Question:** is the signup double-init harmless, a design decision, or a real sync defect?
**Trace:** on signup, `initializeUserData()` (cloudReady=true → saveToFirestore → loadUserData) **and**
`onAuthStateChanged(user)` (cloudReady=false → loadUserData → setupRealtimeListeners) both run, order
non-deterministic.
**Verdict: vestigial redundancy — NOT a data-integrity defect, NOT a deliberate design decision.** It
converges in every interleaving because: (1) `createUser` only succeeds for a brand-new email → no
existing cloud doc to clobber; (2) both paths operate on the same `AppState` → repeated writes produce
the same doc (no loss); (3) `unionById` dedups by id (no duplication), new account has no tombstones (no
resurrection), `saveToFirestore` is an atomic transaction (no corruption); (4) worst case a write is
*skipped* (benign — `cloudReady` guard), self-recovered by the next `'empty'`-path save. Costs are
non-correctness only: 2–3 redundant writes on signup, a benign `cloudReady` flicker, extra renders.
**Decision: NOT in Sync V1.** V1's bar is data integrity; "new users initialize correctly" is met. →
**Post-V1 cleanup task:** apply the R5 pattern to `signUp` (drop `initializeUserData`; let
`onAuthStateChanged`'s `'empty'` path seed the account) for a single clean init.
**Related (not caused by this):** `signUp` pushes shared-localStorage data to the new account — that is
**F5**, fixed by **R6 (namespace localStorage by uid)**, already a post-V1 item.

## 4. Sync Verification Matrix

| # | Scenario | Expected | Current | Status |
|---|---|---|---|---|
| 1 | Single device: add item, reload (signed in) | persists | persists | ✅ |
| 2 | Single device: delete item, reload | stays deleted | tombstoned → stays | ✅ |
| 3 | Two devices online: add on A | appears on B | onSnapshot applies | ✅ |
| 4 | Two devices online: delete on A | removed on B | tombstone propagates | ✅ |
| 5 | Delete on A while B offline; B reconnects/signs in | item removed on B | merge honors tombstone | ✅ |
| 6 | Sign in on device w/ local data; cloud has *different* data | union, nothing lost | union-on-sign-in | ✅ |
| 7 | Near-empty session signs in over populated cloud | adopts cloud (no clobber) | union keeps cloud | ✅ |
| 8 | Sign in; cloud is genuinely empty (new account) | local pushed up | 'empty' → saveToFirestore | ✅ |
| 9 | **Clear All Data, 2nd device signed in** | stays cleared everywhere | 2nd device re-pushes → returns | ❌ (F1) |
| 10 | **Clear All Data, offline** | clears when back online | deleteDoc fails → reload restores | ❌ (F1) |
| 11 | **Delete ALL recipes** | list stays empty | first-run gate respects empty | ✅ **R2** (analysis; device-pending) |
| 12 | **Same item added on 2 devices independently** | one item | two (different ids) | ⚠️ (F3) |
| 13 | Restore Backup of a previously-deleted item | item restored | restored then removed on reload | ⚠️ (F10) |
| 14 | One device on old build | full guarantee | partial (no tombstones) | ⚠️ (F7) |
| 15 | Clear a planned meal slot on A | clears on B | may not propagate | ⚠️ (F8) |
| 16 | Cook a recipe (depletes an item) | item gone everywhere | tombstoned (ok) | 🎛️ (F6) |
| 17 | Edit signed-out, then sign in | explicit choice | silently merged into account | ⚠️ (F5) |

**Correct today:** the core single- and multi-device add/delete/merge paths (rows 1–8) — the union + tombstones close
the resurrection / loss / clobber holes **provided every device runs the new build**. **Open:** Clear (F1), defaults-on-empty
(F2), and the fragility class (F3–F10).

---

## 5. Minimum architectural changes (recommended; not yet implemented)

Ordered by impact. The first three "finish" the correctness story; the rest are hardening.

- **R1 — Clear must propagate, not delete-the-doc (fixes F1).** Replace `deleteDoc`-and-reload with:
  tombstone every current id + empty the lists + `saveData()` (keep the doc). Other devices then apply the
  tombstones and clear too; works offline (queued) and survives a 2nd device. Add an explicit
  **"reset to defaults" vs "wipe to empty"** choice so the result is predictable.
- **R2 — Inject defaults only on *true* first run (fixes F2).** Gate `sampleRecipes`/seeding on an
  `initialized` marker, not on `length===0`. A signed-in account whose doc exists (even with 0 items) is
  *not* first-run — never re-inject samples over a deliberate empty.
- **R3 — Single write model: always merge + tombstones (fixes F9, simplifies everything).** Now that deletes
  are explicit, retire the version-gated *replace*. Every save = union(local, remote) then applyTombstones.
  This collapses the concurrency/race classes into one provably-correct path; `version` becomes advisory only.
- **R4 — Converge ids across devices (fixes F3).** Dedup curated lists by a natural key (lowercased name) in
  addition to id, or assign deterministic ids, so the same item doesn't fork.
- **R5 — One sign-in entry point (fixes F4).** Let `onAuthStateChanged` be the sole trigger for `loadUserData`;
  drop the direct call in `signIn()`.
- **R6 — Namespace local storage by uid (fixes F5).** Keep signed-out scratch separate from an account's data.
- **R7 — Force all clients onto delete-aware code (fixes F7).** Bump a schema/SW version so stale builds update
  before they can resurrect; until then, treat the guarantee as transitional.
- **R8 — Make `restoreBackup` tombstone-aware (fixes F10):** clear tombstones for the ids it restores.
- **R9 — Decide plan/grocery delete semantics (F8):** extend tombstones to plan slots, or document the
  regenerate-from-plan model as intended.

**The minimum to call sync "finished":** R1 + R2 + R3 (+ R5). R3 is the keystone — with explicit tombstones,
"always merge" removes the last data-loss/race surface and makes the remaining fixes small.

---

## 6a. Sync V1 Complete — progress

Milestone = R1 + R2 + R3 + R5, one at a time, full matrix re-run after each, device-verified before the next.

| Rec | What | Code | Self Review / QA | Matrix (analysis) | Device-verified |
|---|---|---|---|---|---|
| **R2** | defaults only on true first run | ✅ done | ✅ pass | ✅ row 11 →✅, no regressions | ⏳ **you** |
| **R5** | single sign-in entry | ✅ done | ✅ pass | ✅ F4 (signIn) resolved, no regressions | ⏳ **you** |
| **R1** | Clear propagates via tombstones | ⏳ | — | — | — |
| **R3** | always-merge + tombstones (retire version-replace) | ⏳ | — | — | — |

**R2 device checks (please verify):** (a) a brand-new user still sees the sample recipes; (b) delete **all**
recipes, refresh → they **stay gone** (no samples reappear); (c) on a 2nd device signed into the same account
with 0 recipes → stays empty. If all three hold, row 11 flips from analysis-✅ to device-✅ and I proceed to R5.

---

## 6. Conclusion

The recently-added **union-on-sign-in + tombstones (D-018)** correctly close *resurrection, silent loss, and
empty-clobber* for the curated lists **when every device runs the new build** (matrix rows 1–8). The remaining
real defects are concentrated and well-understood: **Clear-All-Data doesn't propagate (F1)**, **defaults overwrite a
deliberate empty (F2)**, and a fragility class (F3–F10) that **R3 (always-merge-with-tombstones)** largely
dissolves. None of these require a rewrite — they're four to five targeted, provable changes.

**Recommendation:** approve R1, R2, R3, R5 as the "finish sync" set. On approval, each change updates §2 (diagram)
and §4 (matrix) in the same commit, and ships only after the matrix row it targets flips to ✅ — verified by you on
real devices, since live multi-device Firebase is the one thing the automated gates cannot test.
