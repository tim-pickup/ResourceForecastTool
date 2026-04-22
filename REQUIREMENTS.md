# Digital Manufacturing Resource Load & Capacity Tool

## Requirements Specification — v1.15

---

## 1. Purpose

This tool exists to help the Digital Manufacturing PMO and Domain Leads manage team capacity against a constantly changing demand pipeline. It is **forward-looking only** — it models commitments and forecasts from today onwards. Actual time bookings live in SAP and are out of scope.

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

The data model has three layers: **structure** (domains, skills, people), **demand** (what we're being asked to do), and **commitments** (how demand consumes people's time). Time is the unifying dimension, expressed at monthly resolution across a rolling 5-year horizon.

### 2.1 Structure

**Function**
- Name (e.g. "Digital Manufacturing")
- Description
- Active flag (soft-hiding; in v1 a single Function record is pre-seeded and cannot be deleted from the UI)
- A Function is the root of both the skill taxonomy (it owns Domains) and the organisational structure (it owns Teams). This makes the model extensible to multiple Functions (e.g. IT Infrastructure, Operations Engineering) without structural change — each Function brings its own Domains, Skills, and Teams.

**Domain** *(formerly "Theme" — renamed in v1.15 to reflect that Domain is an internal grouping concept specific to each Function, not a universal term)*
- Belongs to one **Function** (`function_id` required)
- Name (e.g. MOM, MI&V, MBM)
- Description

**Skill**
- Belongs to one Domain
- Name (e.g. "SCADA Development", "Historian Configuration")
- Level scale is fixed at three levels: **Basic**, **Advanced**, **Specialist**

**Team**
- Belongs to one **Function** (`function_id` required)
- Name (e.g. "Central Delivery Team", "Plant Team A")
- Type: `Plant` | `Central` | `Specialist` | `Other` (extensible enum)
- Lead: person_id (nullable — a Team can exist before a lead is assigned)
- Active flag (soft-hiding; hard-delete blocked if Team has assigned People)
- Teams are the organisational unit that owns people and receives demand assignments. A Function can have many Teams; a Team belongs to exactly one Function.

**Person**
- Name
- **Team** (`team_id` required — every person belongs to exactly one Team, and therefore transitively to one Function)
- Primary Domain (read-only, derived from the person's skill profile — the Domain in which they hold the most skills or the highest level; used for grouping/display only, not a constraint)
- Contracted hours per month (drives capacity; part-time is handled entirely through this field)
- `available_from` (YYYY-MM, nullable) — capacity before this month is zero. Used for new starters.
- `available_to` (YYYY-MM, nullable) — capacity after this month is zero. Used for leavers.
- Active/inactive flag (for soft-hiding without deletion)
- **Skill profile**: a list of `{skill, level}` entries — a person can hold multiple skills at different levels, including skills from Domains other than their Team's primary Domain
- **BAU allocations**: see section 2.3

**Skill profile scoping rule**: when assigning skills to a person in admin, the DOMAIN > SKILL selector is scoped to the person's Function (via their Team). A person cannot be assigned skills from a different Function's Domain taxonomy. Within their Function, they may hold skills across any Domain.


### 2.1.1 Programme / Project hierarchy

Demand items optionally belong to a **Project**, which in turn belongs to a **Programme**. This is a lightweight grouping layer for roll-up and filtering — not a gate on demand workflow and not tracked as its own state machine.

**Programme**
- Name (free text, required, unique)
- Description (free text, optional)
- Active flag (for soft-hiding; inactive Programmes remain on their existing Projects but don't appear in pickers)

**Project**
- Name (free text, required, unique within its parent Programme)
- Parent Programme (required — a Project must belong to exactly one Programme)
- Description (free text, optional)
- Active flag (for soft-hiding)

**Relationships**

- A Programme has 1..n Projects. (1 is allowed — it's legitimate for a Programme to have only a single Project, especially early on.)
- A Project has 0..n Demand items. (0 is allowed — a Project can exist before any Demand is aligned to it.)
- A Demand item has **0..1 Project** — alignment is optional. Unaligned demand is legitimate, particularly for BAU and small ad-hoc items that don't fit a project shape. Unaligned demand appears under a virtual "No Project" grouping in any view that groups by Project.

**What this hierarchy deliberately is not**

- It is **not a status workflow**. Programmes and Projects have no states, no approval gates, no transitions. They're labels with roll-up power.
- It **does not carry its own resourcing data**. Skill requirements, allocations, and phases all sit on Demand items, exactly as before. A Project's "resource requirement" is just the aggregate of its Demand items' requirements.
- It **does not gate Demand workflow**. A Demand item can move through its full state machine with or without a Project alignment. The alignment field is freely editable in every status (see section 3 — Allocation editing: Programme/Project is deliberately excluded from the "locked once approved" rule, because changing the alignment has zero effect on capacity calculations; it only re-points roll-ups).

**Aggregation semantics**

For any Programme or Project, roll-up totals are computed by summing across its child Demand items. See section 2.4.9 for the full definition of Programme/Project roll-up functions — these are additional named aggregation functions that must live in the shared aggregation module.

Worked example:

- Programme "MES Modernisation" contains Projects "Plant A MES Refresh", "Plant B MES Refresh", "Plant C MES Platform Migration".
- Each Project has 1–3 Demand items covering its scoping, build, and cutover work.
- Rolling up to Programme level aggregates internal committed hours across all those Demand items, plus external hours (see section 2.6) required across them.

### 2.2 Demand

**Demand Item** — the unit of work the tool tracks.

| Field | Notes |
|---|---|
| Name | Free text |
| Type | One of: `Group Strategy Project`, `Plant Project`, `NPD Demand`, `BAU` |
| Status | One of: `Draft`, `Submitted`, `Approved`, `PartiallyAllocated`, `Allocated`, `Parked`, `Closed` (see section 3) |
| Owner | Free-text field (person or role name) |
| Primary Domain | **Read-only, auto-derived** — never entered manually. Computed at render time as the Domain with the greatest total target hours across all requirements in all phases. Displays as "Unassigned" when no requirements exist. Used for reporting/grouping only — **not a constraint** on which domain's people can be allocated. |
| Project | Optional — the Project this Demand item is aligned to. Nullable. Parent Programme is derived via the Project's parent and not stored separately on the Demand. See section 2.1.1. Editable in every status. |
| Description | Free text |
| Parked reason | Free text, shown when status = Parked. Captures why it was parked and any context for revival. |
| **Phases** | One or more — see below |

**Phase** — a demand item consists of one or more phases. A phase is the unit of capacity validation.

| Field | Notes |
|---|---|
| Name | Free text, with autocomplete from phase names used on recent demand items |
| Start month | YYYY-MM — required |
| End month | YYYY-MM — **nullable**. If null, the phase is indefinite (see below). |
| Funding source | One of: `Investment Scheme`, `Plant/Sector Allocation`, `Mixed` |
| Funding notes | Free text — e.g. scheme name or sector |
| **Resource requirements** | One or more — see below |

**Finite vs indefinite phases**

- A **finite phase** has a populated `end_month`. Hours are captured in `hours_by_month` — an object keyed by YYYY-MM with one entry per month the phase spans.
- An **indefinite phase** has a null `end_month`. Hours are captured as `steady_state_hours` — a single flat rate that applies every month from `start_month` onwards, forever (or until the demand is Closed or Parked).
- A requirement only ever uses one or the other: finite phases exclusively use `hours_by_month`; indefinite phases exclusively use `steady_state_hours`.
- Changing a phase from finite to indefinite clears `hours_by_month` and prompts the user for a steady-state value (suggest the average of the existing per-month hours as the default). Changing a phase from indefinite to finite prompts for an end month and pre-fills `hours_by_month` with the steady-state value for every month.

**Resource Requirement** — how a phase consumes capacity. **A phase has many resource requirements.** All requirements are skill-shaped: `{skill, level, hours representation, owning_team_id, notes}`. Named people fulfilling the requirement are held as separate **allocations** attached to the requirement (see section 3 — allocations).

- `owning_team_id` (nullable) — the Team responsible for supplying this requirement. Set during the Scoping workflow when a Team Lead confirms their requirements for a phase. Null for demand items that bypass Scoping (Draft → Submitted directly via legacy flow or BAU). When set, the person picker in the allocation workspace defaults to filtering candidates from that team; the "Show all" toggle lifts this filter. Cross-team allocation (a person from a different team) is permitted but flagged visually.

The "hours representation" depends on the parent phase type:
- In a finite phase: `hours_by_month` (object keyed by YYYY-MM).
- In an indefinite phase: `steady_state_hours` (single number).

**Per-month hours UI (finite phases)**

- When a requirement is first created, the UI pre-fills every month in the phase with a suggested value (e.g. the user's entered "typical" hours) — but each month is then individually editable.
- Changing the phase's start or end month adds or removes entries in `hours_by_month`. When extending, new months inherit the value from the nearest existing month. When shrinking, removed months' values are discarded (with a confirm if they were non-zero).

**Steady-state UI (indefinite phases)**

- A single numeric input: "Hours per month (indefinite)".
- The capacity calculation treats this value as applying to every month from the phase's `start_month` onwards, with no end.
- Closing the demand item ends its contribution to capacity. Parking the demand also removes it from capacity calculations.

A single phase can hold multiple requirements of the same skill at the same or different levels — this is how a phase that needs two MOM Specialists or three different skills gets modelled. See section 2.5 for worked examples.

The `notes` field on a requirement captures tacit context that skill+level alone can't express (e.g. "needs S7 experience specifically", "must have been through site induction").

### 2.3 BAU

BAU is modelled as **demand of type `BAU`** — using exactly the same data structure as project demand, just with the type flag set. There are no separate BAU streams, no separate BAU allocations, and no BAU admin surface. A BAU engagement is a demand item in the main Demand list, alongside projects.

Typical shape of a BAU demand item:

- **Type**: `BAU`.
- **Phases**: often a single indefinite phase (no end date, steady-state hours) for ongoing support streams. Declining BAU (e.g. ramp-down toward business handover) is modelled as multiple sequential finite phases with decreasing hours, optionally followed by a final indefinite residual phase.
- **Requirements**: skill-shaped, using the same DOMAIN > SKILL selector as project demand.
- **Allocations**: named people allocated to requirements, same mechanism as project demand.

Example — declining BAU handover:

Demand item: "MES Super User — Plant B", type BAU.
- Phase 1 "Current support" — Jan 2026 to Jun 2026, 30 hrs/month (finite).
- Phase 2 "Handover period" — Jul 2026 to Dec 2026, 15 hrs/month (finite).
- Phase 3 "Residual support" — Jan 2027 onwards, 5 hrs/month (indefinite).

This turns BAU into a first-class tracked part of the pipeline — it shows on Capacity Validation as the BAU stack layer, contributes to Team Activity via its named allocations, and benefits from the same workflow and visualisations as project demand.

Statuses for BAU items follow the same state machine as projects (section 3). In practice BAU items move through Draft → Submitted → Approved → Allocated quickly since there's usually no real review gate for known support engagements.

### 2.4 Capacity model

This section specifies how capacity and demand numbers are computed across the tool. Several parts of the spec (Capacity Validation charts, Team Activity cells, allocation headroom, over-capacity signals) all depend on these definitions. **The calculations below are the single source of truth**; every view reads from the same aggregation layer.

#### 2.4.1 Person-level capacity

A person's **available project capacity** in a given month is their contracted hours, less their real named allocations, bounded by their employment window:

```
if month < available_from OR (available_to is set AND month > available_to):
    capacity(person, month) = 0
else:
    capacity(person, month) =
        contracted_hours(person)
        − sum of named allocation hours on that person for that month
          across every demand item in the store with status in
          { Approved, PartiallyAllocated, Allocated }
```

Named allocation hours are read from the allocation's `hours_by_month[month]` (finite phase) or `steady_state_hours` (indefinite phase), identically to how they're read anywhere else.

**Submitted, Draft, Parked and Closed demand items do not consume person-level capacity**, because those statuses have no real commitment of people — either because no allocations exist yet (Draft, Submitted) or because the work has been set aside (Parked, Closed).

#### 2.4.2 Domain-level and skill-level capacity

Domain and skill capacity lines on the Capacity Validation charts represent **the skill pool's real availability** — the sum of hours available from people who hold the relevant skills, net of what those people are actually committed to elsewhere.

```
domain_capacity(domain T, month M) =
    sum over every person P who holds any skill in T:
        max(0, contracted_hours(P, M) − P's_real_committed_hours(M))

skill_capacity(skill S, month M) =
    sum over every person P who holds S (at any level):
        max(0, contracted_hours(P, M) − P's_real_committed_hours(M))
```

Where `P's_real_committed_hours(M)` is the sum of P's named allocation hours in M across every demand item with status `Approved`, `PartiallyAllocated`, or `Allocated` — **regardless of which domain or skill those allocations are serving**. A person's 152 hours is a single pool; every real commitment draws from the same pool.

**Critical**: the work that a person is *doing* for skill S shows up on S's *demand* side, not subtracted from S's capacity. Only the work they're doing *on other skills* reduces S's capacity line. This prevents double-counting: Alex doing 100 hrs of MOM work appears as 100 hrs of demand on MOM charts, and reduces MI&V capacity by 100 hrs on MI&V charts — exactly once in each.

#### 2.4.3 Demand aggregation — what goes on the demand stacks

The demand stacks on the charts are composed of *real demand* for the relevant domain or skill:

- **Committed demand** (displayed as the solid stack): the skill-shaped requirement hours from demand items in status `Approved`, `PartiallyAllocated`, or `Allocated`. Per skill-shaped requirement, take the `hours_by_month` or `steady_state_hours` target — this is what the team has committed to deliver.
- **Overlay demand** (displayed as a solid fill on top): the skill-shaped requirement hours from the **currently-selected Submitted overlay**, if any. This is what the team would additionally be committing to if the overlay were Approved. Rendered as a solid amber/yellow area stacked above the committed demand stack, at moderate opacity so the layer beneath remains faintly visible — see section 4 View 1 for the full rendering spec.

Demand aggregation takes the requirement's **target** hours, not the allocation hours. The requirement's target is what's been committed to at the skill level; whether or not the allocations are yet in place doesn't change the demand number. This keeps demand stable across the Approved → PartiallyAllocated → Allocated transitions: the work committed doesn't change, only the allocation of it to specific people.

#### 2.4.4 Unallocated-demand projection — the grey band

Real allocations reduce a skill's capacity line (section 2.4.2). But some committed demand has **no allocations yet** — and that unallocated work still represents hours that will *likely* be consumed by the skill pool once it's allocated. For a domain or skill chart to give an honest "can we take on more?" picture, this pending consumption must be surfaced.

This is done via a **grey hatched band** rendered on each chart, **anchored to the capacity line and hanging downward** — reducing the visible available-headroom zone rather than stacking on top of demand. The grey band represents **capacity effectively removed** from this chart's skill pool by unallocated demand elsewhere — demand not on this chart's skill, but that *would* consume people who contribute to this chart's skill pool.

**Why hanging from the capacity line, not stacking on demand**: the grey band is a capacity-side concept, not a demand-side one. It does not represent demand on this chart's skill (that would be double-counting — see the exclusion rule below). It represents this chart's skill pool being provisionally claimed elsewhere, so the pool's *effective* ceiling is lower than the capacity line. Anchoring the band at the capacity line and hanging it downward communicates that directly: "the headline capacity is X, but this portion is already spoken for elsewhere, so what you can really count on is the space below." Stacking the band on top of demand reads as "phantom demand," which confuses the meaning.

**Rendering**: on every domain/skill chart the capacity line is drawn at the top; the grey hatched band fills downward from the line; the committed demand stack is drawn from the x-axis upward; the overlay demand stack (when present) sits directly above the committed stack. The available headroom zone is the remaining white space between the top of the combined demand stack and the bottom edge of the grey band. If the grey band's bottom edge drops below the top of the demand stack, the overlap is rendered in a warning treatment (see section 4 View 1 for the specifics) — this is the "the skill pool is oversubscribed even before this chart's own demand" case.

**What counts as "unallocated" demand for projection**:

For every skill-shaped requirement across the store, compute its *unallocated portion* for each month — the gap between the requirement's target hours and the sum of its current named allocations. This unallocated portion is then projected as described below. Specifically, unallocated hours come from:

- Every `Approved` demand item's requirements (no allocations yet).
- The unfilled portion of every `PartiallyAllocated` demand item's requirements.
- If an overlay is selected, the target hours of the selected `Submitted` demand item's requirements.

Fully-`Allocated` demand has zero unallocated portion — its consumption is already reflected in real capacity (section 2.4.1), so it contributes zero to the grey band.

**The projection algorithm** — see section 2.4.5 for the full detail. In short: each unit of unallocated-requirement-hours is distributed proportionally across the real headroom of people who are eligible for that requirement (hold the required skill at the required level or higher). The result is a per-person, per-month projected consumption figure.

The grey band on a domain/skill chart is then:

```
grey_band(domain T, month M) =
    sum over every person P contributing to T's capacity:
        sum of P's projected consumption(M) from unallocated demand
        whose target skill is NOT in T
```

The exclusion at the end is deliberate: unallocated demand that is *for this chart's domain/skill* shows up on this chart's demand stack — it doesn't also show as a grey band here (which would double-count). Demand for any *other* domain/skill that would consume the same people reduces the usable headroom here — that's what the grey band represents.

**Rendering requirement — the grey band must exist as its own DOM element.** The grey band is not a computed property of some other layer. It must be rendered as a dedicated hatched area (an `<Area>` in Recharts, with a `<pattern>` fill defined in `<defs>`), separate from every demand-stack layer and separate from the capacity line. On inspecting the rendered SVG of any domain/skill chart, a reviewer must be able to identify the grey-band element by its hatched fill and its position anchored to the capacity line. If the grey band is absent from the DOM — even when the calculation returns zero — the renderability invariant (section 2.4.8) has not been satisfied: a zero-height band is still a mounted element; an absent band is a wiring bug.

**Visual treatment — cross-hatch fill and dotted lower bound.** The grey band uses a **two-way cross-hatch** fill pattern (diagonal lines in both directions, forming a lattice), not a single-direction 45° hatch. This is deliberately more prominent than a single-direction hatch and further distinguishes the band from other hatched elements on the chart (historically the overlay was also hatched; as of v1.13 the overlay is solid yellow, so cross-hatch uniquely identifies "projection elsewhere"). The cross-hatch pattern is defined once in `<defs>` as a reusable SVG `<pattern>` and referenced by every domain/skill chart.

The band also has an **explicit dotted lower bound** — a dotted line in the same grey as the hatch, tracing the bottom edge of the band across the chart. This gives the band a defined, readable boundary instead of fading off into the chart area; without it the user can see "there's some hatched region" but can't easily read exactly where the available headroom starts. The dotted line's colour matches the hatch strokes and its dash pattern is a standard short-dash (2px on, 3px off or similar — DESIGNSYSTEM.md specifies the exact values).

Colour tokens, pattern dimensions, and dash specifications live in `DESIGNSYSTEM.md` under "Projection grey band." The pattern and dotted line read together as a single visual signal: "this area is capacity spoken for elsewhere; the dotted line marks where your usable headroom begins."

#### 2.4.5 The projection algorithm

The projection is a single-pass proportional distribution, applied to every unallocated-requirement-month across the whole store. No iteration, no ordering, no sequential assignment.

For each unallocated-requirement-month (a specific requirement R, in a specific month M, with some unallocated hours H):

1. **Find eligible people** for R: every active person P who holds R's skill at R's required level or higher, and whose `available_from` / `available_to` include M.
2. **Compute each eligible person's real headroom** in M: their contracted hours minus their real named allocations in M (from section 2.4.1).
3. **If total eligible headroom ≥ H**, distribute H across eligible people proportionally to their headroom. Each person P gets `H × (P's headroom / total eligible headroom)` projected hours onto R.
4. **If total eligible headroom < H**, each eligible person is projected at 100% of their headroom; the excess (`H − total eligible headroom`) is recorded as a **projection shortfall** against R in M. The shortfall is surfaced separately as a signal (see section 2.4.6) — it's not hidden in the grey band.

Key properties:

- **Single pass, no ordering.** Each requirement-month is projected independently and in one step. No requirement's projection depends on what another requirement was projected to first. This makes the algorithm deterministic and trivially re-runnable.
- **Proportional to real headroom.** A person with 100 hrs free gets twice the share of a person with 50 hrs free — which mirrors how a real allocator would tend to spread work based on availability.
- **Sum of projections onto any one person across all requirements ≤ that person's contracted hours**, by construction — each requirement's distribution is bounded by people's headroom, and if collective demand exceeds supply, the excess becomes a shortfall rather than over-projecting onto individuals.

#### 2.4.6 Projection shortfall — surfacing excess demand

When unallocated demand collectively exceeds the skill pool's real headroom (step 4 of the algorithm), the excess is recorded as a **projection shortfall** against the specific requirement-month. These shortfalls are the signal that the team is committed to (or being asked to consider) more work than it can supply — even optimally.

Shortfalls must be surfaced in the over-capacity summary strip on the Capacity Validation view (see View 1 spec). Example format:

> ⚠ **Projection shortfall**: MOM Specialist demand in Jun–Aug 2026 exceeds available headroom by 40 hrs/mo. Driven by: Project A (Approved, 30 hrs short), Project B (PartiallyAllocated, 10 hrs short).

Shortfalls are surfaced per skill and per month. They are not hidden inside the grey band — a greyed chart alone doesn't tell the PMO *which* demand can't be served, and by how much.

#### 2.4.7 Over-allocation (person-level)

**Over-allocation is permitted** — a person can be allocated more hours than their contracted capacity via real named allocations. The tool warns the user at save time and requires confirmation but imposes no upper limit. No audit trail of acknowledgements is kept in v1.

When a person is over-allocated in the store, their capacity contribution to domain/skill lines is floored at zero (see the `max(0, …)` in section 2.4.2) — an over-allocated person contributes nothing more to the available skill pool; they're already working beyond 100%. The over-allocation itself is visible separately on the Team Activity chart for that person-month.

#### 2.4.8 Demand aggregation consistency — one function, many callers

All demand and capacity numbers across the tool are computed by a single shared aggregation module. Every view reads from the same underlying selectors:

- Capacity Validation chart demand stacks
- Capacity Validation capacity lines and grey bands
- Over-capacity summary strip entries (including projection shortfalls)
- Team Activity cell segments and headroom
- Demand drawer summaries
- Allocation workspace headroom/coverage computations

There must be exactly one implementation of each of: `person_capacity`, `real_committed_hours(person, month)`, `domain_capacity`, `skill_capacity`, `demand_hours_for(domain|skill, status_filter, month)`, `projected_consumption(person, month)`, and `grey_band(domain|skill, month)`. All consumers call these functions; no view computes its own totals by iterating over the store independently.

**Testable invariant**: take any Submitted demand item; compute what it contributes to every chart (demand stacks on its own domain/skill; grey band on other domain/skill charts) under the overlay. Now hypothetically toggle the item's status to Approved and re-read the same numbers from the aggregation layer. The numbers must be identical, because the projection rules treat Submitted-overlay and Approved-unallocated demand identically. This is the core correctness test for the aggregation layer.

**Renderability invariant — every named aggregation function must be verified end-to-end against the seed.** Specifying a function and shipping a stub that returns zero are the same thing to any downstream view: both produce a blank visual. To close this gap, after implementing or changing any aggregation function, the build must verify that the function actually produces non-zero output for the seed scenarios where section 11.8 promises non-zero output. Specifically, on a fresh seed load with no overlay selected:

- `grey_band('mom', '2026-06')` must be > 0. The seed's "Plant C MES Platform Migration" is Approved-unallocated and its MOM Specialist requirements project onto people who also hold other MOM skills, producing a baseline MOM grey band in Jun–Aug 2026.
- `projected_consumption(alex_morgan_id, '2026-06')` must be > 0 for the same reason (Alex holds MOM Specialist and will receive a share of the projection).
- With "Corporate Data Lake" selected as the overlay: `grey_band('miv', '2026-07')` must be > 0, and a projection shortfall entry for MI&V Specialist must exist in the over-capacity summary strip for Jun–Aug 2026.

These are not optional checks. If any of them returns zero when the seed is loaded fresh, the aggregation layer has a bug that must be fixed before any UI work built on top of it is trustworthy. They should be codified as runtime assertions (enabled in development builds) or as automated tests against the seed fixture — not as manual spot-checks.

This is the v1.10 invariants' missing enforcement layer. An aggregation function that silently returns zero is indistinguishable from one that correctly returns zero; the seed was designed specifically so that "correctly zero" and "silently broken zero" produce observably different behaviour. This invariant was added in v1.12 after the v1.11 build shipped with a grey_band function that returned zero for every input and no rendered band anywhere.

#### 2.4.9 Programme / Project roll-up aggregation

Programme and Project roll-ups are named aggregation functions, implemented in the same shared module as the rest (section 2.4.8) and called from every view that surfaces roll-up numbers. Inline summation over child Demand items by individual callers is not acceptable.

Required functions:

- `project_internal_hours(project_id, month)` → number. Sum of all internal skill-shaped requirement target hours across Demand items aligned to this Project, for Demand items in status `Approved`, `PartiallyAllocated`, or `Allocated`. Excludes Draft, Submitted, Parked, Closed. Excludes external requirements.
- `project_external_hours(project_id, month)` → number. Sum of all external requirement `hours_by_month` / `steady_state_hours` across Demand items aligned to this Project, across every Phase regardless of Demand status except Parked and Closed. External hours are demand-shaped only (no allocation layer) so the committed/unallocated distinction does not apply; any non-Parked, non-Closed Demand's external requirements count.
- `project_external_hours_by_provider(project_id, month)` → `{provider_id: number}`. Same as above, broken down per provider.
- `project_demand_count(project_id, status_filter?)` → number. Count of child Demand items, optionally filtered by status set.
- `programme_internal_hours(programme_id, month)` → number. Sum of `project_internal_hours` across all Projects in this Programme, plus internal hours from any unaligned Demand explicitly attached to the Programme (note: this spec does not currently support direct Programme attachment — all Demand goes via a Project — but the function signature is stable for a v2 extension).
- `programme_external_hours(programme_id, month)` → number. Sum across Projects.
- `programme_external_hours_by_provider(programme_id, month)` → `{provider_id: number}`. Sum across Projects.
- `programme_project_count(programme_id)` → number. Count of active Projects in this Programme.
- `unaligned_demand_hours(month, {internal|external})` → number. For the virtual "No Project" grouping in roll-up views.

**Semantics notes**:

- External hours include Submitted and Draft. Rationale: external resource is often known and being lined up well before the Demand is Approved internally — a Project roll-up that excluded Submitted external hours would understate the external effort being planned. If a user wants to see only "committed" external effort they can filter by Demand status at the view layer.
- Internal hours follow the same committed-demand definition as the rest of the aggregation layer (`Approved` / `PartiallyAllocated` / `Allocated` only) so numbers reconcile with the Capacity Validation charts.
- Roll-ups over a month range (for the Programme/Project summary blocks on the Demand page) are computed by summing the monthly function over the range.

**Where these functions are called**:

- Demand page — when grouped by Programme/Project (section 4.6), each group header shows internal hours total, external hours total (with provider breakdown tooltip), and child Demand count across the visible horizon.
- Programme/Project admin screens (section 5) — compact roll-up block per record.
- Future: any Programme/Project detail view (out of scope for v1.14 but the function signatures are designed to support it).

### 2.5 Worked examples of requirement composition

These examples exist to make the abstract model concrete.

**Example A — Multiple skills and multiple same-skill-different-level on one phase**

Project "Site X MES Upgrade", Phase 1 "Design" (May–Aug 2026). All requirements are skill-shaped on entry. Hours are per-month, not flat:

| # | Skill | Level | May | Jun | Jul | Aug |
|---|---|---|---|---|---|---|
| R1 | MOM — MES Platform | Specialist | 20 | 40 | 60 | 60 |
| R2 | MOM — Workflow Design | Advanced | 40 | 80 | 80 | 40 |
| R3 | MOM — Workflow Design | Advanced | 0 | 40 | 40 | 40 |
| R4 | MI&V — HMI Design | Basic | 0 | 0 | 20 | 30 |

This shape is impossible to express cleanly with flat-rate hours — the phase has a clear ramp-up, peak, and tail, and requirements start and end at different times within the phase. R3 is a second MOM Advanced slot that only kicks in from June; R4 starts late for HMI work that depends on the workflow design being further along.

**Example B — Splitting a single requirement across multiple people at promotion**

Same project moves from Accepted to Allocated. R2 (MOM Advanced: 40/80/80/40 across May–Aug) is promoted and split between two people. Each named allocation carries its own `hours_by_month` derived from the original:

| Promoted from | Named to | May | Jun | Jul | Aug |
|---|---|---|---|---|---|
| R2 | Sarah | 30 | 56 | 56 | 30 |
| R2 | Chris | 10 | 24 | 24 | 10 |

The monthly totals still sum to the original (40/80/80/40). The tool tracks the promotion lineage so the user can see R2 was fulfilled by two named allocations. The capacity view credits Sarah and Chris separately in each month.

**Example C — Cross-domain demand item**

Project "NPD Line Y Integration" — Primary Domain is MOM (because that's the lead), but:

- Phase 1 "Specification" requires 1× MOM Advanced + 1× MI&V Advanced
- Phase 2 "Build" requires 2× MOM Specialist + 1× MBM Basic
- Phase 3 "Deploy" requires 1× MOM Basic + 1× MI&V Basic

The demand item carries the MOM primary domain tag for reporting, but its requirements pull capacity from three domains. The capacity views should show this item's contribution against all three domains, not just MOM.

### 2.6 External resource requirements

Some Demand items need resource from outside our team — other internal teams, Managed Services, contractors, OEM engineers, plant teams. The tool tracks this so a Demand item's resourcing picture is *complete*, but **external resource never enters our team's capacity calculations, charts, or projection grey bands**. Our team's capacity is and remains the primary lens. External requirements are recorded alongside internal skill-shaped requirements but live in a separate bucket from a computation perspective.

**External Resource Requirement** — sits on a Phase, alongside skill-shaped (internal) requirements.

| Field | Notes |
|---|---|
| Provider | Dropdown, admin-configured — see "Provider list" below. Required. |
| Role | Free text (e.g. "SCADA Engineer", "Historian Specialist", "Plant Electrician"). Required. |
| Hours representation | Same pattern as internal requirements: `hours_by_month` on finite phases, `steady_state_hours` on indefinite phases. Required. |
| Notes | Free text, optional — context not captured by provider/role. |

A single Phase can hold zero, one, or many External Resource Requirements, independently of its internal skill-shaped requirements. A Phase that is *entirely* externally-resourced has zero internal requirements and one-or-more external requirements; a Phase that is *entirely* internal has the reverse; mixed is common and supported.

**Hours representation details**

- **Finite phase**: external requirement carries `hours_by_month` keyed by YYYY-MM for every month the phase spans. The same month-grid UI used for internal requirements applies (see section 4.5.2 Mode A).
- **Indefinite phase**: external requirement carries `steady_state_hours` — a single flat monthly rate applying from `start_month` onwards.
- Changing the parent phase between finite and indefinite follows the same rules as for internal requirements (section 2.2): finite→indefinite clears `hours_by_month` and prompts for a steady-state default (suggesting the average of existing per-month values); indefinite→finite regenerates the per-month grid pre-filled with the steady-state value.

**Provider list (admin-configured)**

The Provider dropdown reads from an admin-configured list. See section 5 for the admin surface. Suggested starter values: `Managed Services`, `Contractor`, `OEM`, `Plant Team`, `Other Internal Team`, `Other`. The list is editable — new providers can be added, existing ones renamed (renames cascade to existing requirements), and unused providers deleted.

**No allocation layer for external requirements**

External requirements are **demand-shaped only**. They do not have named allocations — we don't track which specific external person is doing the work. The provider + role is the granularity; hours/month is the commitment. If the user wants to note a specific named contractor, that goes in the requirement's Notes field.

This is a deliberate simplification: adding an allocation layer for external resource would turn the app into a multi-team tracker (Option C in the design discussion), which is explicitly out of scope for v1. If, in practice, users find they need to track external allocations more richly, that's a v2 conversation.

**Exclusion from capacity calculations — explicit rule**

External requirements are excluded from:

- Every capacity line on the Capacity Validation charts (section 4 View 1). External hours do not contribute to or reduce domain/skill capacity, because they don't consume our team's people.
- Every demand stack on the Capacity Validation charts. External hours do not appear on the stacked demand visuals.
- The projection grey band (section 2.4.4). External requirements have no projected consumption of our team's skill pool.
- Projection shortfalls (section 2.4.6). Unallocated-but-external hours do not create shortfalls against our team's skill pool.
- Team Activity cells (section 4 View 2). Our team's people are the rows; external hours have no place on the grid.
- Skill detail view's people heatmaps and demand Gantt (section 4.8). Both are about our team's skills and our team's commitments.
- The aggregation functions `demand_hours_for`, `domain_capacity`, `skill_capacity`, `grey_band`, `projected_consumption`, `projection_shortfalls` (section 2.4.8). These functions read internal skill-shaped requirements only.

External requirements **are included** in:

- The Demand drawer (section 4.5.1) — visible as a dedicated external-requirements summary block below the internal phase/requirement summary.
- The Demand edit page Mode A (section 4.5.2) — entered and edited alongside internal skill-shaped requirements, within each Phase card.
- The Demand edit page Mode B — read-only, same locking rules as internal requirement definitions.
- The Programme/Project roll-up totals (section 2.4.9), where external hours are surfaced as their own total broken down by provider.
- Per-Demand external-hours totals, used for roll-up and for the drawer summary.

**Worked example**

Demand item "Plant C MES Platform Migration", Phase 2 "Build" (Jul 2026 – Dec 2026). Finite phase. Requirements as a mixed internal/external set:

Internal (skill-shaped):
- R1 — MOM Specialist, 80 hrs/mo across phase
- R2 — MOM Advanced, 60 hrs/mo across phase

External:
- E1 — Provider: Managed Services, Role: SCADA Engineer, 120 hrs/mo across phase
- E2 — Provider: OEM, Role: MES Platform Vendor Support, 40 hrs/mo Jul–Aug only (ramp-down shape captured in `hours_by_month`)

The internal R1 + R2 hours contribute to MOM domain and skill charts exactly as before. The external E1 + E2 hours appear in the Demand drawer and Edit page, contribute to the Project-level external-hours roll-up broken down by provider, and are visible nowhere on the capacity charts.

---

## 3. Demand workflow

Demand items move through a defined state machine. Unlike earlier versions of this spec, transitions are **gated** — only the specific transitions described below are permitted. The Board view and the demand drawer/edit page surface only the valid transitions from the current status.

### Statuses

| Status | Meaning | Capacity impact |
|---|---|---|
| **Draft** | Being shaped. Metadata and phases may be incomplete. | None — excluded from all capacity views. |
| **Scoping** | Submitted for team input. The demand owner has defined the gross shape (phases, team assignments, rough description). Assigned Team Leads are filling in skill-shaped requirements. Auto-advances to Submitted when all team assignments are confirmed. | None — excluded from all capacity views. Can be Closed directly (unlike Draft/Submitted) and restored from Archive. |
| **Submitted** | Ready for capacity assessment. Requirements are populated with skill-shaped demand. | Shown as overlay on Capacity Validation charts when selected (see View 1). Not counted as committed. |
| **Approved** | The team has committed to doing this work. Named allocation has not yet started. | Counted as committed at domain/skill level. Contributes to demand stacks on charts. No individual capacity is consumed yet (no named people). |
| **PartiallyAllocated** | Allocation has started but is incomplete — at least one named allocation exists, but not every requirement-month is fully covered. | Counted as committed. Named allocations consume individual capacity; unfilled portions remain as skill-shaped demand at domain/skill level. |
| **Allocated** | Every requirement's per-month hours are fully covered by named allocations across every month of every phase. | Fully counted. All demand lands on named individuals. |
| **Parked** | Temporarily set aside. | Excluded from all capacity calculations. |
| **Closed** | Archived. The work is complete, cancelled, or otherwise concluded. | Excluded from all capacity calculations. Not shown in the main Demand list — only in the Archive view. |

### State machine

```
  ┌────────┐
  │ DRAFT  │◄───────────────────────┐
  └───┬────┘                        │ (Revert to Draft)
      │                             │
      │ (Submit for Scoping)        │
      ▼                             │
  ┌─────────┐                       │
  │ SCOPING │◄─────────────────────-┘
  └────┬────┘
       │  (auto: all team assignments confirmed)
       ▼
  ┌───────────┐
  │ SUBMITTED │
  └─┬──┬────┬─┘
    │  │    │
    │  │    └──── (Park) ────┐
    │  │                     ▼
    │  └──── (Approve) ──► APPROVED ────► (Park) ──┐
    │                         │                    │
    │                         ▼ (auto: first alloc ▼
    │                             added)           │
    │                     PARTIALLYALLOCATED ───► (Park) ──┐
    │                         │    ▲                       │
    │                         │    │ (auto: drops          │
    │                         │    │  below 100%)          │
    │                         ▼    │                       │
    │                     ALLOCATED ─────► (Park) ─────────┤
    │                         │                            │
    │                         │                            ▼
    │                                              ┌─────────┐
    │                                              │ PARKED  │
    │                                              └────┬────┘
    │                                                   │
    │                 (Revive to Submitted)             │
    └───────────────────────────────────────────────────┘

  SCOPING / APPROVED / PARTIALLYALLOCATED / ALLOCATED ──(Close)──► CLOSED ──► (Restore from Archive)
```

### Transition reference

User-driven transitions (the user clicks a button):

| From | To | Action label | Notes |
|---|---|---|---|
| Draft | Scoping | **Submit for Scoping** | Demand owner assigns teams to phases and provides rough description. Creates DemandTeamAssignment records. |
| Scoping | Draft | **Revert to Draft** | For when the scoping needs further shaping before teams are engaged. |
| Scoping | Parked | **Park** | With optional reason note. |
| Scoping | Closed | **Close** | Scoping is a full status — can be Closed and restored from Archive, unlike Draft and Submitted. |
| Submitted | Draft | **Revert to Draft** | For when a submission needs further shaping. |
| Submitted | Approved | **Approve** | Confirms the team will do this work. |
| Submitted | Parked | **Park** | With optional reason note. |
| Approved | Submitted | **Revise** | Low-friction path back to Submitted to correct demand definition issues discovered after approval but before allocation work is underway. Existing named allocations are preserved but ignored from capacity calculations while in Submitted. On re-Approval, they're re-validated against the (possibly edited) requirements and flagged if they no longer fit. |
| Approved | Parked | **Park** | Rare — used if the work is pulled post-approval. |
| PartiallyAllocated | Parked | **Park** | Pulls work mid-allocation. Named allocations are preserved but not counted. |
| Allocated | Parked | **Park** | Pulls fully-allocated work. Named allocations are preserved but not counted. |
| Parked | Submitted | **Revive** | Always revives to Submitted. From there the normal flow applies. |
| Approved / PartiallyAllocated / Allocated | Closed | **Close** | Explicit, manual. Archives the demand; excludes it from the main list and from all charts. |
| Closed (in Archive view) | previous status | **Restore** | Restores to whatever status the item held immediately before it was closed. |

System-driven transitions (automatic, no user action):

| From | To | Trigger |
|---|---|---|
| Scoping | Submitted | Every DemandTeamAssignment for the demand has `confirmed = true`. |
| Approved | PartiallyAllocated | The first named allocation is added to any requirement on the demand. |
| PartiallyAllocated | Allocated | Every requirement's per-month hours are fully covered by named allocations (see "Full allocation definition" below). |
| Allocated | PartiallyAllocated | A named allocation is removed or reduced such that coverage drops below 100% on any requirement-month. |

Transitions that are **not** permitted:

- Draft → anywhere except Scoping.
- Scoping → anywhere except Draft / Submitted (auto) / Parked / Closed.
- Submitted → anywhere except Draft / Approved / Parked.
- PartiallyAllocated / Allocated → Submitted directly. (Must go via Park → Revive. These statuses have active allocations consuming capacity; direct-to-Submitted would be ambiguous.)
- PartiallyAllocated / Allocated → Approved. (Editing allocations is permitted in these states without changing status; see 4.5.2. A direct downgrade is not needed.)
- Closed → any state except via Restore from the Archive view.
- Any state → Closed except from Scoping / Approved / PartiallyAllocated / Allocated. (You can't close a Draft or a Submitted — Park them instead.)

### Full allocation definition

A demand item is **fully allocated** — and auto-transitions to `Allocated` — when every skill-shaped requirement has named allocations such that, **for every single month in the parent phase's date range**, the sum of named allocation hours exactly equals the skill-shaped requirement's `hours_by_month` value for that month.

- Over-allocation against a requirement's hours (named allocations summing to more than the requirement's per-month target) does not count as "fully allocated" — it triggers a validation warning instead.
- Partially-allocated months (named allocations summing to less than the requirement's per-month target) keep the demand in PartiallyAllocated.
- The unfilled portion of each requirement-month remains as skill-shaped demand on the capacity charts, so a PartiallyAllocated demand with gaps shows up correctly as "some committed capacity at domain level, some unfilled by named people."

### Allocation editing

Once a demand is in PartiallyAllocated or Allocated, the user can freely:

- Add, remove, or modify named allocations to any requirement.
- Change the per-month hours on any named allocation.
- Add further named people to cover gaps.
- **Change the Project alignment** of the Demand item (section 2.1.1). Re-pointing a Demand to a different Project (or removing its Project alignment entirely) has zero effect on capacity calculations, allocations, or the state machine — it only re-points the roll-up totals on the Programme/Project views. This is editable in every status, including Approved / PartiallyAllocated / Allocated.

No status change is needed before editing allocations or re-aligning the Project. The status auto-updates based on the coverage rule above.

What the user **cannot** do in PartiallyAllocated or Allocated:

- Edit the underlying skill-shaped requirements (skill, level, or target hours).
- Add, remove, or change phases.
- Edit demand item metadata that affects the resourcing picture (type, owner, phase dates).
- Edit external resource requirements (section 2.6) — provider, role, or hours. External requirements are locked under the same rule as internal requirement definitions.

If any of those need to change, the user must explicitly `Park` the demand, revive it to `Submitted`, adjust, and re-approve. This is deliberate friction — it prevents casual edits to already-committed work and surfaces them as a conscious decision. (This friction is one of the things v2 scenario modelling will soften.)

### The skill-shaped → named relationship

Skill-shaped requirements are the *definition* of demand. Named allocations are the *fulfilment* of that demand. They are separate records, linked by reference.

- Each named allocation belongs to a specific skill-shaped requirement (its parent).
- A named allocation carries: person, `hours_by_month`, notes.
- Multiple named allocations can fulfil a single skill-shaped requirement (e.g. 80 hrs/month split as Sarah 50 + Chris 30).
- A named allocation's person must hold the parent requirement's skill at the required level or higher (warn, don't block).

This replaces the earlier "promotion" language. Named allocations are not a *shape* of requirement; they are *attached* to a skill-shaped requirement. This keeps the requirement-level demand stable and makes partial allocation trivially representable (some months allocated, others not).

### Deletion and duplication

**Park vs Close vs Delete** — three different actions:

- **Park**: temporary; reversible via Revive. Item stays in the Demand list but is excluded from charts.
- **Close**: permanent but retrievable; removes from main UI and charts, lives in Archive, restorable.
- **Hard Delete**: irreversible removal from the database. For genuine mistakes (duplicates, mis-entered demand). Requires confirmation and carries a distinct icon. Available from any status via an admin-style action, not the main transition buttons.

**Duplicate**: copies name (with "(copy)" suffix), type, owner, Project alignment, description, all phases, skill-shaped requirements, and external resource requirements, but **not** named allocations (they never transfer to a duplicate). Primary Domain is not copied — it is re-derived from the duplicated requirements. Status resets to `Draft`.

---

## 4. Views

The tool provides four views. **Views 1 and 2 are the MVP** and must be built first. Views 3 and 4 follow once the data model is populated and in use.

### View 1 — Capacity Validation (MVP)

The question this view answers: *Can we resource the pipeline, and where is capacity constrained?*

This is a **team-level, strategic view** — not an individual-level grid. It is composed of charts that show demand vs capacity over time, structured so that both overall team health and skill-level constraints are visible. Individual-level detail is reached via drill-down, not as the primary lens.

**The polymorphic-capacity principle**

A person is a pool of hours that can flex across any domain/skill they hold. This means:

- **Total team capacity** is additive — sum of everyone's contracted hours (respecting available_from/to).
- **Domain-level capacity** and **skill-level capacity** are *not* additive across domains/skills, because the same person contributes to multiple lines. Displaying them stacked in one chart would double-count.
- Therefore each domain (and each skill when drilled in) gets **its own chart** with its own capacity line and its own grey-band projection.
- See section 2.4 for the complete capacity and projection model. Every chart reads its numbers from the shared aggregation layer described there.

**Page structure**

The page is a scrollable, vertically composed set of chart sections:

1. **Section A — Overall team capacity** (top, always visible, prominent)
   - A single chart showing total team capacity as a line, with demand stacked by work type (Group Strategy Project, Plant Project, NPD Demand, BAU) against that line.
   - Answers "do we have enough people to do the work in aggregate?"
   - Over-capacity months are clearly signalled on this chart.

2. **Section B — Domain / Skill breakdown** (below, scrollable)
   - A **Domain / Skill toggle** at the top of this section switches between:
     - **Domain mode (default)**: one chart per domain (3 charts for MOM, MI&V, MBM). Demand stacked by work type within that domain, against that domain's capacity line.
     - **Skill mode**: one chart per skill, grouped under their parent domain with a heading per domain. Same stacked-demand-vs-capacity-line pattern.
   - Charts in this section are sized for side-by-side or responsive grid layout, not full-width.
   - Each chart is independently interactive (hover, tooltip, click-through).

**Chart specification (applies to every chart on the page)**

Every domain/skill chart is composed of the following elements:

1. **Capacity line** — drawn at the top of the chart, representing the total theoretical capacity of the skill pool (see the Capacity line paragraph below).
2. **Projection grey band** — anchored to the capacity line, hanging **downward**. Hatched grey fill, representing capacity effectively removed from this chart's skill pool by *unallocated demand elsewhere* (demand for other domains/skills whose projected allocations would consume the same people). See section 2.4.4 for the calculation.
3. **Committed demand stack** — drawn from the x-axis upward. Work in status `Approved`, `PartiallyAllocated`, or `Allocated` that targets this chart's domain/skill. Stacked by work type (BAU → Plant Project → NPD Demand → Group Strategy Project, bottom to top), solid fill, using the colour palette consistent across all views.
4. **Overlay demand stack** (when an overlay is selected) — the representation of the selected Submitted demand's contribution to this chart's domain/skill. Sits directly above the committed stack. The overlay's *height* in each month is the overlay's own contribution to this chart — not the cumulative top-of-stack coordinate. The overlay renders as a **solid amber/yellow fill** at moderate opacity (typically ~0.6–0.7 so the colour reads as overlay-yellow while the committed layer below remains faintly visible); exact token in `DESIGNSYSTEM.md`. As of v1.13, hatched fill is reserved for the projection grey band only — the overlay is solid to keep these two visual signals clearly distinct. The overlay's `d` path silhouette must still differ from the top committed-stack layer's silhouette (the v1.12 wiring fix). If the overlay path coordinates match the top committed area's coordinates exactly, the overlay is being rendered as a silent duplicate rather than as its own distinct `<Area>` with its own `dataKey`, and no visual change will be visible when an overlay is selected — this is a rendering bug that must be fixed.
5. **Available headroom** — the remaining white space between the top of the combined demand stack and the bottom edge of the grey band. This is the genuine "usable" capacity for this chart's domain/skill right now.

**Capacity line**: a single thick line at the top representing the **total theoretical capacity** of the skill pool (sum of contracted hours of everyone holding the relevant skills, respecting `available_from`/`available_to`). The capacity line is **static relative to real allocations** — it does not move when allocations happen; instead the grey band grows (hangs further down from the line) and the available headroom shrinks. This is intentional: the line represents "what this pool could theoretically do in a month," and what sits underneath it tells the consumption story.

- **Time axis**: horizontal, monthly. Default horizon is 6–12 months, with preset switches for 6 / 12 / 24 / 60 months. The horizon selector is global — applies to all charts simultaneously.
- **Over-capacity signal**: the combined demand stack (committed + overlay) and the grey band meet in the middle of the chart. When they overlap — i.e. the top of the demand stack crosses into the grey band, or beyond — that's the signal. Two distinct treatments:
  - If the **demand stack alone** (committed + overlay, without any grey band) exceeds the capacity line, the overflow area above the capacity line is rendered in a strong red warning treatment. This is true over-capacity: real committed work above the pool's ceiling.
  - If the demand stack is below the capacity line but crosses into the grey band (i.e. available headroom has gone to zero or negative), the overlap region — where demand stack and grey band intersect — is rendered in a softer red warning treatment. This is the "pool is oversubscribed once projected consumption elsewhere is accounted for, even though demand on this chart alone is within capacity" case.
- **Per-chart over-capacity badge**: any chart currently showing demand above its capacity line, or demand crossing into the grey band, renders a prominent badge in the chart card header (e.g. a red "Over capacity" pill with the month range or peak overflow). The badge is visible at chart-card scale regardless of how large the over-capacity area inside the chart is — so a small spike in one month is just as noticeable as a sustained overflow across multiple months.

**Grey band interaction**:

- **Hover** on the grey band in any month shows a breakdown tooltip: "Capacity consumed elsewhere this month: X hrs. Driven by: *Project A* (Approved, N hrs projected onto shared skill-holders), *Project B* (PartiallyAllocated unfilled, N hrs), *Project C* (Submitted overlay, N hrs)." Ordered by contribution.
- The grey band is purely informational — clicking it doesn't navigate anywhere (the underlying demand items are reachable through the demand stack segment clicks on their own chart, or through the over-capacity summary strip's shortfall entries).

**Over-capacity summary strip (top of Section B)**

Immediately above the breakdown charts, a summary strip lists every signal that deserves attention within the visible time horizon. Three distinct signal types, visually distinguished:

- **Over capacity**: a domain/skill chart where committed demand alone exceeds the capacity line. Format: "**MOM** · Jun–Aug 2026 · peak +40 hrs over capacity". This is the most serious signal — real committed work exceeding real capacity.
- **Over capacity with overlay**: a chart that becomes over-capacity only because of the current Submitted overlay. Format: "**MOM** · Jun 2026 · +15 hrs with overlay (*Site X MES Upgrade*)". Distinguishes structural from overlay-induced problems.
- **Projection shortfall**: a skill whose unallocated demand (Approved, PartiallyAllocated, or overlay) exceeds the real headroom of eligible people — i.e. the skill pool cannot absorb the pending work even optimally. Format: "⚠ **Projection shortfall**: MOM Specialist demand in Jun–Aug 2026 exceeds available headroom by 40 hrs/mo. Driven by: *Project A* (30 hrs), *Project B* (10 hrs)". See section 2.4.6 for how these are computed.

Entries are sorted with over-capacity and projection shortfalls first, then overlay-induced. Clicking an entry scrolls to and briefly highlights the corresponding chart card below. When nothing is over-capacity or short, the strip shows a concise all-clear message ("All domains within capacity across the next 12 months; no projection shortfalls") rather than disappearing — so the absence of problems is as visible as their presence.

**Overlay mechanism — single Submitted demand**

The overlay answers: *"If we approved this specific Submitted item, what would change?"* It is a decision tool for a single demand item at a time.

- A toolbar at the top of the page lets the user select **one** Submitted demand item to overlay — not multiple. Only items in status `Submitted` are eligible; items in other statuses are not selectable.
- The currently-overlaid item is shown as a chip in the toolbar. A search-and-add combobox lets the user change the overlay to a different Submitted item. Adding a new overlay replaces the current one; it does not stack.
- When an overlay is active:
  - The chart for the overlay's target domain/skill shows the overlay demand as a solid amber layer on top of the committed stack.
  - Charts for *other* domain/skill pools that share people with the overlay's target show the overlay's projected consumption in their grey band.
- Removing the overlay returns all charts to showing only committed demand and the baseline grey band from Approved / PartiallyAllocated unallocated work.

**Aggregate Submitted visibility** (separate from the overlay):

Because overlays are single-item, the "overall Submitted pipeline" question is answered elsewhere:

- The **Demand page** (section 4.6) in Board mode shows the full Submitted column at a glance.
- The **over-capacity summary strip** shows skill-level projection shortfalls that include all unallocated demand — Approved, PartiallyAllocated unfilled, and the current overlay. To see "if *everything* Submitted were approved," the user can mentally substitute or actually promote items; the strip will re-evaluate as they go.

For v1, there is no "select all Submitted" bulk overlay. Stacking overlays makes the projection interpretation confusing (which overlay caused what shortfall?) and adds little insight over the single-item modelling already provided. Revisit in v2 if users genuinely need cumulative overlay projection.

**"Model Impact" — arriving with a pre-selected overlay**:

The Capacity Validation view can be deep-linked from a Submitted demand's drawer via a "Model Impact" action (see section 4.5.1). When arriving this way:
- The view opens with the originating demand item pre-selected as the single overlay.
- A dismissable banner at the top of the page confirms context: "Modelling impact of *Site X MES Upgrade*. **Back to demand** · Dismiss".
- Clicking **Back to demand** returns the user to wherever they came from (typically the Demand list with the drawer re-opened on the originating item).
- Dismissing the banner doesn't change the overlay — it just removes the banner. The user can then use the view normally.

The overlay is **purely additive and view-only**. It does not mutate the underlying demand data. Changing an item's status (Submitted → Approved) is still done through the Demand Item Editor, not through the overlay.

The overlay is explicitly *not* a scenario modeller. It cannot move committed demand, change dates on existing work, or reassign people. Those capabilities are v2 — see section 8.1.

**Drill-down**

- Click a domain chart → opens the skill-level charts for that domain (in place, below or replacing the domain view).
- Click a skill chart → opens the **Skill detail view** (section 4.8). This is a dedicated page that shows the people who hold the skill and the demand that is consuming it, both along the same time axis as the parent chart.
- Click a stacked area segment → opens a side panel listing the demand items contributing to that segment (with deep-link into the Demand Item Editor).

**Required features**

- Domain / Skill toggle (section B).
- Time horizon preset (6 / 12 / 24 / 60 months).
- Work type filter — show/hide specific work types across the demand stacks on all charts.
- **Programme / Project filter** — a toolbar control letting the user narrow all charts (and the over-capacity summary strip) to demand from a single Programme or a single Project. Dependent dropdowns: Programme filter is single-select with "All Programmes" default; Project filter populates from the selected Programme (or all Projects when Programme is "All"). When a Programme/Project filter is active, the demand stacks reflect only the internal requirement hours from Demands aligned to that Programme/Project — capacity lines and grey bands still reflect the full team (the team doesn't shrink just because the user is filtering their view of demand), so the charts then answer the question "how much of our team is this Programme/Project consuming against the team's total capacity?" A small info tooltip on the filter explains this semantics so users aren't confused by a narrow demand band against a full capacity line.
- **Team filter** — a toolbar control (single-select, "All Teams" default) scoping the view to a specific Team. When a Team is selected: (1) each Domain/skill chart gains a second **dashed** capacity line representing that team's contribution to the pool — computed as the sum of contracted hours of team members holding the relevant skills, net of their real allocations; (2) a tinted overlay on the demand stack highlights the portion of committed demand whose requirements have `owningTeamId` matching the selected team. The solid capacity line (full pool) remains unchanged. Together, the dashed line and tint answer: "is my team specifically over-committed for this domain/skill, and how does that compare to the full pool's headroom?" When "All Teams" is selected, the dashed line and tint are hidden and the view reverts to current whole-pool behaviour. The Team filter composes with the Programme/Project filter.
- Single-item overlay selector for Submitted items (combobox pattern; one overlay at a time). The Programme/Project filter applies to which Submitted items are eligible for overlay too — when a Programme/Project filter is active, only Submitted items aligned to that scope appear in the overlay picker.
- Grey band rendering and hover breakdown on every domain/skill chart.
- Over-capacity summary strip with three signal types (over-capacity, over-capacity-with-overlay, projection shortfall).
- Drill-down on chart click.
- Live recalculation within ~200ms on edits to demand, phases, requirements, allocations, or status changes.
- **"Show external resource" toggle** — controls visibility of Section C (see below). Default off.

**Section C — External Resource Demand** (shown when "Show external resource" toggle is on)

This section sits below Section B and is toggled independently from the rest of the view. It provides planning visibility into external resource hours — it is **not** a capacity chart and must be visually distinct from Sections A and B.

A prominent section header reads: **"External Resource Demand"** with an inline info note: *"External hours are shown for planning visibility only — they do not affect team capacity calculations."*

The section contains two sub-sections:

**Sub-section C1 — Overview chart**
- A single stacked area chart. X-axis: months, aligned with the rest of the page (same horizon preset). Y-axis: total external hours across all Demand items in scope.
- Stacked by Provider — each Provider gets a distinct colour from the design system palette. A legend identifies each Provider.
- **No capacity line. No grey band. No projection.** This chart carries none of the capacity-model visual language from Sections A and B — its purpose is solely to show external effort over time.
- Hover tooltip: month, total external hours, per-Provider breakdown with role count.

**Sub-section C2 — Per-Provider breakdown**
- One chart per Provider that has any external requirement hours in the visible horizon.
- Each chart shows that Provider's hours over time, stacked by Demand item. Each contributing Demand item gets a distinct colour segment.
- Same chart card sizing and layout as the Domain charts in Section B for visual consistency.
- Hover tooltip: month, Provider name, total hours, list of contributing Demand item names with per-item hours.
- Charts are only rendered for Providers with non-zero hours in the visible horizon — Providers with no activity in scope are not shown.

**Section C scope rules:**
- The Programme/Project filter applies to Section C: when active, only external hours from Demands aligned to the selected scope are shown.
- The Team filter does not apply to Section C — external requirements have no `owningTeamId`.
- The time horizon preset applies identically.
- Section C reads from the existing `project_external_hours_by_provider` and `unaligned_demand_hours` aggregation functions (section 2.4.9) — no new aggregation functions are required. The Function-wide total is the sum across all Projects plus unaligned Demand external hours.


**What this view deliberately does *not* do**

- It does not show individual people by default. The Team Activity view (View 2) is the right place for per-person detail. Individual data is reachable through drill-down but never in the landing view.
- It does not attempt to show domain/skill charts stacked in a single combined chart — the double-counting problem makes that misleading.
- It does not try to reconcile or surface contention *between* concurrent overlays. That's a scenario modelling concern and belongs in v2.

**Capacity calculation reference**

| Level | Capacity formula |
|---|---|
| Total team | `Σ (person.contracted_hours) − Σ (active BAU allocations)` for all active people in the month |
| Domain | `Σ (person.contracted_hours − person.BAU − person.named_commitments_outside_this_theme)` for all people holding any skill in the domain |
| Skill (any level) | `Σ (person.contracted_hours − person.BAU − person.named_commitments_not_supplying_this_skill)` for all people holding this skill at any level |
| Skill (specific level) | as above, but only counting people whose held level meets or exceeds the specified level |

Skill-shaped (not-yet-named) demand contributes to the demand side of charts at the domain and skill level it specifies, but does not consume any individual's capacity.


### View 2 — Team Activity (MVP)

The question this view answers: *What is each person actually working on right now, how is their time split by work type, and where is their headroom?*

**Primary interaction**: Grid of people × months. Each cell is a stacked horizontal bar showing the breakdown of that person's time that month by work type.

**Layout**:
- **Group by toggle**: `Domain` (default) ↔ `Team`. Controls the primary row grouping:
  - **Domain grouping** (default): rows grouped under Domain headers (MOM, MI&V, MBM). This is the PMO view — shows skill-pool utilisation at a glance.
  - **Team grouping**: rows grouped under Team headers (e.g. Central Delivery Team, Plant Team A). Each team header shows a **team summary bar** — a rolled-up aggregate stacked bar representing the team's total committed hours as a proportion of total contracted hours for the team, using the same work-type colour segments. This is the Team Lead view — shows whether the team as a whole is over or under committed before reading individual rows.
- Horizontal time axis, monthly, default 6 months (with the same preset switches as View 1: 6 / 12 / 24 / 60).
- Each **cell** is a horizontal stacked bar whose full width represents the person's contracted hours for that month.
- **Cross-team allocation signal**: when a person's cell includes hours for a requirement whose `owningTeamId` differs from their own `teamId`, that allocation segment receives a thin contrasting border. Hovering the segment shows "Cross-team: [Demand name] owned by [Other Team name]." This makes cross-team borrowing visible in the grid without being visually noisy at normal scale.

**Cell composition — stacked horizontal bar**:

Each cell shows segments in a fixed left-to-right order, with widths proportional to committed hours:

1. **BAU** (leftmost)
2. **NPD Demand**
3. **Plant Project**
4. **Group Strategy Project**
5. **Available Capacity** (rightmost — the remainder of contracted hours not yet committed)

**Colours are consistent with the Capacity Validation charts** (section View 1) for the four work-type segments. Available Capacity uses a neutral/muted tone to visually step back — it's not a work type, it's the headroom.

- The segments sum to the person's contracted hours for that month.
- **Over-allocated cells** must be visually unmissable. When a person's committed hours exceed their contracted hours for the month:
  - The **entire cell background** is tinted a light red (not just the overflow portion), so it's visible at a glance from across the whole grid.
  - Within the cell, the committed stack extends past the 100% marker into an overflow portion rendered in a stronger red treatment (hatched or darker), matching the over-capacity visual logic on View 1.
  - The numerical badge (e.g. "+24h") sits on top of the red background. Its red text is kept, but the background is what makes the cell catch the eye from distance.
- If the person has `available_from` or `available_to` constraints excluding this month, the cell is shown as "unavailable" with a distinct treatment (e.g. diagonal stripes, muted background) and zero utilisation.

**Click interaction — drill-down to contributing demand**:

Clicking anywhere on a cell's stacked bar opens a **popover or side panel** listing the specific demand items contributing to that person-month. Each entry shows:
- Demand item name (clickable — opens the demand drawer for further detail)
- Work type badge
- Hours contributed this month
- Parent phase name

Clicking a specific segment (e.g. the BAU segment) can filter the drill-down list to that work type. Clicking the Available Capacity segment shows a simple message confirming available hours and (where relevant) lists demand items whose Submitted status means they *could* land there (useful when Team Activity is viewed in conjunction with the Submitted overlay workflow, though this is a secondary affordance).

**Required features**:
- Filter by Domain, by Person, by work Type.
- Time horizon preset (6 / 12 / 24 / 60 months).
- Cell click → drill-down panel listing contributing demand items.
- Segment click → drill-down filtered to that work type.
- Tooltip on hover showing the exact hours breakdown for that person-month.

### View 3 — Forecast (post-MVP)

The question this view answers: *Where will our demand outstrip our capacity, and when?*

**Primary interaction**: Rolled-up demand vs capacity by Domain and by Skill, across the 5-year horizon.

**Layout**:
- Two chart modes: by Domain (demand across all skills in a domain) and by Skill (specific skill within a domain).
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
- For each gap, suggest candidate people based on: adjacent skills held, same domain, current skill level at Basic (could be developed to Advanced), etc.
- Simple "candidacy" scoring — no AI, just rule-based matching.

**Required features**:
- Configurable shortfall threshold (e.g. ignore gaps < 20 hours/month).
- Ability to flag a development plan as "in progress" for a person/skill — purely informational in v1.

### 4.5 Demand Item — viewing and editing

Demand items are viewed through a **drawer** and edited on a **full page**. These are two distinct surfaces with different purposes.

#### 4.5.1 The Drawer (read-only preview)

A side-panel drawer shown when a user clicks into a demand item from any view (Capacity Validation chart segment, Team Activity block, Demand list row).

**Purpose**: fast glance at what a demand item is, without leaving the current view. Optimised for *understanding*, with a **clear next-step CTA** that reflects where the demand sits in its lifecycle.

**Layout** — the drawer has four distinct zones:

1. **Header zone** (top)
   - **Left side**: demand name as the primary heading; then on the row below: Type badge; then on the row below that: Project alignment shown as "Programme › Project" in muted text, or **"Unaligned — Not Associated To A Project"** in muted italic text if no alignment is set. At narrow drawer widths, the unaligned label truncates to "Unaligned". Primary Domain is **not** shown in the header — it is auto-derived from requirements and surfaced in the body zone only. Owner shown below the alignment row.
   - **Right side**: **Edit** button (prominent styling, aligned to the right edge), then the **Overflow menu** (kebab / ⋯) button, then the **Close drawer** (×) button. The Edit button is the always-available entry into the full edit page and is consistent across every status — this is the mental-model constant that lets users reach any field at any time.
   - The overflow menu contains actions that aren't part of the primary workflow for the current status. See the **Overflow menu contents** table below.

2. **Status zone** (inline, just below the header)
   - Status pill shown prominently.
   - **No buttons in this zone.** Status transitions have moved out of the status zone in v1.14. The zone now carries status information only (pill plus any small informational badges — e.g. "Partially Allocated · 68% covered"), not actions. This keeps the status zone clean and delegates all action-taking to the header-right (Edit, overflow) and footer (primary CTA) zones.

3. **Body zone** (scrollable content)
   - Description.
   - Project alignment block — if the Demand is aligned to a Project, show "Programme › Project" with a small inline affordance to re-align (opens a dropdown). If unaligned, show an "Align to Project…" affordance. Either way, re-alignment is available from here in every status (section 2.1.1 permits this). **This block must not appear a second time** elsewhere in the body — the Project alignment is shown once here and once in the header zone only.
   - **Primary Domain** (read-only, auto-derived) — shown as a labelled read-only field: "Primary Domain: MOM" (or "Primary Domain: Unassigned" if no requirements exist yet). Derived at render time as the domain with the greatest total target hours across all requirements in all phases. Never manually editable.
   - Summary stats: phase count, total internal hours across all phases, total external hours across all phases (if any external requirements exist), date range, funding sources used.
   - Phases laid out in a compact read-only form. For each phase: name, dates (or "indefinite" if no end), funding source, and a summary of both its internal skill-shaped requirements (skill + level + hours summary — "180 hrs total May–Aug" for finite, "5 hrs/mo steady" for indefinite) and its external resource requirements (provider + role + hours summary), if any.
   - A "Total skills/hours" rollup at the bottom, aggregating across all phases. Internal and external totals shown on separate lines.

4. **Footer zone** (bottom, sticky)
   - The footer holds **one or more status-specific primary action buttons**, right-aligned. The specific buttons shown depend on the current status — see the **Footer buttons by status** table below.
   - Ordering is right-to-left — the **rightmost** button is the most prominent / primary CTA for the current lifecycle moment, with secondary primary buttons running leftward from there. No overflow menu in the footer; no duplicate Edit; no status pill.

**Footer buttons by status** (right-to-left ordering, rightmost first — this is the primary-CTA position)

| Status | Footer buttons (right-to-left) |
|---|---|
| Draft | **Submit** |
| Submitted | **Approve**, Model Impact, Revert to Draft, Park |
| Approved | **Allocate** |
| PartiallyAllocated | **Allocate** |
| Allocated | *(none — footer is empty)* |
| Parked | **Revive** |
| Closed *(Archive view only)* | **Restore** |

**Rationale for each footer primary**

- **Draft → Submit** is the only forward move; Revert-to-Draft doesn't apply (you're already in Draft); Park doesn't apply either (you don't park a Draft — you delete it if it's junk). Submit is the whole footer.
- **Submitted → Approve** is the primary forward move. Model Impact deep-links to Capacity Validation with this item pre-selected as overlay (section 11.11) — it's a decision-support action adjacent to Approve, so it sits next to it. Revert-to-Draft and Park are valid alternatives and also sit in the footer as secondary primaries.
- **Approved → Allocate** is the new v1.14 button. It opens the edit page in Mode B (Allocation Workspace) directly, bypassing the Mode-A-by-default Edit flow. It's a navigational button, not a status transition. Rationale: at this point in the lifecycle, the overwhelmingly common action is "start allocating people" — making that a one-click primary instead of Edit → scroll-to-allocations is the single most-impactful UX improvement of this version.
- **PartiallyAllocated → Allocate** continues the same pattern — the work isn't done yet, so "keep allocating" remains the headline CTA.
- **Allocated → *(no footer button)*.** There is no meaningful forward action at this stage. Edit (top-right) is still available if the user needs to reach any field; status transitions like Park and Close sit in the overflow menu, not the footer. An empty footer is the honest design: the allocation work is complete, and surfacing a button for the rare exit actions (Park / Close) would over-weight them relative to how often they're used.
- **Parked → Revive** is the one-step return to the pipeline. All other actions are in the overflow.
- **Closed → Restore** is the Archive-view action, moving the item back to its prior status.

**Overflow menu contents** (top-right kebab ⋯)

The overflow menu collects every action not surfaced as a footer primary button, plus the destructive actions. Contents vary by status:

| Status | Overflow menu contents |
|---|---|
| Draft | Duplicate, Delete |
| Submitted | Duplicate, Delete |
| Approved | Revise (to Submitted), Park, Close, Duplicate, Delete |
| PartiallyAllocated | Park, Close, Duplicate, Delete |
| Allocated | Park, Close, Duplicate, Delete |
| Parked | Duplicate, Delete |
| Closed *(Archive view only)* | Duplicate, Delete |

**Why Revise is in the overflow on Approved (not the footer)**

Revise is the low-friction backward path from Approved → Submitted to correct demand definition issues. It's valid but uncommon — the common action from Approved is to start allocating people. Putting Revise in the footer alongside Allocate would dilute the CTA; putting it in the overflow keeps it reachable without competing with the forward workflow. Same argument for Park on Approved / PartiallyAllocated / Allocated: these are valid but infrequent exits and belong in the overflow.

**Why Close is in the overflow, not a footer primary**

Close is terminal. It always belongs in the overflow because the user should pause before clicking it. Footer primaries are for the common next-step action; Close is not a common next step, even on Allocated work (which stays Allocated for the life of the project before being explicitly closed).

**Button hierarchy rationale — v1.14 summary**

Three tiers, reflecting action frequency and risk:
- **Top-right Edit button**: the mental-model constant. Always present, always primary styling, always opens the full edit page. One click to reach any field regardless of status.
- **Footer primary CTA(s)**: status-appropriate forward-motion actions. One to four buttons depending on status; empty on Allocated.
- **Overflow menu** (kebab, top-right, adjacent to Edit): everything else — Duplicate, Delete, and any valid-but-uncommon transitions for the current status (Revise, Park, Close, restorative actions).

**Behaviour**:
- Read-only apart from the Project-alignment affordance and action buttons.
- Closing the drawer returns the user to their previous view with no side-effects.
- All footer action buttons, overflow menu transitions, and the top-right Edit button apply **immediately** on click (they don't require the save/cancel pattern that applies to field edits on the edit page). Status transitions update the store atomically; Allocate and Edit navigate to the edit page.

#### 4.5.2 The Edit Page — two modes based on status

The edit page is reached via the drawer's "Edit" button, or directly via "+ New Demand" from the Demand list. It has **two distinct modes** depending on the demand's current status.

**Mode A — Demand Definition** (active when status is `Draft`, `Submitted`, `Parked`)

This is where the demand is shaped: metadata, phases, and skill-shaped requirements (internal), plus any external resource requirements. Named allocation of our team's people is not available in this mode because the demand hasn't been committed to yet.

Content:
- Top section: demand item fields (name, type, owner, **Project alignment** — see below — description, parked reason if Parked). **Primary Domain is not a form field** — it is auto-derived from requirements and displayed read-only in the drawer and table views. It does not appear on the edit form.
- **Project alignment field**: a picker showing current alignment as "Programme › Project" (or "Unaligned" if null). Clicking opens a searchable dropdown listing all active Projects grouped by Programme — the Programme is a non-selectable group header, just like the DOMAIN > SKILL selector pattern (section 4.5.3). Selecting a Project aligns the Demand; a "Clear alignment" action at the top of the dropdown makes the Demand unaligned. At the bottom of the dropdown, a persistent **"+ Create new Project…"** option opens an inline mini-form (Project name + Programme — the Programme picker has its own "+ Create new Programme…" entry) that creates the record and immediately selects it. This inline-create pattern means the user can align a Demand to a new Project without breaking flow. See section 5 for the standalone admin surface and section 11.14 for the creation flow detail.
- **Phase timeline (Gantt)**: a horizontal time-based overview at the top of the Phases section, above the phase cards. Shows every phase as a labelled bar on a shared month-resolution timeline, sorted ascending by start month. Each bar shows the phase name and indicates its duration; indefinite phases render with a trailing dashed extension or arrow marker to communicate "continues beyond the visible range." The timeline is read-only and navigational — clicking a bar scrolls the page to the corresponding phase card and expands it. Changes to phase dates in the cards below update the timeline immediately. When the demand has a single phase the timeline is still shown but kept compact.
  - **Bars are colour-coded by the phase's Funding Source** — one colour per value of the three-value enum (Investment Scheme, Plant/Sector Allocation, Mixed). The colour mapping is documented in `DESIGNSYSTEM.md` and is shared with any other view that colours by funding source. A compact legend is rendered inside the timeline container (top-right or inline with the header) so the colour-to-source mapping is readable without hovering. Changing a phase's funding source in the card below updates the bar colour immediately. This replaces any previous colour scheme on this chart (e.g. generic/phase-indexed colouring).
  - **Vertical padding**: the timeline container must have breathing room above the topmost bar and below the bottommost bar — at least one bar-height worth of space at each end, so bars do not touch the container edge or overlap the horizontal scrollbar (where one is present). This is a specific regression seen in v1.10: the lowest bar overlaps the horizontal scroll rail and is hard to read. If the container scrolls horizontally because the phase range exceeds the visible width, the scrollbar must sit entirely below the bottom padding, not on top of the last bar.
  - **Bar styling**: bars have rounded corners, sit on a horizontal grid of month lines, and show the phase name as a label inside the bar (truncating with ellipsis if the bar is narrow). Labels must have sufficient contrast against the funding-source fill colour — if necessary, the label is rendered on a semi-transparent backing to preserve legibility regardless of the bar colour.
- Phases section: each phase is a collapsible card showing:
  - Phase name, start month, end month (end month supports a "No end date (indefinite)" toggle — see 11.12)
  - Funding source (dropdown) and funding notes (free text)
  - **Internal requirements list** — each internal requirement displays as a row with skill, level, notes, and a **per-month hours grid** (finite) or **steady-state hours input** (indefinite). This is the existing behaviour, unchanged.
  - **External requirements list** (new in v1.14) — a visually distinct sub-section within each phase card, below the internal requirements. Header: "External Resource Requirements" with an "+ Add external requirement" button. Each external requirement displays as a row with Provider (dropdown — admin-configured), Role (free text), notes, and the same **per-month hours grid** (finite) or **steady-state hours input** (indefinite) as internal requirements. Visually, external requirements are distinguished by a secondary accent colour and a small "External" label or icon on each row — users must be able to tell at a glance which rows are internal and which are external. When a phase has no external requirements, the section collapses to just the "+ Add external requirement" affordance — it doesn't take up vertical space with empty state chrome.
- Actions: add phase, reorder phases, delete phase, add internal requirement within a phase, add external requirement within a phase, delete any requirement.

**Internal requirements entry** is **always skill-shaped**:
- The "Add Internal Requirement" form offers only: **Skill** (using the DOMAIN > SKILL selector — see 4.5.3), **Level** (Basic / Advanced / Specialist), **Starting hours per month** (pre-fills the per-month grid, or sets the steady-state value for indefinite phases).
- Named allocations are not entered in this mode — they're added in Mode B.

**External requirements entry** (new in v1.14):
- The "Add External Requirement" form offers: **Provider** (dropdown reading from the admin-configured Provider list — see section 5), **Role** (free text), **Starting hours per month** (pre-fills the per-month grid, or sets the steady-state value for indefinite phases), optional **notes**.
- External requirements never have named allocations. They are demand-shaped only (section 2.6). No allocation UI appears for them in Mode B.
- If the admin Provider list is empty when the user first tries to add an external requirement, the form surfaces an inline link to the Provider admin screen and blocks submission until at least one provider exists.

**Dropdown overflow — mandatory portalling**: the DOMAIN > SKILL selector, the Project alignment picker, the Provider dropdown, and any other dropdown that opens from inside a phase card or elsewhere in the edit page must be rendered via a portal (e.g. Radix Popover or Headless UI Combobox patterns that mount to document.body). Phase cards and containers have `overflow` constraints that clip non-portalled dropdowns, cutting off options — this must not happen. Any dropdown open event must yield a popover that can exceed its container bounds and remain fully visible regardless of where it sits on the page.

Per-month hours UI (finite phases) — applies identically to internal and external requirements:
- Each requirement row shows a horizontal grid of month cells spanning the phase's date range.
- Adjusting the phase start/end month adds or removes cells (as per section 2.2).
- A **"Fill all"** action on each row flattens hours to a uniform value across every month in the phase. The user enters a value (or, if any cell already has a non-zero value, the UI offers to propagate that existing value to all cells). This button appears on both internal skill-shaped requirement rows **and** external requirement rows — the behaviour is identical for both.
- Row shows a monthly total and phase total for sanity-checking.

Steady-state UI (indefinite phases) — applies identically to internal and external requirements:
- Each requirement row shows a single "Hours per month (indefinite)" input instead of the per-month grid.
- For internal requirements, the capacity calculation applies this value from the phase's `start_month` onwards with no end bound. For external requirements, the value contributes to Programme/Project external roll-ups with no end bound, but does not affect any capacity calculation.

**Mode B — Allocation Workspace** (active when status is `Approved`, `Partially Allocated`, `Allocated`)

Once approved, the primary purpose of the edit page becomes allocation — naming people against the committed skill-shaped requirements. The demand definition is locked (see section 3 — Allocation editing). A small read-only summary of the demand definition is shown at the top for reference, with a link back to Park-and-revise if changes are truly needed.

Content:
- Top section: read-only demand summary (name, type, owner, domain, **Project alignment** — displayed as "Programme › Project" with an inline re-align affordance that's still editable here, per section 2.1.1 — total internal hours by phase, and a compact external-hours summary if any external requirements exist: "External: 160 hrs/mo across 2 providers" with a hover or expand for the per-provider breakdown).
- **Phase timeline (Gantt)**: the same phase Gantt visual as Mode A (section 4.5.2 — "Phase timeline (Gantt)"), rendered **read-only** here. Same visual styling, same colour-by-funding-source, same legend, same vertical-padding rules — only the interactivity changes: clicking a bar still scrolls the page to the corresponding phase card below, but dragging, resizing, or otherwise editing bar geometry is not available. Changing the phase timeline requires Park-and-revise or (from Approved) the Revise action (section 3). This read-only Gantt sits **above the "Demand Definition is Locked" banner** so the user can orient themselves on the shape of the work before seeing the locked-banner and the allocation rows. Rationale: the Gantt is pure orientation — it tells the user at a glance "this demand has three phases, here's when each runs" — and that's just as useful in Mode B as in Mode A. Hiding it behind a mode split made Mode B feel like a different page than Mode A rather than a progression of the same page.
- **"Demand Definition is Locked" banner**: a subtle yellow/amber banner immediately below the Gantt, stating that requirement definitions are locked in the current status and offering the appropriate return-to-Mode-A action (Revise from Approved; Park → Revive from Partially Allocated / Allocated).
- **Allocation summary header**: overall coverage across the demand (e.g. "68% allocated, 4 unfilled requirement-months"), status pill showing current status.

**Phase separation — visual priority**

Each phase is rendered as a **distinctly bounded card** with strong visual separation from surrounding phases. This is the single most common complaint about the current build — phases run together and it's hard to tell where one ends and the next begins. Requirements:

- Each phase is a container with a strong border (not just a subtle divider), ideally with spacing or background-tint differentiation between phase cards.
- Phase card header is visually prominent: "Phase 1 · Design · May–Aug 2026" with type-setting that reads as a heading, not a subheading.
- Phases are numbered sequentially ("Phase 1", "Phase 2") so the user can talk about them unambiguously.
- Collapsing a phase is supported but expanded is the default, so all requirements are visible on first render.

**Per requirement within a phase**:
- The skill-shaped target at the top: skill (using DOMAIN > SKILL display format), level, and a compact view of the per-month target hours.
- **Month labels directly above the coverage indicator** — "May · Jun · Jul · Aug" text labels aligned to the cells below. The current implementation has the coverage strip without explicit month labelling, making it unclear what you're looking at. This is mandatory.
- **Coverage indicator strip** — one cell per month of the phase, colour-coded: green (fully covered), amber (partial), red (unfilled). Each cell hovers to show "Jun 2026 — 56/80 hrs covered".
- **Allocation rows** below the coverage strip — one row per named person allocated to this requirement. Each shows: person's name and primary domain, per-month hours grid (editable), sum vs target indicator.
- An "Add allocation" action to append another allocation row.

**External requirements within a phase — read-only in Mode B**:
- If the phase has external requirements, they appear below the internal requirements in a clearly-labelled "External Resource Requirements" sub-section. Same visual treatment as Mode A — secondary accent colour and "External" label — but rendered read-only.
- Each external requirement shows its Provider, Role, and per-month hours (or steady-state hours for indefinite phases).
- No coverage strip, no allocation rows, no "Add allocation" — external requirements have no allocation layer (section 2.6). The row is purely informational.
- External requirements cannot be edited in Mode B (locked under the same rule as internal requirement definitions — section 3, Allocation editing). To edit, the user must Park-and-revise (or Revise from Approved) to return to Mode A.

**Person capacity visibility on allocation**

This is a key functional gap in the current build and must be addressed. When a person is selected for an allocation, the tool must surface their **per-month available capacity** so the allocator can tell at a glance whether they can actually take the work.

Specifically:
- Each allocation row shows a **capacity-preview strip** immediately above or alongside its per-month hours grid — one cell per month, showing the person's remaining available capacity for that month.
- As the user types an hours value into an allocation cell, the corresponding capacity-preview cell updates in real time to show the effect: green if within capacity, amber if approaching (e.g. >80%), red if pushing over capacity.
- Hovering a capacity-preview cell shows the breakdown (see the calculation detail below).

**Headroom calculation — mandatory scope**

The "remaining available capacity" for person P in month M must be computed from **two sources combined**: allocations already persisted in the store (from every demand item) *plus* pending in-session edits on the current allocation page (from every row except the one whose cell is being edited).

The formal definition:

```
headroom(P, M, row_being_edited) =
    contracted_hours(P, M)
  − SUM over every PERSISTED allocation A such that:
        A.person_id == P
        AND month M falls within A.parent_phase date range
        AND A.parent_demand_item.status ∈ {Approved, PartiallyAllocated, Allocated}
        AND A.parent_demand_item ≠ the demand item currently being edited
  − SUM over every IN-SESSION pending allocation value V on the current edit page such that:
        V.person_id == P
        AND V is for month M
        AND V belongs to an allocation row on this page
        AND V's row ≠ row_being_edited
```

In plain English — the headroom preview on any row, for any person, for any month, must subtract:

1. Everything that person is committed to *elsewhere in the store*, for demand items *other than the one open in this editor*, in statuses that consume capacity (Approved / PartiallyAllocated / Allocated); plus
2. Every pending edit already entered on *any other row of the same edit page* for the same person in the same month — whether or not Save has been pressed yet.

Key points:

- **The store and the in-session map are the two inputs, and they are mutually exclusive.** Persisted allocations belonging to the demand item currently being edited must be ignored from the persisted-store sum, because those allocations are *represented* in the in-session map (as pre-populated values on the page) and would otherwise be double-counted. When the user opens the edit page, the in-session map is seeded from the persisted state of the current demand's allocations; from then on it diverges from the store until Save.
- **Every keystroke on any row re-derives every other row's preview for the affected person-months.** This is a live derivation, not a snapshot. Typing "60" into Row A's Jun 2026 cell for Alex Morgan must immediately reduce the Jun 2026 preview on every other row on the page that is also allocating Alex Morgan. Same applies to all months in a row when a quick-fill action is used.
- The allocation being edited is **excluded** from its own "other allocations" bucket. Otherwise headroom shrinks as the user types, producing confusing feedback. "Row being edited" means the specific `(phase, requirement, person)` row — not the specific month cell. All month cells on the same row share the same exclusion, so typing into one month doesn't change that row's preview for another month.
- BAU is included naturally because BAU is now demand of type BAU — its allocations are in the same pool.
- `contracted_hours(P, M)` respects the person's `available_from` / `available_to` — if M is outside that range, contracted hours for that month is zero.
- If the parent demand item of the allocation being edited is currently in Submitted status (e.g. during Revise flow), its existing persisted allocations should be **excluded** from the headroom calculation, since Submitted items don't consume capacity.

Hover text format: "Alex Morgan, June 2026: 152 contracted − 20 BAU (MES Super User) − 60 Project X Phase 2 − 40 pending this session (Phase 1 · MES Platform) = 32 hrs available". The pending-this-session line is only shown when non-zero.

**Worked example — the Plant C MES Platform Migration case**

Demand item has two skill lines in Phase 1 (Jun 2026) where Alex Morgan is eligible:
- Row A — Skill line "MES Platform (core configuration)"
- Row B — Skill line "Production Workflow Design"

Alex's Jun 2026 contracted hours: 152. Alex is already allocated 60h elsewhere in the store (some other Approved demand item). So the *starting* headroom preview on both rows is `152 − 60 = 92h`.

1. The user opens the edit page. Both rows show Jun 26 headroom = 92h. ✓
2. The user types `60` into Row A's Jun 26 cell. Row A's preview stays at 92h (its own value is excluded from its own preview by design). **Row B's preview immediately updates to 32h** (`92 − 60` pending from Row A). ✓
3. The user types `40` into Row B's Jun 26 cell. Row B's preview stays at 32h. Row A's preview updates to 52h (`92 − 40` pending from Row B). Both rows are within their respective previews — no warning fires.
4. If the user instead entered `60` into Row B, Row A's preview would drop to 32h, and Row B itself would also show 32h remaining. Row B's *input value* of 60 exceeds that 32h preview, so the person-level soft-warning fires (consistent with the existing v1.8 rule: person-level over-allocation is soft-warned at input and confirm-required on save).

This behaviour — live cross-row re-derivation — is the core fix for the v1.10 observed bug where both rows showed 92h regardless of what was typed on the other.

**Implementation note** — the in-session pending allocation map should be the single source of truth for *every* value the user sees on the page, including the per-month hours grids themselves and the capacity-preview strips. The persisted store is read once when the page opens (and on explicit reload), after which everything derives from `(persisted store minus this demand) + in-session map`. On Save, the in-session map is written back atomically; on Cancel, it is discarded.

This turns the allocation flow from blind to informed — the PMO can see in real time whether the person they're about to commit actually has the hours, accounting for *every* other commitment across the whole plan.

**Person picker**:
- Filtered by default to people who hold the parent skill at the required level or higher.
- Shows each candidate's **summary capacity for the phase period** next to their name (e.g. "Alex Morgan · MOM Specialist · avg 40 hrs/mo available across phase"). The summary uses the same full-store headroom calculation as above, averaged across the phase's months.
- A "Show all" toggle lifts the skill filter (with a visible warning if a non-holder is chosen).

**Quick-fill actions on each allocation row**:
- **"Fill remaining"** — allocates this person to whatever hours are currently unfilled on the requirement, month by month. Respects both the requirement's remaining headroom *and* the person's remaining capacity: fills up to `min(requirement_remaining, person_headroom)` for each month, leaving any gap unfilled. This is the single primary quick-fill action.
- **"Match pattern"** — copies the shape of the requirement's target into this row, scaled to a user-chosen percentage (e.g. "this person covers 60% of each month"). Will never exceed the requirement's remaining headroom even at 100%. Person-capacity warnings still apply and require confirm-on-save.

**Previously specified "Full coverage" action is removed.** After the v1.8 hard-block on requirement over-allocation, Full Coverage and Fill Remaining behaved identically in almost all cases (both capped at requirement headroom). Users who deliberately want to over-commit a person can do so by typing the value directly — that's a conscious override, not a button.

**Two distinct over-allocation checks — different enforcement**:

The tool distinguishes between two kinds of over-allocation, and treats them differently:

1. **Requirement-level over-allocation** — the sum of all named allocations for a requirement-month exceeds the requirement's target hours for that month. This is treated as a **hard block**:
   - The per-month hours input for an allocation is **capped at input time**: the user cannot type a value greater than the requirement's remaining headroom for that month (target − sum of other allocations). If they try, the input clamps to the maximum permitted value and a brief inline hint explains why.
   - On **Save**, a final validation confirms no requirement-month is over-allocated. If any is (e.g. due to an edit sequence that worked around the input cap), the Save is blocked and the offending rows are highlighted with an error message.
   - This belt-and-braces approach keeps the allocation maths trustworthy: the sum of allocations for a requirement-month will always be ≤ the target.

2. **Person-level over-allocation** — a person's total committed hours across all their allocations (plus BAU) exceeds their contracted hours for that month. This is treated as a **soft warning**:
   - Inline warning on the allocation row with a visual signal.
   - On Save, if any person is over-capacity in any month, the user is shown a confirm dialog listing the affected person-months; they can proceed anyway (legitimate strategic over-commitment) or cancel to reduce.
   - No block — this is often a deliberate decision.

Saving in Mode B:
- Same explicit Save/Cancel pattern as Mode A. All allocation edits are held in form state until Save.
- Save flow: requirement-level over-allocation blocks the save entirely; person-level over-allocation prompts a confirm.
- After Save, the auto-transition rule evaluates the full coverage state and the status updates if warranted (Approved → Partially Allocated, or Partially Allocated → Allocated, or the reverse).

**Switching between modes**

The mode is determined by status and is not directly toggleable. Two paths exist for returning a demand to Mode A:

- From `Approved`: the **Revise** action — moves the demand directly back to `Submitted` without the Park detour. Existing allocations are preserved but ignored from capacity calculations while in Submitted. On re-Approval, they're re-validated against the (possibly edited) requirements and flagged if they no longer fit (e.g. the requirement's skill changed). This is the low-friction path for correcting demand definition issues that are discovered after approval but before allocation work has started in earnest.
- From `Partially Allocated` or `Allocated`: only the **Park → Revive** path. Because these statuses represent active allocation work against real capacity, direct-to-Submitted is not permitted — the Park step is deliberate friction that ensures the user consciously acknowledges they're pulling committed resource-naming.

Named allocations are **preserved** through both Revise and Park/Revive, so they reappear when the demand is re-approved.

**Validation (both modes)**:
- Block save on requirement-level over-allocation (see above).
- Warn (with confirm) on person-level over-allocation.
- Warn when an allocation is made to someone who doesn't hold the required skill at the required level.

**Save model — explicit save, applies to both modes**:
- All edits on this page are held in local form state.
- A prominent **Save** button commits changes to the store (and thence to localStorage).
- A **Cancel** button discards unsaved changes.
- Navigating away from the page with unsaved changes prompts the user to save or discard.
- Live recalculation on the Capacity Validation charts is preserved — once saved, charts react immediately.

#### 4.5.3 DOMAIN > SKILL selector (shared component)

A shared hierarchical selector used wherever a skill is picked:

- Demand edit page, when adding a skill-shaped requirement.
- Admin, when assigning skills to a person (section 5).
- Filters in Capacity Validation and Team Activity views.

Behaviour:
- Dropdown presents skills grouped under their parent domain. Domain names are shown as non-selectable group headers; only skills are selectable.
- Display format for a selected skill: "`MOM` > `MES Platform`" — both segments shown, with the domain in muted styling and the skill in primary text.
- Searchable — typing filters the visible skills by name with the domain remaining visible as context for each match.
- In admin person-skill assignment (and anywhere else multiple skills are picked), the selector supports multi-select — each selected skill appears as a chip with both the domain and skill visible, plus the level for admin person-skill context.

Implementation note: this is one component. Build it once and reuse everywhere a skill is picked. Without this discipline, the demand form, admin, and filters end up with three different skill pickers.

### 4.6 Demand discovery

Finding a specific demand item among many. Three switchable modes, default is **Board (Kanban)** — the state-machine flow is the primary mental model for the page. Active statuses only (Draft, Submitted, Approved, Partially Allocated, Allocated, Parked). Closed items appear in the Archive view, not here.

- **Board mode (default)**: kanban-style cards grouped by status across six columns in state-machine order: Draft / Submitted / Approved / Partially Allocated / Allocated / Parked. Drag between columns triggers the valid status transition. If a drag would be invalid (e.g. Approved → Draft) the drop is rejected with a tooltip explaining the constraint. Invalid drops should visually animate back to the source column. Cards show Project alignment as a small "Programme › Project" tag if set, or a subtle "Unaligned" indicator if not.
- **Table mode**: spreadsheet-style, sortable columns (name, type, status, primary domain, Programme, Project, owner, phase count, total committed hours, total external hours). Filterable. Best for bulk scanning.
- **Search mode**: full-text search across name, description, owner, phase names, and Programme/Project names. Best for "find one specific thing."

**Group-by-Programme/Project view** (new in v1.14)

In **Table mode**, a "Group by" control offers three grouping options: None (flat list, the default), Programme, or Project. When grouping is active:

- Rows are grouped under collapsible section headers. When grouping by Programme, headers are Programme names with Project-level sub-headers below. When grouping by Project, headers are "Programme › Project" strings with Demands listed under each. Unaligned Demands appear under a virtual "No Project" / "No Programme" group, visually distinct (e.g. italicised or muted header).
- Each group header shows a **roll-up summary block** to its right: internal hours total across the visible time horizon (sum of `project_internal_hours` or `programme_internal_hours` across the horizon), external hours total (sum of `project_external_hours` or equivalent), external breakdown by provider available on hover or click-to-expand, and a child Demand count.
- The Demand count in a group header respects any active status / domain / type filters — so a filter applied to the rows also constrains the count and the roll-up totals. This keeps the header number consistent with what the user sees below.
- Collapsing a group hides its Demand rows but leaves the summary header visible.

**Filters** (available across all modes):

- Status (multi-select), Type (multi-select), Primary Domain (multi-select) — existing.
- **Programme** (single-select, with "Any" as default) — new in v1.14. When a Programme is selected, only Demands aligned to that Programme's Projects are shown. Also affects Programme/Project grouping counts (the roll-up respects the filter).
- **Project** (single-select, dependent on the Programme filter — lists all Projects if Programme is "Any", or only the selected Programme's Projects if one is selected) — new in v1.14.
- **"Has external requirements"** toggle — new in v1.14. When enabled, filters the list to Demands with at least one external requirement. Useful for finding all the cross-team-dependent work quickly.

All filters compose — selecting Programme "MES Modernisation" + Type "Plant Project" + Has-external-requirements shows only Plant Projects within that Programme that have external resource needs. Filter state persists per-session.

Mode selection persists per-session. User preference is not stored long-term in v1.

### 4.7 Archive view

A dedicated page listing all demand items in status `Closed`. Reachable from the main navigation.

- Spreadsheet-style table (similar to Demand list Table mode).
- Columns include the status the item was closed *from*, and the date closed.
- Read-only per row, with a **Restore** action per item that returns it to the status it held before Close.
- Archive items are excluded from all other views (Demand list, Capacity Validation, Team Activity, Forecast) so Closed demand never affects operational numbers.

### 4.8 Skill detail view

The question this view answers: *For a specific skill, who holds it, how loaded are those people over time, and what demand is consuming the skill?*

Reached by clicking a skill chart on the Capacity Validation view (section 4 View 1). This is a dedicated page, not a modal or a drawer — the content is rich enough that a side panel would be cramped.

**Time axis** — all time-phased content on this page uses the **same horizon and month alignment as the parent Capacity Validation chart** the user clicked through from. If the user had the 12-month preset active, the skill detail page opens with the same 12-month window. The horizon preset selector is mirrored on this page so the user can widen or narrow independently.

**Page structure** — three sections, top to bottom:

**Section 1 — Skill header**
- Skill name and parent domain as a prominent header (e.g. "MI&V > Historian Configuration").
- Key summary numbers, each time-aware across the visible horizon:
  - Number of people who hold the skill (at any level), with a breakdown by level (e.g. "7 people: 2 Specialist · 3 Advanced · 2 Basic").
  - Peak demand hours in any visible month, with the month.
  - Peak utilisation of the skill pool in any visible month (demand / capacity as a percentage), with the month.
  - Projection shortfall indicator if the skill has any shortfall entries in the visible horizon (links to the corresponding over-capacity summary strip entry on the parent view).
- Back link to the parent Capacity Validation view.

**Section 2 — People who hold this skill**

One row per person who holds this skill (at any level), grouped by skill level (Specialist first, then Advanced, then Basic). Each row shows:

- Name and the level at which they hold *this* skill.
- Primary domain (as a small muted tag — useful context because a person may hold a skill outside their primary domain).
- **A month-by-month utilisation mini-heatmap**, one cell per month across the visible horizon. Each cell reflects the person's **total utilisation across all their commitments** (not just commitments drawing on this skill), colour-coded:
  - Green: ≤70% of contracted hours committed
  - Amber: 71–90% committed
  - Red: 91–100% committed
  - Dark red: >100% (over-allocated)
  - Grey diagonal stripes: outside the person's `available_from`/`available_to` window (cell is inactive).
- **Month-column headers** above the heatmap use a two-line stacked format: month abbreviation (MMM — "Jan", "Feb", etc.) on the upper line, two-digit year (YY — "26", "27") on the lower line. This saves horizontal space versus a single-line "Jan 26" label and keeps columns narrow enough that 12+ months fit comfortably across the page. The year row can be omitted where consecutive columns share a year to reduce clutter, but the first column of each year must always show both lines so year boundaries are obvious.
- Hovering a cell shows a tooltip with the full breakdown for that person-month: contracted hours, committed hours by work type (BAU / NPD Demand / Plant Project / Group Strategy Project), available hours remaining. This is the same breakdown as Team Activity (View 2) cell drill-down, because the underlying numbers are identical.
- Clicking a cell navigates to Team Activity filtered to that person and scrolled to that month — the user's next question after "is this person loaded?" is usually "what is loading them?" and Team Activity answers that directly.
- Summary numbers to the right of the heatmap, both computed across the visible horizon: **average headroom** (mean of `contracted − committed` across visible months, floored at zero per month) and **worst-month headroom** (minimum of the same across visible months), with the worst month labelled.

**Why total utilisation rather than this-skill utilisation**: the value of this page is answering "who could I call on for this skill?" — and that is determined by the person's overall availability, not by whether they happen to be committed on this specific skill today. Someone fully booked on MOM work is unavailable for MI&V Specialist work even if their MI&V allocation is currently zero. Showing total utilisation makes that immediately visible.

Sort controls on the people list: default sort is by skill level descending (Specialist first), then by average headroom across the horizon descending (most-available first within each level). The user can re-sort by name, worst-month headroom, or average headroom.

**Section 3 — Demand consuming this skill**

A **Gantt chart**, with the same visual styling as the phase timeline on the Demand edit page Mode A (section 4.5.2). One row per demand item with at least one requirement targeting this skill (at any level) within the visible horizon.

- **X-axis**: months, aligned with the heatmaps above (same horizon and month boundaries). Month labels use the same **two-line stacked format** as the people-heatmap column headers — MMM on the upper line, YY on the lower — so both visuals align column-for-column and read consistently.
- **Y-axis**: one row per demand item. Sorted by earliest requirement-start month ascending, then by status (Allocated > PartiallyAllocated > Approved > Submitted > Draft > Parked), then by name.
- **Bar span**: from the earliest month where the demand has a requirement for this skill, through the latest such month. For multi-phase demand items where phases with this-skill requirements are non-contiguous, render one bar per contiguous run (same demand item, multiple bars on the same row).
- **Bar colour**: by **demand type**, matching the universal demand-type colour coding used on the Capacity Validation stacks and Team Activity cells (Plant Project, Group Strategy Project, NPD Demand, BAU). This is consistent with Tim's direction that colour follows demand type on cross-demand views; funding-source colouring is only used on the within-one-demand phase Gantt in Mode A.
- **Bar label**: demand name, truncated with ellipsis if the bar is narrow. Status shown as a small pill/icon at the left end of the bar. A count of hours-per-month for this skill shown at the right end of the bar (or in the tooltip if the bar is narrow).
- **Hover a bar**: tooltip with demand name, type, status, phase(s) that touch this skill, total committed hours for this skill across the visible horizon.
- **Click a bar**: opens the demand drawer (section 4.5.1) for that item, with the contextual back link pointing back to this skill detail view rather than to the Demand list.

**Filter controls above the Gantt**:
- Status filter (multi-select) — toggles are displayed **in state-machine flow order**: Draft → Submitted → Approved → Partially Allocated → Allocated → Parked. This matches the Demand-page Kanban column order (section 4.6) so users build one mental model for status sequence across the app. Default selection shows Approved, Partially Allocated, Allocated. Users can enable Draft, Submitted, and/or Parked to see pipeline pressure. Never sort status toggles alphabetically — that breaks the process-flow mental model.
- Demand type filter (multi-select) — default all on.
- Skill level filter — "show demand requiring Specialist", "show demand requiring Advanced or higher", etc. Default: all levels.

**Vertical padding** on the Gantt — same rule as the Mode A phase Gantt: at least one bar-height of space above the topmost bar and below the bottommost bar, so rows do not collide with container edges or any horizontal scrollbar.

**What this view deliberately does *not* do**
- It does not show per-skill-level capacity as a separate chart. The earlier "specialist capacity sub-line" was removed in v1.10; level-based shortfalls are surfaced via the over-capacity summary strip on the parent Capacity Validation page. Level filtering on the Gantt (above) gives the user a way to narrow to level-specific demand without duplicating capacity lines.
- It does not include demand items with no requirement touching this skill in the visible horizon — those are irrelevant to the page's purpose.

All numbers on this page must be computed via the shared aggregation layer (section 2.4.8) — no inline summing. The people-heatmap cells read `real_committed_hours(person, month)` and `contracted_hours(person, month)`; the Gantt bars read requirement target hours for the specific skill; summary numbers in the header are derived from these.

---

## 5. Admin

All admin is open — anyone with access can edit any of the following. No permissions in v1.

- **Function** (view/edit only in v1). A single Function record "Digital Manufacturing" is pre-seeded. The admin screen shows name and description as editable fields. Add and delete are not available in v1 — the tool is single-function scope. The Function record is the root of the Domain taxonomy and the Team hierarchy; it is shown here for completeness and future extensibility.
- **Domains and Skills** (CRUD). Flat admin screens; domains and skills are simple named records. Each Domain belongs to the single Function (implicit in v1). Skills belong to a Domain.
- **Teams** (CRUD). Flat admin screen listing all Teams with name, parent Function (locked to "Digital Manufacturing" in v1), type (Plant / Central / Specialist / Other), lead (person picker, nullable), active flag, and a summary column showing member count. Soft-delete via the active flag — inactive Teams remain on their existing People but don't appear in pickers. Hard-delete is permitted only if the Team has no assigned People; the user is otherwise shown the list of blocking People and advised to reassign them first. **Function, Teams, and their People do not affect capacity calculations** — Team is an organisational label. Creating, renaming, or reassigning Teams never changes any chart, grey band, or projection shortfall.
- **People** (CRUD). Each person's screen shows: name, **Team** (required — dropdown of active Teams), contracted hours, `available_from` / `available_to`, active flag, and a **skill profile section** where skills are assigned. Primary Domain is not shown as an editable field — it is derived from the skill profile and displayed read-only. Existing People records without a Team assignment show an inline warning prompt in admin.
- **Programmes** (CRUD). Flat admin screen listing all Programmes with name, description, active flag, and a small summary column showing Project count and child Demand count. Soft-delete via the active flag — inactive Programmes remain on their existing Projects but don't appear in Demand alignment pickers. Hard-delete is permitted only if the Programme has no active Projects (and no Closed Projects that would orphan their Demands); the user is otherwise shown the list of blocking Projects and advised to reassign them first. See section 2.1.1 for the data model.
- **Projects** (CRUD). Flat admin screen listing all Projects with name, parent Programme, description, active flag, and a summary column showing child Demand count and rolled-up internal/external hours across the next 12 months (using `project_internal_hours` and `project_external_hours` summed across the 12-month window). Adding a Project requires selecting a Programme — either an existing one from a dropdown, or via an inline "+ Create new Programme…" entry in that dropdown (same pattern as the Demand's Project-alignment picker, section 4.5.2). Hard-delete is permitted only if the Project has no aligned Demands; the user is otherwise shown the list of blocking Demands and advised to reassign or unalign them first. Soft-delete via the active flag is always available — inactive Projects remain on their existing Demands but don't appear in pickers.
- **Providers** (CRUD). Flat admin screen listing all Providers with name and an in-use indicator (showing how many external requirements currently reference this Provider across all Demands). Name is required and unique. Renames cascade to all existing external requirements (section 2.6) — the requirement records reference the Provider by id, not by name, so a rename is a single-record update. Hard-delete is permitted only when the Provider's in-use count is zero; otherwise the user sees the blocking requirements list and is advised to reassign them to a different Provider (a bulk-reassign action is provided). Seed values: `Managed Services`, `Contractor`, `OEM`, `Plant Team`, `Other Internal Team`, `Other` — all pre-populated at seed time and editable thereafter.

**None of Functions, Teams, Programmes, Projects, or Providers affect capacity calculations.** They are admin-configured labels and organisational groupings. Creating, renaming, or reassigning them never changes any chart, grey band, projection shortfall, or person's committed hours. This is by design — it keeps the mental model of capacity clean while letting the user organise the pipeline and track external effort.

**BAU is not an admin concern** — see section 2.3. BAU is captured as demand items of type `BAU` in the main Demand list, not as admin records. There is no BAU admin area; any prior BAU admin pages must be removed.

**Skill profile on the Person admin screen**:

- Uses the shared **DOMAIN > SKILL selector** (section 4.5.3) for adding skills — showing Domain as group header and skill as the selectable item. The selector is scoped to the person's Function (via their Team). Flat lists of skills without Domain grouping are not acceptable; the selector gives users the same hierarchical mental model as the demand form.
- Each assigned skill appears as a row showing: Domain, skill name, and a level selector (Basic / Advanced / Specialist).
- Remove button per row.
- A person can hold skills across multiple Domains; nothing restricts them to any single Domain.

A simple admin area is otherwise sufficient — no need for sophisticated UX beyond the skill selector consistency.

---

## 6. Seed data

The tool should ship with seed data sufficient to demonstrate all four views. Suggested:

- **Domains**: MOM, MI&V, MBM (3 domains)
- **Skills per domain**: 4–6 skills each, covering realistic Digital Manufacturing capabilities
- **People**: ~12 people spread across domains, with varied skill profiles and levels. Include at least one with `available_from` set in the near future (new starter) and one with `available_to` set (planned leaver).
- **BAU Streams**: 4–6 streams across the domains, with varied allocation patterns including at least one declining stream (handoff to the business)
- **Demand Items**: at least 2 in each of the five statuses, with a mix of types, phases, funding sources, and both skill-shaped and named requirements. Include at least one cross-domain item and at least one item with a skill-shaped requirement split across two named people.
- **Programmes**: 2–3 Programmes. Suggested: "MES Modernisation" (covering Plant A/B/C MES work), "Digital Twin Rollout" (for Model-Based Manufacturing exemplars), and optionally a third for MI&V work. Programmes should be plausible real-world groupings of the seed's existing Demand items.
- **Projects**: 4–6 Projects across the Programmes. Each Programme should have at least 1 Project with multiple aligned Demands to demonstrate the roll-up. At least one Programme should have 2+ Projects to demonstrate the Programme > Project > Demand roll-up path. At least one seed Demand must remain **unaligned** (typically BAU or a small ad-hoc item) so the virtual "No Project" group renders in the grouped Demand view.
- **Function**: one record — "Digital Manufacturing". All Domains, Teams, and People belong to this Function.
- **Teams**: three Teams — "Central Delivery Team" (type: Central), "Plant Team A" (type: Plant), "Plant Team B" (type: Plant). All under Digital Manufacturing Function. Assign existing seed People to teams plausibly based on their skills and primary Domain — e.g. MOM Specialists to Plant Teams, MI&V and MBM people split across Central and Plant.
- **Domains**: MOM, MI&V, MBM (3 domains) — unchanged, now explicitly belonging to the Digital Manufacturing Function.
- **Skills per domain**: 4–6 skills each, covering realistic Digital Manufacturing capabilities
- **People**: ~12 people spread across domains, with varied skill profiles and levels. Include at least one with `available_from` set in the near future (new starter) and one with `available_to` set (planned leaver). Every person must have a `teamId` assigned.
- **BAU Streams**: 4–6 streams across the domains, with varied allocation patterns including at least one declining stream (handoff to the business)
- **Demand Items**: at least 2 in each status including the new **Scoping** status, with a mix of types, phases, funding sources, and both skill-shaped and named requirements. Include at least one cross-domain item and at least one item with a skill-shaped requirement split across two named people.
  - **Scoping seed item**: at least one demand item in Scoping status with two teams assigned to a phase via DemandTeamAssignment records — one team confirmed (`confirmed: true`) and one still pending (`confirmed: false`). This demonstrates the Scoping board column and the confirmation strip on cards. The pending team's phase should have no skill-shaped requirements yet (the team lead hasn't filled them in) — this is the realistic state during Scoping.
- **Programmes**: 2–3 Programmes. Suggested: "MES Modernisation" (covering Plant A/B/C MES work), "Digital Twin Rollout" (for Model-Based Manufacturing exemplars), and optionally a third for MI&V work. Programmes should be plausible real-world groupings of the seed's existing Demand items.
- **Projects**: 4–6 Projects across the Programmes. Each Programme should have at least 1 Project with multiple aligned Demands to demonstrate the roll-up. At least one Programme should have 2+ Projects to demonstrate the Programme > Project > Demand roll-up path. At least one seed Demand must remain **unaligned** (typically BAU or a small ad-hoc item) so the virtual "No Project" group renders in the grouped Demand view.
- **Providers**: pre-populated with `Managed Services`, `Contractor`, `OEM`, `Plant Team`, `Other Internal Team`, `Other`.
- **External resource requirements on Demands**: at least 3 of the seed Demand items must carry external requirements, spread across Providers. Suggested:
  - "Plant C MES Platform Migration" — add external `OEM` requirement (MES Platform Vendor Support, 40 hrs/mo on Build phase) and `Managed Services` requirement (SCADA Engineer, 120 hrs/mo on Build phase). This is the headline example — a real MES project with meaningful external dependencies.
  - "Corporate Data Lake" (Submitted) — add `Contractor` requirement (Data Engineer, 80 hrs/mo) on its main phase. Demonstrates external effort on a Submitted item rolling up into Programme/Project totals before approval.
  - One BAU item with a small `Other Internal Team` requirement (e.g. 10 hrs/mo indefinite for plant electrician support). Demonstrates the indefinite-phase external-requirement path.
- **Seed assertion — Programme/Project roll-up visibility**: loading the seed fresh and grouping the Demand list by Project must produce at least one group with non-zero internal hours *and* non-zero external hours in the current 12-month window, with the external breakdown showing 2+ distinct providers. This is the equivalent renderability invariant for the Programme/Project roll-up (mirror of the v1.12 grey-band renderability invariant in section 2.4.8).
- **Seed assertion — Scoping column visible**: loading the seed fresh and opening Board mode must show the Scoping column with at least one card, and that card must show a mixed confirmation strip (one green chip, one amber chip).

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

The Capacity Validation view in v1 uses a **Submitted overlay** to answer "what can we absorb from the Submitted queue?". Scenario modelling is a fundamentally different feature for a fundamentally different question: *"Given what we've already committed to, what if we re-arranged it?"*

Where the overlay is additive and view-only, scenario modelling is **mutative** — it changes things that have already been said yes to. A typical scenario workflow:

- Pull an Accepted project's start date two months earlier
- Swap Sarah for Chris on Phase 2 of another project
- See the combined impact across the team before committing the change

V2 will introduce:

- **Named scenarios** — saveable sets of proposed changes to committed demand (date shifts, re-allocations, reassignments), separate from the live plan.
- **Multi-item scenarios** — a scenario can move multiple demand items simultaneously so knock-on effects are visible together.
- **Scenario comparison** — view live plan vs scenario side-by-side on the same charts.
- **Commit/discard** — promote a scenario back into the live plan, or discard.
- **Scenario-mode UI** — likely a toggle on the Capacity Validation view that puts it into a sandbox state where edits affect the scenario rather than live data.

**V1 implication**: Phase dates and resource allocations must be cleanly editable in-place through the Demand Item Editor, and the capacity view must recalculate live from the underlying data. This gives users a clunky but functional "what-if" workflow today (edit → look → undo if needed) and sets up v2 scenarios as a data-layer branch without architectural rework. Claude Code should not build any scenario-specific UI or data structures in v1.

### 8.2 Approval workflow

The current Draft → Submitted → Accepted → Allocated flow is manual and unrestricted in v1. V2 will introduce:

- Role-based gating of status transitions.
- Designated reviewers per domain.
- Audit trail of status changes, including over-allocation acknowledgements.

### 8.3 Funding budget tracking

V2 may introduce scheme-level budget tracking: "Scheme X has 2000 hours, 1400 committed, 600 remaining." V1 captures funding source on phases, which provides the data foundation for this without building the feature.

### 8.4 Actuals reconciliation

Actual time is recorded in SAP. V2 may ingest a periodic actuals feed to compare against forecast. Not in scope for v1.

### 8.5 Permissions

All edit access is open in v1. V2 will introduce authentication and role-based permissions (Domain Lead, Resource Manager, PMO, read-only).

---

## 9. Build sequencing

Suggested order for the v1 build (original ordering). **v1.14 additions are listed separately below — they slot into an already-built app and follow a different critical-path ordering.**

1. **Data model and admin** — domains, skills, people (inc. available_from/to), BAU streams, BAU allocations. Populated via seed data and simple admin screens. Includes the **DOMAIN > SKILL selector** as a shared component used in admin and elsewhere.
2. **Demand items and phases** — CRUD for demand items with phases and skill-shaped requirements (per-month hours). Mode A of the edit page. Drawer (read-only preview).
3. **State machine and status transitions** — the gated workflow from section 3. Apply to Table, Board, Drawer, and Edit page consistently.
4. **Mode B — Allocation Workspace** — named allocations, per-requirement coverage indicators, auto-transitions between Approved / PartiallyAllocated / Allocated.
5. **Archive view** — for Closed items, with Restore.
6. **View 1: Capacity Validation** — the core value of the tool. Build this against live data.
7. **View 2: Team Activity** — secondary MVP view.
8. **Demand discovery** — Table mode first, then Board (with valid-transition drag constraints) and Search.
9. **Post-MVP**: View 3 then View 4.

Views 3 and 4 should not be started until 1 and 2 have been in active use for long enough to validate the data model and uncover real workflow patterns.

### v1.14 — build order for the three major updates

These are slotted into an app that's already at v1.13. The order below respects dependencies — data model and admin first, then UI surfaces that depend on them.

1. **Data model additions** (no UI yet):
   - Add `Programme` and `Project` entities to the store with active flags, following the lightweight schema in section 2.1.1.
   - Add `project_id` (nullable) to the Demand Item schema.
   - Add `Provider` entity to the store.
   - Add `ExternalResourceRequirement` entity attached to Phase, following section 2.6 — mirrors the internal-requirement hours-representation pattern (`hours_by_month` for finite, `steady_state_hours` for indefinite).
   - Update seed to include Programmes (2–3), Projects (4–6), Providers (pre-populated list), Project alignments on existing seed Demands, and at least 3 Demands with external requirements per section 6.
2. **Aggregation layer additions** (section 2.4.9):
   - Implement the 9 named Programme/Project roll-up functions. They sit alongside the existing 8 aggregation functions from section 2.4.8 in the same shared module.
   - Add the renderability invariant assertions: grouped-by-Project view on fresh seed must produce at least one group with non-zero internal and external hours in the 12-month horizon, with 2+ distinct providers in the external breakdown.
   - No view changes yet — run the invariants as dev-mode assertions to prove the aggregation works before wiring any UI to it.
3. **Admin surfaces** (section 5):
   - Add Programmes, Projects, Providers admin screens. Flat CRUD, following the pattern of the existing Domains/Skills/People admin surfaces.
   - Implement the cascade / hard-delete / soft-delete rules per section 5.
4. **Drawer button restructure** (section 4.5.1) — **this is a breaking change to the drawer and should land as its own PR**:
   - Edit button moves to top-right alongside the overflow menu.
   - Status zone demoted to pure info (no buttons).
   - Footer rewritten per the status-by-status table: status-specific right-aligned primary CTAs, right-to-left ordering, empty footer on Allocated.
   - Overflow menu contents redistributed per the new table.
   - New **Allocate** button on Approved / PartiallyAllocated — navigates to edit page in Mode B.
   - Update section 11.3 — Status transitions UI listing — to reflect the new surfaces.
5. **Demand edit page — Mode A additions** (section 4.5.2):
   - Project alignment picker with inline "+ Create new Project…" / "+ Create new Programme…" entries.
   - External Resource Requirements sub-section within each phase card, below internal requirements.
   - Provider dropdown reads from the admin-configured list; empty-state links to the Provider admin screen.
6. **Demand edit page — Mode B additions** (section 4.5.2):
   - Project alignment displayed and editable (even in Approved / PartiallyAllocated / Allocated).
   - External requirements shown read-only within each phase card.
7. **Demand drawer body updates** (section 4.5.1):
   - Project alignment block with inline re-align affordance.
   - External requirements summary in the body zone and in phase summaries.
8. **Demand discovery enhancements** (section 4.6):
   - Table mode Group-by-Programme/Project with roll-up summary headers.
   - Programme / Project / Has-external-requirements filters across all modes.
   - Board mode: Programme › Project tag on cards.
9. **Capacity Validation filter** (section 4 View 1):
   - Programme / Project filter in the toolbar.
   - Apply the filter to the overlay picker so only in-scope Submitted items are eligible.
   - Ensure the filter affects demand stacks only, not capacity lines or grey bands (semantics clarified in the info tooltip).

**Testable after each step**: don't bundle steps 1–9 into a single commit. Each step has a user-observable outcome that should land and be smoke-tested before the next step builds on top.

---

## 10. Open questions and assumptions

The following are flagged. Assumptions are explicit so they can be challenged before or during build.

- **Scenario mechanics (v2)**: when a scenario shifts a project, does only the phase date move, or do named allocations and/or skill requirements move with it? Does a scenario affect one demand item or many? Does not need answering for v1 but should be resolved before v2 planning.
- **BAU at domain level** (assumption): all BAU is per-person; there are no domain-level BAU streams. Stream name provides the roll-up view.
- **Phase name autocomplete source** (assumption): suggestions come from phase names used on the last N demand items, not a fixed master list. No admin burden.

---

## 11. Interpretation guidance for Claude Code

Where the spec leaves room for interpretation, these are the resolutions to take. Not new requirements — just "when you hit a fork, take this path."

### 11.1 Click behaviour on Capacity Validation charts

The Capacity Validation view is chart-based, not grid-based. Click behaviour is hierarchical:

- Clicking a **domain chart** opens the skill breakdown for that domain (switches section B into Skill mode filtered to that domain).
- Clicking a **skill chart** opens the Skill detail view (section 4.8) — a dedicated page showing the people who hold the skill with their time-phased utilisation, and a Gantt of the demand items consuming the skill.
- Clicking a **stacked demand segment** (any work type layer in any chart) opens a side panel listing the demand items contributing to that segment, each deep-linking into the **Demand Item drawer** (section 4.5.1 — read-only preview). From the drawer, the user can click "Edit" to open the full edit page.
- Clicking anywhere else on a chart opens a tooltip showing exact numbers for that month: capacity line, committed demand by work type, overlay demand if active, and grey band total (with breakdown available via hover on the band itself).

### 11.2 Selecting an overlay

The overlay selector in the toolbar is a **single-selection** pattern. The user clicks a "Set overlay" combobox which lists all demand items in `Submitted` status, searchable by name. Selecting one sets it as the single active overlay, replacing any previously-selected item. A "Clear overlay" button (or the × on the chip) removes the overlay. Only Submitted items are eligible — items in other statuses are not offered.

If the user arrives via "Model Impact" from a demand drawer, the overlay is pre-populated with that item; the user can clear it or change it using the same combobox.

### 11.3 Status transitions

Status transitions are available from:

- The **drawer** (read-only preview) — distributed across three surfaces in v1.14 per section 4.5.1: the **footer** carries the status-appropriate primary-CTA transition(s), the **overflow menu** (top-right kebab) carries the valid-but-uncommon transitions, and the **top-right Edit button** opens the edit page where the same transitions are also available. The status zone itself no longer carries action buttons.
- The **edit page** — transition buttons in the page header or footer, since the user may change status as part of an editing session.
- The **Board discovery mode** — drag-and-drop between columns, as per 4.6.

The transitions available depend on the current status. See section 3 for the complete state machine. See section 4.5.1 for the exact drawer footer / overflow split by status.

User-driven transitions exposed in the UI (summary — authoritative placement is in section 4.5.1):

- **From Draft**: `Submit` (footer primary); `Duplicate`, `Delete` (overflow).
- **From Submitted**: `Approve`, `Model Impact`, `Revert to Draft`, `Park` (footer — right-to-left in that order, Approve is the rightmost primary); `Duplicate`, `Delete` (overflow).
- **From Approved**: `Allocate` (footer primary — opens edit page in Mode B); `Revise`, `Park`, `Close`, `Duplicate`, `Delete` (overflow).
- **From Partially Allocated**: `Allocate` (footer primary); `Park`, `Close`, `Duplicate`, `Delete` (overflow).
- **From Allocated**: *(no footer button)*; `Park`, `Close`, `Duplicate`, `Delete` (overflow). Edit remains available at top-right.
- **From Parked**: `Revive` (footer primary — always to Submitted); `Duplicate`, `Delete` (overflow).
- **From Closed** (Archive view only): `Restore` (footer primary); `Duplicate`, `Delete` (overflow).

**Allocate is a navigational button, not a status transition.** It opens the edit page in Mode B. Its presence as a footer primary on Approved / PartiallyAllocated reflects that "start/continue allocating people" is the overwhelmingly common next action at those lifecycle points. Clicking it does not change the Demand's status.

**Model Impact is a cross-view navigation**, not a status transition. It opens the Capacity Validation view with this Demand pre-selected as the overlay (section 11.11).

Status changes take effect immediately on click (they do not require the explicit save that applies to field edits on the edit page). The navigational buttons (Allocate, Model Impact, Edit) also apply immediately — they just navigate rather than mutating status.

Auto-transitions (no button, system-driven — see section 3 for full rules):
- Approved → Partially Allocated: when the first named allocation is saved.
- Partially Allocated → Allocated: when all requirement-months are fully covered.
- Allocated → Partially Allocated: when coverage drops below 100% on any requirement-month due to allocation edits.

**Label convention**: the internal enum value is `PartiallyAllocated` (a single PascalCase identifier, consistent with the other enum values). The displayed label in all UI surfaces is **"Partially Allocated"** with a space. Do not split the enum value itself; only the display string is spaced.

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

**The seed is intentionally mixed — realistic in most places, deliberately constrained in specific places** — so v1.10's new visual signals have exemplars to render. Specifically, by selecting the right overlays and viewing the right months, a tester can produce every one of the following states:

- **Person-level over-allocation** — at least one person-month in the seed has committed allocations exceeding the person's contracted hours. The Team Activity view's light red cell-background tint should be visible on this cell on first load. (Check Priya Kumar, Jun–Aug 2026.)
- **Overlay-induced domain over-capacity** — selecting certain Submitted items as the overlay tips a domain chart over capacity. (Check any of the Submitted MOM items in Jun–Aug 2026.)
- **Projection shortfall** — overlaying one Submitted item combined with existing Approved-unallocated work produces a skill whose unallocated demand exceeds eligible real headroom. (Check MI&V Specialist with the "Corporate Data Lake" Submitted overlay.)
- **Meaningful grey band from baseline unallocated work** — the Approved-unallocated "Plant C MES Platform Migration" projects onto MOM Specialist-holders even before any overlay is selected, producing a visible grey band on MOM charts in Jun–Aug 2026.
- **Cross-project same-person allocation overlap** — Fatima Al-Rashid is allocated to two separate MI&V demand items with overlapping months (dmd_004 and stress_005). Opening either one's allocation workspace must show a capacity-preview strip reflecting the other's consumption. This directly tests the store-wide headroom formula.
- **Comfortable capacity** — MBM domain has light demand across the whole horizon, demonstrating the charts' behaviour when nothing is constrained.

If any of these states fails to render visibly after wiring up the v1.10 features, something in the aggregation layer is wrong — the seed is designed specifically to trigger them.

### 11.9 Colour and visual styling

The mockup provided (`CapacityValidation_mockup.html`) shows **layout and interaction intent only**. All colours, typography, spacing, borders, shadows, and component styling must come from `DESIGNSYSTEM.md` in the repository root. If the design system conflicts with the mockup's visual choices, the design system wins.

### 11.10 "Live recalc" — scope and meaning

Live recalculation applies to the **Capacity Validation charts**, not to the Demand Item edit page. These are two different things:

**Demand Item edit page** — explicit save, not live:
- Edits are held in local form state while the user is working.
- On Save, changes are committed to the Zustand store (and persisted to localStorage).
- On Cancel, changes are discarded.
- There is no auto-save, no debounced write from the form, no "saving..." indicator.

**Capacity Validation charts** — live recalc:
- Once data has been committed to the store (via a Demand edit save, a status change, a BAU edit, or a People admin edit), the charts react immediately.
- Selectors are pure functions over store state; re-renders happen within one frame (~16ms).
- Persistence to localStorage is debounced at the store layer (~500ms) — but this is invisible to the UI; the store is the source of truth and views read from it synchronously.

This distinction fixes the v1.5 build problem where per-field auto-save on the demand form was appending rows on every keystroke. Explicit save on forms, live rendering from the store.

### 11.11 Model Impact deep-link and return

The "Model Impact" action on a Submitted demand's drawer (section 4.5.1) is a cross-view navigation pattern. Implementation expectations:

- Clicking **Model Impact** navigates to the Capacity Validation route with a URL parameter identifying the originating demand item (e.g. `#/capacity?overlay=dmd_005&from=demand`).
- On arrival, the overlay store is initialised with that single demand item pre-selected.
- A dismissable banner is rendered above the page content: "Modelling impact of *{demand name}*. **Back to demand** · ✕". The banner is fixed at the top of the scrollable page region.
- **Back to demand** navigates back to the originating route (the Demand list) and re-opens the drawer on the same demand item.
- Dismissing the banner (✕) removes the banner only. The overlay stays selected, the user continues using Capacity Validation normally.
- If the user adds or removes other overlays while the banner is visible, the banner remains (it's about provenance, not overlay state) until they either click Back or dismiss.
- If the user navigates away from Capacity Validation via any other route (main nav, etc.), the banner is gone and "Back to demand" context is lost. This is fine — they're free to re-enter via the drawer again.

Implementation note: use the router's query params (via `HashRouter`) to carry the overlay-on-load state. Don't introduce a separate "Model Impact mode" — it's just a normal Capacity Validation page with pre-selected overlay and a contextual banner.

### 11.12 Indefinite phase UI — end-date toggle

In the Demand edit page (Mode A), the end-date input for each phase is the trigger that switches between finite and indefinite UI:

- A **"No end date (indefinite)"** checkbox sits next to the end-month input.
- Checking it clears the end-month input, hides the per-month hours grid for all requirements in that phase, and shows a single "Hours per month (indefinite)" input per requirement.
- Unchecking it prompts for an end month; the requirements' per-month grids are regenerated from `start_month` to the new `end_month`, pre-filled with the current `steady_state_hours` value for every month.
- The toggle is per-phase — a demand item can have finite phases and indefinite phases side-by-side.

The allocation workspace (Mode B) mirrors this:
- Finite phase → per-month coverage strip and per-month allocation grid, as before.
- Indefinite phase → a single "Hours per month" target; allocation rows show a single hours value per person; the coverage indicator shows a single cell (green / amber / red).

### 11.13 Capacity model refactor — building the shared aggregation layer

Section 2.4 specifies a substantial rework of how capacity and demand are computed across the tool. This is a cross-cutting refactor with strong correctness implications — it must be done carefully and in the right order.

**Build the aggregation layer first, views second**

Before any view is updated to use the new model:

1. **Identify every place in the current codebase that reads capacity or demand numbers** — chart data generators, overlay renderers, drawer summary computations, Team Activity cell builders, over-capacity summary strip, allocation workspace's capacity-preview strip, the person picker's summary capacity, validation checks. Any place that loops over phases/requirements/allocations or that computes "how much demand is there" or "how much capacity is free."

2. **Create a single aggregation module** (e.g. `src/lib/capacity.ts` or `src/selectors/capacity.ts`) that implements the eight named functions required by section 2.4.8:
   - `person_capacity(person_id, month)` → number
   - `real_committed_hours(person_id, month)` → number
   - `domain_capacity(domain_id, month)` → number
   - `skill_capacity(skill_id, month)` → number
   - `demand_hours_for(target, status_filter, month)` → number, where `target` is a domain, skill, or "overall"
   - `projected_consumption(person_id, month)` → number — the sum of projected hours onto this person from all unallocated demand
   - `grey_band(target, month)` → number — the chart's grey band height for a given domain/skill in a given month
   - `projection_shortfalls()` → a list of shortfall records keyed by (skill, month)

   All of these must be **pure functions of the full store**. No hidden state, no memoisation-across-store-changes that risks staleness.

3. **Replace every inline summation in the views** with a call to the appropriate aggregation function. No view should do its own reduce-over-requirements or sum-over-allocations.

**Then wire up views in this order**:

4. Capacity Validation charts — capacity lines, demand stacks, grey bands, over-capacity signals.
5. Over-capacity summary strip — over-capacity, over-capacity-with-overlay, projection shortfalls (three distinct signal types).
6. Team Activity — cell segments read from the aggregation layer, including per-person BAU/NPD/Plant/Strategy/Available segmentation.
7. Allocation workspace — capacity-preview strip, person picker summary.
8. Demand drawer summary — total hours rollups.

**Testable invariants — verify these work before moving on**

These are not optional — they're the difference between a tool the PMO can trust and one they can't:

- **Invariant A (Submitted == Approved-unallocated)**: take any Submitted demand item; hypothetically toggle its status to Approved (in memory, without saving); compare the contribution to every chart's demand stack, grey band, and capacity line. The numbers must be identical. Because the projection algorithm (section 2.4.5) treats Submitted overlay and Approved-unallocated demand the same way, a status change with no allocations must produce identical visuals.

- **Invariant B (allocation conservation)**: for any person in any month, `real_committed_hours(P, M) + projected_consumption(P, M) + remaining_headroom(P, M) ≤ contracted_hours(P, M)`, with equality when the projection exhausts available capacity. Projected consumption must never exceed the headroom the projection had to work with.

- **Invariant C (shortfall surfacing)**: if a skill's unallocated demand collectively exceeds eligible headroom in some month, a projection shortfall must be surfaced on the over-capacity summary strip. There must be no "silent" shortfalls — every case where the projection algorithm couldn't place all the hours must be visible.

- **Invariant D (no double-counting)**: the demand that is *for* a chart's domain/skill shows on the demand stack only, never in the grey band. The demand *against other* domains/skills that would consume the same people shows in the grey band only, never on the demand stack.

These invariants should be checkable at runtime during development — ideally with a debug overlay or an assertion function that can be turned on. In production they should hold by construction.

**Specific scenarios to verify**

Beyond the invariants, manually check these:

- Indefinite phases — the `steady_state_hours` path must be read correctly by both capacity and projection logic.
- BAU-type demand items — BAU was a separate entity pre-v1.7; ensure no legacy code paths handle BAU allocations differently from project allocations.
- Items just after a status transition — stale memoisation could make an item briefly appear in both overlay and committed buckets. Recompute from the store state, don't cache across transitions.
- Multi-phase demand — a demand item with phases across different domains should correctly contribute demand to multiple charts.
- Cross-phase person allocation — a person allocated to multiple phases (potentially overlapping months) must have their real_committed_hours correctly aggregated across all phases.

**Do not skip the audit step**. The value of this refactor comes from single-source aggregation. If two call sites keep their own summation logic, the bug comes back in a different form.

### 11.14 Programme / Project / Provider creation flow

Three creation paths, chosen by context:

**Full admin creation** — the standalone admin screens for Programmes, Projects, and Providers (section 5). Used when the user is doing a batch of setup work: adding several Programmes at once, tidying the Provider list, etc.

**Inline creation from the Demand Project-alignment picker** — used mid-flow when aligning a Demand. The picker's dropdown always shows a persistent "+ Create new Project…" entry at the bottom. Selecting it opens a small inline form with: Project name (required), Programme picker (required, with its own "+ Create new Programme…" entry at the bottom of its own dropdown), optional description. On submit, the record(s) are created in the store, the new Project is immediately selected as the Demand's alignment, and the user is returned to where they were with no page navigation. On cancel, nothing is created and the original picker state is restored.

**Inline creation from the Provider dropdown** — when adding an external requirement and the admin list is empty, the form surfaces a link to the Provider admin screen. The dropdown itself does not offer inline Provider creation — Providers are a shared taxonomy that should be curated centrally, not created ad-hoc by every user adding a requirement. This is a deliberate asymmetry with Project/Programme inline creation: Projects are intrinsically tied to specific Demands and it's reasonable to create them in flow; Providers are reference data and should be controlled.

**Naming collision handling**: on creation, a uniqueness check is applied (Programme names globally unique; Project names unique within their parent Programme; Provider names globally unique). Collisions show an inline validation error on the name field and block submission. Case-insensitive matching — "Managed Services" collides with "managed services."

### 11.15 External requirement editing and validation rules

External requirements follow the same "locked once committed" discipline as internal skill-shaped requirements, but with their own specifics:

- **Editable in Mode A** (Draft, Submitted, Parked) — add, remove, edit provider/role/notes/hours.
- **Read-only in Mode B** (Approved, PartiallyAllocated, Allocated) — same locking as internal requirements (section 3 Allocation editing). To edit, the user must Park-and-revive (or use Revise from Approved).
- **No allocation layer** — external requirements never have a Mode B workspace. They're demand-shaped only (section 2.6). Mode B simply renders them read-only alongside the internal allocation workspace.
- **Validation on save** (Mode A):
  - Provider is required (must be selected from the admin-configured list).
  - Role is required (free text, min 1 character after trim).
  - Hours values are required for every month in the phase's range (finite) or a single steady-state value (indefinite), non-negative, no upper bound enforced. Zero-hour months are permitted for ramp-up/ramp-down shapes — they're valid data, not a validation error.
  - No cross-requirement validation (unlike internal requirements, there's no "over-allocation" to check — external requirements don't interact).
- **Delete is immediate** (in Mode A) — no confirmation required unless the requirement has non-zero hours in any month, in which case a lightweight "Delete external requirement for *{Provider}* — *{Role}*? This will remove {X} total hours across the phase." confirmation is shown.
- **Provider rename cascade**: if a Provider is renamed in admin, all existing external requirements referencing that Provider show the new name immediately. No data migration needed — requirements store the Provider's id, not its name.
- **Provider delete handling**: hard-delete of a Provider is blocked if any external requirement references it (section 5). The bulk-reassign action lets the user pick a replacement Provider for all affected requirements in one operation. Soft-delete (via admin's active flag) is always available — the Provider disappears from future pickers but existing requirements keep their reference unchanged.

### 11.16 Drawer button behaviours — navigational vs transitional

The v1.14 drawer footer contains a mix of button types. Claude Code should treat them correctly:

- **Transitional buttons** (Submit, Approve, Revert to Draft, Park, Revive, Restore): change the Demand's status in the store and re-render the drawer with the new status's footer/overflow contents. No navigation. The drawer stays open; the user can observe the status pill change and the footer/overflow contents update in place.
- **Navigational buttons** (Allocate, Model Impact, Edit): navigate to a different route. Allocate and Edit both open the edit page — Edit opens it in whatever mode applies to the current status (Mode A for Draft/Submitted/Parked, Mode B for Approved/PartiallyAllocated/Allocated); Allocate opens it in Mode B regardless (it's only surfaced on Approved/PartiallyAllocated, so Mode B is always the right mode). Model Impact opens the Capacity Validation view with the current Demand pre-selected as the overlay (section 11.11).
- **Overflow destructive buttons** (Close, Delete): require confirmation dialogs. Close is confirm-only ("This Demand will be archived. Restore from the Archive view if needed.") — no further friction. Delete is a harder confirm ("This permanently removes the Demand from the store. This cannot be undone.") requiring the user to type the Demand's name or tick an "I understand" checkbox, per DESIGNSYSTEM.md's destructive-action patterns.
- **Overflow duplicate** (Duplicate): immediate, no confirmation. Per section 3 Duplicate behaviour, creates a new Draft copy. After creation, the drawer updates to show the newly-created duplicate (navigating within the drawer), not the original — the user's next action is almost always to edit the duplicate, so surfacing it immediately is the right default.

The **top-right Edit button** behaves identically to the overflow "Edit" would have — same Mode A/B routing logic based on current status. It is not a transition; it's navigation.

---

## Changelog

**v1.15** (this revision): **Six changes: Function/Team data model; Scoping status; Domain rename; Primary Domain auto-derived; drawer header fixes; External Resource Demand chart; Fill All on external requirements.**

Function and Team entities (sections 2.1, 5, 6):

- **Function entity added** as the root of both the skill taxonomy (owns Domains) and the organisational structure (owns Teams). A single "Digital Manufacturing" Function is pre-seeded in v1. The model is explicitly designed for multi-function extensibility — adding a second Function requires no structural changes.
- **Team entity added** — belongs to a Function, typed (Plant / Central / Specialist / Other), has an optional lead and active flag. Hard-delete blocked if Team has assigned People; soft-delete always available.
- **Person gains `teamId`** (required going forward). Every person belongs to exactly one Team, transitively belonging to one Function.
- **Skill profile scoping rule**: when assigning skills to a person in admin, the DOMAIN > SKILL selector is scoped to the person's Function. Cross-Function skill assignment is not permitted.
- **Admin updated**: Function (view/edit only), Teams (full CRUD), People updated to require Team assignment. Skill profile DOMAIN > SKILL selector replaces the previous DOMAIN > SKILL label.
- **Seed updated**: one Function, three Teams (Central Delivery Team, Plant Team A, Plant Team B), all existing seed people assigned to teams.

Scoping status (sections 3, 4.5.1, 4.5.2, 4.6, 6, 11.3):

- **New `Scoping` status** inserted between Draft and Submitted. Demand owner defines gross shape (phases, team assignments, rough description) and submits for team input. Assigned Team Leads fill in skill-shaped requirements for their phases and confirm. Demand auto-advances to Submitted when all `DemandTeamAssignment` records are confirmed.
- **`DemandTeamAssignment` join entity added**: `{demandId, phaseId, teamId, confirmed, confirmedBy, confirmedAt}`. Either the demand owner or team lead can change team assignments during Scoping — collaborative at this stage. Changing an assignment resets `confirmed = false` for that phase only.
- **Scoping is a full status** — can be Closed directly and restored from Archive, unlike Draft and Submitted. Capacity impact: none (excluded from all capacity calculations, same as Draft).
- **Board mode gains a Scoping column** between Draft and Submitted. Cards show a confirmation strip: one chip per assigned team, green if confirmed, amber if pending.
- **Mode A in Scoping**: phase cards show a Teams assigned multi-select. Team leads see only their team's requirement rows as editable; other teams' rows are read-only. A "Confirm requirements for [Team Name]" button per phase sets `DemandTeamAssignment.confirmed = true` for that team+phase.
- **Drawer footer for Scoping**: Revert to Draft, Park as secondaries; no forward primary (advance is automatic). Overflow: Close, Duplicate, Delete.
- **Seed**: at least one Scoping demand item with two teams assigned, one confirmed and one pending.

Capacity Validation — Team scope filter and External Resource chart (sections 4 View 1):

- **Team filter added to toolbar** (single-select, "All Teams" default). When a Team is selected: each Domain/skill chart gains a dashed secondary capacity line showing that team's contribution to the pool; a tint on the demand stack highlights requirements owned by that team. Full-pool solid line unchanged. Composes with the Programme/Project filter.
- **Section C — External Resource Demand** added (toggled off by default via "Show external resource" toolbar control). Two sub-sections: (1) overview stacked area chart of total external hours by Provider across the visible horizon; (2) per-Provider breakdown charts stacked by Demand item. No capacity line, no grey band, no projection — explicitly labelled as planning visibility only. Reads from existing `project_external_hours_by_provider` aggregation functions. Programme/Project filter applies; Team filter does not.

Team Activity — Team grouping (section 4 View 2):

- **Group by toggle added**: Domain (existing default) ↔ Team (new). Team grouping shows a rolled-up team summary bar per group header. Cross-team allocation signal: segments for requirements owned by a different team get a thin contrasting border with hover tooltip.

Domain rename — Theme → Domain (throughout):

- **All mentions of "Theme" / "Themes" renamed to "Domain" / "Domains"** throughout the spec and codebase. Rationale: "Theme" is an internal grouping concept specific to Digital Manufacturing; "Domain" is a more neutral and universally understood term that works across Functions. This is a pure terminology rename — no logic, calculation, or data structure changes. Aggregation function `theme_capacity` → `domain_capacity`; `theme_id` → `domain_id`; selector label "DOMAIN > SKILL" → "DOMAIN > SKILL"; all UI strings updated accordingly.

Primary Domain — auto-derived (sections 2.2, 4.5.1, 4.5.2, 3):

- **Primary Domain removed from demand entry form entirely.** It is no longer a manually entered field.
- **Primary Domain is now auto-derived** at render time as the Domain with the greatest total target hours across all requirements in all phases. Displays as "Unassigned" when no requirements exist. Shown read-only in the drawer body zone, Table mode column (with subtle auto-derived styling), and Team Activity person rows. Never manually editable anywhere in the app.
- **Duplicate behaviour updated**: Primary Domain is not copied — it is re-derived from the duplicated requirements.
- **Locked-fields list updated**: Primary Domain removed from the list of fields locked in Approved/PartiallyAllocated/Allocated — it cannot be edited in any status since it is derived.

Drawer header fixes (section 4.5.1):

- **Programme › Project label appears exactly once** in the drawer header — third row of left-side header text (below name, below Type badge). The second occurrence previously appearing in the body zone below the internal hours total is removed.
- **Unaligned label**: when no Project alignment is set, shows "Unaligned — Not Associated To A Project" in muted italic text. Truncates to "Unaligned" at narrow widths below ~320px.
- **Primary Domain removed from header zone** — it now appears only in the body zone as a read-only derived field.

External requirements — Fill All button (section 4.5.2):

- **"Fill all" button added to external requirement rows** in Mode A, matching the existing behaviour on internal requirement rows. Sets every month cell in the row to a uniform value. Applies to finite phases only (indefinite phases have a single input; Fill all is not shown there).

No changes to the projection algorithm (section 2.4.5), the eight core aggregation functions (section 2.4.8), the Programme/Project roll-up functions (section 2.4.9), or any existing visual treatment on charts.

**v1.14**: **Three major updates: drawer button layout rework; Programme › Project › Demand hierarchy; external resource requirements. One data model addition, one aggregation layer addition, substantial UI change on the drawer.**

Drawer button layout rework (section 4.5.1 rewritten):

- **Edit button moved to top-right** of the header zone, alongside the overflow kebab menu and close button. Edit is now a mental-model constant — always present, always primary styling, always opens the full edit page regardless of status.
- **Status zone demoted to pure info** — no longer holds transition buttons. Just the status pill and any informational badges (e.g. "Partially Allocated · 68% covered"). All actions moved to either the top-right (Edit, overflow) or the footer.
- **Footer rewritten with status-specific right-aligned primaries in right-to-left order**:
  - Draft: **Submit**
  - Submitted: **Approve**, Model Impact, Revert to Draft, Park
  - Approved: **Allocate** (new navigational button — opens edit page in Mode B directly)
  - PartiallyAllocated: **Allocate**
  - Allocated: *(empty footer)*
  - Parked: **Revive**
  - Closed: **Restore**
- **Overflow menu (top-right kebab)** redistributed to carry everything not in the footer: Duplicate and Delete at every status, plus status-specific valid-but-uncommon transitions (Revise on Approved, Park/Close on Approved/PartiallyAllocated/Allocated).
- **Allocate is a new navigational button** — not a status transition. Opens the edit page in Mode B. Rationale: at Approved and PartiallyAllocated, "start/continue allocating people" is the overwhelmingly common next action, and a one-click primary for it is the single most-impactful UX improvement of this version.
- **Empty footer on Allocated** is deliberate — there's no meaningful forward action at that stage, and surfacing Park/Close in the footer would over-weight them relative to how often they're used.
- Section 11.3 updated to reflect the new surfaces.
- Section 11.16 added — navigational vs transitional button behaviours.

Programme › Project › Demand hierarchy (section 2.1.1 added; sections 2.4.9, 4.5.1, 4.5.2, 4.6, View 1 filter, 5, 6, 11.14 updated):

- **Programme and Project entities added to the data model** as lightweight records (name, description, active flag). Programme has 1..n Projects; Project has 0..n Demands; Demand has 0..1 Project (alignment is optional — BAU and ad-hoc items don't need forcing in).
- **Programme is derived via the Project's parent** — not stored separately on the Demand. Single source of truth for the parent relationship.
- **Project alignment is editable in every status**, including Approved / PartiallyAllocated / Allocated. Changing the alignment has zero effect on capacity — it only re-points roll-up totals. Explicit exception to the "locked once approved" rule in section 3.
- **Section 2.4.9 — 9 new named aggregation functions** for Programme/Project roll-ups: `project_internal_hours`, `project_external_hours`, `project_external_hours_by_provider`, `project_demand_count`, plus Programme-level counterparts and an `unaligned_demand_hours` function for the virtual "No Project" group. Follows the same one-function-many-callers rule as section 2.4.8.
- **Admin surfaces added** for Programmes and Projects (section 5) — flat CRUD with cascade / hard-delete / soft-delete rules. Hard-delete blocked if child records exist.
- **Inline creation** from the Demand Project-alignment picker (section 11.14) — "+ Create new Project…" with nested "+ Create new Programme…" for flow-preserving ad-hoc creation.
- **Demand page Table mode gains Group-by-Programme/Project** with roll-up summary headers showing internal + external hours across the visible horizon, plus a Demand count. Board mode cards show Programme › Project tag.
- **New filters across Demand page**: Programme (single-select), Project (dependent on Programme), Has-external-requirements toggle.
- **Capacity Validation gains a Programme/Project filter** — narrows demand stacks to in-scope Demands while keeping capacity lines and grey bands at full-team scope (with clarifying tooltip on the filter).

External resource requirements (section 2.6 added; sections 3, 4.5.1, 4.5.2, 4.6, 5, 6, 11.15 updated):

- **New entity** `ExternalResourceRequirement` sits on Phase, alongside internal skill-shaped requirements. Fields: Provider (admin-configured dropdown), Role (free text), hours representation (same `hours_by_month` for finite / `steady_state_hours` for indefinite as internal requirements), optional notes.
- **Admin-configured Provider list** (section 5) — new admin surface. Seed values: Managed Services, Contractor, OEM, Plant Team, Other Internal Team, Other.
- **No allocation layer for external requirements** — demand-shaped only. Mode B renders them read-only; no Mode B workspace for external resource.
- **Explicit exclusion from all capacity calculations** — external hours do not contribute to or reduce capacity lines, do not appear on demand stacks, do not contribute to the grey band, do not create projection shortfalls, do not appear on Team Activity or the Skill detail view, and are not read by any of the 8 existing aggregation functions from section 2.4.8. They are included only in Programme/Project roll-ups and in per-Demand summaries.
- **Cross-team resourcing visibility** comes via Programme/Project roll-up totals (section 2.4.9) — broken down by Provider — surfaced on the Demand page grouped view and the Project admin screen.
- **Same locking discipline as internal requirements** — editable in Mode A, read-only in Mode B. Editing requires Park-and-revive (or Revise from Approved).
- **Provider rename cascades** to all existing external requirements (id-referenced, not name-referenced). Provider hard-delete blocked if any requirement references it; bulk-reassign provided.

Seed data updates (section 6):

- **2–3 Programmes added**: "MES Modernisation", "Digital Twin Rollout", and optionally a third. Plausible groupings of the existing seed Demand items.
- **4–6 Projects added** across Programmes, with at least one Programme having 2+ Projects.
- **Existing seed Demands aligned to Projects**; at least one Demand intentionally left unaligned so the virtual "No Project" group renders.
- **Providers pre-populated**: Managed Services, Contractor, OEM, Plant Team, Other Internal Team, Other.
- **External requirements added to at least 3 seed Demands**, spread across Providers — including "Plant C MES Platform Migration" (OEM + Managed Services), "Corporate Data Lake" Submitted item (Contractor), and one BAU item with an indefinite Other Internal Team requirement.
- **Renderability invariant** for Programme/Project roll-ups — grouped-by-Project view on fresh seed must produce at least one group with non-zero internal and external hours in the 12-month window, with 2+ distinct providers in the external breakdown.

No changes to the state machine transitions themselves, the aggregation functions from section 2.4.8, the projection algorithm (section 2.4.5), the capacity calculation rules (sections 2.4.1–2.4.4), or any existing visual treatment on the Capacity Validation charts / Team Activity / Skill detail view. This version is additive.

**v1.13**: **Visual refinements and Mode B Gantt visibility. No data model or aggregation logic changes.**

Five targeted improvements identified after v1.12 shipped:

- **Grey projection band — cross-hatch fill and dotted lower bound** (section 2.4.4). Replaces the single-direction 45° hatch with a two-way lattice cross-hatch, and adds an explicit dotted line in the same grey tracing the band's bottom edge. This makes the band more prominent and gives the user a readable boundary between "capacity consumed elsewhere" and "usable headroom." Colour tokens, pattern dimensions, and dash pattern specified in `DESIGNSYSTEM.md` under "Projection grey band."
- **Overlay fill reverted from hatched amber to solid amber/yellow** (section 4 View 1, section 2.4.3). The v1.12 move to hatched amber was intended to visually distinguish the overlay from the committed stack — but created a new collision with the hatched grey band. As of v1.13, hatched fill is reserved exclusively for the projection grey band; the overlay renders as a solid amber/yellow fill at moderate opacity. The v1.12 wiring fix (distinct `<Area>`, own `dataKey`, distinct `d` silhouette) remains — only the fill style changes.
- **Skill detail view — stacked month-column headers** (section 4.8). Month labels on both the people heatmap and the demand Gantt change from single-line "Jan 26" to two-line stacked MMM / YY format. Saves horizontal space and lets 12+ month views read cleanly without column crowding.
- **Skill detail view — status filter in state-machine order** (section 4.8). The Gantt's status filter toggles are now ordered Draft → Submitted → Approved → Partially Allocated → Allocated → Parked, matching the Kanban column order from the Demand page (section 4.6). Alphabetical ordering is explicitly called out as wrong — it breaks the process-flow mental model.
- **Phase Gantt visible in Mode B (read-only)** (section 4.5.2). Previously the phase timeline visual only rendered on the demand edit page when the demand was in an editable status (Draft / Submitted / Parked). It now also renders in Mode B (Approved / Partially Allocated / Allocated) as a read-only version, positioned above the "Demand Definition is Locked" banner. Same visual styling, colour-by-funding-source, legend, and padding as Mode A — only the editing affordances are removed. Rationale: the Gantt is pure orientation, and orientation is as useful when allocating as when defining.

No changes to the data model, the state machine, the aggregation functions, or the seed.

**v1.12**: **Bug-fix release — restore grey band rendering and overlay layer correctness, add renderability invariant. No feature additions, no data model changes.**

Two regressions observed in the shipped v1.11 build:

- **Grey projection band was not rendering on any domain/skill chart.** Inspection of the rendered SVG showed no grey-band DOM element present — not clipped, not zero-height, simply never instantiated. Root cause is either the `grey_band()` aggregation returning zero for every input (stub or broken skill-exclusion logic), or the chart component never mounting the layer. Fix covered by strengthened section 2.4.4 (the band must exist as its own DOM element regardless of calculated value) and the new renderability invariant in section 2.4.8.
- **Overlay area rendered as a silent duplicate of the committed stack top.** In the shipped build, the Recharts `<Area>` for the Submitted overlay has a `d` path identical to the top committed-stack layer, making it invisible as a distinct layer. Section 4 View 1 now explicitly requires the overlay to render with its own height data (the overlay's contribution per month) and visually distinct hatched fill — if the overlay path silhouette matches the top committed-stack silhouette, the wiring is wrong.

New section content:

- **Section 2.4.4 — DOM-layer mandate added** for the grey band. The band must be rendered as a dedicated hatched `<Area>` with a `<pattern>` fill, separate from every demand-stack layer and separate from the capacity line. A zero-height band is still a mounted element; an absent band is a wiring bug.
- **Section 2.4.8 — renderability invariant added.** Named aggregation functions must be verified end-to-end against the seed. Specific fresh-seed assertions codified: `grey_band('mom', '2026-06') > 0`, `projected_consumption(alex_morgan_id, '2026-06') > 0`, and (with Corporate Data Lake overlay) `grey_band('miv', '2026-07') > 0` plus an MI&V Specialist projection shortfall entry. These must be codified as runtime dev-mode assertions or seed-fixture tests, not manual spot-checks.
- **Section 4 View 1 — overlay layer correctness requirement added.** Explicit rule that the overlay path silhouette must differ from the top committed-stack silhouette.

No changes to the data model, the state machine, or the seed.

**v1.11**: **Targeted fixes and one new view — no data model changes.**

Capacity charts (section 2.4.4, View 1):
- **Grey projection band inverted** — now anchors to the capacity line and hangs downward, rather than stacking on top of the committed demand. The band represents capacity consumed elsewhere, which is a capacity-side concept, not a demand-side one; the new rendering direction matches the semantics. Available headroom is now the white space between the top of the demand stack and the bottom edge of the grey band. Two distinct over-capacity treatments specified: strong red when demand alone exceeds the capacity line, softer red where the demand stack meets or crosses into the grey band.

Allocation workspace (section 4.5.2 Mode B):
- **Headroom calculation extended to include in-session pending edits across rows.** The v1.9/v1.10 formula was store-only and missed the case where the same person is selected on multiple rows of the same Allocation Workspace page — each row's preview ignored the pending values on every other row. New formulation reads from `(persisted store minus the demand item being edited) + (in-session pending map minus the row being edited)`. Every keystroke on any row re-derives every other row's preview for the affected person-month. Worked example added using the observed Plant C MES Platform Migration / Alex Morgan case.

Demand edit page Mode A (section 4.5.2):
- **Phase Gantt colour-coded by Funding Source** (Investment Scheme / Plant/Sector Allocation / Mixed), replacing whatever scheme was previously in place. Colour mapping lives in `DESIGNSYSTEM.md`. A compact legend is rendered inside the timeline container.
- **Phase Gantt vertical padding specified.** At least one bar-height of space above the topmost bar and below the bottommost bar, so bars do not overlap the horizontal scrollbar (v1.10 regression).

New view — Skill detail (section 4.8):
- Dedicated page reached by clicking a skill chart on Capacity Validation. Replaces the thin "person-level detail panel" drill-down referenced in v1.10. Three sections: a skill header with time-aware summary numbers; a people list showing each skill-holder with a month-by-month utilisation mini-heatmap (colour-coded green/amber/red/dark-red) reflecting **total** utilisation across all commitments; and a demand Gantt showing every demand item with requirements against this skill across the visible horizon, colour-coded by demand type (matching universal colour coding), styled consistently with the Mode A phase Gantt. Status / demand-type / skill-level filters above the Gantt. All numbers sourced from the shared aggregation layer (section 2.4.8).
- Interpretation guidance 11.1 updated to reference section 4.8 for skill-chart click behaviour.

**v1.10**: **Major capacity model rework, plus allocation and Team Activity improvements.**

Capacity model (section 2.4 rewritten, new section structure 2.4.1–2.4.8):
- **Domain and skill capacity lines are now dynamic** — computed as the skill pool's real availability, net of each person's real named allocations across *all* domains and skills. A person doing MOM work has their MI&V contribution correspondingly reduced; the MI&V capacity line drops accordingly. The capacity formula explicitly excludes commitments to the chart's own skill (those show on the demand side), preventing double-counting.
- **New "grey band" projection layer on every domain/skill chart.** Between the demand stack and the capacity line, a hatched grey band represents projected consumption of this chart's skill pool by *unallocated demand elsewhere* (demand targeting other domains/skills whose projected allocations would consume the same people). Unallocated demand includes Approved items with no allocations, the unfilled portion of Partially Allocated items, and the currently-selected Submitted overlay.
- **Projection algorithm formally specified** (section 2.4.5). Single-pass proportional distribution: each unallocated-requirement-hour is distributed across eligible skill-holders proportionally to their remaining real headroom. No ordering, no iteration, no arbitration between demand items. If collective demand exceeds supply, the excess becomes an explicit projection shortfall.
- **Projection shortfalls surfaced as explicit signals** (section 2.4.6) in the over-capacity summary strip, not hidden in the grey band. Three distinct signal types now exist: Over capacity (committed demand exceeds capacity), Over capacity with overlay (overlay induces it), Projection shortfall (unallocated demand exceeds eligible headroom).
- **Overlay mechanism changed from multi-select to single-item.** Only one Submitted item can be overlaid at a time. Aggregate Submitted visibility is handled via the Demand page Board view and the projection-shortfall signals in the summary strip, not by stacking overlays on the chart. "Select all Submitted" and "Clear all" removed.
- **Testable invariants specified** (section 2.4.8, interpretation guidance 11.13). Submitted-as-overlay must produce identical numbers to the same item Approved-without-allocations. Allocation conservation must hold per-person per-month. No silent shortfalls. No double-counting of demand in both stack and grey band.

Allocation workspace (section 4.5.2 Mode B):
- **Headroom calculation is now explicitly store-wide.** The capacity-preview strip computes remaining hours by summing every real allocation on that person across every demand item in the store for the target month, excluding only the allocation currently being edited. Formula specified in section 4.5.2.
- **"Full coverage" quick-fill action removed.** After v1.8's requirement-level hard-block, Full Coverage and Fill Remaining were behaviourally identical — both capped at the requirement's remaining headroom. Fill Remaining is kept (now explicitly capped by both requirement headroom and person capacity). Users who want to deliberately over-commit a person can type the value directly and confirm on save.

Team Activity (section 4 View 2):
- **Over-capacity cells now tinted at cell-background level.** Previously the indicator was confined to the overflow bar segment and a small "+24h" badge. The whole cell now gets a light red background tint so over-capacity months are visible at a glance across the whole grid.

Capacity Validation charts (section 4 View 1):
- **Skill-level capacity sub-line removed.** The dotted/thinner secondary line showing "of which Specialist" capacity on skill-mode charts has been removed. It added visual noise without clear value — users who want to understand level-specific capacity can reach for level-filtered drill-down instead. Charts in skill mode now show a single capacity line per chart.

Aggregation layer (section 2.4.8, interpretation guidance 11.13):
- **Eight named aggregation functions required**, implemented once and called from every view. No inline summing by individual callers. Build sequence prescribed: aggregation layer first, then views in specified order. Explicit invariants checked throughout.

Seed data (section 11.8):
- **Seed updated to include deliberate stress-test scenarios.** Five stress items added (dmd_stress_001 through 005) plus an intentional overlap so that, between them, every new v1.10 visual signal has at least one exemplar: person-level over-allocation (Priya, Jun/Aug 2026), overlay-induced domain over-capacity (select any Submitted MOM item), projection shortfall (MI&V Specialist with Corporate Data Lake overlay), baseline grey band from Approved-unallocated (Plant C MES Migration), cross-project same-person overlap (Fatima on dmd_004 + stress_005). MBM domain left comfortably under-loaded so uncongested chart behaviour is also visible. Existing 18 items retained unchanged as realistic baseline.

**v1.8**:
- Phase Gantt overview added to the demand edit page (Mode A).
- Portalled dropdowns mandated for phase cards.
- Allocation caps: requirement-level hard-blocks, person-level soft-warns.
- "Revise" action: Approved → Submitted direct transition.
- Team Activity rewritten with stacked horizontal bars.
- Kanban is now the default for Demand page.
- Over-capacity summary strip on Capacity Validation + per-chart badge.
- NPD Demand examples added to seed.

**v1.7**:
- Indefinite phases supported (`end_month` nullable; `steady_state_hours` for indefinite phases).
- BAU removed from admin and represented as demand of type BAU.
- Allocation Workspace UI improved (phase separation, month labels on coverage strip, capacity-preview strip).
- Drawer button zones restructured; Model Impact action added; overlay Select-all / Clear bulk actions.
- "Partially Allocated" display label (enum value unchanged).

**v1.6**:
- Demand workflow as a gated state machine with seven statuses.
- `Accepted` renamed to `Approved`; `PartiallyAllocated` and `Closed` added.
- Edit page Mode A / Mode B split based on status.
- Shared DOMAIN > SKILL selector component.
- Archive view for Closed items.

**v1.5**:
- Demand Item edit save model changed from live-save to explicit Save/Cancel. Live recalculation on the Capacity Validation charts preserved.
- Requirement entry is always skill-shaped; hours captured per-month, not flat.
- Demand Item view/edit split — drawer (read-only) vs edit page (full CRUD).

**v1.4**:
- Clarified the Submitted overlay's purpose and scope on the Capacity Validation view.
- Rewrote the v2 scenario modelling section to distinguish from the overlay.

**v1.3**:
- **Rewrote View 1 — Capacity Validation** to be a chart-based, team-level strategic view rather than a person-level grid.
  - Added top-level "Overall Team Capacity" chart as the primary page element.
  - Below it, Domain/Skill toggle — one chart per domain by default (3 charts), or one chart per skill (grouped by domain).
  - Charts are stacked-area-over-capacity-line, with demand stacked by work type (Group Strategy / Plant Project / NPD / BAU).
  - Individual-level grid now repositioned as a drill-down reached by clicking a skill chart, not a default view.
- Introduced the **polymorphic-capacity principle**: domains/skills cannot be stacked in one chart because the same person contributes to multiple capacity lines. Each domain/skill gets its own chart. Formulae for capacity at each level (total / domain / skill any-level / skill specific-level) are specified in a reference table.
- Added **skill-level capacity sub-line** — in skill mode, each chart shows both total skill capacity and a sub-line for the highest specified level, so level-based shortfalls don't hide behind headline capacity.
- Updated interpretation guidance 11.1 to reflect chart-based click behaviour (was previously about cells in a grid).

**v1.2**:
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
- Added worked examples (section 2.5) for multi-skill phases, split-at-promotion, and cross-domain demand items.
- Clarified that Primary Domain on a demand item is a reporting hint, not a constraint.
- Specified three visual signals for over-allocation at person / skill-short / domain-short levels.
- Specified default time horizon as 6–12 months with 6/12/24/60 presets.
- Specified live recalculation within ~200ms and called out the client-side state architecture implication in section 7.
- Added the Demand Item Editor as a reusable side-panel component (section 4.5).
- Added Demand discovery modes: Table (default), Board, Search (section 4.6).
- Added Duplicate demand item action (named becomes skill-shaped on copy).
- Clarified that promotion supports 1-to-many splits.
- Reordered build sequencing to reflect the editor component needing to exist before the main views.
- Added explicit requirement that Claude Code must follow `DESIGNSYSTEM.md` in the repo for all UI styling.
