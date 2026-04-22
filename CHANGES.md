# v1.15 Implementation Progress

Spec: `REQUIREMENTS.md` v1.15  
Stack: React 18, Vite, TypeScript, Zustand, Recharts, Tailwind, shadcn/ui  
Aggregation layer: `src/lib/capacity.ts` — do not modify logic unless a change explicitly says so  
Design system: `DESIGNSYSTEM.md` — all colours, spacing, component styling from here only  

After completing each change: `git add -A && git commit -m "v1.15 Change N: <short description>"` then stop.

---

## Status

- [x] Change 1 — Domain rename ✓ committed
- [x] Change 2 — Primary Domain auto-derived
- [x] Change 3 — Drawer header fix
- [x] Change 4 — External requirements Fill All
- [x] Change 5 — External Resource Demand chart
- [ ] Change 6 — Data model: Function, Team, DemandTeamAssignment
- [ ] Change 7 — Scoping status
- [ ] Change 8 — Capacity Validation Team filter
- [ ] Change 9 — Team Activity Team grouping
- [ ] Change 10 — Admin screens

---

## Change 1 — RENAME: Theme → Domain
*Scope: terminology only. No logic, calculation, or data structure changes.*

Rename every TypeScript type, interface, variable, function, and UI string that contains `theme` or `Theme` to use `domain` or `Domain`.

Key renames:
- `ThemeId` → `DomainId`
- `theme_capacity` → `domain_capacity`
- `themeId` → `domainId`
- `primaryTheme` → `primaryDomain`
- `"THEME > SKILL"` → `"DOMAIN > SKILL"` (all display strings)
- `"Theme mode"` toggle label → `"Domain mode"`
- `"Theme"` / `"Themes"` in any UI string → `"Domain"` / `"Domains"`
- The `Theme` entity in the Zustand store → `Domain`
- Seed data keys: `themes` → `domains`, `themeId` → `domainId`

The `Skill` entity still belongs to a `Domain` — relationship unchanged.

After renaming, search for any remaining `theme` occurrences (case-insensitive) in `.ts` and `.tsx` files and fix them.

**Do not change any calculation logic, component structure, or routing.**

Use a project-wide find-and-replace first, then manually verify compound identifiers and string literals the automated rename may have missed.

---

## Change 2 — Primary Domain: remove from form, auto-derive
*Scope: demand entry form, drawer body, table column, aggregation selector.*

1. Remove the Primary Domain field from the Mode A demand entry form. Do not show an input or selector for it anywhere on the edit page.

2. Add a `derivedPrimaryDomain(demandItem)` computed selector: returns the Domain with the greatest sum of target hours across all requirements in all phases. Returns `null` / displays as `"Unassigned"` if no requirements exist yet.

3. Replace every read of the stored `primaryDomain` field in UI components with a call to `derivedPrimaryDomain`. Affected surfaces:
   - Drawer body zone — shown as a read-only labelled field: `"Primary Domain: MOM"` or `"Primary Domain: Unassigned"`
   - Table mode column — shows derived value with subtle italic styling to indicate it is computed
   - Team Activity person row — derived value used for grouping
   - Allocation workspace person name row

4. The stored `primaryDomain` field may be retained in the data model for seed compatibility but must be ignored in all UI reads — the derived value always wins.

5. Update Duplicate logic: do not copy `primaryDomain` — it will be re-derived from the duplicated requirements automatically.

---

## Change 3 — Drawer header: Programme › Project label fix
*Scope: demand drawer header and body zones only.*

1. In the drawer **header zone** left side, lay out text in this exact row order:
   - Row 1: Demand name (primary heading)
   - Row 2: Type badge
   - Row 3: Project alignment — `"Programme › Project"` in muted text if aligned, or `"Unaligned — Not Associated To A Project"` in muted italic if unaligned. At drawer widths below ~320px, truncate the unaligned label to `"Unaligned"`.
   - Row 4: Owner

   Primary Domain is **not** shown in the header zone.

2. Audit the drawer **body zone**: if Programme › Project appears a second time below the internal hours total, remove that second instance. The interactive Project alignment block (with the re-align affordance dropdown) remains — only the duplicate read-only label is removed.

---

## Change 4 — External requirements: Fill All button
*Scope: Mode A edit page, external requirement rows only.*

Add a **"Fill all"** button to each external requirement row in the per-month hours grid (finite phases only — indefinite phases have a single input and do not show this button).

Behaviour: identical to the existing Fill all on internal requirement rows. When clicked:
- If any cell already has a non-zero value, offer to propagate that value to all cells in the row.
- Otherwise, prompt the user for a value and fill all cells with it.

The button must appear on external requirement rows in the same position as it does on internal requirement rows — visual consistency is required.

---

## Change 5 — Capacity Validation: External Resource Demand chart section
*Scope: Capacity Validation view only. No aggregation layer changes — reads from existing functions.*

Add a **Section C** to the Capacity Validation view, below Section B.

**Toolbar control**: `"Show external resource"` toggle (default: off). When off, Section C is fully hidden. When on, it appears below Section B.

**Section C structure**:

Section header: `"External Resource Demand"` with an inline info note:
> *"External hours are shown for planning visibility only — they do not affect team capacity calculations."*

This section must be visually distinct from Sections A and B. Use a different background tint on the section container and ensure no capacity-model visual language (capacity lines, grey bands, projection) appears anywhere in it.

**Sub-section C1 — Overview chart**:
- Single stacked area chart. X-axis: months (same horizon preset as rest of page). Y-axis: total external hours.
- Stacked by Provider — each Provider gets a distinct colour from `DESIGNSYSTEM.md` palette, with a legend.
- No capacity line, no grey band, no projection.
- Hover tooltip: month, total external hours, per-Provider breakdown.

**Sub-section C2 — Per-Provider breakdown**:
- One chart per Provider that has non-zero external hours in the visible horizon. Providers with no activity are not shown.
- Each chart: Provider's hours over time, stacked by Demand item. Each contributing Demand item gets a distinct colour segment.
- Chart card sizing matches Section B Domain charts.
- Hover tooltip: month, Provider name, total hours, list of contributing Demand item names with per-item hours.

**Scope rules**:
- Programme/Project toolbar filter applies to Section C (narrows to in-scope Demands).
- Team filter does not apply to Section C.
- Time horizon preset applies identically.
- Data source: sum `project_external_hours_by_provider` across all Projects plus `unaligned_demand_hours(month, 'external')` for unaligned Demands. No new aggregation functions needed.

---

## Change 6 — Data model: Function, Team, DemandTeamAssignment entities
*Scope: Zustand store schema, seed data, TypeScript types.*

Add the following to the store:

```typescript
interface Function {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

interface Team {
  id: string;
  name: string;
  description: string;
  functionId: string;
  type: 'Plant' | 'Central' | 'Specialist' | 'Other';
  leadPersonId: string | null;
  active: boolean;
}

interface DemandTeamAssignment {
  id: string;
  demandId: string;
  phaseId: string;
  teamId: string;
  confirmed: boolean;
  confirmedBy: string | null;   // free text, not auth-linked in v1
  confirmedAt: string | null;   // ISO timestamp
}

// Updated entities
interface Person {
  // ... existing fields ...
  teamId: string;  // required — every person belongs to one Team
}

interface Requirement {
  // ... existing fields ...
  owningTeamId: string | null;  // which Team is responsible for supplying this requirement
}

interface Domain {
  // ... existing fields ...
  functionId: string;  // new — belongs to one Function
}
```

**Update seed data**:
- Add one Function record: `{ id: 'func_001', name: 'Digital Manufacturing', description: '...', active: true }`
- Add three Team records:
  - `{ id: 'team_001', name: 'Central Delivery Team', functionId: 'func_001', type: 'Central', leadPersonId: null, active: true }`
  - `{ id: 'team_002', name: 'Plant Team A', functionId: 'func_001', type: 'Plant', leadPersonId: null, active: true }`
  - `{ id: 'team_003', name: 'Plant Team B', functionId: 'func_001', type: 'Plant', leadPersonId: null, active: true }`
- Assign all existing seed People to teams via `teamId` — distribute plausibly based on their primary Domain and skills.
- Add `functionId: 'func_001'` to all existing Domain records.
- Add at least one `DemandTeamAssignment` record set for the Scoping seed item (see Change 7 seed requirement).
- After updating seed, verify the existing stress-test scenarios from section 11.8 still produce the expected visual signals. Team additions must not affect any capacity calculation.

---

## Change 7 — Scoping status
*Scope: state machine, Zustand store, Board view, drawer, Mode A edit page, Archive view.*
*Depends on: Change 6 (Team entity must exist in the store).*

Add `Scoping` as a new status in the demand state machine, between Draft and Submitted.

**State machine rules**:
- `Draft → Scoping`: action label `"Submit for Scoping"`. Demand owner provides phase-level team assignments (creates `DemandTeamAssignment` records) and gross description. Skill-shaped requirements do not need to exist yet.
- `Scoping → Submitted`: **system-driven auto-transition** — fires when every `DemandTeamAssignment` for the demand has `confirmed: true`. No manual Submit button from Scoping.
- `Scoping → Draft`: `"Revert to Draft"` — user action.
- `Scoping → Parked`: `"Park"` — user action.
- `Scoping → Closed`: `"Close"` — user action. Scoping is a full status; it can be Closed and Restored from Archive.
- Capacity impact: none. Scoping items are excluded from all capacity calculations (same as Draft).

The Scoping status must be added to every place the status enum is used — Board column order, drawer footer switch statement, table status filter, archive view, transition validation logic. Grep for existing status values (`'Draft'`, `'Submitted'`, `'Approved'`) to find all call sites.

**Board mode**: add a Scoping column between Draft and Submitted.
- Cards in the Scoping column show a **confirmation strip** below the card title: one chip per assigned team, green (`confirmed: true`) or amber (`confirmed: false`).

**Drawer footer for Scoping**:
- Footer: `"Revert to Draft"`, `"Park"` as secondary primaries. No single dominant primary — there is no manual forward action from Scoping.
- Overflow menu: `"Close"`, `"Duplicate"`, `"Delete"`.

**Mode A in Scoping status**: phase cards show a **"Teams assigned"** multi-select control at the top of each phase card (above requirements). Selecting a Team creates a `DemandTeamAssignment` record for that phase.
- Team lead editing a Scoping demand: their team's requirement rows are fully editable; other teams' requirement rows within the same phase are visible but read-only.
- A **"Confirm requirements for [Team Name]"** button appears at the bottom of each phase card where this team has an assignment. Clicking it sets `DemandTeamAssignment.confirmed = true` for that team+phase combination.
- If a team assignment is changed (team added or removed from a phase), reset `confirmed: false` for that phase's assignments — not the whole demand.
- Both demand owner and team lead may change team assignments during Scoping.

**Archive view**: Scoping items that have been Closed appear in the Archive with a `"Restore"` action, exactly as Approved/PartiallyAllocated/Allocated items do.

**Seed**: add one demand item in Scoping status with two `DemandTeamAssignment` records — one with `confirmed: true` and one with `confirmed: false` — to demonstrate the mixed confirmation strip on the Board card.

---

## Change 8 — Capacity Validation: Team scope filter
*Scope: Capacity Validation toolbar and chart rendering only. Aggregation layer: add optional team scope parameter to two existing functions only.*
*Depends on: Change 6 (Team entity must exist in the store).*

Add a **Team filter** to the Capacity Validation toolbar (single-select dropdown, `"All Teams"` default, lists active Teams).

When a specific Team is selected:

1. **Add a dashed secondary capacity line to each Domain/skill chart**: computed as `domain_capacity(domainId, month, teamId)` — the sum of contracted hours (net of real allocations) for people in the selected team who hold skills in that domain. Implement this as an **optional `teamId` parameter** on the existing `domain_capacity` and `skill_capacity` aggregation functions — when `teamId` is provided, filter the person pool to that team; when absent, use the full pool (existing behaviour preserved). These are the only changes permitted to `src/lib/capacity.ts` in this change.

2. **Add a tinted demand stack overlay**: highlights the portion of the committed demand stack where `requirement.owningTeamId === selectedTeamId`. This is a visual tint on existing segments, not a new data series — the chart's underlying demand numbers do not change.

3. The **solid capacity line (full pool) remains unchanged** — it always represents the full Function-wide pool.

4. When `"All Teams"` is selected, hide the dashed line and tint. Charts revert to current behaviour exactly.

5. The Team filter composes with the Programme/Project filter — both can be active simultaneously.

---

## Change 9 — Team Activity: Team grouping
*Scope: Team Activity view layout and grouping controls only.*
*Depends on: Change 6 (Team entity must exist in the store).*

Add a **"Group by"** toggle to Team Activity: `"Domain"` (existing default) ↔ `"Team"` (new).

**Team grouping mode**:
- Rows are grouped under Team name headers instead of Domain headers.
- Each Team header row shows a **team summary bar** — a single rolled-up stacked horizontal bar representing the team's aggregate committed hours as a proportion of total contracted hours. Same work-type colour segments (BAU, NPD Demand, Plant Project, Group Strategy Project, Available Capacity) as individual cells.
- Individual person rows appear under their team header, same as Domain grouping shows people under Domain headers.

**Cross-team allocation signal** (applies in both grouping modes):
- When a person's cell contains hours for a requirement where `requirement.owningTeamId !== person.teamId`, that specific allocation segment within the cell receives a **thin contrasting border** (2px, using a secondary accent colour from `DESIGNSYSTEM.md`).
- Hovering the segment shows a tooltip: `"Cross-team: [Demand name] owned by [Team name]"`.
- This signal must be subtle enough not to be visually noisy at normal grid scale.

---

## Change 10 — Admin: Function, Team, People updates
*Scope: admin screens only.*
*Depends on: Change 6 (Team entity must exist in the store).*

**Function admin screen** (new, view/edit only):
- Show the single "Digital Manufacturing" Function record with editable name and description fields.
- No add or delete controls in v1.
- Accessible from the admin navigation.

**Teams admin screen** (new, full CRUD):
- Flat list of Teams with columns: Name, Type, Lead (person name or "—"), Member count, Active.
- Add Team: form with Name (required), Type dropdown (Plant / Central / Specialist / Other), Lead (person picker, optional), parent Function (locked to "Digital Manufacturing" in v1).
- Edit Team: same fields.
- Soft-delete via Active toggle — inactive Teams remain on existing People but don't appear in pickers.
- Hard-delete: blocked if the Team has any assigned People. Show a list of blocking People with a prompt to reassign them first.

**People admin screen** (updated):
- Add **Team** field (required dropdown of active Teams) to the person form and detail view.
- Remove Primary Domain as an editable field. Show it as a read-only derived value labelled `"Primary Domain (derived from skills)"`.
- Existing People without a `teamId` show an inline warning banner in their admin record: `"This person is not assigned to a team. Please assign a team."`.
- The DOMAIN > SKILL selector in the skill profile section is scoped to the person's Function (via their Team). Ensure the `functionId` filter is applied when the person has a `teamId`.
