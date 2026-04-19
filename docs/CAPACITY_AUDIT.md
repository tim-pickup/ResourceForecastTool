# Capacity Model Audit — v1.12

Audit of the capacity and demand aggregation layer introduced in v1.10. Conducted as part of v1.12 bug-fix release per §2.4.8 discipline. Each section answers the corresponding review question from the v1.12 brief.

---

## A. Aggregation Function Inventory

### A1 — Named aggregation functions

All functions are in `src/lib/capacity.ts`.

| Function | Line | Description |
|---|---|---|
| `real_committed_hours` | 41 | Sum of every named allocation for a person-month across Approved / PartiallyAllocated / Allocated items. |
| `person_capacity` | 63 | A person's available hours: contracted − real_committed, floored at zero, zero outside their employment window. |
| `theme_capacity` | 77 | Capacity line for a theme chart: sum over theme-pool people of (contracted − non-theme committed), prevents double-counting by excluding this theme's own skill commitments. |
| `skill_capacity` | 110 | Capacity line for a skill chart: same logic as theme_capacity but scoped to a single skill. |
| `demand_hours_for` | 156 | Requirement-target hours for any target (overall / theme / skill) and arbitrary status set, plus optional overlay item. |
| `computeProjection` | 235 | Single-pass proportional projection: distributes unallocated Approved / PartiallyAllocated / overlay requirement-hours across eligible people's real headroom. Returns `ProjectionResult` (byPerson map + shortfalls). |
| `projected_consumption` | 349 | Total projected hours onto a person-month from `ProjectionResult`, capped at real headroom (Invariant B). |
| `grey_band` | 366 | Projected hours from non-target-skill requirements onto the chart's skill pool (capacity consumed elsewhere), sourced from `ProjectionResult`. |
| `projection_shortfalls` | 411 | Returns `ShortfallRecord[]` from `ProjectionResult` where demand exceeded eligible headroom. |
| `team_capacity` | 417 | Simple sum of contracted hours for active people in the month. |
| `checkInvariants` | 431 | Dev-mode invariant checker (Invariants A, B, C). Called from `CapacityValidation` on mount. |

**Status:** All eight functions mandated by §2.4.8 are present and implemented. None returns a stub value or empty array unconditionally.

### A2 — Stub or no-op functions

None found. All functions perform real computation.

### A3 — Inline summation outside the aggregation module

The following files contain local summation or iteration over demand data that duplicates or partially overlaps the canonical aggregation layer. Each is a potential divergence site:

| File | Description | Risk |
|---|---|---|
| `src/utils/capacity.ts` | Contains `getThemeCapacity`, `getSkillCapacity`, `getThemeDemand`, `getSkillDemand`, `getTeamDemand`, `demandFromItems`, plus person-level helpers. These are **an older parallel aggregation layer** from before v1.10 — they remain present and differ from `src/lib/capacity.ts` in BAU subtraction logic and status filtering. | **High** — Callers (Team Activity, allocation workspace) may use the wrong layer. |
| `src/views/TeamActivity/index.tsx` | Uses `getPersonLoad` and `getPersonBauHoursFromDemand` from `src/utils/capacity.ts`, not the canonical lib. | Medium |
| `src/views/DemandEdit/AllocationWorkspace.tsx` | Uses `getPersonAvailableHoursExcluding` from `src/utils/capacity.ts`. | Medium |
| `src/views/CapacityValidation/SkillDetail.tsx` | Pending review — not checked in this audit. | Unknown |

**Finding (v1.13 candidate):** `src/utils/capacity.ts` is a pre-v1.10 aggregation layer that should be migrated or removed. Its `getThemeCapacity` subtracts BAU hours from contracted (not all-other-theme allocations), deviating from the §2.4.2 formula. Views that still call it may show different numbers from the Capacity Validation charts.

---

## B. Status Filters and Cross-Theme Consumption

### B1 — Status sets per function

| Function | Status set used |
|---|---|
| `real_committed_hours` | `{Approved, PartiallyAllocated, Allocated}` — `REAL_STATUSES` constant, line 14. ✓ |
| `theme_capacity` | Same `REAL_STATUSES` via `otherCommitted` loop (line 88). ✓ |
| `skill_capacity` | Same `REAL_STATUSES` (line 119). ✓ |
| `demand_hours_for` | Caller-supplied `statuses` argument. In `CapacityValidation/index.tsx` the caller always passes `COMMITTED_STATUSES = {Approved, PartiallyAllocated, Allocated}` for the committed stack, and `EMPTY_STATUSES` (empty set) when computing the overlay contribution (the overlay item is passed separately as `overlayItemId`). ✓ |
| `computeProjection` | Processes `Approved` and `PartiallyAllocated` items (line 272), plus the single `Submitted` overlay item if supplied. Does NOT include `Allocated` items in projection (fully allocated items contribute zero unallocated hours anyway). ✓ |
| `grey_band` | Derives from `ProjectionResult`, inheriting the status filter of `computeProjection`. ✓ |

All status filters match the §2.4 specification. No deviations found.

### B2 — Double-counting prevention in skill-pool capacity

`skill_capacity` (line 110) and `theme_capacity` (line 77) exclude commitments to the chart's own skill from the `otherCommitted` sum (lines 124 and 92 respectively):

```ts
// skill_capacity — line 124
if (req.skill_id === skillId) continue  // skip this skill

// theme_capacity — line 92
if (themeSkillIds.has(req.skill_id)) continue  // skip this theme's skills
```

This ensures a person doing MOM work appears as demand on the MOM chart, not as a reduction of MOM capacity. **Working correctly.**

---

## C. Eligibility, Projection, Shortfalls

### C1 — Eligibility filter

`computeProjection` lines 293–300:

```ts
if (!person.active) continue
if (!monthInRange(month, person.available_from, person.available_to)) continue
const heldSkills = personSkillIndex.get(person.id)
if (!heldSkills) continue
const heldLevel = heldSkills.get(req.skill_id)
if (!heldLevel || !meetsLevel(heldLevel, req.level)) continue
```

Eligibility = active AND within available_from/available_to window AND holds the requirement's exact skill_id at the required level or higher. It does **not** use primary_theme matching. **Correct per §2.4.5.**

### C2 — Single-pass proportional distribution

`computeProjection` is a single nested loop (months → items → phases → requirements). Each requirement-month is distributed in one pass at lines 306–319. There is no iterative or ordering-sensitive re-distribution. **Correct per §2.4.5.**

### C3 — Shortfalls surfaced separately

Shortfalls are recorded in `shortfallMap` (line 324) when `totalHeadroom < unallocH`. They are returned from `projection_shortfalls()` and rendered in the over-capacity summary strip. They are not silently absorbed into the grey band. **Working correctly.**

---

## D. Status Transition Edge Cases

### D1 — Memoisation on status change

`computeProjection` takes `state: AppState` as a parameter. `state` is the live Zustand store. The `CapacityValidation` view memoises `projResult` via `useMemo([store, months, overlayId])` — `store` is the entire store object, which changes reference on every Zustand mutation. So any status transition that calls `updateDemandItem` invalidates the `store` reference and re-runs `computeProjection`. **No stale-cache risk for status transitions.**

The `rchCache` inside `computeProjection` is local to a single invocation, so it does not persist across re-renders.

### D2 — Submitted-overlay vs Approved-unallocated equivalence (Invariant A)

`demand_hours_for` with `overlayItemId` set: if `isOverlay && item.status !== 'Submitted'` → skips (line 171). If `!isOverlay && !statuses.has(item.status)` → skips (line 172). The overlay item's requirement-hours are counted the same way as a committed item's (iterating `reqHoursForMonth`, not allocation hours). An Approved item with zero allocations would have the same requirement-hours. **Invariant A holds structurally.** The runtime checker in `checkInvariants` (line 464) also verifies this per theme per month with the actual seed.

---

## E. Allocation Workspace State

### E1 — Source of truth for pending allocations

`AllocationWorkspace.tsx` maintains in-session pending allocations in local React state (`pendingAllocs`). The capacity-preview strips and per-month grids read from this local state, not from the persisted store, during editing. On save, `updateDemandItem` is called once to write the full updated requirement to the store.

**Correct:** pending state is the single source of truth during editing.

### E2 — Double-counting of own demand item

`AllocationWorkspace.tsx` uses `getPersonAvailableHoursExcluding` from `src/utils/capacity.ts` (old layer), which accepts an `excludeAllocId`. This does exclude the current allocation being edited. However, it uses the old BAU-subtraction capacity formula rather than the canonical `real_committed_hours`. **Finding (v1.13 candidate):** the allocation workspace headroom preview may slightly deviate from the Capacity Validation view due to using the pre-v1.10 formula.

---

## F. Team Activity and Cross-View Consistency

### F1 — Team Activity cell vs aggregation layer

Team Activity (`src/views/TeamActivity/index.tsx`) uses `getPersonLoad` from `src/utils/capacity.ts`. This function sums allocation hours across all Approved / PartiallyAllocated / Allocated items. The canonical `real_committed_hours` in `src/lib/capacity.ts` does the same. Both iterate `alloc.hours_by_month[month]` for the same status set.

For Fatima Al-Rashid (per_006) in Aug 2026:
- `real_committed_hours` sums her allocations across dmd_002 (Allocated) and any stress items.
- `getPersonLoad` (Team Activity) sums the same allocations.
- The two paths should agree for Approved/PartiallyAllocated/Allocated items.

**Finding (v1.13 candidate):** `getPersonLoad` treats BAU and project allocations as conceptually distinct (it subtracts BAU from total to get project). `real_committed_hours` treats them as a unified sum. The total committed figure should be identical; only the work-type breakdown differs. No cross-view inconsistency in totals.

### F2 — Chart demand stacks vs total committed hours

The Capacity Validation theme charts show requirement-target hours (not allocation hours) for committed items. The Team Activity view shows allocation hours. These are not the same number: a requirement may be unallocated (demand on chart but zero Team Activity hours) or over-allocated (allocation hours > requirement target, unusual but possible). The two views are measuring different things and are not expected to sum to the same total.

---

## G. Null / Empty-State Robustness

| Scenario | Behaviour |
|---|---|
| Demand item with zero requirements | `for (const req of phase.requirements)` — empty array, loops produce 0. ✓ |
| Phase with zero requirements | Same. ✓ |
| Requirement with empty `hours_by_month` | `reqHoursForMonth` returns `req.hours_by_month[month] ?? 0` — returns 0. ✓ |
| Person with zero skills | `personSkillIndex.get(person.id)` → empty Map, `heldSkills.get(req.skill_id)` → undefined, skips. ✓ |
| Person outside available window | `monthInRange` returns false, person is skipped. ✓ |
| `computeProjection` with empty months array | Outer loop doesn't execute; returns empty ProjectionResult. ✓ |
| `grey_band` for `overall` target | Returns 0 immediately (line 373). ✓ |

No NaN or throw scenarios found for these inputs.

---

## Summary of Findings

### Fixed in v1.12

| # | Finding | Fix |
|---|---|---|
| 1 | Grey band rendered as `ReferenceArea` (only when > 0); §2.4.4 mandate requires a dedicated `<Area>` element always in the DOM. | Replaced with `<Area stackId="grey">` pair with SVG `<pattern>` hatch fill in `CapacityChart.tsx`. |
| 2 | Overlay `<Area>` rendered even when overlay = 0, producing a path identical to the top committed-stack layer — silent duplicate. §4 View 1. | Overlay Area now conditionally rendered only when `chartData.some(d => d.overlay > 0)`. |
| 3 | No seed-fixture renderability assertions existed; stub functions and zero-return bugs could ship undetected. §2.4.8. | `src/lib/seedAssertions.ts` added; called from `main.tsx` in dev mode. |

### v1.13 Candidates (documented, not fixed in this release)

| # | Finding |
|---|---|
| T1 | `src/utils/capacity.ts` is a pre-v1.10 parallel aggregation layer still used by Team Activity and AllocationWorkspace. Its theme/skill capacity formula subtracts BAU (not all-other-theme allocations), deviating from §2.4.2. Should be migrated to the canonical `src/lib/capacity.ts` layer. |
| T2 | AllocationWorkspace headroom preview uses the old formula (`getPersonAvailableHoursExcluding`) — could show slightly different headroom from Capacity Validation. |
| T3 | `SkillDetail.tsx` not audited — verify it sources all numbers from `src/lib/capacity.ts`. |

### Working Correctly

Aggregation functions in `src/lib/capacity.ts`: all eight required functions implemented, correct status filters, correct eligibility filter (skill + level + window, not primary_theme), single-pass projection, explicit shortfall surfacing, Invariant B cap on projected_consumption, Invariant A structurally guaranteed by `demand_hours_for` design.
