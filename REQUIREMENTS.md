# Digital Manufacturing Resource Load & Capacity Tool

## Requirements Specification — v1.1

---

## 1. Purpose

This tool exists to help the Digital Manufacturing PMO and Theme Leads manage team capacity against a constantly changing demand pipeline. It is **forward-looking only** — it models commitments and forecasts from today onwards. Actual time bookings live in SAP and are out of scope.

### End-goal outcomes

The tool must enable the team to:

1. **Validate whether a new demand item can be resourced** within current capacity, at the skill and individual level.
2. **Forecast future resource needs** — identifying where the team needs to grow, and where skill development of existing people could close gaps.
3. **Maintain a live understanding of what the team is working on** across project and BAU demand.

### Explicit non-goals for v1

The following are deliberately out of scope to keep v1 focused and shippable:

- Permissions, authentication, and role-based access (the tool is open — anyone with access can edit anything).
- Actual time tracking, reconciliation with SAP, or variance analysis against forecast.
- Funding budget burn-down (hours committed vs hours available on a scheme).
- Historical views of past commitments.
- Integration with Azure DevOps, SAP, or any external system.
- Mobile-responsive UI.
- Email or in-app notifications.

---

## 2. Core concepts and data model

The data model has three layers: **structure** (themes, skills, people), **demand** (what we're being asked to do), and **commitments** (how demand consumes people's time). Time is the unifying dimension, expressed at monthly resolution across a rolling 5-year horizon.

### 2.1 Structure

**Theme**
- Name (e.g. MOM, MI&V, MBM)
- Description

**Skill**
- Belongs to one Theme
- Name (e.g. "SCADA Development", "Historian Configuration")
- Level scale is fixed at three levels: **Basic**, **Advanced**, **Specialist**

**Person**
- Name
- Primary Theme (for reporting/grouping — a person can hold skills across themes)
- Contracted hours per month (drives capacity; part-time is handled entirely through this field)
- `available_from` (YYYY-MM, nullable) — capacity before this month is zero. Used for new starters.
- `available_to` (YYYY-MM, nullable) — capacity after this month is zero. Used for leavers.
- Active/inactive flag (for soft-hiding without deletion)
- **Skill profile**: a list of `{skill, level}` entries — a person can hold multiple skills at different levels
- **BAU allocations**: see section 2.3

### 2.2 Demand

**Demand Item** — the unit of work the tool tracks.

| Field | Notes |
|---|---|
| Name | Free text |
| Type | One of: `Group Strategy Project`, `Plant Project`, `NPD Demand`, `BAU` |
| Status | One of: `Draft`, `Submitted`, `Accepted`, `Allocated`, `Parked` (see section 3) |
| Owner | Free-text field (person or role name) |
| Primary Theme | Reporting/grouping hint only — **not a constraint**. A demand item can draw resource from any theme via its requirements. |
| Description | Free text |
| Parked reason | Free text, shown when status = Parked. Captures why it was parked and any context for revival. |
| **Phases** | One or more — see below |

**Phase** — a demand item consists of one or more phases. A phase is the unit of capacity validation.

| Field | Notes |
|---|---|
| Name | Free text, with autocomplete from phase names used on recent demand items |
| Start month | YYYY-MM |
| End month | YYYY-MM |
| Funding source | One of: `Investment Scheme`, `Plant/Sector Allocation`, `Mixed` |
| Funding notes | Free text — e.g. scheme name or sector |
| **Resource requirements** | One or more — see below |

**Resource Requirement** — how a phase consumes capacity. **A phase has many resource requirements.** Each requirement is one of two shapes:

- **Skill-shaped**: `{skill, level, hours per month, notes}` — used when the work is understood but not yet assigned to a named person.
- **Named**: `{person, hours per month, notes}` — used when a specific person is committed.

A single phase can mix both shapes freely, and multiple requirements of the same skill at the same or different levels are permitted. See section 2.5 for worked examples.

A skill-shaped requirement can be **promoted to named** — and crucially, a single skill-shaped requirement can be split across multiple people. See section 2.5.

The `notes` field on a requirement captures tacit context that skill+level alone can't express (e.g. "needs S7 experience specifically", "must have been through site induction").

### 2.3 BAU

BAU is modelled as a **forecast**, not a log. It lives per-person, broken down into **BAU Streams**.

**BAU Stream**
- Name (e.g. "MES Super User – Plant A", "Historian day-to-day support")
- Description
- Owning Theme (for roll-up reporting)

**BAU Allocation** — links a person to a stream with an effective-dated forecast.

| Field | Notes |
|---|---|
| Person | |
| Stream | |
| Hours per month | The forecast load |
| Effective from | YYYY-MM |
| Effective to | YYYY-MM (nullable — null means open-ended) |

This structure lets you model declining BAU cleanly. Example: "Sarah is 30 hours/month on MES Super User – Plant A until 2026-06, then 10 hours/month from 2026-07 onwards" is two allocations on the same stream with adjacent effective ranges.

### 2.4 Derived capacity

A person's **available project capacity** in a given month is:

```
if month < available_from OR month > available_to:
    capacity = 0
else:
    capacity = contracted_hours − sum(active BAU allocations) − sum(named project commitments in that month)
```

"Active" means the month falls within the allocation's effective range.

Named project commitments come from Resource Requirements with a person assigned, where the current month falls within the parent Phase's date range, **and the parent Demand Item is in status `Accepted` or `Allocated`**. Hours per month on the requirement are applied flat across every month in the phase.

**Skill-shaped requirements** do not consume named capacity but *do* count toward theme-level and skill-level demand forecasts. They represent commitments against the team that haven't yet been landed on individuals.

**Demand item status and capacity**:
- `Draft` — excluded from all capacity calculations.
- `Submitted` — counted only when explicitly toggled on in a view.
- `Accepted` — counted as committed at theme/skill level; named requirements consume individual capacity.
- `Allocated` — fully counted; all requirements should be named.
- `Parked` — excluded from all capacity calculations. Commitments disappear from people's loads the moment status changes to Parked.

**Over-allocation is permitted.** A person can be allocated more than their capacity. The tool warns the user at save time and requires confirmation, but imposes no upper limit. No audit trail of acknowledgements is kept in v1.

### 2.5 Worked examples of requirement composition

These examples exist to make the abstract model concrete.

**Example A — Multiple skills and multiple same-skill-different-level on one phase**

Project "Site X MES Upgrade", Phase 1 "Design" (2026-05 to 2026-08):

| # | Shape | Detail |
|---|---|---|
| R1 | Skill | MOM Specialist, 40 hrs/month |
| R2 | Skill | MOM Advanced, 80 hrs/month |
| R3 | Skill | MOM Advanced, 40 hrs/month (second slot) |
| R4 | Skill | MI&V Basic, 20 hrs/month |

Total skill-shaped demand on this phase: 180 hrs/month across 4 requirement lines, spanning 2 themes and 3 distinct skill/level combinations.

**Example B — Splitting a single requirement across multiple people at promotion**

Same project moves from Accepted to Allocated. The MOM Advanced 80 hrs/month requirement (R2) can be split. The user converts it into:

| Promoted from | Shape | Detail |
|---|---|---|
| R2 | Named | Sarah — 56 hrs/month |
| R2 | Named | Chris — 24 hrs/month |

The total still sums to 80 hrs/month against the original requirement. The tool tracks the promotion lineage so the user can see that R2 was fulfilled by two named allocations, and the capacity view credits Sarah and Chris separately.

**Example C — Cross-theme demand item**

Project "NPD Line Y Integration" — Primary Theme is MOM (because that's the lead), but:

- Phase 1 "Specification" requires 1× MOM Advanced + 1× MI&V Advanced
- Phase 2 "Build" requires 2× MOM Specialist + 1× MBM Basic
- Phase 3 "Deploy" requires 1× MOM Basic + 1× MI&V Basic

The demand item carries the MOM primary theme tag for reporting, but its requirements pull capacity from three themes. The capacity views should show this item's contribution against all three themes, not just MOM.

---

## 3. Demand workflow

Demand items move through five statuses. The workflow is lightweight — there is no approval gating in v1; status is set manually by the user.

| Status | Meaning | Capacity impact |
|---|---|---|
| **Draft** | Being shaped. Not yet part of the team's commitment picture. | None — excluded from all capacity views. |
| **Submitted** | Ready for capacity assessment. Requirements are populated. | Shown in capacity views as *proposed* load only when the user toggles it on — visually distinct from committed. |
| **Accepted** | Agreed the team will do this work. Named assignments may still be pending. | Counted as committed at theme/skill level. Skill-shaped requirements contribute to demand; named requirements consume individual capacity. |
| **Allocated** | Named people assigned to all requirements. Work is fully committed. | Fully counted — all requirements should be named. |
| **Parked** | Temporarily set aside. Not resourceable now or cancelled for now, but may come back. | Excluded from all capacity calculations. |

### Status transitions

All transitions are manual and unrestricted in v1 — any user can move an item to any status, in any direction. Specific transitions worth calling out:

- **Any status → Parked**: allowed. When moving from `Accepted` or `Allocated` to `Parked`, all commitments (named and skill-shaped) immediately stop consuming capacity. The data is preserved so the item can be revived later with its requirements intact.
- **Parked → Submitted** (or any other status): allowed. The item is revived with its full requirement history.
- **Allocated → Accepted** (or earlier): allowed. Useful when named assignments need to be rethought.

### Promotion of skill-shaped to named

When moving toward `Allocated`, the user resolves skill-shaped requirements into named ones. The tool must support:

- **1-to-1 promotion**: skill-shaped becomes a single named allocation for the same hours.
- **1-to-many split**: a single skill-shaped requirement is satisfied by two or more named allocations that sum to the original hours. The tool should make it easy to split and to show the sum vs the target.

The tool does not enforce full promotion in v1 — an `Allocated` item with unresolved skill-shaped requirements is permitted and should be visually flagged.

### Deletion

Two distinct actions:

- **Park** (soft): item is preserved, moved to Parked status. Reversible. This is the default "we don't need this right now" action.
- **Hard delete**: item is removed entirely from the database. Irreversible. For demand that is genuinely no longer needed (duplicates, requests that were mis-entered, cancelled schemes). Requires a confirmation step.

### Duplication

Users can duplicate a demand item to use as a starting point for a new one. The duplicate:
- Copies name (suffixed with "(copy)"), type, owner, primary theme, description
- Copies all phases and requirements
- Named requirements become skill-shaped in the copy (since they're unlikely to be the same people)
- Status resets to `Draft`

---

## 4. Views

The tool provides four views. **Views 1 and 2 are the MVP** and must be built first. Views 3 and 4 follow once the data model is populated and in use.

### View 1 — Capacity Validation (MVP)

The question this view answers: *Can we resource this demand, and what breaks if we do?*

**Primary interaction**: Select one or more demand items (typically a Submitted item under assessment) and see them overlaid on current commitments.

**Layout**:
- **Time axis**: horizontal, monthly. Default horizon is 6–12 months, with preset switches for 6 / 12 / 24 / 60 months.
- **Y-axis grouping**: selectable — by Person, by Theme, by Skill. Grouping switch must preserve scroll position.
- **Load cells**: each month × (person/theme/skill) shows a stacked load — committed hours + selected-item hours — against capacity. Over-capacity cells are visually distinct.
- **Distinguishing demand states**: committed load rendered solid; proposed/overlay load rendered with a distinct treatment (e.g. hatched or outlined).
- **Over-state signalling**: three distinct visual signals for over-allocation at person level, skill-short at skill level, and theme-short at theme level.

**Required features**:
- Filter by Theme, by demand Type, by Status.
- Toggle: include Submitted items in the overlay, or only Accepted + Allocated in the baseline.
- Click into any cell to open the **Demand Item side-panel editor** (see 4.5), with full CRUD available without leaving the view.
- Live recalculation: edits to phase dates, requirement hours, named assignments, or BAU allocations update the view within ~200ms. This commits the tool to a client-side state architecture — see section 7.

### View 2 — Team Activity (MVP)

The question this view answers: *What is each person actually working on right now and across the near term?*

**Primary interaction**: Per-person timeline showing their named commitments and BAU allocations.

**Layout**:
- One row per person, grouped by Theme.
- Horizontal time axis, monthly, default 6 months (with the same preset switches as View 1).
- Blocks show: BAU allocations (one colour treatment), named project commitments (another treatment), with demand item / stream name visible on the block.
- Utilisation % shown per person-month, with over-capacity months flagged.

**Required features**:
- Filter by Theme, by Person, by demand Type.
- Click into a block to see the underlying demand item or BAU stream (via the same side-panel editor as View 1).
- Toggle to include/exclude BAU in the utilisation calculation.

### View 3 — Forecast (post-MVP)

The question this view answers: *Where will our demand outstrip our capacity, and when?*

**Primary interaction**: Rolled-up demand vs capacity by Theme and by Skill, across the 5-year horizon.

**Layout**:
- Two chart modes: by Theme (demand across all skills in a theme) and by Skill (specific skill within a theme).
- Time axis: monthly, extendable to the 5-year horizon.
- Stacked demand by commitment confidence: Allocated (highest confidence) → Accepted → Submitted (lowest).
- Capacity line overlaid, derived from current team's skills/levels and contracted hours net of BAU.

**Required features**:
- Filter by commitment status (e.g. hide Submitted to see only confirmed demand).
- Visual signal for months where demand exceeds capacity.
- Export to CSV for offline analysis.

### View 4 — Skills Development (post-MVP)

The question this view answers: *Where could we close a skill gap by developing existing people rather than hiring?*

**Primary interaction**: Cross-reference forecast skill shortfalls against the current team's skill profile, surfacing development opportunities.

**Layout**:
- List of forecast skill gaps (from View 3), showing when the gap appears and its size.
- For each gap, suggest candidate people based on: adjacent skills held, same theme, current skill level at Basic (could be developed to Advanced), etc.
- Simple "candidacy" scoring — no AI, just rule-based matching.

**Required features**:
- Configurable shortfall threshold (e.g. ignore gaps < 20 hours/month).
- Ability to flag a development plan as "in progress" for a person/skill — purely informational in v1.

### 4.5 Demand Item Editor (component, used by multiple views)

The demand item editor is a **reusable side-panel component** used from Capacity Validation, Team Activity, and the Demand discovery views. It is not a page of its own — it always overlays on the view that invoked it, preserving context.

**Capabilities**:
- Edit all demand item fields (name, type, status, owner, primary theme, description, parked reason where relevant).
- Add, edit, reorder, and delete phases.
- Within each phase: add, edit, duplicate, and delete resource requirements. Toggle a requirement between skill-shaped and named. Split a skill-shaped requirement into multiple named ones at promotion time.
- Inline validation: warn on over-allocation with confirm; warn when Allocated status has unresolved skill-shaped requirements.

**Behaviour**:
- Edits save live (debounced) and the invoking view recalculates immediately.
- Closing the panel does not require an explicit save — state is always persisted.

### 4.6 Demand discovery

Finding a specific demand item among many. Three switchable modes, default is Table:

- **Table mode (default)**: spreadsheet-style, sortable columns (name, type, status, primary theme, owner, phase count, total committed hours). Filterable.
- **Board mode**: cards grouped by status, visual kanban-style. Drag between columns changes status.
- **Search mode**: full-text search across name, description, owner, and phase names.

---

## 5. Admin

All admin is open — anyone with access can edit any of the following. No permissions in v1.

- Themes and Skills (CRUD)
- People, their skill profiles, contracted hours, `available_from` / `available_to` (CRUD)
- BAU Streams and BAU Allocations (CRUD)

A simple admin area is sufficient — no need for sophisticated UX here.

---

## 6. Seed data

The tool should ship with seed data sufficient to demonstrate all four views. Suggested:

- **Themes**: MOM, MI&V, MBM (3 themes)
- **Skills per theme**: 4–6 skills each, covering realistic Digital Manufacturing capabilities
- **People**: ~12 people spread across themes, with varied skill profiles and levels. Include at least one with `available_from` set in the near future (new starter) and one with `available_to` set (planned leaver).
- **BAU Streams**: 4–6 streams across the themes, with varied allocation patterns including at least one declining stream (handoff to the business)
- **Demand Items**: at least 2 in each of the five statuses, with a mix of types, phases, funding sources, and both skill-shaped and named requirements. Include at least one cross-theme item and at least one item with a skill-shaped requirement split across two named people.

---

## 7. Technology

**Recommended stack for v1**:

| Layer | Choice |
|---|---|
| Frontend | React (Vite) with TypeScript |
| UI components | Tailwind + shadcn/ui, styled in accordance with the design system |
| Design system | **Claude Code must follow the design system specified in `DESIGNSYSTEM.md` at the root of the repository.** All colours, typography, spacing, component styling, and visual language decisions should defer to that document. The mockups provided alongside this spec illustrate layout and interaction intent, not final visual styling — visual styling comes from `DESIGNSYSTEM.md`. |
| State management | Client-side store (Zustand recommended) holding the full dataset. No server sync needed — all state lives in the browser. |
| Charts / timelines | Recharts for standard charts; custom SVG for the timeline views (Capacity Validation, Team Activity) |
| Hosting / backend | **GitHub Pages — static only.** There is no backend server in v1. All state lives in the browser: seed data is imported at build time from a JSON file shipped with the app; user edits persist to `localStorage`. The app is a single-page React/Vite build. Implication: state is per-browser-per-device (no cross-user sync). A "Reset to seed" admin action clears localStorage and reloads. |
| Date handling | date-fns |

**Architectural notes**:

1. **Live recalc**: the full capacity-relevant dataset is held in the browser; recalculation happens locally on edit and persists to localStorage, debounced. At the scale of this tool (12–20 people, dozens of demand items, 60-month horizon), the entire dataset is well under 1 MB — no need for virtualisation, pagination, or lazy loading. Keep it simple.

2. **Persistence model**: on app load, check localStorage for saved state; if absent, hydrate from the bundled seed JSON. All subsequent edits write back to localStorage (debounced ~500ms). A "Reset to seed" button in admin wipes localStorage and reloads.

3. **No shared state**: this is explicitly a single-user POC. If two people open the app in different browsers they see independent data. Cross-user sync is a post-v1 concern.

4. **GitHub Pages routing**: use `HashRouter` (or equivalent) rather than `BrowserRouter` to avoid 404s on deep-link refresh, since GitHub Pages doesn't support server-side routing.

---

## 8. On the horizon — noted for v2, not in scope for v1

The following are known future requirements. V1 must not paint them into a corner, but they should not be built in v1.

### 8.1 Scenario modelling

Users will need to ask "what if we pulled Project X forward by two months?" and see the capacity impact across the team — including knock-on effects on other work. V2 will introduce:

- **Named scenarios** — saveable sets of proposed changes (phase date shifts, re-allocations, new demand) separate from the live plan.
- **Scenario comparison** — view live plan vs scenario side-by-side.
- **Multi-item scenarios** — a scenario can move multiple demand items simultaneously.
- **Commit/discard** — promote a scenario back into the live plan, or discard.

**V1 implication**: Phase dates and resource allocations must be cleanly editable in-place, and the capacity view must recalculate live from the underlying data. This gives users a clunky but functional "what-if" workflow (edit → look → undo) and sets up v2 scenarios as a data-layer branch without architectural rework.

### 8.2 Approval workflow

The current Draft → Submitted → Accepted → Allocated flow is manual and unrestricted in v1. V2 will introduce:

- Role-based gating of status transitions.
- Designated reviewers per theme.
- Audit trail of status changes, including over-allocation acknowledgements.

### 8.3 Funding budget tracking

V2 may introduce scheme-level budget tracking: "Scheme X has 2000 hours, 1400 committed, 600 remaining." V1 captures funding source on phases, which provides the data foundation for this without building the feature.

### 8.4 Actuals reconciliation

Actual time is recorded in SAP. V2 may ingest a periodic actuals feed to compare against forecast. Not in scope for v1.

### 8.5 Permissions

All edit access is open in v1. V2 will introduce authentication and role-based permissions (Theme Lead, Resource Manager, PMO, read-only).

### 8.6 Non-flat allocation profiles

V1 applies hours-per-month flat across every month in a phase. V2 may introduce front-loaded / back-loaded / custom profiles within a phase. Flat is explicitly assumed sufficient for v1.

---

## 9. Build sequencing

Suggested order for the v1 build:

1. **Data model and admin** — themes, skills, people (inc. available_from/to), BAU streams, BAU allocations. Populated via seed data and simple admin screens.
2. **Demand items and phases** — CRUD for demand items with phases and both requirement shapes. Status workflow including Park/Revive and hard delete. Duplicate action.
3. **Demand Item Editor as a reusable side-panel component** — built early since it's used by multiple views.
4. **View 1: Capacity Validation** — the core value of the tool. Build this against live data.
5. **View 2: Team Activity** — secondary MVP view.
6. **Demand discovery** — Table mode first, then Board and Search.
7. **Post-MVP**: View 3 then View 4.

Views 3 and 4 should not be started until 1 and 2 have been in active use for long enough to validate the data model and uncover real workflow patterns.

---

## 10. Open questions and assumptions

The following are flagged. Assumptions are explicit so they can be challenged before or during build.

- **Scenario mechanics (v2)**: when a scenario shifts a project, does only the phase date move, or do named allocations and/or skill requirements move with it? Does a scenario affect one demand item or many? Does not need answering for v1 but should be resolved before v2 planning.
- **Flat-rate hours-per-month** (assumption): hours are applied flat across every month in a phase. This is sufficient for v1. Revisit if real usage shows significant intra-phase spikiness.
- **BAU at theme level** (assumption): all BAU is per-person; there are no theme-level BAU streams. Stream name provides the roll-up view.
- **Phase name autocomplete source** (assumption): suggestions come from phase names used on the last N demand items, not a fixed master list. No admin burden.

---

## 11. Interpretation guidance for Claude Code

Where the spec leaves room for interpretation, these are the resolutions to take. Not new requirements — just "when you hit a fork, take this path."

### 11.1 Click behaviour on a capacity cell (View 1)

When the user clicks a cell in the Capacity Validation view, the side panel opens showing **the demand item that is currently selected as the overlay**. If no overlay is selected, the panel opens on the demand item contributing the largest committed block to that cell, with a breadcrumb at the top showing "Load in June 26 for Sarah Jones" so the user understands what they're looking at. There is no "list of all contributing items" view in v1 — that's a v2 concern.

### 11.2 Adding an overlay

The overlay selector in the toolbar is a search-and-add pattern. The user clicks an "+ Add demand" button which opens a small combobox listing all demand items in `Draft`, `Submitted`, `Accepted`, or `Allocated` status, searchable by name. Selecting one adds it as a chip to the overlay area. Multiple overlays can be stacked. Clicking the × on a chip removes it. No drag-drop, no modal picker.

### 11.3 Status transitions from the side panel

The side panel footer includes status transition buttons contextual to the current status:

- From Draft: `Submit`, `Park`, `Delete`
- From Submitted: `Accept`, `Park`, `Delete`
- From Accepted: `Move to Allocated`, `Back to Submitted`, `Park`, `Delete`
- From Allocated: `Back to Accepted`, `Park`, `Delete`
- From Parked: `Revive to Submitted`, `Delete`

`Duplicate` is available from all statuses as a secondary action.

This means status transitions are not confined to the Board view — they are a first-class action from the editor.

### 11.4 Empty states

The tool must behave gracefully when:

- No demand items exist yet → Capacity Validation shows the team capacity grid with no overlay and a hint message "Add demand items to start assessing capacity impact"
- No overlay selected → grid shows current committed state only, with a hint "Select a demand item to overlay its impact"
- No people yet → admin flow directs user to add people first with a clear call-to-action

### 11.5 Dataset scale and client-side state

The full dataset for this POC is small (estimated <1 MB in localStorage). Do not implement virtualisation, pagination, lazy loading, or streaming. Hold the entire dataset in a single Zustand store and derive all views as memoised selectors. Recalculation on edit should be a pure function over the store state.

### 11.6 Board mode drag-and-drop

Use `@dnd-kit/core` for the Board view drag-and-drop, with keyboard accessibility enabled out of the box. Optimistic updates only — no loading spinners on status change. If drag-drop proves problematic to implement cleanly, a "Change status" dropdown on each card is an acceptable v1 fallback.

### 11.7 Routing on GitHub Pages

Use `HashRouter` from `react-router-dom` (not `BrowserRouter`). GitHub Pages does not support server-side routing, and deep-link refreshes on a `BrowserRouter` setup 404. Hash routing avoids this entirely.

### 11.8 Seed data source

A curated seed dataset is provided alongside this spec as `seed.json`. **Use this dataset verbatim** — do not generate placeholder names or invent skill taxonomies. The seed dataset reflects the real shape of the team and the demand pipeline and is essential to making the demo credible.

### 11.9 Colour and visual styling

The mockup provided (`CapacityValidation_mockup.html`) shows **layout and interaction intent only**. All colours, typography, spacing, borders, shadows, and component styling must come from `DESIGNSYSTEM.md` in the repository root. If the design system conflicts with the mockup's visual choices, the design system wins.

### 11.10 What "live recalc" means in practice

When the user edits a phase date, requirement hours, named assignment, or BAU allocation:

1. The change writes immediately to the in-memory Zustand store.
2. All derived selectors re-run synchronously (they are pure functions).
3. The visible view re-renders within one frame (~16ms).
4. A debounced write (500ms) persists the store to localStorage.

The user should experience the edit as instantaneous. There is no "saving…" spinner, no "save" button, no dirty-state tracking.

---

## Changelog

**v1.2** (this revision):
- Changed hosting / backend model: v1 is now a GitHub Pages static-only React/Vite app. No server, no json-server, no Supabase. State lives in localStorage; seed data ships in the bundle.
- Added section 11 — Interpretation guidance for Claude Code — resolving ten specific ambiguities that could cause drift during build.
- Specified `HashRouter`, `@dnd-kit/core`, Zustand, and the persistence model explicitly.
- Called out empty states, click behaviour, and overlay-add mechanics.
- Referenced `seed.json` as a required input provided alongside the spec.

**v1.1**:
- Added `Parked` as the fifth status (replacing earlier "soft delete" concept). Parked items exclude their commitments from capacity calculations. Revival is supported from any status.
- Added explicit hard-delete action as separate from Park.
- Added `available_from` / `available_to` on Person for new starters and leavers.
- Added free-text `notes` field on Resource Requirements.
- Added worked examples (section 2.5) for multi-skill phases, split-at-promotion, and cross-theme demand items.
- Clarified that Primary Theme on a demand item is a reporting hint, not a constraint.
- Specified three visual signals for over-allocation at person / skill-short / theme-short levels.
- Specified default time horizon as 6–12 months with 6/12/24/60 presets.
- Specified live recalculation within ~200ms and called out the client-side state architecture implication in section 7.
- Added the Demand Item Editor as a reusable side-panel component (section 4.5).
- Added Demand discovery modes: Table (default), Board, Search (section 4.6).
- Added Duplicate demand item action (named becomes skill-shaped on copy).
- Clarified that promotion supports 1-to-many splits.
- Reordered build sequencing to reflect the editor component needing to exist before the main views.
- Added explicit requirement that Claude Code must follow `DESIGNSYSTEM.md` in the repo for all UI styling.
