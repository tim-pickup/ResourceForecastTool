# Digital Manufacturing Resource Load & Capacity Tool

## Requirements Specification — v1.21

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

### 2.0 Terminology — Phase → Activity *(v1.20 rename)*

The user-facing and internal name for the unit of work breakdown changes from "Phase" to "Activity" in v1.20. This better reflects internal Digital Manufacturing PMO naming convention. The rename is **complete and breaking** — it covers user-facing labels, data model field names, import workbook tabs and columns, aggregation function arguments, seed data, and code identifiers.

**Field rename map** (apply throughout):

| v1.19 | v1.20 |
|---|---|
| Phase (entity) | Activity |
| `phase_id` | `activity_id` |
| `phases` (collection on Project / Demand) | `activities` |
| `phase_name` | `activity_name` |
| `phase_start_month` | `activity_start_month` |
| `phase_end_month` | `activity_end_month` |
| Resource Requirement's parent reference (was implicit "phase") | implicit "activity" |
| "Phase timeline (Gantt)" UI element | "Activity timeline (Gantt)" |
| "+ Add Phase" button label | "+ Add Activity" |
| "Phase 1 · Design · May–Aug 2026" header | "Activity 1 · Design · May–Aug 2026" |
| `hours_by_month` (no rename — already keyed by month, not phase) | unchanged |
| `steady_state_hours` | unchanged |
| Indefinite phase / finite phase concepts | Indefinite Activity / finite Activity |

**Import workbook rename map** (section 6.1):

| v1.19 tab/column | v1.20 |
|---|---|
| Tab `Phases` | Tab `Activities` |
| Column `phase_name` (tabs 2, 3, 4) | `activity_name` |
| Column `phase_start_month` | `activity_start_month` |
| Column `phase_end_month` | `activity_end_month` |

The bundled master template at `assets/import_template/master.xlsx` is regenerated to match the v1.20 schema. Any pre-v1.20 workbooks held by users will fail the workbook structure check at import time with a clear error: *"This file uses the v1.19 template (tab 'Phases'). Please download the latest template — Phases have been renamed to Activities."*

**Throughout the rest of this spec, "Activity" is the canonical term.** Where prose below still says "phase" in places not yet edited, it refers to the same entity — Claude Code should treat the rename as universal. The build sequencing (section 9) lists the rename as the first task in the v1.20 build.

### 2.1 Structure

**Function**
- Name (e.g. "Digital Manufacturing", "Group IT Enterprise Solutions")
- Description
- Active flag (soft-hiding; inactive Functions are hidden from the Function selector but their data remains intact)
- A Function is the root of both the skill taxonomy (it owns Domains) and the organisational structure (it owns Teams). **v1.16 introduces multi-Function support** — the tool ships seeded with two Functions (Digital Manufacturing and Group IT Enterprise Solutions) and admins can add more. The **active Function** is selected via a global Function selector (see section 4.9) and acts as a **lens** over the data — it determines which Domains, Skills, Teams, People, capacity charts, Team Activity rows, and admin lists are shown. Programmes, Projects, Demands, and Providers are **Function-agnostic** (see section 2.2) and visible regardless of which Function is active, though their view may be lensed (e.g. a Demand's visible requirements are those touching the active Function's Skills).

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
- Active flag (soft-hiding; hard-delete blocked if Team has assigned People)
- Teams are the organisational unit that owns people and receives demand assignments. A Function can have many Teams; a Team belongs to exactly one Function.

**Person**
- Name
- **Team** (`team_id` required — every person belongs to exactly one Team, and therefore transitively to one Function)
- Contracted hours per month (drives capacity; part-time is handled entirely through this field)
- `available_from` (YYYY-MM, nullable) — capacity before this month is zero. Used for new starters.
- `available_to` (YYYY-MM, nullable) — capacity after this month is zero. Used for leavers.
- Active/inactive flag (for soft-hiding without deletion)
- **Skill profile**: a list of `{skill, level}` entries — a person can hold multiple skills at different levels, across any Domain within their Function
- **BAU allocations**: see section 2.3

**Skill profile scoping rule**: when assigning skills to a person in admin, the DOMAIN > SKILL selector is scoped to the person's Function (via their Team). A person cannot be assigned skills from a different Function's Domain taxonomy. Within their Function, they may hold skills across any Domain.


### 2.1.1 Programme / Project hierarchy

*Substantially redefined in v1.18.* The Project entity is now the planning unit users scope (replacing today's grouping-layer-only Project). Programmes remain as the optional parent grouping for Projects.

**Programme**
- Name (free text, required, unique)
- Description (free text, optional)
- Active flag (for soft-hiding; inactive Programmes remain on their existing Projects but don't appear in pickers)
- Programmes have **no status**, no approval gates, and no transitions. They are organisational labels with roll-up power.

**Project** *(redefined in v1.18 — replaces today's Demand-as-planning-unit and today's Project grouping layer)*

The Project is the planning vehicle. Users create, scope, and approve a Project; the Project then spawns one Demand per Function involved (see section 2.2 and section 3).

| Field | Notes |
|---|---|
| Name | Free text, required |
| Owner | Free-text field (person or role name) |
| Type | **Reference to a Project Type record** (see section 2.1.2). Required. The picker reads from active Project Type records in the store; the displayed label is the record's `name`. Carried through to spawned Demands. |
| Programme | **Optional** — nullable. A Project may belong to one Programme, or be unaligned. Editable in every status. |
| Description | Free text |
| Status | One of: `Draft`, `Scoping`, `Submitted`, `Approved`, `Allocated` (see section 3) |
| **Activities** | One or more — see section 2.2 |
| **Functions Required** | Originator's declaration at Draft of which Functions are expected to engage in Scoping. Multi-select. **Hint, not binding** — Scoping users are not constrained to these Functions; they can add requirements under any Function's Skills. Frozen at Submit (becomes a planning audit record). See section 3 — Project workflow narrative. |
| **Functions Actually Involved** | Derived (read-only) — the distinct set of Functions touched by any of the Project's requirements across all Activities. May differ from Functions Required if Scoping added Functions the originator didn't anticipate. |
| Active flag | Soft-hide for terminal/cancelled Projects; not the same as deletion |
| **`created_under_function_id`** | *(new in v1.20)* Function id of the user's active Function at the moment the Project was created. Tracked as a lightweight metadata field — **not** ownership, just a tiebreaker for visibility in Draft/Scoping when `functions_required` is empty or the requirements set is incomplete. See section 4.6.A for visibility rules and section 4.9 for the analogous behaviour on Demands. |

**Relationships**

- A Programme has 0..n Projects.
- A Project has 0..1 Programme (optional).
- A Project has 0..n Demands (0 in Draft and Scoping; ≥1 from Submitted onwards once spawned). The set of Demands is determined by the Functions touched by the Project's requirements at spawn time.
- A Demand has **0..1 Project**. Project-spawned Demands have a `parent_project_id` set; direct Demands (created without a Project — see section 2.2 and section 3 "Direct Demand path") have null. A Demand belongs to exactly one Function regardless of origin.

**Function-agnostic at the Project level**

A Project is Function-agnostic in the same sense today's Demand was: it does not "belong to" any Function. The Functions Actually Involved are derived from its requirements. A Project with requirements spanning Digital Manufacturing and Group IT spawns one Demand for each of those Functions when it transitions to Submitted. The originator's declared **Functions Required** list (set at Draft) is shown as planning metadata alongside Functions Actually Involved — useful for retrospective reflection ("we expected MOM and MI&V; actually involved MBM as well") but does not gate the spawn.

**Spawn materialises requirements onto child Demands — *new in v1.19***

When a Project transitions Scoping → Submitted, the spawn rule (section 2.2.4) **materialises** a deep copy of each Function-scoped slice of Activities, internal requirements, and external requirements onto the corresponding child Demand. From that point, each Demand owns its own data and is independently editable (within the Demand state machine's locking discipline — see section 3). The Project's own Activities and requirements are frozen at Submit and remain on the Project as a read-only planning record.

This severs the "live computed view" model used in v1.18: spawned Demands are no longer projections of the parent Project's data; they are independent execution slices. The owning Function can refine technical detail on their Submitted Demand (skills, hours, externals) without that change rippling back to the Project or to sibling Demands. Conversely, the Project remains a fixed snapshot of what was agreed at Submit time — a useful audit artefact, not a live source of truth.

The structural relationship `Demand.parent_project_id` remains for roll-up purposes (Programme/Project totals derived across child Demands) and for the drawer's "part of [Project name]" reference. But for read/edit purposes, each spawned Demand is now self-contained.

**Direct Demand path — bypasses the Project model**

Not all Demand on a team belongs to a wider Project. A team may receive ad-hoc requests, BAU streams, or single-Function pieces of work that don't justify cross-Function planning. The **direct Demand path** lets users create a Demand directly: single-Function from creation (`function_id` required, `parent_project_id = null`), with its own Draft swimlane on Manage Demand. Direct Demands flow through `Draft → Submitted → Approved → PartiallyAllocated → Allocated`, skipping Scoping entirely (Scoping exists for cross-Function coordination — moot when only one Function is involved).

Project-spawned Demands and direct Demands converge at the Submitted swimlane on Manage Demand. From Submitted onwards their behaviour, drawer footers, edit page, and capacity treatment are identical — the only persistent difference is that Project-spawned Demands carry a `parent_project_id` and roll up to that Project (and through it, the Programme). Direct Demands roll up directly to a virtual "Direct Demands" grouping on the Demand view (section 4.10).

**Conversion between paths is not supported in v1.18**: a direct Demand cannot be retroactively attached to a Project after creation, and a Project-spawned Demand cannot be detached from its parent. If a user realises mid-Draft that a direct Demand is really part of a wider Project, they should Delete the direct Demand and create the Project instead. This is a deliberate v1.18 simplification — supporting attach/detach later is straightforward but adds ambiguity (whose definition is authoritative — the Project's or the Demand's?) that we don't need to resolve yet.

**Aggregation semantics**

For any Programme or Project, roll-up totals are computed by summing across its Activities' requirements (Project level) and its child Demands' allocations (Project and Programme level). See section 2.4.9 for the named aggregation functions — these all live in the shared aggregation module.

Worked example:

- Programme "MES Modernisation" contains Projects "Plant A MES Refresh", "Plant B MES Refresh", "Plant C MES Platform Migration".
- "Plant C MES Platform Migration" has Activities with requirements targeting Digital Manufacturing Skills (MOM, MI&V) and Group IT Skills (Data & Integration). On Submit, it spawns a Digital Manufacturing Demand (carrying the DM-Skill requirements) and a Group IT Demand (carrying the GroupIT-Skill requirements).
- Allocation happens per Demand: the DM Demand names DM people; the Group IT Demand names Group IT people. Each tracks its own PartiallyAllocated/Allocated state independently.
- The Project rolls up to Allocated when both child Demands are Allocated.
- Separately, the Digital Manufacturing team also has a direct Demand "MES Super User support — Plant B" (BAU type, Function = Digital Manufacturing, no parent Project). It went through Draft → Submitted directly on Manage Demand and now sits in PartiallyAllocated. It rolls up to the Demand view's "Direct Demands" virtual card, not to any Programme.

**Migration note for seed data**

In the v1.18 seed, every today-Demand becomes a Project (carrying its Activities and requirements). Cross-Function today-Demands spawn the appropriate per-Function child Demands at the appropriate Project status. See section 6.

### 2.1.2 Project Type entity

*Introduced in v1.19.* Project Type is a first-class admin-managed entity, not a hardcoded enum. This lets organisations rename, reorder, recolour, or extend the work-type taxonomy (e.g. to add "Plant E Capability Project") without code changes.

| Field | Notes |
|---|---|
| `id` | Stable identifier referenced by `Project.type` and `Demand.type` (see sections 2.1.1 and 2.2). **Auto-derived from `name` on create** as `pt_<slugified_name>` (lowercase, ASCII alphanumerics, non-alphanumeric runs collapsed to a single underscore, leading/trailing underscores stripped). Examples: "Plant Project" → `pt_plant_project`; "Group Strategy Project" → `pt_group_strategy_project`; "NPD Demand" → `pt_npd_demand`. **Uniqueness is enforced at creation** — if the derived id collides with an existing record's id (active or inactive), the create is blocked with an inline validation error on the `name` field: *"A Project Type with this system key already exists. Choose a different name."* The id is **immutable after creation** — renaming a record (changing `name`) does not regenerate the id (other records reference it). The id is **shown read-only in the admin surface** alongside the `name` field so admins can see the system key without editing it (see section 5). Never reused. |
| `name` | User-editable display label. Shown everywhere the type is rendered — drawer header Type badge, Manage Projects column, Manage Demand column, capacity stack legend, filter dropdowns, import workbook dropdown. |
| `display_order` | Integer (zero-indexed). Drives the order in which Project Types appear in pickers, filter dropdowns, and the capacity-validation stack. **The capacity stack is built bottom-to-top in `display_order` order**, so the lowest-`display_order` type sits at the bottom of the stack. Admin sets this via drag-handle reordering on the admin surface; persists immediately. |
| `colour_token` | Reference to a colour from a fixed design-system palette (8–12 named tokens defined in `DESIGNSYSTEM.md`). Drives the fill colour of the type's segment on every demand stack and the colour of the Type badge on drawer/cards. **Admin picks from the palette; arbitrary hex codes are not accepted.** This keeps the visual language consistent and prevents users from picking unreadable or off-brand colours. |
| `is_bau` | Boolean. **System-fixed — not admin-toggleable.** Marks the record that represents BAU work for the purposes of the 80/20 capacity philosophy, BAU-specific roll-ups, and any other place where BAU has special treatment. Exactly one Project Type record carries `is_bau = true`; new types added via admin always have `is_bau = false`. The BAU record can be renamed, reordered, recoloured, or deactivated like any other, but the flag itself is system-managed. |
| `active` | Boolean. Soft-delete: deactivated types do not appear in pickers but existing Projects keep their reference. Reactivation is a single admin click. |

**Hard-delete behaviour** — admin can hard-delete a Project Type only when no Project or Demand references it. The admin surface surfaces the in-use count and blocks the delete with a clear message: *"This Project Type is used by 12 Projects and 18 Demands. Reassign them to another type or deactivate this one to hide it from new Projects."* A bulk-reassign action is provided alongside.

**Seed records** — four Project Types are seeded to match the v1.18 enum values:

| `name` | `display_order` | `colour_token` | `is_bau` | `active` |
|---|---|---|---|---|
| BAU | 0 | `--colour-bau` | true | true |
| NPD Demand | 1 | `--colour-npd` | false | true |
| Plant Project | 2 | `--colour-plant-project` | false | true |
| Group Strategy Project | 3 | `--colour-group-strategy` | false | true |

The `display_order` matches the v1.18 stack order (bottom-to-top: BAU, NPD Demand, Plant Project, Group Strategy Project). The colour tokens are existing design-system tokens; no new colour values are introduced by v1.19's Project Type entity (the existing palette is simply now referenced by token rather than baked into per-type render logic).

**Implication for downstream surfaces** — every place that previously hardcoded the four enum values must now read from the active Project Type records, sorted by `display_order`. The hardcoded list `["BAU", "NPD Demand", "Plant Project", "Group Strategy Project"]` no longer exists in the code. See section 9 build order step 1 for the data-model migration and section 5 for the new admin surface.

### 2.2 Demand and Project requirements

*Substantially redefined in v1.18 and further refined in v1.19.* The "Demand item" of v1.17 is split into two entities: a **Project** (the planning vehicle, defined in section 2.1.1, holding Activities and requirements *until Submit*) and a **Demand** (the per-Function execution slice, holding Activities, requirements, and allocations from spawn onwards). Direct Demands hold the same data outright from creation.

**v1.19 unifies the data ownership model**: every Demand — regardless of origin — owns its own Activities, internal skill-shaped requirements, and external resource requirements. Project-spawned Demands receive a deep copy at spawn time (section 2.2.4); direct Demands have their data from creation. There is no longer a "Function-scoped view of the parent Project" — the parent Project is a frozen planning record, not a live read source.

#### 2.2.1 Demand entity

A Demand is the unit of work a single Function commits to and allocates against.

| Field | Notes |
|---|---|
| Function | **Required** — the single Function this Demand belongs to. Set on creation (direct) or at spawn (Project-spawned). Immutable after. |
| Parent Project | `parent_project_id` — nullable. Populated for Project-spawned Demands; null for direct Demands. Used for roll-up references and drawer breadcrumbs only — the Demand does not read its Activities/requirements from the Project. |
| Name | Required. For Project-spawned Demands the name is auto-generated as `<Project name> — <Function name>` at spawn time and then editable; for direct Demands the name is user-entered. |
| Type | **Reference to a Project Type record** (see section 2.1.2). Required. For Project-spawned Demands, copied from the parent Project at spawn time and then editable on the Demand. For direct Demands, user-entered at creation. |
| Status | One of: `Draft`, `Submitted`, `Approved`, `PartiallyAllocated`, `Allocated` (see section 3). Project-spawned Demands skip Draft (they enter at Submitted on Project-Submit). Direct Demands begin at Draft. |
| Owner | Free-text (person or role name). For Project-spawned Demands copied from the Project at spawn time, then editable. |
| Description | Free text. For Project-spawned Demands copied from the Project at spawn time, then editable. |
| **Activities** | One or more, owned by the Demand from spawn onwards (Project-spawned) or from creation (direct). See section 2.2.2. |
| **Internal requirements** | Owned by the Demand on its Activities. Function-scoped — every internal requirement's Skill must belong to a Domain in the Demand's Function. |
| **External requirements** | Owned by the Demand on its Activities. Tagged with this Demand's Function at spawn time (via the Function-tag set during Scoping — see section 2.6) or set explicitly on direct Demand creation. |

**Demand requirements and Activities — unified model (v1.19)**

Every Demand owns its Activities, internal requirements, and external requirements. The data sits *on* the Demand; it is not read live from anywhere else.

- **Project-spawned Demand**: receives a Function-scoped deep copy of the parent Project's Activities, internal requirements (those targeting this Demand's Function), and external requirements (those tagged with this Demand's Function during Scoping) at spawn time. From spawn onwards the Demand is the source of truth for its own data.
- **Direct Demand**: Activities, internal requirements, and external requirements are entered directly on the Demand at creation, exactly as in v1.17/v1.18's direct-Demand model.

In both cases, allocations attach to skill-shaped internal requirements via reference. The skill-shaped → named relationship described in section 3 is unchanged.

**Editability after spawn — Submitted is now a workable state**

A consequence of unifying the ownership model is that **Submitted Demands are editable on definition** in v1.19 — the owning Function can refine skills, levels, hours, and external requirements before approving (section 3 — Demand workflow narrative). The lock point on Demand definition has moved from "at Submit" (v1.18) to "at Approve" (v1.19). This applies to both Project-spawned and direct Demands.

What is **not** editable on a Submitted Project-spawned Demand:
- Activities themselves (name, dates, funding source, funding notes) — these are part of the Project's planning shape, not the Function's technical detail. To change Activities, the parent Project would need to be Deleted-and-recreated.
- Function — set at spawn, immutable.
- The fact that this Demand's parent is the originating Project (`parent_project_id` is immutable).

What **is** editable on a Submitted Project-spawned Demand:
- Internal skill-shaped requirements on this Demand's Activities (skill, level, hours, owning team, notes — adding, editing, removing).
- External resource requirements on this Demand's Activities (provider, role, hours, notes — adding, editing, removing).
- Demand metadata (name, type, owner, description) — useful when the Function wants to refine the auto-generated name or correct an inherited field.

For direct Demands, **all definition fields including Activities are editable in Submitted** (the user owns the whole shape — there is no parent Project that would expect Activity stability). Activity dates, funding source, etc. can be adjusted in Submitted to refine the request before approving.

**Function consistency rule**

Every internal skill-shaped requirement on a Demand must target a Skill belonging to the Demand's Function (i.e. `requirement.skill.domain.function_id === demand.function_id`). The DOMAIN > SKILL selector on a Demand's edit page is scoped to the Demand's Function. This rule applies identically to Project-spawned and direct Demands — by construction, the spawn rule only copies requirements whose Function matches the spawned Demand's Function, and direct Demands have a Function-locked picker from creation.

External requirements on a Demand carry the Demand's `function_id` (set at spawn for Project-spawned Demands via the Function-tag, or set automatically to the Demand's Function on direct Demands). External requirements do not have a Skill, so no Skill-Function check applies — only the Function-tag itself.

#### 2.2.2 Activity *(renamed from Phase in v1.20)*

An Activity is the unit of capacity validation. **In v1.19, Activities live on the entity that owns the requirements** — and from spawn onwards, that is always the Demand:

- For Project-spawned work, Activities are defined on the **Project** *during Draft and Scoping*. At Submit, Activities are deep-copied to each spawned Demand (Function-scoped — only Activities that have at least one requirement targeting the spawned Function are included). After spawn, the Project's Activities are a frozen audit record; the live Activities for capacity and allocation work live on each Demand.
- For direct Demand, Activities are defined on the **Demand** from creation. Single-Function by construction.

| Field | Notes |
|---|---|
| Name (`activity_name`) | Free text, with autocomplete from Activity names used on recent Projects/Demands |
| Start month (`activity_start_month`) | YYYY-MM — required |
| End month (`activity_end_month`) | YYYY-MM — **nullable**. If null, the Activity is indefinite (see below). |
| Funding source | One of: `Investment Scheme`, `Plant/Sector Allocation`, `Mixed` |
| Funding notes | Free text — e.g. scheme name or sector |
| **Resource requirements** | Zero or more — see below. An Activity with zero requirements is permitted (e.g. a placeholder Activity whose detail hasn't been worked yet). |

**Date input UI — month-year picker with validation** *(new in v1.20)*

Both `activity_start_month` and `activity_end_month` are entered via a **month-year picker** component on the edit page (Mode A) — a calendar-style popover offering a year navigator and 12 month tiles, returning a `YYYY-MM` value. Free-text entry is removed. The picker portals (per section 4.5.2 dropdown overflow rule) so it is never clipped by the Activity card.

Validation:

- `activity_end_month` must be **greater than or equal to** `activity_start_month` when both are present. If the user picks an end month earlier than the start, the picker rejects the selection and surfaces an inline hint *"End month must be the same as or later than the start month (May 2026)."* The hint clears once a valid end month is picked or the start is moved earlier.
- **Indefinite Activities are preserved** — a "No end date (indefinite)" checkbox sits next to the end-month picker (see section 11.12). When checked, the end-month picker is hidden and the Activity becomes indefinite. The validation rule applies only when both start and end are set.
- The validation runs on every change (live), not only on save. The Save button is disabled while any Activity has invalid dates, with a banner naming the offending Activity.

Imports (section 4.6.A.1) also enforce this rule — `activity_end_month < activity_start_month` is a row-level error per section 6.1's parser semantics; v1.20 inherits this unchanged.

**Finite vs indefinite Activities**

- A **finite Activity** has a populated `activity_end_month`. Hours are captured in `hours_by_month` — an object keyed by YYYY-MM with one entry per month the Activity spans.
- An **indefinite Activity** has a null `activity_end_month`. Hours are captured as `steady_state_hours` — a single flat rate that applies every month from `activity_start_month` onwards, until the parent Project/Demand is Deleted.
- A requirement only ever uses one or the other: finite Activities exclusively use `hours_by_month`; indefinite Activities exclusively use `steady_state_hours`.
- Changing an Activity from finite to indefinite clears `hours_by_month` and prompts the user for a steady-state value (suggest the average of the existing per-month hours as the default). Changing an Activity from indefinite to finite prompts for an end month and pre-fills `hours_by_month` with the steady-state value for every month.

#### 2.2.3 Resource Requirement

How an Activity consumes capacity. **An Activity has many resource requirements.** All internal requirements are skill-shaped: `{skill, level, hours representation, function_id (derived), notes}`. Named people fulfilling the requirement are held as separate **allocations** attached to the requirement (see section 3).

- `function_id` is **derived** from the requirement's Skill (Skill → Domain → Function). Not a separately editable field. Used by the spawn rule and by the Function-scoped Demand view.

*v1.19 note: the previous `owning_team_id` field on requirements is removed. Teams play no part in the workflow — they remain an organisational concept under People (a person belongs to a Team, a Team belongs to a Function) but no longer attach to requirements, do not surface on the Scoping page, and do not constrain the person picker in the allocation workspace. The "Show all / restrict to team" toggle in Mode B is removed.*

The "hours representation" depends on the parent Activity type:
- In a finite Activity: `hours_by_month` (object keyed by YYYY-MM).
- In an indefinite Activity: `steady_state_hours` (single number).

**Per-month hours UI (finite Activities)**

- When a requirement is first created, the UI pre-fills every month in the Activity with a suggested value (e.g. the user's entered "typical" hours) — but each month is then individually editable.
- Changing the Activity's start or end month adds or removes entries in `hours_by_month`. When extending, new months inherit the value from the nearest existing month. When shrinking, removed months' values are discarded (with a confirm if they were non-zero).

**Steady-state UI (indefinite Activities)**

- A single numeric input: "Hours per month (indefinite)".
- The capacity calculation treats this value as applying to every month from the Activity's `activity_start_month` onwards, with no end.
- Deleting the parent Project/Demand ends its contribution to capacity.

A single Activity can hold multiple requirements of the same skill at the same or different levels — this is how an Activity that needs two MOM Specialists or three different skills gets modelled. See section 2.5 for worked examples.

The `notes` field on a requirement captures tacit context that skill+level alone can't express (e.g. "needs S7 experience specifically", "must have been through site induction").

#### 2.2.4 The spawn rule (Project → Demands)

*Substantially rewritten in v1.19.* When a Project transitions Scoping → Submitted (section 3), the system spawns one child Demand per Function whose Skills are touched by any of the Project's internal requirements, and **materialises** a Function-scoped slice of the Project's Activities, internal requirements, and external requirements onto each spawned Demand.

The spawn happens once at Submit. After spawn, each Demand owns its own copy of Activities and requirements; the Project's Activities and requirements remain on the Project as a frozen planning record but are no longer the live source of data for any Demand.

1. Compute the set of Functions involved: `{r.skill.domain.function_id for r in project.activities.flatMap(internal_requirements)}`. Empty Project (no internal requirements) blocks the transition with an inline error. The originator's `functions_required` list is **not** consulted by the spawn — actual requirements are the source of truth for which Demands spawn.
2. For each Function in the set, create a new Demand and materialise its data:
   - `function_id` = the Function
   - `parent_project_id` = the Project's id
   - `name` = the Project's `name` *(v1.20 change — previously `<Project name> — <Function name>`. The Function suffix is removed because the Function chip in the Demand drawer header and on every list/card sufficiently disambiguates sibling Demands, and the suffix duplicated context. The name is still editable thereafter on the Demand.)*
   - `type` = the Project's type (editable thereafter on the Demand)
   - `owner` = the Project's owner (editable thereafter on the Demand)
   - `description` = the Project's description (editable thereafter on the Demand)
   - `status` = `Submitted`
   - `activities` = deep copy of every Project Activity that contains at least one Function-relevant requirement (internal or external). Activities that contain no Function-relevant requirements are omitted from this Demand. Activity fields (name, start_month, end_month, funding_source, funding_notes) are copied verbatim. Indefinite-vs-finite shape is preserved.
   - `internal_requirements` per Activity = deep copy of the Project-Activity's internal requirements where `r.skill.domain.function_id === <this Function>`. Hours representation (`hours_by_month` for finite, `steady_state_hours` for indefinite) is copied verbatim.
   - `external_requirements` per Activity = deep copy of the Project-Activity's external requirements where the external requirement's Function-tag (set during Scoping — see section 2.6) matches `<this Function>`. Hours representation copied verbatim. External requirements without a Function-tag (legacy or not yet tagged) default at spawn time to the **Project owner's primary Function** if it is one of the Functions in the spawn set; otherwise to the alphabetically-first Function in the spawn set, with a runtime warning logged in development builds.
3. The Demands and the Project's status flip from Scoping to Submitted are atomic — either all spawn (with their materialised data) and the Project transitions, or none do and the Project stays in Scoping with the error surfaced.
4. After spawn, the Project's `activities`, `internal_requirements`, and `external_requirements` remain on the Project as a **frozen audit record**. They are not updated by subsequent edits to child Demands. The Project's edit page becomes read-only; the drawer surfaces them in a "Planning record at Submit" section. Roll-up aggregation functions (section 2.4.9) read from the **child Demands**, not from the Project's frozen record — the Project's record is for human reference only.

**Mathematical equivalence at the moment of spawn**: at the instant of Submit, the union of all child Demands' Activities/requirements (across Functions) is identical to the Project's Activities/requirements. Drift is introduced by subsequent edits to Submitted Demands, which is the intended behaviour.

**Renderability invariant**: on a fresh seed load, every Project-spawned Demand's `activities` and `requirements` are the materialised result of the spawn — verifiable by checking that no Demand's data is structurally identical to the parent Project's data via reference (deep-equal at clone time, but distinct object identity).

### 2.3 BAU

BAU is modelled as **Demand of type `BAU`** — using the Demand entity directly via the **direct Demand path** (section 2.1.1). BAU is single-Function by definition (a support stream is owned by one team in one Function), so the direct path is the natural fit — there's no cross-Function planning to do, and routing BAU through a Project would add a Scoping step that has no value for known support engagements.

Typical shape of a BAU Demand:

- **Function**: set at creation (e.g. Digital Manufacturing).
- **Type**: `BAU`.
- **Parent Project**: null (direct Demand).
- **Activities**: often a single indefinite Activity (no end date, steady-state hours) for ongoing support streams. Declining BAU (e.g. ramp-down toward business handover) is modelled as multiple sequential finite Activities with decreasing hours, optionally followed by a final indefinite residual Activity.
- **Requirements**: skill-shaped, using the same DOMAIN > SKILL selector as Project work, scoped to the Demand's Function.
- **Allocations**: named people allocated to requirements, same mechanism as Project-spawned Demands.

Example — declining BAU handover:

Direct Demand: "MES Super User — Plant B", type BAU, Function = Digital Manufacturing.
- Activity 1 "Current support" — Jan 2026 to Jun 2026, 30 hrs/month (finite).
- Activity 2 "Handover period" — Jul 2026 to Dec 2026, 15 hrs/month (finite).
- Activity 3 "Residual support" — Jan 2027 onwards, 5 hrs/month (indefinite).

This turns BAU into a first-class tracked part of the pipeline — it shows on Capacity Validation as the BAU stack layer, contributes to Team Activity via its named allocations, and benefits from the same workflow and visualisations as Project work.

BAU Demands follow the direct Demand state machine (section 3): `Draft → Submitted → Approved → PartiallyAllocated → Allocated`. In practice BAU items move through this quickly since there's usually no real review gate for known support engagements.

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

Named allocation hours are read from the allocation's `hours_by_month[month]` (finite Activity) or `steady_state_hours` (indefinite Activity), identically to how they're read anywhere else.

**Submitted and Draft Demand items do not consume person-level capacity**, because those statuses have no real commitment of people — no allocations exist yet (Project-spawned Demands enter at Submitted with zero allocations; direct Demands hold zero allocations through Draft and Submitted).

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

**Capacity reconciliation invariants — added v1.18 to address Function-switch and Domain-capacity bugs**

The v1.17 build shipped with two latent capacity defects observed against the live deployment:

1. The Capacity Validation Section A chart ("Overall Function Capacity") did not change when a different Function was selected — it remained anchored to the initially-loaded Function regardless of the active Function selector value. The selector-not-prop pattern (section 11.17) was not being honoured by Section A's chart component.
2. Capacity Validation by Skill for Group IT Enterprise Solutions showed Data & Integration with apparent capacity for July–August 2026 when no Approved Demand existed there — pointing to either (a) capacity calculations including hours that should be netted off, or (b) a seed/aggregation mismatch that produced phantom headroom.

Both are evidence that capacity numbers were not being independently verified against the seed. The renderability invariant pattern from v1.12 (grey_band) closes this gap for grey-band; v1.18 extends the same pattern to capacity:

**Per-Function capacity reconciliation invariants** — on a fresh seed load with no overlay selected and the 12-month horizon, the following must hold for each active Function and each visible month:

- `function_capacity(function_id, month)` — must equal the sum of `person_capacity(person, month)` for all active People in that Function, with `available_from`/`available_to` respected. The Section A chart's capacity line in any given month must equal this number; if it doesn't, the chart and the aggregation are inconsistent.
- Switching the active Function from Digital Manufacturing to Group IT Enterprise Solutions must produce a **different** Section A capacity-line value in at least one visible month — verified as a runtime assertion. (Equality across Functions in every month would only happen if both Functions had identical headcount and contracted hours, which the seed is intentionally constructed to prevent.)
- Section A's chart component must read its data via the active-Function-aware selector pattern from section 11.17 — `selectActiveFunctionCapacityLine(store, month)` rather than a hard-coded function id captured at mount time. A regression test must verify that a Function-switch action causes Section A's data to recompute and the chart to re-render.

**Per-Domain capacity reconciliation invariants** — on a fresh seed load:

- For every Domain in every Function, `domain_capacity(domain_id, month)` for every visible month must equal the sum of `person_capacity(person, month) - real_committed_hours_outside_domain(person, month)` for People holding any Skill in that Domain. The values are independently computable from the seed and must be added to the seed assertion table in section 11.8.
- Specifically: on the Group IT Enterprise Solutions Function, `domain_capacity('data_integration', '2026-07')` and `domain_capacity('data_integration', '2026-08')` must be reconciled against an explicit seed-derived table in section 6 ("Group IT Enterprise Solutions — capacity reconciliation table"). Any mismatch between chart, aggregation, and table is a bug to investigate; the live deployment's apparent phantom headroom must be reproduced or shown not to occur from a fresh seed load.
- A runtime assertion (development builds) checks `domain_capacity` against the seed-derived table at load time; mismatches log a clear console error naming the (Domain, month, expected, actual) tuple.

Together with the existing grey-band invariant, these three layers (capacity, domain capacity, projection) form a complete renderability check across every chart on the Capacity Validation page. Their failure mode is loud (console errors with diagnostic detail) rather than silent (a chart that renders but is wrong).

#### 2.4.9 Programme / Project roll-up aggregation

Programme and Project roll-ups are named aggregation functions, implemented in the same shared module as the rest (section 2.4.8) and called from every view that surfaces roll-up numbers. Inline summation over child Demand items by individual callers is not acceptable.

Required functions:

- `project_internal_hours(project_id, month)` → number. Sum of all internal skill-shaped requirement target hours on this Project's Activities, scoped to the Functions whose child Demands are in status `Approved`, `PartiallyAllocated`, or `Allocated`. Excludes Functions whose Demand is in `Draft` or `Submitted`. Excludes external requirements. Direct Demands (which have no Project) are not included — they roll up via `direct_demand_internal_hours` instead.
- `project_external_hours(project_id, month)` → number. Sum of all external requirement `hours_by_month` / `steady_state_hours` on this Project's Activities. External requirements live on the Project and are independent of which Demands have been spawned or their statuses; any Project that is not Deleted contributes its external hours.
- `project_external_hours_by_provider(project_id, month)` → `{provider_id: number}`. Same as above, broken down per provider.
- `project_demand_count(project_id, status_filter?)` → number. Count of child Demands, optionally filtered by status set. (For Project-spawned Demands only — by definition there are no direct Demands under a Project.)
- `programme_internal_hours(programme_id, month)` → number. Sum of `project_internal_hours` across all Projects in this Programme.
- `programme_external_hours(programme_id, month)` → number. Sum across Projects.
- `programme_external_hours_by_provider(programme_id, month)` → `{provider_id: number}`. Sum across Projects.
- `programme_project_count(programme_id)` → number. Count of active Projects in this Programme.
- `direct_demand_internal_hours(month, {function_id?})` → number. Sum of internal skill-shaped requirement target hours across all **direct Demands** (those with `parent_project_id = null`) in status `Approved`, `PartiallyAllocated`, or `Allocated`. Optional `function_id` filter scopes to a single Function; omitted means all Functions.
- `direct_demand_external_hours(month, {function_id?})` → number. External hours across direct Demands.
- `unaligned_project_hours(month, {internal|external})` → number. For Projects whose Programme is null. Replaces the v1.17 `unaligned_demand_hours`.

**Functions for the Demand view (section 4.10) — v1.17, signatures revised in v1.18**

These functions answer "how much demand does a Programme/Project create over time, scoped to the active Function and respecting the user's external/other-Functions toggles?" They differ from `project_internal_hours` / `programme_internal_hours` in three respects: (1) configurable `status_set`; (2) configurable Function lens and toggles; (3) decomposition by funding source rather than a single scalar.

- `programme_demand_by_funding(programme_id, month, opts)` → `{InvestmentScheme: number, PlantSectorAllocation: number, Mixed: number}`. The opts object carries: `status_set` (`["Approved", "PartiallyAllocated", "Allocated"]` by default; `["Submitted", ...]` when "Include Submitted" is on); `function_id` (the active Function lens — required); `include_external` (boolean, default false — when true adds external hours to the same buckets); `include_other_functions` (boolean, default false — when true also includes hours from Demands belonging to other Functions on the same Project).

  Computation: for each Project in the Programme, take its Activities. For each Activity, compute the in-scope hours: sum the internal requirements whose Function matches `function_id` AND whose parent Demand is in `status_set` (Project-spawned). If `include_other_functions` is true, also include requirements whose Function is *not* `function_id` and whose corresponding sibling Demand on the same Project is in `status_set`. If `include_external` is true, also include all external requirements on the Activity (external hours are unfiltered by Function — externals do not have a Function — and unfiltered by `status_set`; rationale below). Add this hours total to the bucket for the Activity's `funding_source`.

- `project_demand_by_funding(project_id, month, opts)` → `{InvestmentScheme: number, PlantSectorAllocation: number, Mixed: number}`. Same semantics scoped to a single Project's Activities.

- `direct_demand_by_funding(month, opts)` → `{InvestmentScheme: number, PlantSectorAllocation: number, Mixed: number}`. For the "Direct Demands" virtual card on the Demand view (section 4.10). Sums hours across all direct Demands matching `function_id` and `status_set`, bucketed by each direct Demand's Activity funding sources. `include_external` adds the direct Demand's external hours; `include_other_functions` is meaningless for direct Demands (they have no sibling Demands on a shared Project) and is ignored when set.

**Removed in v1.18**:

- `programme_demand_by_team` and `project_demand_by_team` — the By-Team stacking option on the Demand view (section 4.10) is removed in v1.18. These functions are dead code and must be deleted from the aggregation module.

**`cross_function_demand_hours` — reframed in v1.18**

The original v1.16 semantics ("demand my Function's Demands are placing on other Functions") relied on a Demand being able to span multiple Functions, which is no longer possible in v1.18 (Demands belong to exactly one Function). The function is reframed for the v1.18 Project model:

- `cross_function_demand_hours(active_function_id, month, opts)` → `{by: 'function'} → array`. Returns hours from **other Functions' Demands on Projects shared with the active Function** — i.e. for each Project that has at least one Demand belonging to `active_function_id`, sum the requirements on the sibling Demands (Demands belonging to non-active Functions on the same Project), where the sibling Demand is in `status_set` (default Approved-onwards). Decomposed by receiving Function (the sibling Demand's `function_id`). *v1.19: the previous `by: 'team'` decomposition is removed alongside the elimination of `owning_team_id` on requirements; team-level cross-Function visibility is no longer surfaced.*

This is what Capacity Validation Section D consumes (section 4 View 1). Direct Demands are not surfaced through this function — they are not on shared Projects by definition.

**Implementation notes for v1.18 aggregation**:

- All functions live in the shared aggregation module (sections 2.4.8 / 2.4.9). No view computes these decompositions inline.
- Memoisation key includes the full `opts` object (sorted `status_set`, `function_id`, both toggle booleans). Flipping any toggle triggers fresh computation — the toggles change *what the aggregation is*, not just what's filtered client-side.
- External hours are unfiltered by Function (externals belong to a Project's Activities, not to a Function) and unfiltered by `status_set` (externals are committed and lined up before internal Demand work — same rationale as v1.17). The `status_set` parameter applies to the internal-hours portion only.
- Programme-level functions sum the corresponding Project-level functions across the Programme's active Projects. Inactive Projects contribute zero.
- Direct Demands are aggregated separately (`direct_demand_by_funding`); they are not summed into Programme or Project functions.

**Semantics notes**:

- External hours include all non-Deleted Projects regardless of `status_set` or sibling Demand status. Rationale: external resource is often known and being lined up well before any internal Demand is Approved.
- Internal hours follow the same committed-demand definition as the rest of the aggregation layer (`Approved` / `PartiallyAllocated` / `Allocated` only by default; `Submitted+` when "Include Submitted" is on).
- Roll-ups over a month range (for the Programme/Project summary blocks on the Demand view) are computed by summing the monthly function over the range.

**Where these functions are called**:

- **Demand view (section 4.10)** — `programme_demand_by_funding`, `project_demand_by_funding`, `direct_demand_by_funding` for the stacked-area charts on the Programme list, Project drill-down, and Direct Demands card.
- **Manage Demand (section 4.6) and Manage Projects (section 4.6.A)** — the existing scalar functions (`project_internal_hours`, `programme_internal_hours`, `direct_demand_internal_hours`) for group-header roll-up summaries.
- **Capacity Validation Section D (section 4 View 1)** — `cross_function_demand_hours`.
- **Programme/Project admin screens (section 5)** — compact roll-up blocks.

### 2.5 Worked examples of requirement composition

These examples exist to make the abstract model concrete.

**Example A — Multiple skills and multiple same-skill-different-level on one Activity**

Project "Site X MES Upgrade", Activity 1 "Design" (May–Aug 2026). All requirements are skill-shaped on entry. Hours are per-month, not flat:

| # | Skill | Level | May | Jun | Jul | Aug |
|---|---|---|---|---|---|---|
| R1 | MOM — MES Platform | Specialist | 20 | 40 | 60 | 60 |
| R2 | MOM — Workflow Design | Advanced | 40 | 80 | 80 | 40 |
| R3 | MOM — Workflow Design | Advanced | 0 | 40 | 40 | 40 |
| R4 | MI&V — HMI Design | Basic | 0 | 0 | 20 | 30 |

This shape is impossible to express cleanly with flat-rate hours — the Activity has a clear ramp-up, peak, and tail, and requirements start and end at different times within the Activity. R3 is a second MOM Advanced slot that only kicks in from June; R4 starts late for HMI work that depends on the workflow design being further along.

**Example B — Splitting a single requirement across multiple people at promotion**

Same project moves from Accepted to Allocated. R2 (MOM Advanced: 40/80/80/40 across May–Aug) is promoted and split between two people. Each named allocation carries its own `hours_by_month` derived from the original:

| Promoted from | Named to | May | Jun | Jul | Aug |
|---|---|---|---|---|---|
| R2 | Sarah | 30 | 56 | 56 | 30 |
| R2 | Chris | 10 | 24 | 24 | 10 |

The monthly totals still sum to the original (40/80/80/40). The tool tracks the promotion lineage so the user can see R2 was fulfilled by two named allocations. The capacity view credits Sarah and Chris separately in each month.

**Example C — Cross-domain demand item**

Project "NPD Line Y Integration" — the requirements span multiple Domains:

- Activity 1 "Specification" requires 1× MOM Advanced + 1× MI&V Advanced
- Activity 2 "Build" requires 2× MOM Specialist + 1× MBM Basic
- Activity 3 "Deploy" requires 1× MOM Basic + 1× MI&V Basic

The demand item's requirements pull capacity from three Domains, so its contribution appears against all three Domain charts on Capacity Validation, not just one. No "Primary Domain" label is stored or displayed — the Demand's shape emerges from its requirements.

### 2.6 External resource requirements

Some Demand items need resource from outside our team — other internal teams, Managed Services, contractors, OEM engineers, plant teams. The tool tracks this so a Demand item's resourcing picture is *complete*, but **external resource never enters our team's capacity calculations, charts, or projection grey bands**. Our team's capacity is and remains the primary lens. External requirements are recorded alongside internal skill-shaped requirements but live in a separate bucket from a computation perspective.

**External Resource Requirement** — sits on a Activity, alongside skill-shaped (internal) requirements.

| Field | Notes |
|---|---|
| Provider | Dropdown, admin-configured — see "Provider list" below. Required. |
| Role | Free text (e.g. "SCADA Engineer", "Historian Specialist", "Plant Electrician"). Required. |
| Hours representation | Same pattern as internal requirements: `hours_by_month` on finite Activities, `steady_state_hours` on indefinite Activities. Required. |
| **Function tag** | The Function that owns coordinating this external requirement. **Required from v1.19.** On a Project (Draft/Scoping), set during Scoping when the external requirement is created — defaults to the Project owner's primary Function if known, otherwise to the alphabetically-first Function from the Project's `functions_required` list, otherwise to the alphabetically-first Function from the Functions Actually Involved derivation. User-editable in Scoping. Used by the spawn rule (section 2.2.4) to route the external requirement onto the matching Function's spawned Demand. On a direct Demand, the Function tag is auto-set to the Demand's `function_id` and not user-editable (every external requirement on a single-Function Demand belongs to that Demand's Function by construction). |
| Notes | Free text, optional — context not captured by provider/role. |

A single Activity can hold zero, one, or many External Resource Requirements, independently of its internal skill-shaped requirements. A Activity that is *entirely* externally-resourced has zero internal requirements and one-or-more external requirements; a Activity that is *entirely* internal has the reverse; mixed is common and supported.

**Hours representation details**

- **Finite Activity**: external requirement carries `hours_by_month` keyed by YYYY-MM for every month the Activity spans. The same month-grid UI used for internal requirements applies (see section 4.5.2 Mode A).
- **Indefinite Activity**: external requirement carries `steady_state_hours` — a single flat monthly rate applying from `start_month` onwards.
- Changing the parent Activity between finite and indefinite follows the same rules as for internal requirements (section 2.2): finite→indefinite clears `hours_by_month` and prompts for a steady-state default (suggesting the average of existing per-month values); indefinite→finite regenerates the per-month grid pre-filled with the steady-state value.

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

- The Demand drawer (section 4.5.1) — visible as a dedicated external-requirements summary block below the internal Activity/requirement summary.
- The Demand edit page Mode A (section 4.5.2) — entered and edited alongside internal skill-shaped requirements, within each Activity card.
- The Demand edit page Mode B — read-only, same locking rules as internal requirement definitions.
- The Programme/Project roll-up totals (section 2.4.9), where external hours are surfaced as their own total broken down by provider.
- Per-Demand external-hours totals, used for roll-up and for the drawer summary.

**Worked example**

Demand item "Plant C MES Platform Migration", Activity 2 "Build" (Jul 2026 – Dec 2026). Finite Activity. Requirements as a mixed internal/external set:

Internal (skill-shaped):
- R1 — MOM Specialist, 80 hrs/mo across Activity
- R2 — MOM Advanced, 60 hrs/mo across Activity

External:
- E1 — Provider: Managed Services, Role: SCADA Engineer, 120 hrs/mo across Activity
- E2 — Provider: OEM, Role: MES Platform Vendor Support, 40 hrs/mo Jul–Aug only (ramp-down shape captured in `hours_by_month`)

The internal R1 + R2 hours contribute to MOM domain and skill charts exactly as before. The external E1 + E2 hours appear in the Demand drawer and Edit page, contribute to the Project-level external-hours roll-up broken down by provider, and are visible nowhere on the capacity charts.

---

## 3. Project and Demand workflow

*Substantially rewritten in v1.18.* The workflow now has **two state machines**: one for the Project (the planning vehicle) and one for the Demand (the per-Function execution slice). They are coupled at the spawn point: when a Project transitions Scoping → Submitted, it spawns one Demand per Function involved.

The Manage Projects view (section 4.6.A) surfaces the Project state machine; the Manage Demand view (section 4.6) surfaces the Demand state machine.

### Project statuses

| Status | Meaning | Capacity impact | Demand visibility |
|---|---|---|---|
| **Draft** | Being shaped by the originator. Name, type, owner, description, optional Programme, **Functions Required** (originator's hint at which Functions will engage in Scoping), and Activities (name, dates, funding source, funding notes). **No skills, levels, hours, or external resource requirements are entered in Draft** — Draft establishes the shape and the planning intent, not the technical detail. *v1.19: Teams Assigned removed.* | None — excluded from all capacity views. | No child Demands exist. |
| **Scoping** | Being scoped by users across the Functions involved. The Activities from Draft are now visible to Scoping users (typically led by the Functions in Functions Required, but not gated to those Functions); they fill in skill-shaped requirements (skill, level, hours) and external resource requirements (provider, role, hours, **Function tag**) on each Activity. The Skill picker is **scoped to the full Skill catalogue across all Functions** — Scoping users can add requirements under any Function, regardless of whether that Function was declared in Functions Required. The user who initiated scoping (typically the originator or the primary owning Function) decides when to submit — there is no auto-advance. *v1.19: Teams Assigned removed; per-team confirmation strip removed.* | None — excluded from all capacity views. | No child Demands exist. |
| **Submitted** | The Project has been submitted; one Demand per Function actually involved has been spawned in `Submitted` status, with their Activities and requirements materialised onto each Demand at spawn. The Project's own Activities and requirements become a frozen planning record. The Project page is read-only from this point in Manage Projects. | None at the Project level. The spawned Demands carry their own capacity treatment (see Demand statuses). | One child Demand per Function actually involved, all in `Submitted`. Each Demand owns its own materialised data. |
| **Approved** | **Auto** — every child Demand has reached `Approved` or beyond. | None at the Project level (the child Demands carry the capacity treatment). | One child Demand per Function actually involved, all in `Approved` / `PartiallyAllocated` / `Allocated`. |
| **Allocated** | **Auto** — every child Demand has reached `Allocated`. | None at the Project level. | All child Demands in `Allocated`. |

### Demand statuses

| Status | Meaning | Capacity impact |
|---|---|---|
| **Draft** | **Direct Demands only.** Being shaped by the originator. Single Function from creation. Activities, internal requirements, and external requirements all live on the Demand. | None — excluded from all capacity views. |
| **Submitted** | Ready for capacity assessment. For Project-spawned Demands: created in this status when the parent Project is Submitted, with Activities and requirements materialised onto the Demand at spawn. For direct Demands: reached via Submit from Draft. **The Demand definition is editable in this status** *(v1.19 change)* — the owning Function can refine skills, levels, hours, and external requirements before approving. For direct Demands Activities are also editable in Submitted. **The lock point on Demand definition is Approve, not Submit.** | Shown as overlay on Capacity Validation charts when selected (see View 1). Not counted as committed. |
| **Approved** | The Function has committed to doing this work. Named allocation has not yet started. **The Demand's definition becomes read-only on Approve** — Activities, internal requirements, and external requirements are locked from this point onwards. | Counted as committed at domain/skill level. Contributes to demand stacks on charts. No individual capacity is consumed yet (no named people). |
| **PartiallyAllocated** | Allocation has started but is incomplete — at least one named allocation exists, but not every requirement-month is fully covered. | Counted as committed. Named allocations consume individual capacity; unfilled portions remain as skill-shaped demand at domain/skill level. |
| **Allocated** | Every requirement's per-month hours are fully covered by named allocations across every month of every visible Activity. | Fully counted. All demand lands on named individuals. |

There is no `Parked` status, no `Closed` status, and no `Archive` view in v1.18. The only off-flow action is **Delete** (with cascade — see "Deletion" below).

### Project state machine

```
  ┌────────┐
  │ DRAFT  │
  └───┬────┘
      │
      │ (Submit for Scoping — manual)
      ▼
  ┌─────────┐
  │ SCOPING │
  └────┬────┘
       │  (Submit — manual; spawns child Demands atomically)
       ▼
  ┌───────────┐
  │ SUBMITTED │
  └────┬──────┘
       │
       ▼ (auto: all child Demands ≥ Approved)
  ┌──────────┐
  │ APPROVED │
  └────┬─────┘
       │
       ▼ (auto: all child Demands = Allocated)
  ┌───────────┐
  │ ALLOCATED │
  └───────────┘
```

The reverse system transitions are also defined (a child Demand reverting from Allocated to PartiallyAllocated drops the parent Project from Allocated to Approved). See "System-driven Project transitions" below.

### Demand state machine

```
  Direct Demand only:
  ┌────────┐
  │ DRAFT  │
  └───┬────┘
      │
      │ (Submit — manual)
      ▼
  ┌───────────┐
  │ SUBMITTED │  ◄── Project-spawned Demand entry point
  └─────┬─────┘
        │
        │ (Approve — manual, per Demand)
        ▼
  ┌──────────┐
  │ APPROVED │
  └────┬─────┘
       │
       │ (auto: first named allocation added)
       ▼
  ┌─────────────────────┐
  │ PARTIALLYALLOCATED  │
  └────┬────────────────┘
       │
       │ (auto: every req-month fully covered)
       ▼ ▲ (auto: drops below 100%)
  ┌────────────┐
  │ ALLOCATED  │
  └────────────┘
```

### Project transition reference

User-driven Project transitions:

| From | To | Action label | Notes |
|---|---|---|---|
| Draft | Scoping | **Submit for Scoping** | Project must have at least one Activity and at least one entry in Functions Required. Button is disabled otherwise with an inline hint identifying what's missing. *v1.19: the previous "every Activity must have at least one team assigned" gate is removed alongside the Teams Assigned model.* |
| Scoping | Submitted | **Submit Project** | **Manual.** On click, the spawn rule (section 2.2.4) executes: one Demand per Function actually involved is created in `Submitted` status, with Activities, internal requirements, and external requirements materialised onto each Demand. If the Project has zero internal requirements (no Functions actually involved), the action is blocked with an inline error. The confirmation dialog (section 11.18) surfaces the spawn outcome (which Demands will be created, with materialised hour totals) — the user confirms to proceed. *v1.19: the previous unconfirmed-team-assignments warning is removed alongside the Teams Assigned model.* |

System-driven Project transitions:

| From | To | Trigger |
|---|---|---|
| Submitted | Approved | All child Demands have transitioned to `Approved`, `PartiallyAllocated`, or `Allocated`. |
| Approved | Submitted | A child Demand reverts to `Submitted` (rare in v1.18 — there are no user transitions back to Submitted, but a child Demand could be Deleted and re-created via Project edit; see Project edit rules below). |
| Approved | Allocated | All child Demands have transitioned to `Allocated`. |
| Allocated | Approved | A child Demand drops from `Allocated` to `PartiallyAllocated` (e.g. an allocation is removed). |

Transitions that are **not** permitted at the Project level:

- Project Draft → anywhere except Scoping.
- Project Scoping → anywhere except Submitted.
- Submitted, Approved, Allocated → backwards. The Project is not user-mutable from Submitted onwards; lifecycle progresses or completes via its child Demands.

### Demand transition reference

User-driven Demand transitions:

| From | To | Action label | Notes |
|---|---|---|---|
| Draft *(direct only)* | Submitted | **Submit Demand** | Direct Demands only. Button is disabled when the Demand has zero Activities or zero requirements, with an inline hint. The Demand becomes read-only on its definition from Submitted onwards. |
| Submitted | Approved | **Approve** | Confirms the Function will do this work. Same action regardless of origin (Project-spawned or direct). |

System-driven Demand transitions:

| From | To | Trigger |
|---|---|---|
| Approved | PartiallyAllocated | The first named allocation is added to any requirement on the Demand. |
| PartiallyAllocated | Allocated | Every requirement's per-month hours are fully covered by named allocations across every month of every visible Activity (see "Full allocation definition" below). |
| Allocated | PartiallyAllocated | A named allocation is removed or reduced such that coverage drops below 100% on any requirement-month. |

Transitions that are **not** permitted at the Demand level:

- Submitted → Draft. (Removed in v1.18 — this was Revert-to-Draft.)
- Approved → Submitted. (Removed in v1.18 — this was Revise.)
- PartiallyAllocated / Allocated → Submitted or Approved directly. (No user-driven backwards transitions; status is auto from allocation coverage.)
- Project-spawned Demand: any transition that would orphan it from the parent Project. The parent Project's lifecycle constrains the Demand's lifecycle — child Demands cannot be Deleted independently of the Project (see Deletion).

### Project workflow narrative

The three working stages of a Project — Draft, Scoping, Submitted — each have a single dominant purpose. Approved and Allocated are status reflections of the underlying Demands' progress, not user actions.

**Draft — shape the project and decide who scopes it.**

In Draft, the Project owner (typically an end user in the business) captures everything that defines the *shape* of the work without committing any specific resourcing detail. Fields available:

- Name, type, owner, description.
- Optional Programme.
- **Functions Required** — multi-select picker of which Functions the originator thinks should engage in Scoping. **This is a hint, not a binding constraint** — Scoping users can add requirements under any Function regardless of what's declared here. The list is shown to Scoping users at the top of the Scoping page as planning context ("Originator expected: MOM, MI&V, Group IT") so they know which Functions were anticipated.
- Activities — for each Activity: name, start month, end month (or indefinite toggle), funding source, funding notes.

Skills, levels, hours, internal requirements, and external resource requirements are **not entered in Draft**. The skill-shaped requirements list and external resource requirements list are hidden on each Activity card. The "+ Add Internal Requirement" and "+ Add External Requirement" actions are not present.

*v1.19 note: per-Activity Teams Assigned is removed. Teams play no part in the Project workflow — they remain an organisational concept under People for capacity grouping but do not gate or route any planning step.*

**Submit for Scoping** is enabled when the Project has at least one Activity and at least one entry in Functions Required. It is disabled otherwise with an inline hint identifying what's missing.

**Scoping — fill in the technical detail.**

On entry to Scoping, the Activities from Draft become visible to Scoping users. Functions Required is shown as a soft signal at the top of the page ("Originator expected: …") for planning context, but the Skill picker is **scoped to the full Skill catalogue across all Functions** — no Function is gated. For each Activity a user can:

- Add, edit, or remove **internal skill-shaped requirements** (skill, level, hours, notes). The DOMAIN > SKILL selector shows every Skill across every Function, grouped by Function and then by Domain. Adding a requirement under a Function not in Functions Required is allowed and surfaces a small informational badge ("Function X added during Scoping — wasn't in originator's plan") to make the discovery visible without blocking it.
- Add, edit, or remove **external resource requirements** (provider, role, hours, **Function tag**, notes). The Function tag picker on each external requirement defaults to the Project owner's primary Function (if discoverable) or the first Function alphabetically from Functions Required, and is user-editable. The Function tag determines which spawned Demand the external requirement is materialised onto at Submit.

**Functions Required is editable in Scoping** (lower friction than forcing a Draft round-trip when a new Function is needed mid-scope) — adding a Function to the list is a routine planning revision. Removing a Function from Functions Required does **not** remove its requirements (those are real planning artefacts and shouldn't be silently dropped); a confirm prompt warns "X requirements under [Function] will remain — those Functions will still spawn Demands at Submit. Continue?" If the user proceeds, only the planning declaration changes; actual involvement remains derived from requirements.

**Exit from Scoping — Submit Project**: the user clicks **Submit Project** from the drawer footer (section 4.5.1 — Project drawer) or the edit page. The confirmation dialog (section 11.18) surfaces the spawn outcome — which Demands will be created and the materialised hour totals per Demand. On confirmation, the spawn rule (section 2.2.4) executes atomically: each Function's Demand is created in Submitted status with its own copy of the Function-scoped Activities and requirements. The Project's `activities`, `internal_requirements`, `external_requirements`, and `functions_required` are frozen at this point as a planning audit record.

If the Project has zero internal requirements the dialog is replaced by a blocking error explaining that no Demands can be spawned.

**Submitted — Demands are out for capacity assessment.**

The Project is now read-only. Editing Activities, requirements, Functions Required, or any other field is not permitted in v1.19 — to change them, the user would Delete the Project (cascading delete of all child Demands and allocations) and recreate. **In Manage Projects the page is view-only from this status onwards.** All further user action on the work happens via Manage Demand on the individual spawned Demands.

The page surfaces the spawned Demands as a read-only summary: one row per child Demand showing Function, status, hours summary, and a deep-link to the Demand's drawer. The Project's own Activities and requirements (the frozen planning record) are shown below in a "Planning record at Submit" section for human reference.

**Approved — all Functions have committed.**

Auto status. The Project's child Demands have all transitioned to Approved or beyond. No user action exists at the Project level — the lifecycle continues through allocation work on each Demand individually. Manage Projects continues to display the Project view-only.

**Allocated — all Functions have fully allocated.**

Auto status. Every child Demand is `Allocated`. The Project remains visible in the Allocated column of Manage Projects until manually Deleted. Manage Projects continues to display the Project view-only.

**Excel import — Submitted on landing (alternative entry path).**

Projects created via the Excel import flow (section 4.6.A.1) skip Draft and Scoping entirely. The import process creates the Project record, materialises its Function-scoped child Demands via the spawn rule, and lands the Project directly in `Submitted` status — all in one atomic transaction at the moment the user confirms the Import preview. The preview screen plays the role of the Submit-Project confirmation dialog (section 11.18) — it is the deliberate-commitment moment that would otherwise be the manual Submit-Project click.

Imported Projects carry an empty `functions_required` list (no originator declaration was made — the import workbook is the post-Scoping technical detail). Functions Actually Involved is derived from the imported Skill rows, as for any other Project. The drawer body's "Required (originator's plan):" line shows "not declared (imported)" rather than an empty chip row, to make the import origin visible.

### Demand workflow narrative

**Draft *(direct Demands only)* — shape the demand fully.**

A direct Demand in Draft is created from Manage Demand via the "+ New Direct Demand" button. The Demand owner captures:

- Function (set at creation, immutable).
- Name, type, owner, description.
- Activities (name, dates, funding source, funding notes).
- Internal skill-shaped requirements (skill — DOMAIN > SKILL selector scoped to the Demand's Function — level, hours, notes).
- External resource requirements (provider, role, hours, notes — Function tag is auto-set to the Demand's Function and not user-editable).

There is no separate Scoping step — the originator is the same Function that will execute, so the technical detail is captured in Draft directly.

**Submit Demand** is enabled when the Demand has at least one Activity and at least one internal requirement. The transition flips status to Submitted; the Demand's edit surface remains active (Submitted is editable in v1.19).

**Submitted — capacity assessment, refinement, and approval.**

*v1.19 change: Submitted is now an editable working state, not a read-only one.* The owning Function uses Submitted to refine the technical detail of the Demand against the realities of capacity before approving — adjusting hours per month, swapping skill levels, adding/removing requirements, tweaking external arrangements. The page presents the same edit affordances as Scoping (for Project-spawned Demands) or Draft (for direct Demands), with one important exception for Project-spawned Demands: Activities are read-only, because Activities are part of the Project's planning shape and shouldn't be reshaped by a single Function in isolation. Direct Demands can edit Activities freely in Submitted.

What's editable on a Submitted Demand:

- **Project-spawned Demand**: name, type, owner, description, internal requirements (skill, level, hours, notes — add/edit/remove), external requirements (provider, role, hours, notes — add/edit/remove). Activities are read-only.
- **Direct Demand**: all fields including Activities.

The user assessing the Demand has two footer actions:

- **Model Capacity** — opens the Capacity Validation view with this Demand pre-selected as the overlay (see section 11.11). Decision-support; does not change state.
- **Approve** — primary forward action, commits the Demand. **On Approve, the Demand's definition is locked** — Activities, internal requirements, and external requirements become read-only from this point onwards.

There are no Revert-to-Draft, Park, or other footer alternatives in v1.19.

**Approved — pending allocation. Definition is locked.**

The Demand is committed at skill level and counted on the Capacity Validation charts. The definition (Activities, internal requirements, external requirements) is now locked — to change it, the only path is Delete-and-recreate. The primary action is **Allocate**, which navigates to the edit page in Mode B (Allocation Workspace) — see section 4.5.2 Mode B.

**PartiallyAllocated, Allocated** — auto status from allocation coverage. Allocate remains the primary action on PartiallyAllocated (more allocation work to do); Allocated has no footer primary CTA. Definition remains locked.

### Scoping workflow — detailed reference (Project)

This applies to Projects in Scoping status. The behaviour above describes the user-visible flow; this section captures the data-model rules.

**Entry into Scoping**: the user clicks **Submit for Scoping** from a Project Draft. The button is enabled only when the Project has at least one Activity and at least one entry in Functions Required. On click, the status flips from Draft to Scoping.

**During Scoping**: any user opens the Project in Mode A (see section 4.5.2). The skill-shaped and external requirement UIs are now visible on each Activity card. The Skill picker is scoped to the **full Skill catalogue across all Functions** — Scoping users can add requirements under any Function regardless of whether it's in Functions Required. Adding a requirement under a Function not in Functions Required surfaces an informational badge ("Function X added during Scoping — wasn't in originator's plan") to make the discovery visible.

External requirements carry a **Function tag** field at this stage — picker defaults per section 2.6, user-editable. The tag determines which spawned Demand the external requirement is materialised onto at Submit.

**Functions Required** itself remains editable during Scoping (it's a planning declaration, and adjusting it is normal as Scoping unfolds). Removing a Function from Functions Required when requirements exist under it surfaces a confirm prompt; the requirements remain regardless (those Functions still spawn Demands at Submit).

**Exit from Scoping**: the user clicks **Submit Project** from the drawer footer or the edit page. The confirmation dialog (section 11.18) surfaces the spawn outcome — Demands to be spawned and materialised hour totals per Demand. On confirmation, the spawn rule executes — see "Spawn rule" below.

### Spawn rule (Project Scoping → Submitted)

Defined in full in section 2.2.4. Briefly:

- Compute Functions actually involved from the Project's internal requirements: `{r.skill.domain.function_id}` across all Activities. (Functions Required is **not** consulted by the spawn — actual requirements are the source of truth.)
- For each Function, create a Demand with `parent_project_id = project.id`, `function_id = <Function>`, `status = Submitted`, name `<Project name> — <Function name>`, type/owner/description copied from the Project, and **materialised** Function-scoped Activities, internal requirements, and external requirements (the latter routed by their Function tag).
- Atomic: if the spawn cannot complete (e.g. zero Functions actually involved), the Project's status flip is rolled back.

After spawn, each Demand owns its own data and is independently editable in Submitted (subject to the Demand-level locking discipline below). The Project's Activities/requirements are frozen as a planning audit record.

### Allocation editing

Once a Demand (Project-spawned or direct) is in Approved, PartiallyAllocated, or Allocated, the user can freely:

- Add, remove, or modify named allocations to any requirement.
- Change the per-month hours on any named allocation.
- Add further named people to cover gaps.

No status change is needed before editing allocations. The status auto-updates based on the coverage rule.

**Definition lock — at Approve, not at Submit (v1.19 change)**

What the user **can** do in Submitted on a Demand (the v1.19 working state):

- Edit internal skill-shaped requirements (skill, level, target hours, notes — add/edit/remove).
- Edit external resource requirements (provider, role, hours, notes — add/edit/remove).
- Edit Demand metadata (name, type, owner, description) for both Project-spawned and direct.
- Edit Activities (name, dates, funding source, funding notes — add/edit/remove) — **direct Demands only.** Project-spawned Demands have read-only Activities (those belong to the Project's planning shape).

What the user **cannot** do in Approved, PartiallyAllocated, or Allocated:

- Edit the underlying skill-shaped requirements (skill, level, target hours).
- Add, remove, or change Activities.
- Edit Demand metadata that affects the resourcing picture (type, owner, Activity dates).
- Edit external resource requirements (provider, role, or hours).

These are locked from Approve onwards. To change them, the only path is Delete-and-recreate — for direct Demands, deleting the Demand cascades its allocations; for Project-spawned Demands, deleting the parent Project cascades the Demand and its allocations (Project-spawned Demands cannot be Deleted independently).

This is deliberate friction at the Approve step. v1.19 lets the owning Function refine technical detail freely while in Submitted; the Approve commitment crystallises that detail and shifts the workspace to allocation. Richer lifecycle controls (Park, Revert, Revise) remain off-roadmap pending real-world validation of the v1.19 model.

**Project read-only point — at Submit, unchanged from v1.18**

The Project itself is read-only from Submitted onwards in Manage Projects. Editing the Project's planning record (its frozen Activities/requirements) is not possible. To change anything at the Project level, the only path is Delete the Project (cascading to all child Demands and their allocations) and recreate.

### Full allocation definition

A Demand is **fully allocated** — and auto-transitions to `Allocated` — when every internal skill-shaped requirement on this Demand has named allocations such that, **for every single month in the parent Activity's date range**, the sum of named allocation hours is at least equal to the requirement's `hours_by_month` value for that month.

- Over-allocation against a requirement's hours (named allocations summing to more than the per-month target) does not block fully-allocated status — it triggers a validation warning instead. (Person-level over-allocation rules from section 2.4.7 apply separately.)
- Partially-allocated months (named allocations summing to less than the requirement's per-month target) keep the Demand in PartiallyAllocated.
- The unfilled portion of each requirement-month remains as skill-shaped demand on the capacity charts.

### The skill-shaped → named relationship

Skill-shaped requirements are the *definition* of demand. Named allocations are the *fulfilment* of that demand. They are separate records, linked by reference.

- Each named allocation belongs to a specific skill-shaped requirement (its parent).
- A named allocation carries: person, `hours_by_month`, notes.
- A named allocation lives on the Demand (Project-spawned or direct), referencing the requirement (which lives on the parent Project for spawned Demands, or on the Demand itself for direct Demands).
- Multiple named allocations can fulfil a single skill-shaped requirement (e.g. 80 hrs/month split as Sarah 50 + Chris 30).
- A named allocation's person must hold the parent requirement's skill at the required level or higher (warn, don't block).
- The person must belong to the same Function as the Demand (a Demand's Function determines the candidate pool).

### Deletion

There is no Park or Close in v1.18+ — Delete is the only off-flow action. Two cascade rules:

**Project Delete** — permitted in any Project status, including Submitted, Approved, and Allocated. Cascade:

- All child Demands of the Project are deleted.
- All named allocations attached to those Demands' requirements are deleted.
- All Demand-owned Activities, internal requirements, and external requirements (which were materialised at spawn) are deleted along with their parent Demands.

*v1.19: the previous `ProjectTeamAssignment` records are no longer part of the cascade — Teams Assigned has been removed from the Project model.*

A confirmation dialog surfaces the cascade scope: *"This Project has 2 child Demands with 14 named allocations across 3 Activities. Deleting will permanently remove all of them. Continue?"* The dialog uses a destructive action treatment (red primary button) and requires explicit confirmation. No undo.

**Demand Delete** — for direct Demands only. Project-spawned Demands cannot be Deleted independently — Delete the parent Project to remove them. Cascade:

- The Demand and its Activities, internal requirements, external requirements, and named allocations are deleted.

A confirmation dialog surfaces the cascade scope: *"This Demand has 5 named allocations across 2 Activities. Deleting will permanently remove all of them. Continue?"* Same destructive treatment.

Delete is reachable from the drawer overflow menu (kebab) on every status, and from the edit page header. It is never a footer primary.

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

1. **Section A — Overall Function Capacity** (top, always visible, prominent)
   - A single chart showing total capacity for the **active Function** as a line, with demand stacked by Project Type (in `display_order` order — see section 2.1.2) against that line.
   - Answers "do we have enough people in this Function to do the work in aggregate?"
   - Over-capacity months are clearly signalled on this chart.
   - **Re-renders on Function switch** — when the active Function changes (section 4.9), the capacity line, demand stack, and any over-capacity treatment recompute from the new Function's people, skills, and demand. The chart label remains "Overall Function Capacity" — no Function name is interpolated into the heading itself; the active Function is already obvious from the global Function selector in the header.

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
3. **Committed demand stack** — drawn from the x-axis upward. Work in status `Approved`, `PartiallyAllocated`, or `Allocated` that targets this chart's domain/skill. Stacked by **Project Type in `display_order` order, bottom-to-top** (lowest `display_order` at the bottom). With seed Project Type records the stack is BAU at the bottom, then NPD Demand, then Plant Project, then Group Strategy Project at the top — but the order is data-driven from section 2.1.2, not hardcoded. Solid fill, using each Project Type's `colour_token` from the design-system palette.
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

**"Model Capacity" — arriving with a pre-selected overlay**:

The Capacity Validation view can be deep-linked from a Submitted demand's drawer via a "Model Capacity" action (see section 4.5.1). When arriving this way:
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
- Single-item overlay selector for Submitted items belonging to the active Function (combobox pattern; one overlay at a time; `function_id = activeFunctionId` filter — see section 11.2). The Programme/Project filter further narrows which Submitted items are eligible for overlay — when a Programme/Project filter is active, only Submitted items aligned to that scope appear in the overlay picker.
- Grey band rendering and hover breakdown on every domain/skill chart.
- Over-capacity summary strip with three signal types (over-capacity, over-capacity-with-overlay, projection shortfall).
- Drill-down on chart click.
- Live recalculation within ~200ms on edits to demand, Activities, requirements, allocations, or status changes.
- **"Show external resource" toggle** — controls visibility of Section C (external-provider demand from Demands touching the active Function). Default off.
- **"Show demand on other Functions" toggle** — controls visibility of Section D (demand my active Function's Demands are placing on other internal Functions). Default off.

**Note on the absent Team filter**: earlier versions of this spec included a Team filter on the Capacity Validation toolbar. It has been removed in v1.16 because the Capacity Validation view is conceptually a **Functional Domain/Skill pool** view — a Team is an organisational label over people, but the skill pool that appears on these charts is defined by who holds the relevant skills in the active Function, not by who happens to be in which team. A team-level capacity line would misrepresent the polymorphic-capacity principle (a person can flex across skills, and teams do not own skill pools). If team-level visibility is needed, use Team Activity (View 2) grouped by Team — that's where team-level detail belongs.

**Section C — External Resource Demand** (shown when "Show external resource" toggle is on)

This section sits below Section B and is toggled independently from the rest of the view. It provides planning visibility into external resource hours (truly external providers — OEMs, contractors, managed services) — it is **not** a capacity chart and must be visually distinct from Sections A and B.

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
- Section C is scoped by the active Function: only external requirements on Demands that also have at least one internal requirement targeting the active Function's Skills are included. (Rationale — external requirements belong to specific Demands, and from the active Function's perspective the relevant external effort is the external effort on "its" Demands — i.e. Demands in which the active Function is involved. An external requirement on a Demand that has no active-Function involvement at all is not shown on this Function's chart.)
- The time horizon preset applies identically.
- Section C reads from the existing `project_external_hours_by_provider` and `unaligned_demand_hours` aggregation functions (section 2.4.9), with the active-Function scoping applied at read time — no new aggregation functions are required.

**Section D — Other Functions' Demands on Shared Projects** *(reframed in v1.18)* (shown when "Show demand on other Functions" toggle is on)

This section sits below Section C (or below Section B when Section C is off) and is toggled independently. It provides planning visibility into work being done by **other Functions on Projects we share with them** — i.e. *for Projects where my Function has a Demand, what are the other Functions doing alongside us?*

A prominent section header reads: **"Other Functions' Demands on Shared Projects"** with an inline info note: *"This shows internal skill demand from other Functions' Demands on Projects we share. These hours consume other Functions' capacity, not mine — they do not affect this page's capacity charts."*

**Scope definition — the exact set of Demands this section shows**:

Take every Project P such that P has **at least one** spawned Demand belonging to the active Function. For each such P, surface the requirements on P's Activities that target Skills in **Functions other than the active one** — those requirements are visible to (and presented through) the corresponding sibling Demands on those other Functions. Direct Demands are by definition not on shared Projects and never appear here.

Worked example: the active Function is Digital Manufacturing. Project "Plant C MES Platform Migration" has spawned three Demands — DM (MOM, MI&V requirements), Group IT (Data Integration requirements), and possibly one more. Because the Project has a DM Demand, it qualifies. The Group IT requirements (and the Group IT Demand they belong to) appear in Section D. A separate Project "Corporate ERP Refresh" with only Group IT requirements and no DM Demand is excluded — DM has no stake in it.

The section contains two sub-sections:

**Sub-section D1 — Overview chart**
- A single stacked area chart. X-axis: months, aligned with the rest of the page. Y-axis: total internal skill-shaped requirement hours from other Functions' Demands on shared Projects.
- Stacked **by receiving Function** — each other Function gets a distinct colour from the design system palette (reusing the work-type palette's distinct-hue branch, specified in `DESIGNSYSTEM.md`). A legend identifies each Function.
- **No capacity line. No grey band. No projection.** This chart is other Functions' work shown for awareness — their capacity treatment is their concern, not represented here. Visual treatment mirrors Section C (planning visibility only).
- Hover tooltip: month, total hours, per-Function breakdown.
- Clicking a Function's stack segment drills into Sub-section D2's detail for that Function (or if D2 is already expanded, scrolls to the corresponding chart).

**Sub-section D2 — Per-Function breakdown**
- One chart per receiving Function that has any non-zero hours in the visible horizon.
- Each chart shows that Function's hours over time, stacked by **shared Project** — each contributing Project gets a distinct colour segment. (Note: this is per-Project, not per-Demand-name, because each Project surfaces exactly one Demand per receiving Function — naming would be redundant.)
- Same chart card sizing as Section C charts for visual consistency.
- Hover tooltip: month, receiving Function, total hours, contributing Project names with per-Project hours.

*v1.19: the previous team drill-down sub-view is removed. Cross-Function visibility stops at Project-level decomposition — drilling further into receiving Teams is not surfaced because Teams no longer attach to requirements.*

**Section D scope rules**:
- The Programme/Project filter applies: when active, in-scope Projects (those with an active-Function Demand) are further filtered to those that match the selected Programme/Project.
- The active-Function lens is what defines "my Function" — switching the Function selector (section 4.9) changes the set of in-scope Projects and the set of "other Functions" surfaced.
- The time horizon preset applies identically.
- Only internal skill-shaped requirements are included. External requirements (section 2.6) are Section C's concern, not Section D's.
- Direct Demands are excluded — they have no parent Project so cannot be "shared."
- Section D reads from `cross_function_demand_hours(active_function_id, month, {by: 'function' | 'project' | 'team'})` in the shared aggregation module (see section 2.4.9). The function returns the appropriate decomposition for D1 (`by: 'function'`), D2 Project view (`by: 'project'`), or D2 Team drill-down (`by: 'team'`).


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
  - **Domain grouping** (default): rows grouped under Domain headers (MOM, MI&V, MBM). A person appears under a Domain if they hold **at least one Skill belonging to that Domain** in their skill profile. A person who holds Skills across multiple Domains appears under each relevant Domain — their utilisation bar shows **total utilisation** (all commitments across all Domains and Skills, identical regardless of which Domain header they appear under), consistent with the Skill detail view rationale (section 4.8): overall availability determines who can be called upon, not per-Domain partial utilisation. Domains with no skill-holders in the active Function are not rendered (no empty Domain groups). *(v1.21 bug-fix: the previous implementation failed to render any rows in Domain grouping mode because the person-inclusion predicate was missing — the view attempted to group people by Domain without a defined rule for which people belong to which Domain.)* This is the PMO view — shows skill-pool utilisation at a glance.
  - **Team grouping**: rows grouped under Team headers (e.g. Central Delivery Team, Plant Team A). Each team header shows a **team summary bar** — a rolled-up aggregate stacked bar representing the team's total committed hours as a proportion of total contracted hours for the team, using the same work-type colour segments. This is the Team Lead view — shows whether the team as a whole is over or under committed before reading individual rows.
- Horizontal time axis, monthly, default 6 months (with the same preset switches as View 1: 6 / 12 / 24 / 60).
- Each **cell** is a horizontal stacked bar whose full width represents the person's contracted hours for that month.
- **Cross-team allocation signal**: when a person's cell includes hours for a requirement whose `owningTeamId` differs from their own `teamId`, that allocation segment receives a thin contrasting border. Hovering the segment shows "Cross-team: [Demand name] owned by [Other Team name]." This makes cross-team borrowing visible in the grid without being visually noisy at normal scale.

**Cell composition — stacked horizontal bar**:

Each cell shows segments in a fixed left-to-right order, with widths proportional to committed hours. The **Project Type segments appear in `display_order` order** (see section 2.1.2) — left-to-right matches the Capacity Validation chart's bottom-to-top stack ordering, so a viewer scanning between views sees the same colour at the same relative position. With seed Project Types this is:

1. **BAU** (leftmost — `display_order = 0`)
2. **NPD Demand** (`display_order = 1`)
3. **Plant Project** (`display_order = 2`)
4. **Group Strategy Project** (`display_order = 3`)
5. **Available Capacity** (rightmost — the remainder of contracted hours not yet committed; not a Project Type)

**Colours are read from each Project Type's `colour_token`**, consistent with the Capacity Validation charts (section View 1). Available Capacity uses a neutral/muted tone to visually step back — it's not a Project Type, it's the headroom.

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
- Parent Activity name

Clicking a specific segment (e.g. the BAU segment) can filter the drill-down list to that work type. Clicking the Available Capacity segment shows a simple message confirming available hours and (where relevant) lists demand items whose Submitted status means they *could* land there (useful when Team Activity is viewed in conjunction with the Submitted overlay workflow, though this is a secondary affordance).

**Required features**:
- Filter by Domain, by Person, by work Type. The **Domain filter** works in both grouping modes: in Domain grouping mode, it collapses the view to show only the selected Domain's group. In Team grouping mode, it filters the person list within each Team to only those people who hold at least one Skill in the selected Domain — people with no skills in the filtered Domain are hidden. *(v1.21 clarification: the Domain filter's person-inclusion predicate matches the Domain grouping rule — a person is included if their skill profile contains at least one Skill belonging to the filtered Domain.)*
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

### 4.5 Project and Demand — viewing and editing

*Substantially revised in v1.18.* Both Projects and Demands are viewed through a **drawer** and edited on a **full page**. These are two distinct surfaces with different purposes — preview vs editor — and they share the same layout vocabulary (header / status / body / footer for the drawer; Mode A / Mode B for the edit page).

The Project surface and Demand surface differ in **which fields they hold**, **which transitions are valid**, and **which footer buttons appear** — but they share the visual structure. Where the spec below says "the entity," it applies to both Projects and Demands unless explicitly differentiated.

#### 4.5.1 The Drawer (read-only preview)

A side-panel drawer shown when a user clicks into a demand item from any view (Capacity Validation chart segment, Team Activity block, Demand list row).

**Purpose**: fast glance at what a Project or Demand is, without leaving the current view. Optimised for *understanding*, with a **clear next-step CTA** that reflects where the entity sits in its lifecycle.

**Layout** — the drawer has four distinct zones:

1. **Header zone** (top)
   - **Left side** *(Project drawer)*: Project name as the primary heading on its own row, full width — no separator characters, no Programme prefix. The Programme is reference context and lives in the body zone, not the header. Below the name, on its own row, the Type badge. Below that, Owner in muted text.
   - **Left side** *(Demand drawer)*: Demand name as the primary heading on its own row. The Demand's auto-generated name is `<Project name> — <Function name>` (editable thereafter), which is already self-describing — no additional prefix or hierarchy in the title. Below the name, on its own row, the Type badge plus a small Function chip (the Demand's Function). Below that, Owner in muted text.
   - **Programme and parent-Project context lives in the body zone, not the header.** This is a deliberate change in v1.19 — earlier versions packed Programme › Project hierarchy into the title row, which truncated on long names and depended on chevron-character font support that wasn't reliable across rendering contexts. The body zone is where reference fields belong; the title's job is to identify which entity you're looking at, not to provide hierarchical context.
   - **Right side**: **Edit** button (prominent styling, aligned to the right edge), then the **Overflow menu** (kebab / ⋯) button, then the **Close drawer** (×) button. The Edit button is the always-available entry into the full edit page and is consistent across every status — this is the mental-model constant that lets users reach any field at any time. (Note: for Project-spawned Demands, Edit opens Mode B; the parent Project's definition is read-only from this Demand and reachable via the parent-Project link in the body zone.) On Submitted/Approved/Allocated Projects in Manage Projects, the Edit button is replaced by a **View** button (section 4.6.A) — same position, same styling treatment, opens the page in fully read-only mode.
   - The overflow menu contains actions that aren't part of the primary workflow for the current status. See the **Overflow menu contents** table below.

2. **Status zone** (inline, just below the header)
   - Status pill shown prominently.
   - **No buttons in this zone.** Status transitions have moved out of the status zone in v1.14. The zone now carries status information only (pill plus any small informational badges — e.g. "Partially Allocated · 68% covered"), not actions. This keeps the status zone clean and delegates all action-taking to the header-right (Edit, overflow) and footer (primary CTA) zones.

3. **Body zone** (scrollable content) — *substantially refined in v1.20: status-aware, deduplicated, encoding-safe*

The body content is **status-aware** — different fields are surfaced depending on where the entity sits in its lifecycle, so the drawer always shows the user the most useful slice of information for the current moment rather than a fixed wall of every field.

**Common fields (every status, both entity types)**:
- **Description** at the top, always.
- **Programme** as a single line: "Programme: MES Modernisation". Falls back to "No Programme" in muted italic when null. On the Demand drawer, this reflects the parent Project's Programme (Project-spawned) or "Direct Demand (no Programme)" in muted italic (direct).

**Project drawer — status-aware body**:

| Status | Body content (in addition to Description + Programme) |
|---|---|
| **Draft** | Type badge (small inline chip — also visible in header). **Functions Required** chip row with the multi-select picker target. **Activity summary line**: count + date span + status (e.g. *"3 Activities · May 2026 – Mar 2027"*). No requirements listed (Project Draft has none — see section 4.5.2 Project Draft strict rule). |
| **Scoping** | **Functions Required** and **Functions Actually Involved** chip rows (two adjacent lines). When the two sets match, the second row is rendered with a subtle "matches plan" label; when they differ, the additional Functions in Actually Involved are highlighted with a small badge ("added during Scoping"). **Activity list — compact** with for each Activity: name, dates (or "indefinite"), funding source, internal requirement count + total internal hours, external requirement count + total external hours. **Totals rollup** at the bottom: total internal hours and total external hours across the visible horizon. |
| **Submitted** | **Spawned Demands list** (primary content) — one row per child Demand showing the Function chip, current Demand status pill, internal hours total, external hours total, and a click-through link to the Demand's drawer. Below this, in a collapsed-by-default expander labelled "Show planning record at Submit": the frozen Functions Required, Functions Actually Involved, and full Activity-and-requirements detail (compact, read-only). For Projects created via Excel import, the planning record header reads "Functions Required: not declared (imported)". |
| **Approved** | Same as Submitted — Spawned Demands list (with each Demand's status reflecting current state, typically Approved / PartiallyAllocated / Allocated); planning record collapsed below. |
| **Allocated** | Same as Approved — Spawned Demands list with Demands all in Allocated; planning record collapsed below. |

**Demand drawer — status-aware body**:

| Status | Body content (in addition to Description + Programme) |
|---|---|
| **Draft** *(direct only)* | **Function chip** (set at creation, immutable). **Origin badge**: "Direct Demand". **Activity list** with per-Activity internal + external requirement summary. **Totals rollup** at the bottom. No allocation summary (no allocations exist in Draft). |
| **Submitted** | **Function chip**. **Origin badge**: "Project-spawned" or "Direct". For Project-spawned: **Parent Project link** ("Part of: [Project name]") and, if siblings exist, **Sibling Demands list** with each sibling's Function and current status. **Activity list** with per-Activity internal + external requirement summary. **Totals rollup**. No allocation summary (no allocations until Approve). |
| **Approved** | All of Submitted, **plus**: **Allocation summary** banner — "Approved · 0% allocated · 0 of N requirement-months covered". Activities and requirements remain visible (read-only, since Approve locks the definition). |
| **PartiallyAllocated** | All of Approved, with the allocation summary updated: "Partially Allocated · 67% covered · 4 unfilled requirement-months · 3 named people". |
| **Allocated** | All of Approved, with the allocation summary: "Fully Allocated · 100% covered · N named people". |

**Encoding and character safety** *(new in v1.20 — addresses observed `�` rendering bug)*

All text rendered in the drawer (and indeed everywhere in the app) must round-trip cleanly through UTF-8 encoding. The replacement character `U+FFFD` (`�`) appearing anywhere in the UI is a **bug, never a styling choice**. Likely causes and fixes:

- Ensure all HTML responses set `charset=utf-8` (Vite's default; verify in the build's `index.html`).
- Ensure `localStorage` reads/writes use the default UTF-8 path (no manual encoding/decoding through ASCII/Latin-1 helpers).
- Ensure the seed JSON is generated and parsed as UTF-8 (the build-time master xlsx parse — section 6 — must write UTF-8 explicitly).
- **Avoid relying on rare separator glyphs** in dynamic text strings. The chevron `›` (U+203A), em-dash `—` (U+2014), and en-dash `–` (U+2013) are common offenders when seed text passes through a downstream component that doesn't preserve UTF-8. Where these characters carry semantic weight (e.g. hierarchy separators in chip labels), prefer **structural rendering** (separate elements / chip components) over inline characters in a single text node. Section 4.5.1's v1.19 change to drop the chevron-joined `Programme › Project` title was driven by exactly this concern.
- A runtime assertion (development builds) scans rendered DOM text for `U+FFFD` and logs a console error naming the element and its contributing data path, so future encoding regressions are loud rather than silent.

**Hierarchy rendering rule**: where the spec says "Programme: MES Modernisation" or similar, render this as a labelled chip or as label-and-value text (label muted, value primary). Do not render hierarchies as chevron-joined inline strings. When listing siblings or spawned Demands, render each as a separate row or chip — not as a comma-separated inline string.

4. **Footer zone** (bottom, sticky)
   - The footer holds **one or more status-specific primary action buttons**, right-aligned. The specific buttons shown depend on the current status and entity type — see the **Footer buttons by status** tables below.
   - Ordering is right-to-left — the **rightmost** button is the most prominent / primary CTA for the current lifecycle moment, with secondary primary buttons running leftward from there. No overflow menu in the footer; no duplicate Edit; no status pill.

**Footer buttons by status — Project drawer** (right-to-left ordering, rightmost first — primary-CTA position)

| Status | Footer buttons (right-to-left) |
|---|---|
| Draft | **Submit for Scoping** |
| Scoping | **Submit Project** |
| Submitted | *(none — auto-progresses based on child Demand statuses)* |
| Approved | *(none — auto-progresses)* |
| Allocated | *(none)* |

**Footer buttons by status — Demand drawer** (right-to-left ordering, rightmost first)

| Status | Footer buttons (right-to-left) | Notes |
|---|---|---|
| Draft *(direct only)* | **Submit Demand** | Direct Demands only — Project-spawned Demands do not enter Draft. |
| Submitted | **Approve**, Model Capacity | Model Capacity is decision-support; does not change state. |
| Approved | **Allocate** | Navigates to Mode B (Allocation Workspace). |
| PartiallyAllocated | **Allocate** | Same — keep allocating to fill remaining gaps. |
| Allocated | *(none — footer is empty)* | Allocation work is complete. |

**Rationale for each footer primary** *(updated v1.19)*

- **Project Draft → Submit for Scoping** is the only forward move; Park, Revert, and Duplicate are removed in v1.18. Submit is the whole footer.
- **Project Scoping → Submit Project** is the manual forward action that triggers the spawn rule (section 3). The button opens a confirmation dialog that surfaces the spawn outcome (which Demands will spawn, materialised hour totals per Demand) and confirms with the user before executing — see section 11.18. *v1.19: the previous unconfirmed-team-assignments warning is removed.*
- **Project Submitted / Approved / Allocated** — no user-driven transitions exist at the Project level; the Project's lifecycle progresses automatically based on child Demand statuses. The drawer footer is intentionally empty.
- **Demand Draft → Submit Demand** *(direct Demands)* is the only forward move from Draft. The button is enabled when the Demand has at least one Activity and at least one internal requirement.
- **Demand Submitted → Approve** is the primary forward move. Model Capacity sits alongside it as decision-support — opens Capacity Validation with this Demand pre-selected as overlay (section 11.11). Both buttons are footer primaries; Model Capacity is the only allowed off-flow action because it does not change state.
- **Demand Approved → Allocate** opens the edit page in Mode B (Allocation Workspace) directly. It's a navigational button, not a status transition.
- **Demand PartiallyAllocated → Allocate** continues the same pattern.
- **Demand Allocated → *(no footer button)*.** Edit (top-right) is still available if the user needs to view any field. There is no meaningful forward action, and no Park/Close in v1.18.

**Overflow menu contents** (top-right kebab ⋯) *(updated v1.18 — only Delete remains)*

| Status (Project or Demand) | Overflow menu contents |
|---|---|
| Any status | **Delete** |

The overflow menu collapses to a single action — Delete — for both Projects and Demands in every status. The menu is still rendered (vs hidden entirely) so the affordance is consistent: a kebab icon adjacent to Edit means "destructive or off-flow actions are available here," and Delete is reachable in one click without competing with the footer's primary CTA. Future versions may reintroduce Duplicate, Park, etc.; the kebab is the natural place for them to return.

**Delete behaviour** — described fully in section 3 "Deletion." Cascade rules differ for Projects (delete cascades to all child Demands and their allocations) vs direct Demands (delete cascades to allocations only). Project-spawned Demands cannot be Deleted independently — Delete the parent Project to remove them. The cascade dialog surfaces the count of records that will be removed and requires explicit confirmation.

**Button hierarchy rationale — v1.18 summary**

Three tiers, reflecting action frequency and risk:
- **Top-right Edit button**: the mental-model constant. Always present, always primary styling, always opens the full edit page. One click to reach any field regardless of status.
- **Footer primary CTA(s)**: status-appropriate forward-motion actions. Zero, one, or two buttons depending on status; empty on Project Submitted/Approved/Allocated and Demand Allocated.
- **Overflow menu** (kebab, top-right, adjacent to Edit): Delete only in v1.18.

**Behaviour**:
- Read-only apart from the action buttons (footer primaries, overflow menu, top-right Edit). Project alignment is no longer editable in the drawer in v1.17 — see body zone description above.
- Closing the drawer returns the user to their previous view with no side-effects.
- All footer action buttons, overflow menu transitions, and the top-right Edit button apply **immediately** on click (they don't require the save/cancel pattern that applies to field edits on the edit page). Status transitions update the store atomically; Allocate and Edit navigate to the edit page.

#### 4.5.2 The Edit Page — two modes based on status

The edit page is reached via the drawer's "Edit" button, or directly via "+ New Project" from Manage Projects (section 4.6.A) or "+ New Direct Demand" from Manage Demand (section 4.6). It has **two distinct modes** depending on the entity's status.

**Mode A — Definition** *(updated v1.19)* — active when status is:
- `Draft` or `Scoping` on a Project
- `Draft` or `Submitted` on a direct Demand
- `Submitted` on a Project-spawned Demand

This is where the entity is shaped. Mode A is **status-aware** and reveals different UI affordances depending on the current status — reflecting the workflow narrative in section 3:

- **Project Draft**: name, type, owner, description, optional Programme, **Functions Required** (multi-select picker — see section 2.1.1), and Activities (name, dates, funding source, funding notes). **Skill-shaped requirements UI and external resource requirements UI are hidden** on Activity cards. The "+ Add Internal Requirement" and "+ Add External Requirement" actions are not shown. *v1.19: Teams Assigned removed.*
- **Project Scoping**: same fields as Project Draft, plus the skill-shaped requirements list and external resource requirements list on each Activity card. The DOMAIN > SKILL selector is scoped to the **full Skill catalogue across all Functions** (grouped by Function then Domain in the picker). External requirements carry a **Function tag** picker. Functions Required remains editable in Scoping. *v1.19: Teams Assigned removed; per-team confirmation strip removed; per-team Skill picker scoping removed.*
- **Direct Demand Draft**: Function (read-only — set at creation), name, type, owner, description, Activities, and skill-shaped + external resource requirements all visible together. Skill picker scoped to the Demand's Function. External requirements' Function tag is auto-set to the Demand's Function (not user-editable on direct Demands).
- **Direct Demand Submitted** *(new in v1.19)*: same surfaces as Direct Demand Draft. Activities, internal requirements, and external requirements remain editable. The header status pill reads "Submitted" rather than "Draft", and the page footer offers Approve as the primary forward action.
- **Project-spawned Demand Submitted** *(new in v1.19)*: name, type, owner, description, internal requirements (skill, level, hours, notes — add/edit/remove on each Activity), external requirements (provider, role, hours, notes — add/edit/remove). **Activities are read-only** — Activity name, dates, funding source, and funding notes are shown but cannot be edited (the Activity shape is part of the parent Project's planning record). Skill picker scoped to the Demand's Function. External requirements' Function tag is auto-set to the Demand's Function (not user-editable). The page is identifiable as Mode A by its editing affordances; the read-only Activity fields are visually muted.

Mode A is **not** active on Project Submitted/Approved/Allocated, Demand Approved/PartiallyAllocated/Allocated. Those statuses are read-only on definition. Project read-only state shows the frozen planning record (Activities, requirements, Functions Required at Submit) for reference.

This is where the demand is shaped: metadata, Activities, and (in Project Scoping, direct Demand Draft/Submitted, or Project-spawned Demand Submitted) skill-shaped requirements, plus external resource requirements. Named allocation is not available in this mode because allocation only begins after Approve (Mode B, section below).

Content:
- Top section: entity fields (name, type, owner, description; on Projects, optional Programme and Functions Required; on direct Demands, the read-only Function badge). The Functions Actually Involved on a Project are derived from its requirements and shown as read-only chips below the description (alongside the Functions Required chips for comparison).
- **Programme picker** *(Projects only)*: a picker showing current Programme as a single-line value (or "Unaligned" if null). Clicking opens a searchable dropdown listing all active Programmes. A "Clear" action makes the Project Programme-less. At the bottom of the dropdown, a persistent **"+ Create new Programme…"** option opens an inline mini-form that creates the record and immediately selects it. See section 5 for the standalone admin surface and section 11.14 for the creation-flow detail.
- **Functions Required picker** *(Projects only — new in v1.19)*: a multi-select picker showing the originator's declared Functions for this Project. Lists all active Functions; users tick/untick to add/remove. Editable in Project Draft and Project Scoping. Frozen at Submit. Removing a Function from this list when requirements exist under it surfaces a confirm prompt (see section 3 — Project workflow narrative). Visually distinct from the derived "Functions Actually Involved" chips, which are read-only and update live as requirements are added.
- **Activity timeline (Gantt)** *(renamed from Phase timeline in v1.20)*: a horizontal time-based overview at the top of the Activities section, above the Activity cards. Shows every Activity as a labelled bar on a shared month-resolution timeline, sorted ascending by start month. Each bar shows the Activity name and indicates its duration; indefinite Activities render with a trailing dashed extension or arrow marker to communicate "continues beyond the visible range." The timeline is read-only and navigational — clicking a bar scrolls the page to the corresponding Activity card and expands it. Changes to Activity dates in the cards below update the timeline immediately. When the entity has a single Activity the timeline is still shown but kept compact.
  - **Bars are colour-coded by the Activity's Funding Source** — one colour per value of the three-value enum (Investment Scheme, Plant/Sector Allocation, Mixed). The colour mapping is documented in `DESIGNSYSTEM.md` and is shared with any other view that colours by funding source. A compact legend is rendered inside the timeline container (top-right or inline with the header) so the colour-to-source mapping is readable without hovering. Changing an Activity's funding source in the card below updates the bar colour immediately. This replaces any previous colour scheme on this chart (e.g. generic/Activity-indexed colouring).
  - **Vertical padding**: the timeline container must have breathing room above the topmost bar and below the bottommost bar — at least one bar-height worth of space at each end, so bars do not touch the container edge or overlap the horizontal scrollbar (where one is present). This is a specific regression seen in v1.10: the lowest bar overlaps the horizontal scroll rail and is hard to read. If the container scrolls horizontally because the Activity range exceeds the visible width, the scrollbar must sit entirely below the bottom padding, not on top of the last bar.
  - **Bar styling**: bars have rounded corners, sit on a horizontal grid of month lines, and show the Activity name as a label inside the bar (truncating with ellipsis if the bar is narrow). Labels must have sufficient contrast against the funding-source fill colour — if necessary, the label is rendered on a semi-transparent backing to preserve legibility regardless of the bar colour.
  - **Bar coordinate rule** *(v1.21 bug-fix)*: each bar's left edge is positioned at `monthToX(activity_start_month)` — the gridline marking the start of the first month. Each bar's right edge is positioned at `monthToX(addMonths(activity_end_month, 1))` — the gridline marking the start of the month *after* the last month. This means a bar spans the full width of every month it covers, including the end month. Consequence: an Activity with `start = Aug 2026, end = Sep 2026` occupies the full Aug and Sep columns (left edge at Aug gridline, right edge at Oct gridline). Two sequential Activities (Aug–Sep, Oct–Dec) produce bars that touch at the Oct gridline with zero visible gap. The previous implementation used `monthToX(activity_end_month)` for the right edge, which placed it at the *start* of the end month — producing bars that appeared one month short and left phantom gaps between sequential Activities. This coordinate rule applies universally to all Gantt bar rendering in the tool: the Mode A Activity timeline, the Mode B read-only Activity Gantt, and the Skill detail view Demand Gantt (section 4.8).
- Activities section: each Activity is a collapsible card showing:
  - Activity name (`activity_name`), start month, end month — entered via the **month-year picker component** (v1.20; see section 2.2.2). The end month picker is paired with a "No end date (indefinite)" toggle (section 11.12). On Project-spawned Demand Submitted, these fields are read-only and visually muted.
  - Funding source (dropdown) and funding notes (free text). On Project-spawned Demand Submitted, these are read-only.
  - **Internal requirements list** — visible from **Project Scoping** onwards (**hidden entirely in Project Draft** — see "Project Draft strict rule" below) or from **direct Demand Draft / Submitted** or **Project-spawned Demand Submitted**. Each internal requirement displays as a row with skill, level, notes, and a **per-month hours grid** (finite) or **steady-state hours input** (indefinite). *v1.19: the previous "owning team" dropdown is removed; requirements no longer carry a team reference.*
  - **External requirements list** — visible from **Project Scoping** onwards (**hidden entirely in Project Draft**) or from **direct Demand Draft / Submitted** or **Project-spawned Demand Submitted**. A visually distinct sub-section within each Activity card, below the internal requirements. Header: "External Resource Requirements" with an "+ Add external requirement" button. Each external requirement displays as a row with Provider (dropdown — admin-configured), Role (free text), **Function tag** (picker, Project Scoping only — auto-set and read-only on Demands), notes, and the same **per-month hours grid** (finite) or **steady-state hours input** (indefinite) as internal requirements. Visually, external requirements are distinguished by a secondary accent colour and a small "External" label or icon on each row — users must be able to tell at a glance which rows are internal and which are external. When an Activity has no external requirements, the section collapses to just the "+ Add external requirement" affordance — it doesn't take up vertical space with empty state chrome.
- Actions: add Activity, reorder Activities, delete Activity (Projects only — Project-spawned Demands and direct Demands in their respective editable statuses; for Project-spawned Demand Submitted, Activity actions are hidden because Activities are owned by the Project). **In Project Scoping, direct Demand Draft, direct Demand Submitted, or Project-spawned Demand Submitted**: add internal requirement within an Activity, add external requirement within an Activity, delete any requirement. In all read-only statuses, all of the above are hidden.

**Project Draft strict rule** *(re-affirmed in v1.20)*

In **Project Draft only**, the internal requirements list, the external requirements list, and the "+ Add internal requirement" / "+ Add external requirement" affordances are **hidden entirely** on every Activity card. Draft is for shaping the planning intent — name, type, owner, description, Programme, Functions Required, and Activities (with names, dates, funding source, funding notes). Skills, levels, hours, and external resource detail are entered during **Scoping**, not Draft. This rule has been part of the spec since v1.18 but was observed to drift in the v1.19 build, where Draft Projects exposed requirements UIs prematurely. Implementations must hide these surfaces on Project Draft regardless of any data that may exist on the record from a prior state.

**Dual "+ Add" button placement — top and bottom of long sections** *(new in v1.20)*

To reduce scrolling friction when creating many Activities or many requirements in succession, the following sections render a "+ Add" affordance in **two places** — a primary inline button in the section header (the existing position) **and** a secondary button immediately below the last item in the section. Adding via either button has identical behaviour; the bottom button exists purely to remove the need to scroll back up after adding several items in a row.

The dual placement applies to:

- The **Activities section** on a Project / Demand edit page (Mode A) — the "+ Add Activity" button appears inline with the "Activities" section heading **and** below the last Activity card. After adding, the new card appears above the bottom button (i.e. the bottom button stays at the bottom).
- The **Internal requirements list** within each Activity card — "+ Add internal requirement" appears inline with the "Internal Requirements" sub-heading **and** below the last requirement row.
- The **External requirements list** within each Activity card — "+ Add external requirement" appears inline with the "External Resource Requirements" sub-heading **and** below the last external requirement row.

When a section is empty, only the inline header button is shown — the bottom button is hidden until at least one item exists. This avoids two adjacent "+ Add" buttons on an empty section.

The bottom button is visually subtler than the header button (e.g. ghost style instead of solid; smaller in size) so it doesn't compete for attention. DESIGNSYSTEM.md specifies the exact treatment.

**Internal requirements entry** is **always skill-shaped**:
- The "Add Internal Requirement" form offers: **Skill** (using the DOMAIN > SKILL selector — see 4.5.3); **Level** (Basic / Advanced / Specialist); **Starting hours per month** (pre-fills the per-month grid, or sets the steady-state value for indefinite Activities); optional **notes**.
- **Skill selector scoping (v1.19)**:
  - On a Project (Draft or Scoping), the DOMAIN > SKILL selector is scoped to the **full Skill catalogue across all Functions**, grouped by Function then by Domain in the picker. This is how cross-Function requirements get added — a Scoping user can pick any Function's Skills regardless of what's in Functions Required.
  - On a direct Demand (Draft or Submitted), the selector is scoped to the **Demand's Function** (set at creation, immutable). Cross-Function requirements are not permitted on direct Demands — that's what Projects exist for.
  - On a Project-spawned Demand (Submitted), the selector is scoped to the **Demand's Function**. The owning Function is editing their own slice; they cannot add a requirement under a different Function (which would belong to a different sibling Demand).
- Adding a requirement under a Function not in Functions Required (Project Scoping only) creates the requirement and surfaces an informational badge on the Functions Actually Involved chip row indicating the new Function — see section 3.
- Named allocations are not entered in this mode — they're added in Mode B.

**External requirements entry**:
- The "Add External Requirement" form offers: **Provider** (dropdown reading from the admin-configured Provider list — see section 5), **Role** (free text), **Function tag** (Project Scoping only — picker defaulting per section 2.6; auto-set and read-only on Demands), **Starting hours per month** (pre-fills the per-month grid, or sets the steady-state value for indefinite Activities), optional **notes**.
- External requirements never have named allocations. They are demand-shaped only (section 2.6). No allocation UI appears for them in Mode B.
- If the admin Provider list is empty when the user first tries to add an external requirement, the form surfaces an inline link to the Provider admin screen and blocks submission until at least one provider exists.

**Dropdown overflow — mandatory portalling**: the DOMAIN > SKILL selector, the Programme picker, the Functions Required picker, the Provider dropdown, the Function tag picker, and any other dropdown that opens from inside a Activity card or elsewhere in the edit page must be rendered via a portal (e.g. Radix Popover or Headless UI Combobox patterns that mount to document.body). Activity cards and containers have `overflow` constraints that clip non-portalled dropdowns, cutting off options — this must not happen. Any dropdown open event must yield a popover that can exceed its container bounds and remain fully visible regardless of where it sits on the page.

Per-month hours UI (finite Activities) — applies identically to internal and external requirements:
- Each requirement row shows a horizontal grid of month cells spanning the Activity's date range.
- Adjusting the Activity start/end month adds or removes cells (as per section 2.2).
- A **"Fill all"** action on each row flattens hours to a uniform value across every month in the Activity. The user enters a value (or, if any cell already has a non-zero value, the UI offers to propagate that existing value to all cells). This button appears on both internal skill-shaped requirement rows **and** external requirement rows — the behaviour is identical for both.
- Row shows a monthly total and Activity total for sanity-checking.

Steady-state UI (indefinite Activities) — applies identically to internal and external requirements:
- Each requirement row shows a single "Hours per month (indefinite)" input instead of the per-month grid.
- For internal requirements, the capacity calculation applies this value from the Activity's `start_month` onwards with no end bound. For external requirements, the value contributes to Programme/Project external roll-ups with no end bound, but does not affect any capacity calculation.

*v1.19 note: the Teams Assigned picker (introduced in v1.16, redesigned in v1.17, retained in v1.18) is removed. Teams play no role in the planning workflow — they remain an organisational concept under People for capacity grouping but no longer appear on Activity cards, do not gate Submit-for-Scoping, and do not constrain the Skill picker. The per-team confirmation strip is removed alongside.*

**Mode B — Allocation Workspace** (active on Demands when status is `Approved`, `PartiallyAllocated`, or `Allocated`)

Mode B is reached only on **Demands** (Project-spawned or direct) — never on Projects. Once a Demand is Approved, the primary purpose of the edit page becomes allocation — naming people against the committed skill-shaped requirements visible on this Demand. The Demand's definition is locked (see section 3 — Allocation editing).

"The definition" is the Demand's own Activities and internal+external requirements — visible read-only on this page. For a Project-spawned Demand the data was materialised at spawn (and possibly refined during Submitted before Approve); for a direct Demand it has always been on the Demand. In either case the user sees only the requirements targeting this Demand's Function.

A small read-only summary of the relevant definition is shown at the top for reference. There is no "back to Mode A" path in v1.18 because Park-and-revise and Revise are removed — to change a definition the user must Delete the Project (or direct Demand) and recreate.

Content:
- Top section: read-only Demand summary (name, type, owner, Function, and — for Project-spawned Demands — a "Part of: [Project name]" line with a click-through to open the parent Project's drawer, plus a "Programme: [Programme name]" line beneath; for direct Demands, "Direct Demand" in muted italic). Total internal hours by Activity scoped to this Function; and a compact external-hours summary if any external requirements exist on the parent: "External: 160 hrs/mo across 2 providers" with a hover or expand for the per-provider breakdown. *(v1.19 change: Programme and parent-Project context appears as separate lines in the body, matching the drawer convention — see section 4.5.1. The previous chevron-joined "Programme › Project name" inline string is removed.)*
- **Activity timeline (Gantt)**: the same Activity Gantt visual as Mode A (section 4.5.2 — "Activity timeline (Gantt)"), rendered **read-only** here, scoped to the Demand's own Activities (which were materialised from the parent Project for spawned Demands or entered directly for direct Demands). Same visual styling, same colour-by-funding-source, same legend, same vertical-padding rules — only the interactivity changes: clicking a bar still scrolls the page to the corresponding Activity card below, but dragging, resizing, or otherwise editing bar geometry is not available. Changing the Activity timeline is not possible from Approved onwards in v1.19 — direct Demands could change Activities in Submitted (Mode A); from Approved onwards, Delete-and-recreate is the only path. This read-only Gantt sits **above the "Definition is Locked" banner** so the user can orient themselves on the shape of the work before seeing the locked-banner and the allocation rows.
- **"Definition is Locked" banner**: a subtle yellow/amber banner immediately below the Gantt, stating that requirement definitions are locked in the current status. The banner copy in v1.19: *"Requirements are locked from Approve onwards. To change them, Delete-and-recreate is the only path. For Project-spawned Demands, that means Deleting the parent Project; for direct Demands, Deleting this Demand."*
- **Allocation summary header**: overall coverage across this Demand (e.g. "68% allocated, 4 unfilled requirement-months"), status pill showing current status.

**Activity separation — visual priority**

Each Activity is rendered as a **distinctly bounded card** with strong visual separation from surrounding Activities. This is the single most common complaint about the current build — Activities run together and it's hard to tell where one ends and the next begins. Requirements:

- Each Activity is a container with a strong border (not just a subtle divider), ideally with spacing or background-tint differentiation between Activity cards.
- Activity card header is visually prominent: "Activity 1 · Design · May–Aug 2026" with type-setting that reads as a heading, not a subheading.
- Activities are numbered sequentially ("Activity 1", "Activity 2") so the user can talk about them unambiguously.
- Collapsing a Activity is supported but expanded is the default, so all requirements are visible on first render.

**Per requirement within a Activity**:
- The skill-shaped target at the top: skill (using DOMAIN > SKILL display format), level, and a compact view of the per-month target hours.
- **Total target hours summary** *(new in v1.20)* — immediately to the right of the skill+level header, a prominent total: e.g. *"Target: 480 hrs total · 80 hrs/mo × Jun–Nov 2026"* for a finite-Activity uniform-rate requirement, or *"Target: 480 hrs total · varies by month · Jun–Nov 2026"* if `hours_by_month` is non-uniform, or *"Target: 5 hrs/mo · indefinite from Jul 2026"* for an indefinite Activity. The total is the sum over the requirement's `hours_by_month` (finite) or "{steady_state_hours} hrs/mo · indefinite" (indefinite). This number is the headline figure the allocator needs to see at a glance — **how much work is this requirement asking for in total** — so it must sit next to the skill name where it's visible without scrolling the row. It updates live as the parent definition is read (it is not editable in Mode B; the underlying definition is locked from Approve onwards).
- **Coverage summary alongside the total** — also new in v1.20: a single line just below the total reading *"Allocated: 320 hrs (67%) · Unfilled: 160 hrs"*. This gives the allocator the immediate sense of how much work remains to be allocated against this requirement before they look at the per-month coverage strip below.
- **Month labels directly above the coverage indicator** — "May · Jun · Jul · Aug" text labels aligned to the cells below. The current implementation has the coverage strip without explicit month labelling, making it unclear what you're looking at. This is mandatory.
- **Coverage indicator strip** — one cell per month of the Activity, colour-coded: green (fully covered), amber (partial), red (unfilled). Each cell hovers to show "Jun 2026 — 56/80 hrs covered".
- **Allocation rows** below the coverage strip — one row per named person allocated to this requirement. Each shows: person's name and team, per-month hours grid (editable), sum vs target indicator.
- An "Add allocation" action to append another allocation row.

**External requirements within a Activity — read-only in Mode B**:
- If the Activity has external requirements, they appear below the internal requirements in a clearly-labelled "External Resource Requirements" sub-section. Same visual treatment as Mode A — secondary accent colour and "External" label — but rendered read-only.
- Each external requirement shows its Provider, Role, and per-month hours (or steady-state hours for indefinite Activities).
- No coverage strip, no allocation rows, no "Add allocation" — external requirements have no allocation layer (section 2.6). The row is purely informational.
- External requirements cannot be edited in Mode B (locked under the same rule as internal requirement definitions — section 3, Allocation editing). To edit, the user must Delete the parent Project (or direct Demand) and recreate.

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
        AND month M falls within A.parent_activity date range
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
- The allocation being edited is **excluded** from its own "other allocations" bucket. Otherwise headroom shrinks as the user types, producing confusing feedback. "Row being edited" means the specific `(Activity, requirement, person)` row — not the specific month cell. All month cells on the same row share the same exclusion, so typing into one month doesn't change that row's preview for another month.
- BAU is included naturally because BAU is now demand of type BAU — its allocations are in the same pool.
- `contracted_hours(P, M)` respects the person's `available_from` / `available_to` — if M is outside that range, contracted hours for that month is zero.
- If the parent Demand of the allocation being edited is currently in Submitted status (only possible for direct Demands editing allocations during Submitted-to-Approved review, which is uncommon in v1.18), its existing persisted allocations should be **excluded** from the headroom calculation, since Submitted Demands don't consume capacity.

Hover text format: "Alex Morgan, June 2026: 152 contracted − 20 BAU (MES Super User) − 60 Project X Activity 2 − 40 pending this session (Activity 1 · MES Platform) = 32 hrs available". The pending-this-session line is only shown when non-zero.

**Worked example — the Plant C MES Platform Migration case**

Demand item has two skill lines in Activity 1 (Jun 2026) where Alex Morgan is eligible:
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
- Shows each candidate's **summary capacity for the Activity period** next to their name (e.g. "Alex Morgan · MOM Specialist · avg 40 hrs/mo available across Activity"). The summary uses the same full-store headroom calculation as above, averaged across the Activity's months.
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

The mode is determined by status and is not directly toggleable. **In v1.18 there is no path back from Mode B to Mode A**. The v1.17 Revise (Approved → Submitted) and Park-and-revive (PartiallyAllocated/Allocated → Parked → Submitted) actions are removed. To change the definition of an Approved or further-progressed Demand, the only path is **Delete-and-recreate** (Delete the parent Project for Project-spawned Demands; Delete the direct Demand for direct ones — see section 3 Deletion). This is deliberate friction; richer return paths return in a later version.

Named allocations are owned by the Demand and follow the Demand's lifecycle. They are preserved while the Demand exists; Delete cascades them away.

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

#### 4.5.3 Skill selector (shared component)

A shared hierarchical selector used wherever a skill is picked:

- Demand edit page, when adding a skill-shaped requirement.
- Project edit page in Scoping, when adding a skill-shaped requirement.
- Admin, when assigning skills to a person (section 5).
- Filters in Capacity Validation and Team Activity views.

**Two scoping modes** *(updated v1.20)*

The selector operates in one of two modes depending on context:

**1. Single-Function mode** (Domain → Skill) — used when the picker is scoped to one Function:
- Active on: a direct Demand (Draft or Submitted), a Project-spawned Demand (Submitted), an admin person-skill assignment (scoped to the person's Function via their Team), and any Function-lensed filter.
- Dropdown presents skills grouped under their parent Domain. Domain names are shown as non-selectable group headers; only skills are selectable.
- Display format for a selected skill: "**MOM** > **MES Platform**" — Domain in muted styling, Skill in primary text.

**2. Cross-Function mode** (Function → Domain → Skill) — used **only on Project Scoping**, where the user can add requirements under any Function regardless of what's in Functions Required:
- The selector presents a **two-step hierarchical picker**: the user first selects a **Function**, then sees that Function's Domains-and-Skills tree, and selects a Skill within. The first step makes the cross-Function nature of the picker explicit and avoids overwhelming the user with a flat list spanning every Skill in every Function.
- A **back affordance** on the second step returns to the Function list without losing context. A **search field at the top** of either step searches across all Functions/Domains/Skills (a search hit on a Skill is shown with its Function and Domain prefix so the user can pick directly without navigating the hierarchy).
- Display format for a selected skill: "**Digital Manufacturing** · MOM > **MES Platform**" — Function as a chip-style prefix in primary text, Domain in muted styling, Skill in primary text. The Function prefix makes clear which Function this requirement targets at a glance, important when the Project's requirements span multiple Functions.
- A flat single-step list with all Skills across all Functions is **not acceptable** — it makes the cross-Function decision implicit, hides the Function the user is committing the Project to, and produces a long unwieldy list (a typical Project Scoping picker may surface 30+ Skills across 6+ Domains across 2+ Functions).

**Implementation requirements** (both modes):

- Searchable — typing filters the visible items by name with the parent context remaining visible for each match.
- In admin person-skill assignment (and anywhere else multiple skills are picked), the selector supports multi-select — each selected skill appears as a chip with both the Domain and Skill visible, plus the level for admin person-skill context.
- The selector portals (per section 4.5.2 dropdown overflow rule) so it is never clipped by the surrounding Activity card or any other container.

Implementation note: this is **one component with two scoping modes**. Build it once and reuse everywhere a skill is picked. Without this discipline, the demand form, admin, and filters end up with three different skill pickers — and the Project Scoping cross-Function picker drifts toward a flat list (the v1.19 build's observed regression).

### 4.6 Manage Demand

*Reshaped in v1.18.* The page that surfaces individual Demands across their lifecycle. Each card represents a single-Function Demand (Project-spawned or direct). The active Function lens applies — only Demands whose `function_id` matches the active Function are shown.

Three switchable modes, default is **Board (Kanban)** — the state-machine flow is the primary mental model.

- **Board mode (default)**: kanban-style cards grouped by status across **5 columns** in state-machine order: **Draft / Submitted / Approved / Partially Allocated / Allocated**. The Draft column shows direct Demands only (Project-spawned Demands enter at Submitted). Drag between columns triggers the valid user-driven status transition: Draft → Submitted on a direct Demand, Submitted → Approved on either origin. Drags to columns reachable only via auto-transition (PartiallyAllocated, Allocated) are rejected with a tooltip explaining "this status is reached automatically as allocations are added." Invalid drops animate back to the source column.

  **Card content (v1.20 cleanup)** — each card shows, top to bottom:
  1. **Demand name** (primary) — for Project-spawned Demands this is the Project's name (per the v1.20 spawn rule that drops the Function suffix); for direct Demands this is the user-entered name.
  2. **Type badge** — pill showing the Project Type's `name` resolved from the FK reference. The badge **must always render the resolved label, never the system key** (e.g. "Plant Project", not `pt_plant_project`). This was observed to drift in v1.19; v1.20 makes resolution mandatory and adds a runtime assertion that the rendered string never matches the `pt_*` pattern.
  3. **Origin/parent line** — for Project-spawned Demands, the parent Project's name on its own muted line as a click-through link (e.g. "Plant C MES Platform Migration"). For direct Demands, a "Direct" badge in the same position.
  4. **Active-Function indicator (siblings only)** — only when the Demand has at least one sibling Demand on the same Project, the active Function is shown as a small chip in the top-right corner of the card to disambiguate. With Manage Demand always Function-lensed, this is rarely needed in normal use; it's there for clarity when scanning Group-by-Project views.
  5. **Compact stats line** — internal hours total across the visible horizon and (if non-zero) external hours total: e.g. "920 hrs internal · 240 hrs external (12 mo)". For PartiallyAllocated cards, also shows the allocation coverage percentage.

  Cards do **not** show: the system key for type (resolution always), Programme (the drawer body has it; Programme is one click away and would clutter the card), description (drawer has it), or Functions Actually Involved (Demands belong to one Function — moot).

  *(v1.19 change retained: card no longer renders chevron-joined "Programme › Project" tags — same rationale as section 4.5.1 drawer body's encoding-safety rule. v1.20 reaffirms this and extends to forbid any chevron- or em-dash- joined inline hierarchy strings in card content.)*

- **Table mode**: spreadsheet-style, sortable columns (name, type — resolved label, status, origin (Project-spawned/Direct), Programme, Project, owner, Activity count, total internal hours, total external hours). Filterable. Best for bulk scanning. Type column resolves the FK to the Project Type's `name` — never shows the system key.
- **Search mode**: full-text search across name, description, owner, Activity names, and parent Project's Programme/Project names. Best for "find one specific thing."

**"+ New Direct Demand" button** *(top-right of the page)* — opens the Mode A edit page for a new direct Demand belonging to the **active Function** (Function is set at creation and immutable). The page lands in Demand Draft with empty Activities and empty requirements.

**Group-by-Project view** (introduced v1.14, retained in v1.18)

In **Table mode**, a "Group by" control offers three grouping options: None (flat list, the default), Programme, or Project. When grouping is active:

- Rows are grouped under collapsible section headers. When grouping by Programme, headers are Programme names with Project sub-headers below. When grouping by Project, the header is a two-row group label: the **Project name** as the primary heading, with the **Programme name** rendered as a small subtitle below it in muted text (or "No Programme" in muted italic). The chevron-joined "Programme › Project" string is not used — same v1.19 rationale as section 4.5.1 drawer header. Direct Demands appear under a virtual "Direct Demands" group, visually distinct (e.g. italicised or muted header).
- Each group header shows a **roll-up summary block** to its right: internal hours total across the visible horizon (sum of `project_internal_hours` or `programme_internal_hours` for Project-grouped), external hours total, external breakdown by provider on hover, and child Demand count.
- The Demand count in a group header respects any active filters — so a filter applied to the rows also constrains the count and the roll-up totals.
- Collapsing a group hides its Demand rows but leaves the summary header visible.

**Filters** (available across all modes)

| Filter | Behaviour |
|---|---|
| Status (multi-select) | Hides Demands whose status is not selected. In Board mode, columns for hidden statuses still render (so the state-machine flow remains visible) but contain zero cards. |
| Type (multi-select) | Hides Demands whose type is not selected. |
| Domain (multi-select) | Hides Demands whose visible requirements (Function-scoped) do not touch any of the selected Domains. Populated from the active Function's Domains (section 4.9). |
| Programme (single-select, "Any" default) | Hides Demands not aligned to the selected Programme's Projects. Direct Demands are always hidden when a specific Programme is selected (they have no Programme); to show them, switch back to "Any." |
| Project (single-select, dependent on Programme) | Hides Demands not aligned to the selected Project. Lists all Projects if Programme is "Any", or only the selected Programme's Projects. Direct Demands are hidden when any Project is selected. |
| Origin (single-select: All / Project-spawned / Direct) | Quick filter for the two paths. Default "All". |
| Has external requirements (toggle) | Hides Demands whose parent Project (or own definition for direct Demands) has zero external requirements. |

**All filters apply to every mode — Board, Table, and Search.** Filter application in Board mode:

- Each Kanban column renders only cards for Demands that pass every active filter. Column header shows the **filtered** count.
- If every card in a column is filtered out, the column renders an empty-state message ("No Demands match the current filters") rather than disappearing — the state-machine flow remains visible even when no cards are present.
- Drag-and-drop remains enabled on visible cards.

All filters compose. Filter state persists per-session.

Mode selection persists per-session. User preference is not stored long-term in v1.

### 4.6.A Manage Projects

*Introduced in v1.18; refined in v1.19; visibility rule tightened in v1.20.* The page that surfaces individual Projects across their planning lifecycle. Reached via the top-nav link "Manage Projects" (between "Demand" and "Manage Demand" — see section 11.19).

**Function lens visibility rule** *(updated v1.20)*

The active Function lens applies in a Function-aware way. A Project is **visible to the active Function** if any of the following hold:

| Status | Visibility predicate |
|---|---|
| **Draft** | Active Function is in `functions_required`, OR `functions_required` is empty AND the Project's `created_under_function_id` matches the active Function. |
| **Scoping** | Active Function is in `functions_required`, OR active Function is in Functions Actually Involved (i.e. at least one of the Project's internal requirements targets a Skill in the active Function), OR (`functions_required` is empty AND Functions Actually Involved is empty AND `created_under_function_id` matches). |
| **Submitted, Approved, Allocated** | At least one spawned child Demand belongs to the active Function. |

This replaces the v1.18/v1.19 rule that made Draft and Scoping Projects visible to **all** Functions regardless of involvement, which produced clutter — every Function saw every Project being shaped anywhere in the org. v1.20 narrows the lens so the active Function sees only Projects that involve them, with `created_under_function_id` as a fallback for Drafts that haven't yet declared Functions Required.

**`created_under_function_id` semantics**: set on Project creation to the user's active Function at that moment. **Not** ownership — just a tiebreaker for visibility while `functions_required` and Functions Actually Involved are still empty (typically only on a brand-new Draft). Once `functions_required` has at least one entry, the visibility predicate is driven by that field; `created_under_function_id` is no longer consulted unless the user explicitly clears `functions_required` back to empty (which they can do during Draft).

**Switching Function while a Project is open**: if a Draft/Scoping Project drawer or edit page is open and the active Function changes such that the Project is no longer visible to the new Function, the drawer/edit page closes and the user is returned to the Manage Projects list under the new Function. A toast confirms: "Project *{name}* is not associated with *{New Function}* — returning to Manage Projects." This mirrors the analogous behaviour for Demands (section 4.9).

**Editability — view-only from Submitted onwards (v1.19 explicit rule).** Manage Projects supports editing only in Draft and Scoping. From Submitted onwards the Project is read-only on this page — its Activities, Functions Required, internal requirements, and external requirements are a frozen planning record and are shown for reference, not for editing. All ongoing user action against the work happens via Manage Demand on the spawned Demands. The drawer's Edit button is hidden on Submitted/Approved/Allocated Projects (a "View" button replaces it, opening the same page in read-only mode). The only mutation available on a Submitted+ Project is Delete (with cascade — see section 3 Deletion).

Three switchable modes, default is **Board (Kanban)**.

- **Board mode (default)**: kanban-style cards grouped by Project status across **5 columns** in state-machine order: **Draft / Scoping / Submitted / Approved / Allocated**. Drag between columns triggers the valid user-driven Project transition: Draft → Scoping (Submit for Scoping — gated on at least one Activity and at least one entry in Functions Required), Scoping → Submitted (Submit Project, triggers spawn rule). Drags to Approved or Allocated are rejected with a tooltip explaining "this status is reached automatically when child Demands progress."

  **Card content (v1.20 cleanup)** — each card shows, top to bottom:
  1. **Project name** (primary).
  2. **Type badge** — pill showing the Project Type's `name` resolved from the FK reference. **Must always render the resolved label, never the system key** (mandatory resolution rule per section 4.6 cards).
  3. **Programme line** — Programme name in muted text, or "No Programme" in muted italic when null.
  4. **Functions Actually Involved chip row** — small chips showing the Functions whose Skills are touched by the Project's requirements. On Draft/Scoping, when this differs from `functions_required`, the additional chips carry the "added during Scoping" badge (consistent with the drawer body convention). On Submitted+ this is the frozen audit set. Empty Drafts (no requirements) show no chip row.
  5. **Functions Required hint line** — a small muted footnote on Draft/Scoping cards only: "Required: Digital Manufacturing, Group IT". Omitted on Submitted+ where the chip row above is the frozen audit record. When Functions Required is empty, the line reads "Required: not yet declared" in muted italic.
  6. **Compact stats line** — Activity count and child Demand count: e.g. "3 Activities · 2 Demands". On Draft (no requirements), only the Activity count is shown.

  Cards do **not** show: the system key for type (resolution always), description (drawer has it), or full requirements detail (drawer has it).

- **Table mode**: sortable columns (name, type — resolved label, status, Programme, owner, Functions Required, Functions Actually Involved, Activity count, total internal hours across the horizon, total external hours, child Demand count). Filterable. Type column resolves the FK to the Project Type's `name` — never shows the system key.
- **Search mode**: full-text search across name, description, owner, Activity names, and Programme name.

**"+ New Project" button** *(top-right of the page)* — opens the Mode A edit page for a new Project. The page lands in Project Draft with empty Activities, empty Programme (user picks if any), and empty Functions Required.

**Filters**

| Filter | Behaviour |
|---|---|
| Status (multi-select) | Hides Projects whose status is not selected. |
| Type (multi-select) | Hides Projects whose type is not selected. |
| Programme (single-select, "Any" default) | Hides Projects not under the selected Programme. |
| Functions Actually Involved (multi-select) | Hides Projects whose requirements do not touch any of the selected Functions. Populated from all Functions. (Functions Required is not a separate filter — Functions Actually Involved is the operational lens; Functions Required is planning metadata.) |
| Has external requirements (toggle) | Hides Projects with zero external requirements. |

**Group-by-Programme view** (Table mode only) — analogous to Manage Demand's Group-by-Project. Programme group headers carry roll-up summaries; Projects without a Programme appear under a virtual "No Programme" group.

Mode and filter state persist per-session.

### 4.6.A.1 Excel import for bulk Project creation

*Introduced in v1.19.* Manage Projects supports bulk creation of Projects from an Excel workbook. Two actions sit alongside "+ New Project" in the page's top-right toolbar:

- **Download Template** — produces a fully-populated `.xlsx` workbook for the user to fill in offline, with reference data (Programmes, Skills, Providers) populated from the live store at the moment of download.
- **Import from Excel** — accepts a filled-in workbook, parses + validates, surfaces a preview of what will be created, and on commit creates Projects with their materialised child Demands directly in `Submitted` status.

The complete tab structure, column definitions, validation rules, and parser semantics for the workbook live in **section 6.1 — Import workbook schema** (the authoritative reference). This section covers the **user-facing flow and UI behaviour** only.

#### Download Template — flow

When the user clicks Download Template:

1. The current state of the store is read: active Programmes (name + description), active Functions, all active Skills with their Domain and Function, all active Providers.
2. A new workbook is built in-browser using ExcelJS (or equivalent client-side `.xlsx` writer):
   - Four data tabs (Projects, Activities, Internal Requirements, External Requirements) in that exact tab order.
   - Four Reference tabs (`Reference - Programmes`, `Reference - Skills`, `Reference - Providers`, `Reference - Project Types`) populated from the live store at this moment.
   - One hidden helper tab (`_lists`) carrying the small enum dropdowns (funding_source, level). *(v1.19 note: `project_type` no longer lives in `_lists` — it has moved to the visible `Reference - Project Types` tab because Project Types are admin-managed records that need to render at download time, not a static enum.)*
   - Named ranges driving every dropdown — see section 6.1.
   - Header tooltips on every column explaining the field.
   - Frozen header rows on every data tab.
   - Empty data rows below the headers — no example rows are baked into the downloaded template (the tool's Instructions tab is not required because the in-app Import surface itself provides the user-facing guidance).
3. The workbook is serialised to a Blob in-browser and a download is triggered as `ResourceForecastTool_ImportTemplate_v1.19_<YYYY-MM-DD>.xlsx`.

The download is fully client-side. There is no server roundtrip. A baseline workbook (`assets/import_template/master.xlsx`) is bundled with the build as the structural template; the live download replaces its Reference tabs with current store contents before serialising.

#### Import from Excel — flow

When the user clicks Import from Excel:

1. **File picker** opens. The user selects a `.xlsx` file. Drag-and-drop into the picker is also supported. CSV is not accepted (the validation rules baked into the template only function inside Excel; raw CSV upload would silently lose them — see section 6.1 rationale).
2. **Parse + validate Activity** runs entirely client-side. No records are created yet. The parser:
   - Verifies the workbook structure: required tabs present (Projects, Activities, Internal Requirements, External Requirements), expected column headers in each.
   - Reads each tab as a row collection.
   - Resolves all references: `programme_name` → Programme record, `skill_function`+`skill_domain`+`skill_name` → Skill record, `provider` → Provider record, `function_tag` → Function record.
   - Validates the cross-tab integrity: every `project_name` referenced on Activities / Internal Reqs / External Reqs must exist on the Projects tab; every (`project_name`, `activity_name`) pair on Internal Reqs / External Reqs must match a row on the Activities tab.
   - Validates Project-level uniqueness (`project_name` unique within the file) and Activity-level uniqueness (`activity_name` unique within a Project).
   - Validates value ranges: `activity_start_month` and `activity_end_month` parse as YYYY-MM; `hours_per_month` parses as a non-negative number; enum fields (funding_source, level) match their allowed values; `project_type` resolves to an active Project Type record by `name` (case-sensitive match). Unknown `project_type` → row-level error: "Projects row 5 — project_type 'Plant Projetc' not found in active Project Types. Did you mean 'Plant Project'?"
3. **Preview screen** renders. This screen is the import equivalent of the Submit-Project confirmation dialog (section 11.18) — it surfaces what will be created, with errors blocking and warnings informational. Layout:
   - Header summary: count of Projects, Activities, Internal Requirements, External Requirements found in the file.
   - **Errors list** (top — red) — blocking. The Import button is disabled while any error is present. Each error names the tab, row, column, and a clear message ("Internal Requirements row 14 — activity_name 'Disovery' does not match any Activity on Project 'Plant C MES Migration'. Did you mean 'Discovery'?"). See section 6.1 for the canonical error catalogue.
   - **Warnings list** (mid — amber) — non-blocking. Each warning names the tab/row and a description ("External Requirements row 8 — function_tag 'Group IT Enterprise Solutions' is not represented by any Skill row on this Project; the spawned Group IT Demand will carry only this external requirement and no internal requirements"). The user clicks Import to proceed regardless.
   - **Project preview cards** (main body) — one card per Project. Each shows the Project's metadata at the top, then a structured listing of Activities with their requirements and externals, in the same visual layout as the Project drawer's body zone (section 4.5.1). At the bottom of each card, the **spawn outcome** is rendered explicitly: "On import, this Project will spawn N Demands: Digital Manufacturing (4 internal requirements, 2 external requirements, 480 hrs over the next 12 months); Group IT Enterprise Solutions (2 internal requirements, 1 external requirement, 220 hrs over the next 12 months)."
   - **Footer**: `[Cancel]` (returns to Manage Projects with no changes made) and `[Import N Projects]` (the commit button — disabled if any error is present).
4. **Import commit** — on confirmation, the entire batch is created in a single atomic transaction:
   - Each Project record is created with `status = Submitted`, `functions_required = []`, `Activities / internal_requirements / external_requirements` populated from the workbook rows.
   - The spawn rule (section 2.2.4) immediately fires for each Project, materialising one Demand per Function actually involved, also in `Submitted` status. Every spawned Demand carries its Function-scoped deep copy of Activities, internal requirements, and external requirements (routed by Function tag).
   - The Project's `Activities / internal_requirements / external_requirements / functions_required` are frozen as a planning record exactly as for any manual Submit-Project transition.
   - If any record fails to write (e.g. the user has tabbed away and reset the seed mid-flow), the entire transaction rolls back; the user sees a single error and the file remains uploaded for re-import.
5. **Post-import**: the user lands back on Manage Projects, with a success banner naming the count of Projects imported and a deep-link to the Submitted column. The imported Projects appear there immediately. On Manage Demand, the spawned child Demands appear in the Submitted column.

#### Authority and bypass semantics

The import flow bypasses two manual steps that exist in the standard Project lifecycle:

- **Submit-for-Scoping** is bypassed because Draft is the only status that gates on Functions Required, and imported Projects don't go through Draft. The originator-declared Functions Required field is left empty by design (see Project workflow narrative in section 3 — Excel import path).
- **Submit-Project** is bypassed at the manual-click level, but the **deliberate-commitment moment is preserved** as the Import button on the preview screen. The user reviews the spawn outcome before committing, exactly as section 11.18 specifies for the manual flow.

The import flow does **not** bypass the spawn rule itself, the materialisation logic, the Function-tag routing on externals, or any other v1.19 invariant. Imported Projects and their spawned Demands are structurally identical to those created via the manual flow — only the entry point differs.

#### What import does not support (v1.19)

- **Direct Demands.** Single-Function ad-hoc work continues to be created via "+ New Direct Demand" on Manage Demand. Bulk import of direct Demands is out of scope for v1.19; the workbook schema is Project-shaped only.
- **Updating existing records.** The import is create-only. A row referencing an existing `project_name` in the store is not an error — the import creates a new Project with that name. (Project name uniqueness is *not* enforced across the store; users can have multiple Projects with the same name. This matches the manual-create behaviour.)
- **Importing Projects in any status other than Submitted.** Draft or Scoping landing is not exposed via the import flow. Users wanting to bulk-load partially-defined Projects use the manual "+ New Project" affordance per-Project.
- **Master data creation.** Programmes, Skills, Domains, Functions, and Providers must already exist via Admin. The import flow surfaces missing references as blocking errors, not auto-creates.

#### Action placement

Both actions sit in Manage Projects' top-right toolbar:

```
                              [Download Template]  [Import from Excel]  [+ New Project]
```

Order matters: Download Template is leftmost (most common first action — get the template before doing anything else), Import from Excel is the action that follows once the template is filled in, and "+ New Project" remains the manual single-Project fallback.

### 4.7 Archive view *(removed in v1.18)*

The Archive view is removed in v1.18 along with the `Closed` status and the `Restore` action. There is no longer a place where Closed/inactive Projects or Demands accumulate — Delete is the only off-flow action, and it permanently removes records (with cascade — see section 3 "Deletion"). Future versions may reintroduce a soft-archive concept; v1.18 trades retrievability for simplicity.

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
- Team (as a small muted tag showing "Team Name · Function Name" — useful context because a person may hold a skill outside their team's typical Domain focus).
- **A month-by-month utilisation mini-heatmap**, one cell per month across the visible horizon. Each cell reflects the person's **total utilisation across all their commitments** (not just commitments drawing on this skill), colour-coded:
  - Green: ≤70% of contracted hours committed
  - Amber: 71–90% committed
  - Red: 91–100% committed
  - Dark red: >100% (over-allocated)
  - Grey diagonal stripes: outside the person's `available_from`/`available_to` window (cell is inactive).
- **Month-column headers** above the heatmap use a two-line stacked format: month abbreviation (MMM — "Jan", "Feb", etc.) on the upper line, two-digit year (YY — "26", "27") on the lower line. This saves horizontal space versus a single-line "Jan 26" label and keeps columns narrow enough that 12+ months fit comfortably across the page. The year row can be omitted where consecutive columns share a year to reduce clutter, but the first column of each year must always show both lines so year boundaries are obvious.
- Hovering a cell shows a tooltip with the full breakdown for that person-month: contracted hours, committed hours by Project Type (in `display_order` order — see section 2.1.2; with seed records this is BAU / NPD Demand / Plant Project / Group Strategy Project), available hours remaining. This is the same breakdown as Team Activity (View 2) cell drill-down, because the underlying numbers are identical.
- Clicking a cell navigates to Team Activity filtered to that person and scrolled to that month — the user's next question after "is this person loaded?" is usually "what is loading them?" and Team Activity answers that directly.
- Summary numbers to the right of the heatmap, both computed across the visible horizon: **average headroom** (mean of `contracted − committed` across visible months, floored at zero per month) and **worst-month headroom** (minimum of the same across visible months), with the worst month labelled.

**Why total utilisation rather than this-skill utilisation**: the value of this page is answering "who could I call on for this skill?" — and that is determined by the person's overall availability, not by whether they happen to be committed on this specific skill today. Someone fully booked on MOM work is unavailable for MI&V Specialist work even if their MI&V allocation is currently zero. Showing total utilisation makes that immediately visible.

Sort controls on the people list: default sort is by skill level descending (Specialist first), then by average headroom across the horizon descending (most-available first within each level). The user can re-sort by name, worst-month headroom, or average headroom.

**Section 3 — Demand consuming this skill**

A **Gantt chart**, with the same visual styling as the Activity timeline on the Demand edit page Mode A (section 4.5.2). One row per demand item with at least one requirement targeting this skill (at any level) within the visible horizon.

- **X-axis**: months, aligned with the heatmaps above (same horizon and month boundaries). Month labels use the same **two-line stacked format** as the people-heatmap column headers — MMM on the upper line, YY on the lower — so both visuals align column-for-column and read consistently.
- **Y-axis**: one row per Demand. Sorted by earliest requirement-start month ascending, then by status (Allocated > PartiallyAllocated > Approved > Submitted > Draft), then by name. Note: only Demands belonging to the active Function are shown (the active Function lens applies to this Skill detail view because Skills belong to a Function).
- **Bar span**: from the earliest month where the Demand has a requirement for this skill, through the latest such month. For multi-Activity Demands where Activities with this-skill requirements are non-contiguous, render one bar per contiguous run (same Demand, multiple bars on the same row).
- **Bar colour**: by **Project Type** — each bar's fill is the `colour_token` of its Project's (or direct Demand's) Type record (see section 2.1.2). With seed records this is the existing palette for Plant Project, Group Strategy Project, NPD Demand, and BAU; admin-added types appear with their picked palette colours. This matches the universal Project Type colour coding used on the Capacity Validation stacks and Team Activity cells. This is consistent with the principle that colour follows Project Type on cross-demand views; funding-source colouring is only used on the within-one-Project Activity Gantt in Mode A.
- **Bar label**: Demand name (auto-generated as `<Project name> — <Function name>` for Project-spawned Demands), truncated with ellipsis if the bar is narrow. Status shown as a small pill/icon at the left end of the bar. A count of hours-per-month for this skill shown at the right end of the bar (or in the tooltip if the bar is narrow).
- **Hover a bar**: tooltip with Demand name, type, status, parent Project (if Project-spawned) or "Direct" badge, Activity(s) that touch this skill, total committed hours for this skill across the visible horizon.
- **Click a bar**: opens the Demand drawer (section 4.5.1) for that Demand, with the contextual back link pointing back to this skill detail view rather than to the Manage Demand list.

**Filter controls above the Gantt**:
- Status filter (multi-select) — toggles are displayed **in state-machine flow order**: Draft → Submitted → Approved → PartiallyAllocated → Allocated. This matches the Manage Demand Kanban column order (section 4.6) so users build one mental model for status sequence across the app. Default selection shows Approved, PartiallyAllocated, Allocated. Users can enable Draft and/or Submitted to see pipeline pressure. Never sort status toggles alphabetically — that breaks the process-flow mental model.
- Demand type filter (multi-select) — default all on.
- Skill level filter — "show demand requiring Specialist", "show demand requiring Advanced or higher", etc. Default: all levels.

**Vertical padding** on the Gantt — same rule as the Mode A Activity Gantt: at least one bar-height of space above the topmost bar and below the bottommost bar, so rows do not collide with container edges or any horizontal scrollbar.

**What this view deliberately does *not* do**
- It does not show per-skill-level capacity as a separate chart. The earlier "specialist capacity sub-line" was removed in v1.10; level-based shortfalls are surfaced via the over-capacity summary strip on the parent Capacity Validation page. Level filtering on the Gantt (above) gives the user a way to narrow to level-specific demand without duplicating capacity lines.
- It does not include demand items with no requirement touching this skill in the visible horizon — those are irrelevant to the page's purpose.

All numbers on this page must be computed via the shared aggregation layer (section 2.4.8) — no inline summing. The people-heatmap cells read `real_committed_hours(person, month)` and `contracted_hours(person, month)`; the Gantt bars read requirement target hours for the specific skill; summary numbers in the header are derived from these.

### 4.9 Function selector

The Function selector is the global **lens** control that determines which Function's data the app is currently viewing. It is placed in the top header of the application, alongside the primary navigation items — visible from every view in the app.

**Placement and styling**
- The selector sits in the top-right region of the header, within the same horizontal bar as the navigation links (Capacity Validation, Demand, Team Activity, Manage Demand, Admin, etc. — see section 11.19 for the v1.17 nav order). Exact visual styling — background, chevron, typography — comes from `DESIGNSYSTEM.md` under "Function selector."
- The selector renders as a labelled dropdown: "Function: **{active Function name}**" with a chevron. Clicking opens a dropdown listing all active Functions sorted alphabetically.
- If only one Function is configured in the store, the selector renders as a static label rather than an interactive dropdown (the chevron is hidden and click does nothing). This avoids UI clutter in single-Function setups.

**Active-Function state**
- The active Function is persisted in the Zustand store and mirrored to localStorage (see section 7). On app load, the last-selected Function is restored; if no selection exists (first load) or the persisted Function has been deleted/deactivated since, the selector defaults to the first alphabetically-ordered active Function.
- The active Function is a URL-visible state — the hash-router route includes it as a parameter (e.g. `#/capacity?fn=digital-manufacturing`), so the current lens is linkable and survives refreshes.
- Changing the active Function causes every view that depends on it to re-derive from the store. This is a pure selector-based re-render — no page navigation is triggered. The user stays on the current page (Capacity Validation, Demand, Manage Projects, Manage Demand, Team Activity, Admin, etc.), but the content updates to reflect the new Function. As of v1.18 every view respects the lens — there is no exception (the v1.17 Demand view exception was removed; see section 11.17).

**What the active Function scopes**

The selector is a **lens** — it changes what's visible, not what exists. The underlying store is Function-agnostic for Demands, Programmes, Projects, and Providers, and Function-scoped for Domains, Skills, Teams, and People.

| Surface | Behaviour when a Function is active |
|---|---|
| Capacity Validation (View 1) | All Domain/Skill charts are drawn for the active Function's Domains and Skills. The over-capacity summary strip surfaces shortfalls in the active Function's Skills. Section C (external) scopes to Demands touching the active Function (see section 4 View 1). Section D (cross-Function demand) shows what the active Function's Demands are placing on *other* Functions. |
| Team Activity (View 2) | Rows are the active Function's People. Group-by-Domain uses the active Function's Domains; Group-by-Team uses the active Function's Teams. People who do not belong to the active Function are not shown. |
| Skill detail view (section 4.8) | Only reachable via drill-down from Capacity Validation, which is already Function-scoped — the parent chart's Function carries through. |
| Demand page (section 4.6) | Shows Demands with **at least one internal skill-shaped requirement** targeting a Skill in the active Function. A Demand with requirements spanning two Functions appears in both Functions' Demand lists. Demands with zero requirements (e.g. freshly-created Drafts) are visible under the Function they were created from — specifically, they are shown under whatever Function was active at creation time, tracked via a lightweight `created_under_function_id` metadata field (this is **not** ownership, just a tiebreaker for visibility of empty Demands). Once the Demand has at least one requirement, the created-under hint is ignored and visibility is driven purely by the requirements. |
| Admin screens (section 5) | Function / Domains / Skills / Teams / People admin screens list only the active Function's records. Programmes / Projects / Providers admin screens are global and show all records regardless of active Function. |
| Dashboard widgets, charts, filter populators | All Domain/Skill/Team/Person-typed selectors populate from the active Function's taxonomy. |

**What is *not* scoped by the Function selector**

- Programmes, Projects, and Providers are Function-agnostic — the same list appears regardless of active Function.
- Demands are Function-agnostic at the record level — the active Function only determines *visibility* on the Demand page list, not ownership or storage.
- The cross-Function views (Capacity Validation Section D, Demand page showing a cross-Function Demand under both Functions) deliberately surface data across the Function boundary to support awareness of cross-Function work.

**Changing the active Function — UX behaviour**

- When a user changes the active Function, any page-level filters that depended on the previous Function's taxonomy (e.g. a Domain multi-select on the Demand page) are cleared to their defaults rather than attempting to remap across Functions. A brief toast confirms: "Switched to {New Function}. Filters reset." This prevents silently showing wrong-Function data.
- If a Demand drawer or edit page is currently open and the Demand has at least one requirement targeting the new Function, it stays open — the user is explicitly looking at cross-Function data. If the Demand has zero requirements targeting the new Function, the drawer/edit page closes and the user is returned to the Demand page list.
- Capacity Validation, Team Activity, and Skill detail views re-render with the new Function's data. The current time-horizon preset, Programme/Project filter (if set), and any other per-view state are preserved across the switch — these are Function-agnostic concepts.

**Seeding and defaults**
- The seed ships with two Functions: **Digital Manufacturing** (existing taxonomy: MOM, MI&V, MBM with their Skills and People) and **Group IT Enterprise Solutions** (new taxonomy — see section 6). On first load, the selector defaults to Digital Manufacturing.

### 4.10 Demand

*Introduced in v1.17, substantially revised in v1.18.* Reached via a top-nav link labelled "Demand", positioned between "Capacity Validation" and "Manage Projects". Distinct from "Manage Demand" (section 4.6) which handles individual Demand-item lifecycle.

**The question this view answers**: *For each Programme (and each Project within it), how much demand is the active Function carrying over time, and where does that demand land?*

This view exists to give the PMO a Programme-level read of demand shape independent of capacity. Capacity Validation answers "can we resource it?"; this view answers "what shape does our work take across our Programmes?". Both are useful, neither replaces the other.

**Function lens behaviour — applies on this view as of v1.18**

The Demand view now respects the active Function lens (reversing the v1.17 exception). Each chart's stacks reflect the active Function's slice of demand; switching the active Function re-renders the charts to that Function's slice. Two toolbar toggles — "Show external resource" and "Show demand on other Functions" — extend the picture beyond the active Function when wanted (defaults OFF). Section 11.17's earlier exception note is removed.

**Page structure — two levels**

The view has two levels: a **Programme list** (landing) and a **Project drill-down** page reached by clicking a Programme. Both share the same chart vocabulary; the difference is scope — the Programme list shows one chart per Programme, the drill-down shows one chart per Project plus a Programme-total chart at the top.

#### 4.10.1 Programme list (landing page)

The landing page lists every Programme as a vertically-stacked card. Each card contains:

- **Header row**: Programme name as primary heading, count of Projects with at least one active-Function Demand, plus that Demand count (e.g. "MES Modernisation · 2 Projects · 3 Demands"), and a chevron / "View Projects →" affordance on the right indicating the row is clickable for drill-down.
- **Stacked-area demand chart** — the primary visual content of the card. See "Chart specification" below. This chart aggregates across the Programme's Projects, scoped to the active Function (with toggles' effect applied).
- **Roll-up summary line** below the chart: "Peak demand: 480 hrs/mo (Aug 2026) · 12-month total: 4,200 hrs". The peak month and totals follow the active horizon and the toolbar's settings.

A virtual **"Direct Demands"** card appears at the bottom of the list, aggregating direct Demands belonging to the active Function (i.e. Demands with `parent_project_id = null` and `function_id = active_function`). The card uses the same chart structure but is visually muted (italicised header, lighter card background). If the active Function has no direct Demands, the card is hidden entirely. The Direct Demands card is **not drillable** — it has no Projects underneath it; it's a leaf card, the bottom of the hierarchy.

A second virtual **"Unaligned Projects"** card appears above the Direct Demands card, aggregating Projects that have no Programme but do have at least one active-Function Demand. Same visual treatment as Direct Demands. Hidden when the active Function has no Demands on Programme-less Projects.

Clicking anywhere on a Programme card (except interactive chart elements) navigates to the Project drill-down. Direct Demands and Unaligned Projects cards are not clickable.

#### 4.10.2 Project drill-down page

Reached by clicking a Programme card on the landing page. URL pattern: `#/demand/programme/<programme_id>`. Layout:

- **Header**: Programme name with a back-link to the Programme list (e.g. "← Demand"), Programme description (if present), Project count (active-Function-touched), Demand count (active-Function only).
- **Programme-total chart** at the top — same chart vocabulary as the landing page card, repeated here so the user can see the full Programme picture before drilling further.
- **Project section** below — one card per Project that has at least one active-Function Demand, each containing the Project's name, child Demand count for the active Function, and a Project-scoped chart using the same chart vocabulary. Cards are ordered alphabetically by Project name. Projects whose active-Function Demand has zero contributing hours in the visible horizon still render — the chart shows an empty state ("No demand from this Project in the visible horizon") rather than a zero-height chart.
- Each Project card has a **"View Demands →"** link in its header that deep-links to Manage Demand (section 4.6) in Table mode, grouped by Project, scrolled and pre-filtered to that Project — under the active Function lens.

#### 4.10.3 Chart specification

Every chart on this view uses the same visual vocabulary:

- **Stacked area chart**, time on the x-axis (monthly resolution, sharing the global horizon presets — 6 / 12 / 24 / 60 months), hours on the y-axis.
- **Stacking — by Funding Source only.** Three stacks: Investment Scheme, Plant/Sector Allocation, Mixed. *(The "By Team" stacking option that existed in v1.17 has been removed in v1.18 — see toolbar below.)*
- **"Include Submitted" toggle behaviour — v1.18 simplified.** When ON, Submitted Demands' hours merge into the same funding-source bucket as Approved/PartiallyAllocated/Allocated — there is no visual differentiation, no hatched layer, no opacity change, and no `(Submitted)` suffix in tooltip labels. The toggle simply expands the `status_set` from `[Approved, PartiallyAllocated, Allocated]` to also include `Submitted`. The chart's y-axis automatically rescales when the toggle is flipped — the toolbar setting is a different aggregation, not a filter applied client-side.
- **"Show external resource" toggle behaviour.** When ON, external resource hours (from external requirements on the Project, or on direct Demands for the Direct Demands card) are added into the same funding-source buckets — same colour mapping, no separate visual treatment, no separate stacks. Externals are bucketed by their Activity's `funding_source` exactly like internals. Off by default, mirroring Capacity Validation Section C's default.
- **"Show demand on other Functions" toggle behaviour.** When ON, hours from other Functions' Demands on the same Projects (i.e. cross-Function siblings of the active Function's Demands) are added into the same funding-source buckets. No separate visual differentiation. Off by default. This toggle does not affect the Direct Demands card (direct Demands have no parent Project so cannot have sibling Demands).
- **Colour mapping — funding-source palette** from `DESIGNSYSTEM.md` (introduced for the Activity Gantt in Mode A — see section 4.5.2). One colour per funding source value, consistent across the tool.
- **No capacity line, no projection grey band, no over-capacity treatment** — this is a demand-shape view, not a capacity view.
- **Hover tooltip** for any month on any chart: lists every non-zero funding-source bucket in that month with its hour total, plus a Programme/Project total row at the bottom. Format: "Investment Scheme: 240 hrs · Plant/Sector Allocation: 80 hrs · Mixed: 160 hrs · Total: 480 hrs". The tooltip does **not** distinguish committed vs Submitted vs external vs other-Functions — the toggles change *what's in the bucket*, not how it's labelled.
- **Click on a stack segment** in any month opens a side panel listing the contributing Demands for that `(month, funding_source)` pair. Each row shows Demand name, status pill, Function chip, parent Project (and Programme, on the landing-page chart where multiple Programmes are in scope), origin (Project-spawned / Direct), and hours contributed for that month. Clicking a Demand row opens the Demand drawer (section 4.5.1) on top of the side panel.

#### 4.10.4 Toolbar

Above the Programme list / Programme-total chart, a single toolbar applies to every chart on the page:

- **Horizon selector** — same control as Capacity Validation: 6 / 12 / 24 / 60 months. Persists across navigation between landing and drill-down.
- **Include Submitted** toggle — default OFF. When ON, expands `status_set` to include Submitted (no visual differentiation; see 4.10.3).
- **Show external resource** toggle — default OFF. When ON, external requirement hours are added to the same buckets.
- **Show demand on other Functions** toggle — default OFF. When ON, sibling Functions' Demand hours on shared Projects are added.
- **Programme filter** — single-select dropdown ("All Programmes" default) on the landing page only; not shown on the drill-down.

The toolbar does **not** include a Stacking selector (only By Funding Source remains in v1.18) and does not include a Team filter or a Function filter (Function lens is from the global selector; Team is no longer a stacking option).

#### 4.10.5 Empty states

- **No Programmes exist and no direct Demands**: render a single empty-state card with links to Manage Projects ("Create your first Project") and Manage Demand ("Create a direct Demand").
- **Programmes exist but no qualifying Demands for the active Function**: each Programme card still renders, but its chart shows the empty-state message described in 4.10.2.
- **Demand view loaded mid-flight while data is still hydrating**: show skeleton cards consistent with `DESIGNSYSTEM.md` skeleton tokens. Do not show a global spinner — the skeletons preserve the page's structure during load.

#### 4.10.6 Aggregation reference

This view is the primary caller of the v1.17/v1.18 aggregation functions in section 2.4.9:

- The Programme list landing chart calls `programme_demand_by_funding(programme_id, month, opts)` for each Programme card.
- The drill-down Programme-total chart calls the same function.
- Each Project card on the drill-down calls `project_demand_by_funding(project_id, month, opts)`.
- The Direct Demands card on the landing page calls `direct_demand_by_funding(month, opts)` with `function_id = active_function`.
- Across all calls, `opts` carries `function_id` (the active Function), `status_set` (controlled by Include Submitted), `include_external` (controlled by Show external resource), `include_other_functions` (controlled by Show demand on other Functions).
- All Demand-level click-throughs (segment click → side panel) read from the store directly, filtered to the same scope as the chart and matched against the clicked funding-source bucket.

No Demand view component performs its own summation — every number on the page comes from these functions, consistent with the aggregation-first principle (section 2.4.8).

---

## 5. Admin

All admin is open — anyone with access can edit any of the following. No permissions in v1.

**Function-scoping in admin**: admin screens for Function-scoped entities (Domains, Skills, Teams, People) show only the active Function's records. Switching Function via the global Function selector (section 4.9) changes which records appear. The admin screens for Function-agnostic entities (Programmes, Projects, Providers) show all records regardless of active Function. The Function admin screen itself is a special case — it shows every Function regardless of which one is active.

- **Functions** (CRUD, new in v1.16). Flat admin screen listing all Functions with name, description, active flag, and summary counts (Domain count, Team count, People count). Adding a Function: name (required, globally unique, case-insensitive uniqueness), description (optional). On create, the Function has no Domains, Teams, or People — the admin user proceeds to seed those via the child admin surfaces, typically by first switching the active Function to the newly-created one. Renames cascade trivially (records reference the Function by id). Soft-delete via the active flag: inactive Functions are hidden from the Function selector but their data (Domains, Teams, People, and any requirements targeting their Skills) remains intact. Hard-delete is permitted only when the Function has zero Domains, zero Teams, and zero People — otherwise the user is shown the blocking records and advised to move or delete them first. The seed ships with two Functions pre-populated: **Digital Manufacturing** and **Group IT Enterprise Solutions** (see section 6). A tool cannot have zero active Functions — deactivating the last active Function is blocked at the admin screen with an explanation.
- **Domains and Skills** (CRUD). Flat admin screens; domains and skills are simple named records scoped to the active Function. **Domain**: name (required, unique within its parent Function), description, `function_id` (derived from the active Function on create, not user-selectable). **Skill**: name (required, unique within its parent Domain), `domain_id` (selected from the active Function's Domains). Hard-delete is permitted only if the Domain/Skill has no references (no People holding the Skill, no requirements targeting it). Soft-delete via active flag retains references. Renaming is safe — records reference by id.
- **Teams** (CRUD). Flat admin screen listing the active Function's Teams with name, type (Plant / Central / Specialist / Other), active flag, and a summary column showing member count. `function_id` is derived from the active Function on create and is not user-editable (a Team cannot be moved between Functions — if that's needed, create a new Team in the target Function and reassign People). Soft-delete via the active flag — inactive Teams remain on their existing People but don't appear in pickers. Hard-delete is permitted only if the Team has no assigned People; the user is otherwise shown the list of blocking People and advised to reassign them first. **Teams do not affect capacity calculations** — Team is an organisational label. Creating, renaming, or reassigning Teams never changes any chart, grey band, or projection shortfall.
- **People** (CRUD). Each person's screen shows: name, **Team** (required — dropdown of active Teams in the active Function), contracted hours, `available_from` / `available_to`, active flag, and a **skill profile section** where skills are assigned (scoped to the person's Function via their Team). Existing People records without a Team assignment show an inline warning prompt in admin.
- **Programmes** (CRUD, global). Flat admin screen listing all Programmes (regardless of active Function) with name, description, active flag, and a small summary column showing Project count (total) and Project count by status. Soft-delete via the active flag — inactive Programmes remain on their existing Projects but don't appear in pickers. Hard-delete is permitted only if the Programme has no Projects (a Programme with Projects must have those Projects reassigned to a different Programme or to "No Programme" first); the user is otherwise shown the list of blocking Projects and advised to reassign them. See section 2.1.1 for the data model.
- **Projects** (CRUD, global, **substantially expanded in v1.18** — Project is now a planning entity with Activities and requirements, not just a grouping label). The admin Projects screen offers two surfaces:
  - **List view**: all Projects across all Functions, with name, parent Programme (or "No Programme"), status, owner, type, child Demand count, and rolled-up internal/external hours across the next 12 months. The list reads from the same store as Manage Projects (section 4.6.A) — admin and operational views are identical reads, just with an admin styling.
  - **Edit deep-link**: clicking a Project from the admin list opens its edit page (Mode A or read-only summary depending on status), the same one reached from Manage Projects. There is no separate admin edit page.
  - Hard-delete behaviour matches the cascade described in section 3 Deletion (cascades to child Demands and allocations). Available from any Project status. The admin list-view shows a Delete button per row with the same confirmation dialog. **Soft-delete via active flag is no longer used** — Projects in v1.18 either exist (in some status) or are Deleted; there's no archived/inactive state.
- **Providers** (CRUD, global). Flat admin screen listing all Providers (regardless of active Function) with name and an in-use indicator (showing how many external requirements currently reference this Provider across all Projects and direct Demands). Name is required and unique. Renames cascade to all existing external requirements (section 2.6) — the requirement records reference the Provider by id, not by name, so a rename is a single-record update. Hard-delete is permitted only when the Provider's in-use count is zero; otherwise the user sees the blocking requirements list and is advised to reassign them to a different Provider (a bulk-reassign action is provided). Seed values: `Managed Services`, `Contractor`, `OEM`, `Plant Team`, `Other Internal Team`, `Other` — all pre-populated at seed time and editable thereafter.
- **Project Types** (CRUD, global, **new in v1.19; v1.20 surfaces the system key in admin**). Flat admin screen listing all Project Type records with the following visible columns/fields: **`id` (system key — read-only, shown as a small monospace tag below the name; auto-derived from `name` on create per section 2.1.2)**, `name`, `display_order` (with drag-handle for reordering), `colour_token` (single-select from a fixed design-system palette of 8–12 named tokens defined in `DESIGNSYSTEM.md` — surfaced as a swatch picker, not a hex input), `is_bau` (read-only badge — "BAU" on the one record, blank on others), `active`, and an in-use indicator (showing how many Projects and Demands currently reference this type). **The system key is shown read-only** so admins understand "this Project Type's stable identifier is `pt_plant_project`" without being able to edit it; it derives from the `name` on create, is checked for uniqueness then, and is immutable thereafter (renaming the record does not change the key — section 2.1.2). Adding a Project Type: `name` (required, unique among active records, case-insensitive uniqueness; the derived `id` must also be unique — the create form previews the derived `id` in real time below the name input so admins know what system key they'll get), `display_order` (admin sets via drag-handle on the list), `colour_token` (selected from the palette), `is_bau` (defaults to false and is not user-editable — see section 2.1.2). Renames cascade trivially. Reordering changes the capacity-stack ordering on every chart that stacks by work type — this is the intended effect, not a side-effect to warn against. Soft-delete via the active flag — inactive types remain on their existing Projects/Demands but don't appear in pickers. Hard-delete is permitted only when the in-use count is zero; otherwise the user sees the blocking record list and is advised to reassign them to another type (a bulk-reassign action is provided) or deactivate. Deleting the BAU record specifically is **always blocked** — the system requires exactly one record with `is_bau = true` at all times. Renaming the BAU record is permitted (e.g. to "Operational Support" if the org prefers that label) but the `is_bau` flag follows the record and the `id` does not change. Seed values: `BAU` (id `pt_bau`), `NPD Demand` (id `pt_npd_demand`), `Plant Project` (id `pt_plant_project`), `Group Strategy Project` (id `pt_group_strategy_project`) — see section 2.1.2 seed table.

**Type label resolution rule** *(new in v1.20 — addresses observed regression)*: every UI surface that renders a Project Type — Project drawer header, Demand drawer header, Manage Projects card, Manage Demand card, Manage Projects/Manage Demand table columns, capacity stack legends, chart tooltips, filter dropdowns, import/seed workbook reference cells — must resolve the FK reference to the Project Type record's `name` and render that. **Rendering the system key (e.g. `pt_group_strat`) is a bug.** A runtime assertion (development builds) scans rendered DOM text for strings matching `pt_[a-z_]+` and logs a console error naming the element and its data path; this catches future regressions loud rather than silent. The seed assertions (section 6) include a check that no rendered Project Type label matches the `pt_*` pattern after a fresh seed load.

**None of Functions, Teams, Programmes, Projects, Providers, or Project Types affect capacity calculations.** They are admin-configured labels and organisational groupings. Creating, renaming, or reassigning them never changes any chart, grey band, projection shortfall, or person's committed hours. This is by design — it keeps the mental model of capacity clean while letting the user organise the pipeline and track external effort. *(v1.19 nuance: reordering Project Types via `display_order` does change which segment of the demand stack appears at the bottom and which at the top — this is a visual reordering, not a capacity calculation change.)*

**BAU is not an admin concern** — see section 2.3. BAU is captured as demand items of type `BAU` in the main Demand list, not as admin records. There is no BAU admin area; any prior BAU admin pages must be removed.

**Skill profile on the Person admin screen**:

- Uses the shared **DOMAIN > SKILL selector** (section 4.5.3) for adding skills — showing Domain as group header and skill as the selectable item. The selector is scoped to the person's Function (via their Team). Flat lists of skills without Domain grouping are not acceptable; the selector gives users the same hierarchical mental model as the demand form.
- Each assigned skill appears as a row showing: Domain, skill name, and a level selector (Basic / Advanced / Specialist).
- Remove button per row.
- A person can hold skills across multiple Domains; nothing restricts them to any single Domain.

A simple admin area is otherwise sufficient — no need for sophisticated UX beyond the skill selector consistency.

---

## 6. Seed data

The tool ships with seed data sufficient to demonstrate every view across **two Functions**, **both creation paths** (Project-spawned and direct), and **all status combinations** of the v1.18 state machines.

### 6.0 Seed source — `master_seed.xlsx` *(new in v1.20)*

In v1.20 the seed data is sourced from a **master Excel workbook** held in the repo at `seed/master_seed.xlsx`, parsed at build time into the bundled `seed.json`. This replaces the previous practice of hand-authoring (or Claude-Code-generating) the seed JSON directly.

**Rationale**: Tim is the SME for what the demo data should say to PMO stakeholders. Editing a structured JSON to refine seed Project names, owners, hours, and other realistic detail is high-friction; editing an Excel workbook is natural. Putting the seed in `master_seed.xlsx` lets Tim refine the demo data offline (using Excel's familiar tools) and rebuild the app from the result. The build pipeline does the parsing.

**Workbook structure** — `master_seed.xlsx` extends the import workbook schema (section 6.1) with additional tabs covering the structural and operational data the import workbook does not carry. Specifically it has **all nine tabs from the import workbook** (Projects, Activities, Internal Requirements, External Requirements, four Reference tabs, hidden `_lists`) **plus** the following extra visible tabs:

| # | Tab name | Columns | Purpose |
|---|---|---|---|
| 10 | `Functions` | name, description, active | One row per Function. |
| 11 | `Domains` | function_name, name, description | One row per Domain. function_name resolves to a Functions row. |
| 12 | `Skills` | function_name, domain_name, name | One row per Skill. (This duplicates the import workbook's `Reference - Skills` tab; the seed workbook treats `Skills` as the authoritative source and uses `Reference - Skills` as a generated mirror at build time for consistency with downloadable templates.) |
| 13 | `Teams` | function_name, name, type, active | One row per Team. type ∈ {Plant, Central, Specialist, Other}. |
| 14 | `People` | name, team_name, contracted_hours, available_from, available_to, active | One row per Person. team_name resolves to a Teams row; contracted_hours is integer; available_from/available_to are YYYY-MM or blank. |
| 15 | `Person Skills` | person_name, function_name, domain_name, skill_name, level | One row per (person, skill) holding. Level ∈ {Basic, Advanced, Specialist}. |
| 16 | `Project Types` | name, display_order, colour_token, is_bau, active | One row per Project Type. `id` is auto-derived from `name` per section 2.1.2 (not stored in the workbook). |
| 17 | `Programmes` | name, description, active | One row per Programme. (Mirrors the import workbook's `Reference - Programmes` tab.) |
| 18 | `Providers` | name | One row per Provider. (Mirrors `Reference - Providers`.) |
| 19 | `Direct Demands` | name, function_name, type, owner, description, status | One row per direct Demand. Activities (renamed: Activities) for direct Demands live on the `Activities` tab and are linked via a special `project_name` value of the form `direct:<demand_name>` to keep the Activities tab schema unchanged. |
| 20 | `Allocations` | demand_name, activity_name, skill_name, level, person_name, hours_per_month, notes | One row per named allocation. demand_name resolves either to a Project name (Project-spawned Demand path — the spawn rule materialises the Demand at parse time) **or** to a direct Demand name. The parser sums multiple allocation rows targeting the same (demand, activity, skill, level, person) tuple — supporting splitting by month is not needed in the seed (per Tim's "flat hours per month" constraint). |

**Build-time parsing** — at build time, a Node script (`scripts/build-seed.ts` or equivalent) executes the following pipeline:

1. Load `seed/master_seed.xlsx` using ExcelJS.
2. Parse the structural tabs (Functions, Domains, Skills, Teams, People, Person Skills, Project Types, Programmes, Providers) into in-memory records, validating cross-references and uniqueness as the import parser does (section 6.1 parser semantics).
3. Parse the Projects, Activities, Internal Requirements, and External Requirements tabs using the import workbook parser logic (section 6.1) — including expanding `hours_per_month` (a single number) uniformly across each finite Activity into `hours_by_month`, or assigning it to `steady_state_hours` for indefinite Activities. **All seed Projects land in `Submitted` status with their child Demands materialised**, exactly as the import flow does.
4. Override status: parse the optional `status_override` column (added v1.20) on the Projects tab — if set, the Project lands in the override status (`Draft`, `Scoping`, `Submitted`, `Approved`, or `Allocated`) rather than the import-default `Submitted`. This is what lets the seed cover every status (e.g. Project 1 lands in Draft, Project 4 in Approved). Constraints:
   - `Draft` and `Scoping` overrides skip the spawn rule (no child Demands created).
   - `Approved` and `Allocated` overrides require the spawn rule to fire (Demands materialise at `Submitted` then the parser advances each Demand's status to match the Project's, respecting the Demand auto-transition rules).
5. Parse `Direct Demands` and their Activities (via the special `direct:<name>` key on the Activities tab). Direct Demand Activities live on the Demand. Apply the same `status_override` semantics — direct Demands can land in `Draft`, `Submitted`, `Approved`, `PartiallyAllocated`, or `Allocated`.
6. Parse `Allocations`. For each row, find the target Demand (Project-spawned by Project name + Function inferred from the Skill, or direct by name), find the requirement (Activity + Skill + Level), and add the named allocation. Allocations are skipped if the Demand's status is below `Approved`.
7. Recompute Demand auto-transitions (section 3) based on allocation coverage to verify the parsed status matches the rules. If `status_override` says `Allocated` but coverage is < 100%, log a build-time warning naming the offending requirement; do not fail the build.
8. Serialise the final in-memory store to `src/seed/seed.json` (or equivalent), bundled into the build.

**Hours per month — flat value** *(per Tim's constraint)* — `hours_per_month` is a single value per requirement in the seed workbook. The parser expands it uniformly across finite Activities (every month gets the same value) or sets it as `steady_state_hours` for indefinite Activities. **The seed never carries non-uniform per-month variation** — that's a feature of editable in-app data, not seed data. This keeps the workbook simple and reflects how a stakeholder demo would naturally describe a requirement ("60 hrs/mo for the design Activity") without needing month-by-month detail.

**Validation and error reporting at build time**:

- The seed parser uses **the same validation library and error catalogue as the import flow** (section 6.1 parser semantics). Errors at build time are loud and fail the build with a clear message: *"seed/master_seed.xlsx — Internal Requirements row 14 — activity_name 'Disovery' does not match any Activity on Project 'Plant C MES Migration'. Did you mean 'Discovery'?"* Tim sees the error in his terminal and fixes the workbook.
- Warnings (e.g. high hours/mo, function_tag mismatches) print at build time but do not fail the build. The build emits a summary report (e.g. `dist/seed-build-report.txt`) listing all warnings.
- The parser is **deterministic** — the same workbook always produces the same `seed.json`. Build reproducibility matters for git diffs.

**No runtime upload in v1.20** — Tim asked specifically for build-time only. The runtime "Reset to seed" admin action (section 7) reloads the bundled `seed.json` (which is the parsed `master_seed.xlsx`). There is no admin "Upload custom seed" action; that's deferred to a later version if ever needed.

**Relationship to the import flow**: the bulk Project import flow (section 4.6.A.1) is unchanged and remains a runtime feature. The import workbook schema (section 6.1) is a **subset** of the seed workbook schema — every tab the import workbook has, the seed workbook has, with identical columns. Tim can use a subset of the seed workbook as an import workbook (just the Projects + Activities + Internal Reqs + External Reqs + Reference tabs); the parser distinguishes the two contexts by which tabs are present.

**Migration from v1.19 seed**: the v1.19 hand-authored `seed.json` is replaced. v1.20 ships with `master_seed.xlsx` as the canonical source; the JSON is generated from it. A git-tracked `seed/master_seed.xlsx` is the new source of truth.

**Functions** — two records (unchanged from v1.16):

- **Digital Manufacturing** — the primary demo Function, owning the existing MOM / MI&V / MBM taxonomy. Default active Function on first load.
- **Group IT Enterprise Solutions** — the second Function demonstrating multi-Function capability and cross-Function Project flow.

**Digital Manufacturing — Domains, Skills, People, Teams**

- **Domains**: MOM, MI&V, MBM (3 Domains).
- **Skills per Domain**: 4–6 skills each, covering realistic Digital Manufacturing capabilities.
- **Teams**: three Teams — "Central Delivery Team" (Central), "Plant Team A" (Plant), "Plant Team B" (Plant). All under the Digital Manufacturing Function.
- **People**: ~12 people spread across Domains, with varied skill profiles and levels. Include at least one with `available_from` set in the near future (new starter) and one with `available_to` set (planned leaver). Every person has a `teamId`.

**Group IT Enterprise Solutions — Domains, Skills, People, Teams**

- **Domains**: three Domains — **Infrastructure & Platforms**, **Enterprise Applications**, **Data & Integration**.
- **Skills per Domain**: 3–4 skills each, e.g.:
  - Infrastructure & Platforms: Cloud Architecture, Network Engineering, Platform Engineering
  - Enterprise Applications: ERP Configuration, CRM Development, Enterprise Application Support
  - Data & Integration: Data Engineering, Integration Architecture, Data Platform Administration
- **Teams**: two Teams — "Infrastructure Team" (Central), "Applications Team" (Central).
- **People**: 5–7 people with `teamId` assigned.

**Programmes**: 2–3 Programmes. Suggested:
- **MES Modernisation** — covers Plant A/B/C MES work, the headline cross-Function flagship.
- **Digital Twin Rollout** — for MBM exemplars.
- Optional third for MI&V work.

### Projects (new in v1.18, refined in v1.19)

The seed must include Projects in **every Project status** to demonstrate Manage Projects (section 4.6.A) end-to-end:

| # | Project name | Status | Programme | Functions touched | Notes |
|---|---|---|---|---|---|
| 1 | "Plant D MES Concept Study" | Draft | MES Modernisation | (no requirements yet — Draft has none) | Demonstrates Project Draft on Manage Projects with Activities but no requirements. Seed must include Activities and **at least 2 entries in Functions Required** (Digital Manufacturing, Group IT Enterprise Solutions) to exercise the Submit-for-Scoping gate. *v1.19: Teams Assigned removed.* |
| 2 | "Plant E MES Refresh" | Scoping | MES Modernisation | DM (MOM, MI&V), GroupIT (Data & Integration) | Demonstrates collaborative scoping. Functions Required at Draft = `[DM]` only; one MI&V requirement and one Data & Integration requirement added during Scoping show as Functions Actually Involved badges ("added during Scoping") — exercises the v1.19 hint-not-binding behaviour. |
| 3 | "Corporate Data Lake" | Submitted | (no Programme) | DM (small MI&V slice), GroupIT (Data & Integration) | Cross-Function, no Programme — demonstrates the "Unaligned Projects" virtual card on the Demand view. Spawned Demands are in Submitted. **External requirements demonstrate Function-tagging**: 1× Contractor tagged DM, 1× OEM tagged GroupIT — at spawn each routes to the correct Demand. |
| 4 | "Plant C MES Platform Migration" | Approved | MES Modernisation | DM (MOM, MI&V), GroupIT (Data & Integration) | **Headline flagship cross-Function Project.** Has rich Activity + requirement structure mirroring the v1.17 seed item. Spawns 2 child Demands; the DM Demand is in PartiallyAllocated, the GroupIT Demand is in Approved (so the Project sits at Approved per the auto-rule). External requirements with Function tags: OEM 40 hrs/mo (DM-tagged), Managed Services 120 hrs/mo (DM-tagged) on Build Activity. **Demonstrates v1.19 spawn materialisation**: at spawn the DM Demand received its 6 internal requirements and 2 external requirements as deep copies; the GroupIT Demand received 3 internal and 0 external. The DM Demand has been edited in Submitted before Approve (one requirement's hours adjusted from 60 to 80) — the Project's frozen record still shows 60 to demonstrate divergence after spawn. |
| 5 | "MBM Foundation Library" | Allocated | Digital Twin Rollout | DM (MBM) | Single-Function Project demonstrating that single-Function Projects work end-to-end. All allocations covered; Project is Allocated. |
| 6 | "Plant B MES Refresh" | Allocated | MES Modernisation | DM (MOM) | Single-Function Project fully allocated, providing a second Programme-level data point under MES Modernisation alongside Project 4. |

### Project-spawned Demands

Each non-Draft, non-Scoping Project has its child Demands spawned. The seed therefore includes:

- 2 Demands from Project 3 ("Corporate Data Lake") — both Submitted.
- 2 Demands from Project 4 ("Plant C MES Platform Migration") — DM in PartiallyAllocated, GroupIT in Approved.
- 1 Demand from Project 5 ("MBM Foundation Library") — Allocated.
- 1 Demand from Project 6 ("Plant B MES Refresh") — Allocated.

Total: 6 spawned Demands across 4 Projects.

### Direct Demands

The seed must include direct Demands in **every Demand status** to demonstrate Manage Demand (section 4.6) end-to-end. All direct Demands belong to Digital Manufacturing (Group IT direct Demands are not required for the demo):

| # | Direct Demand name | Function | Status | Type | Notes |
|---|---|---|---|---|---|
| D1 | "Ad-hoc shift pattern review" | DM | Draft | Plant Project | Demonstrates direct Demand Draft on Manage Demand. Has 1 Activity, 1 internal requirement (MOM Basic), no external. |
| D2 | "Plant A SCADA migration assist" | DM | Submitted | Plant Project | Direct path through Submitted — demonstrates Approve as the next-step CTA on a non-Project-spawned Demand. |
| D3 | "MES Super User support — Plant B" | DM | PartiallyAllocated | BAU | Indefinite-Activity BAU support stream with named allocation partly in place. Demonstrates the BAU-as-direct-Demand flow described in section 2.3. Has a small `Other Internal Team` external requirement (10 hrs/mo indefinite). |
| D4 | "Historian configuration handover" | DM | Allocated | Plant Project | Fully allocated direct Demand. |

Total: 4 direct Demands.

**Total Demand pipeline in seed**: 10 Demands across both creation paths.

**Providers**: pre-populated with `Managed Services`, `Contractor`, `OEM`, `Plant Team`, `Other Internal Team`, `Other`.

**External resource requirements summary**: at least 3 entities carry external requirements. Suggested distribution:
- "Plant C MES Platform Migration" (Project 4) — OEM (MES Platform Vendor Support, 40 hrs/mo on Build), Managed Services (SCADA Engineer, 120 hrs/mo on Build).
- "Corporate Data Lake" (Project 3) — Contractor (Data Engineer, 80 hrs/mo on its main Activity).
- "MES Super User support — Plant B" (D3) — Other Internal Team (Plant electrician support, 10 hrs/mo indefinite).

### Capacity reconciliation table — for the v1.18 capacity invariant (section 2.4.8)

These are the seed-derived expected values for `function_capacity` and `domain_capacity` at the 12-month-horizon centre month (2026-08). Implementation must reconcile chart, aggregation, and table; runtime assertions in development builds verify against this table.

| Function / Domain | function_capacity / domain_capacity (Aug 2026) | Source |
|---|---|---|
| Digital Manufacturing (Function) | sum of contracted hours of all DM People active in Aug 2026, minus DM BAU allocations active in Aug 2026 | computed from People + BAU at seed |
| MOM (Domain) | sum of contracted hours of People holding any MOM Skill, minus their non-MOM committed hours | computed from People skill profiles |
| MI&V (Domain) | analogous | analogous |
| MBM (Domain) | analogous | analogous |
| Group IT Enterprise Solutions (Function) | sum of contracted hours of all GroupIT People active in Aug 2026 | computed from People |
| Infrastructure & Platforms | sum of contracted hours of People holding any I&P Skill | analogous |
| Enterprise Applications | analogous | analogous |
| Data & Integration | analogous | analogous |

The exact numerical values are derived at seed-build time from the People records' contracted_hours and skill profiles. The seed module must export these expected values alongside the People data so the runtime assertion has something to check against. **The Group IT Data & Integration value for Jul 2026 and Aug 2026 must be reconciled** — the v1.17 build's apparent "phantom capacity" symptom must either reproduce (and be debugged) or not occur from a fresh seed load.

### Seed assertions (renderability invariants)

These must hold on a fresh seed load. They extend the v1.12 grey-band invariant pattern into v1.18+v1.19 territory:

- **Manage Projects board renders all 5 columns** with at least one card in Draft, Scoping, Submitted, Approved, and Allocated columns respectively — exercising Project state machine.
- **Manage Demand board renders all 5 columns** with at least one card in Draft, Submitted, Approved, PartiallyAllocated, and Allocated columns respectively — exercising Demand state machine. The Draft column shows direct Demands only (e.g. D1).
- **Project-spawned Demand carries `parent_project_id`**: at least one Demand on Manage Demand can be opened, its drawer shows "Part of [Programme] › [Project]", and clicking that link opens the parent Project's drawer.
- **Direct Demand carries no parent**: at least one Demand on Manage Demand shows the "Direct Demand" badge in its drawer.
- **Cross-Function spawn**: Project 4 ("Plant C MES Platform Migration") has exactly 2 child Demands (DM and GroupIT). Each Demand's "Sibling Demands" line lists the other.
- **Demand view Function lens applies**: the Demand view's landing page shows different chart values when the active Function switches between DM and GroupIT.
- **Demand view Direct Demands card renders** for the active Function when at least one direct Demand exists for it. With DM active, the card shows D1–D4's contributions. With GroupIT active, the card is hidden (no GroupIT direct Demands in seed).
- **Demand view By-Funding stacking only**: the toolbar has no "By Team" option; only By Funding Source is rendered. The aggregation module exports no `programme_demand_by_team` or `project_demand_by_team` functions.
- **Demand view "Include Submitted" merges, does not differentiate**: toggling Include Submitted ON adds Project 3's hours into the same funding-source bucket; the chart shows no hatched fill, no opacity change, no `(Submitted)` suffix in tooltips.
- **Demand view "Show external resource" toggle works**: toggling ON adds external hours into the same funding-source buckets; toggling OFF removes them.
- **Demand view "Show demand on other Functions" toggle works**: toggling ON for the active Function adds sibling Demands' hours on shared Projects; the Direct Demands card is unaffected.
- **Capacity Validation Section A re-renders on Function switch**: Section A's capacity-line value in any visible month differs between DM-active and GroupIT-active.
- **Capacity Validation per-Domain reconciliation**: every Domain chart's capacity-line value matches the seed reconciliation table (above) for at least one tested month per Domain.
- **Capacity Validation Section D reframed**: with DM active and "Show demand on other Functions" ON, Section D's D1 chart shows non-zero hours for GroupIT; the in-scope Demands are GroupIT Demands on **shared Projects** (Projects 3 and 4) — not all GroupIT Demands.
- **No Park/Close/Revert/Revise/Duplicate anywhere**: the drawer overflow on every status shows only Delete; the drawer footer shows only the status-appropriate primaries (no Park/Revert/Revise buttons exist anywhere in the UI). The Archive nav item is absent.

**v1.19-specific seed assertions** — added to verify the new model holds on a fresh seed load:

- **No Teams Assigned anywhere on Projects**: every Project — Draft, Scoping, Submitted, Approved, or Allocated — renders its Activity cards with no Teams Assigned section, no per-team confirmation strip, and no team-assignment dropdown. The store contains zero `ProjectTeamAssignment` records.
- **Functions Required field present and editable on Project Draft and Scoping**: Project 1 ("Plant D MES Concept Study") in Draft shows Functions Required = `[Digital Manufacturing, Group IT Enterprise Solutions]` with the multi-select picker enabled. Project 2 ("Plant E MES Refresh") in Scoping shows Functions Required = `[Digital Manufacturing]` only — verifying the originator declared a single Function and additional Functions joined via Scoping requirements.
- **Functions Actually Involved derived correctly**: on Project 2 in Scoping, the "Actually involved" chip row includes both Digital Manufacturing and Group IT Enterprise Solutions, with the Group IT chip showing the "added during Scoping" badge.
- **Functions Required is frozen post-Submit**: Project 4 ("Plant C MES Platform Migration") in Approved shows Functions Required as a read-only chip row, identical to the value it had at Submit; the multi-select picker is not rendered.
- **Skill picker scoping in Project Scoping is full-catalogue**: opening Project 2's edit page in Scoping and clicking "Add internal requirement" on any Activity shows a DOMAIN > SKILL selector listing every Skill across both Functions, grouped by Function then Domain.
- **Skill picker scoping in Demand Submitted is single-Function**: opening a spawned Demand's edit page in Submitted (e.g. Project 3's DM Demand) shows a Skill picker scoped to the Demand's Function only.
- **Submitted Demand is editable**: Project 3 ("Corporate Data Lake")'s spawned DM Demand in Submitted has its edit page in Mode A — internal requirements list shows "+ Add Internal Requirement", existing requirements show editable hours grids, external requirements show editable provider/role/hours fields. Activities on this Project-spawned Demand are read-only (visually muted, no edit affordances). The drawer footer shows Approve and Model Capacity.
- **Approved Demand is locked**: Project 4's GroupIT Demand in Approved has its edit page in Mode B (Allocation Workspace) — the "Definition is Locked" banner is visible with the v1.19 copy, and no internal/external requirement fields show edit affordances.
- **Materialisation produces independent Demand data**: at seed-build time, Project 4's spawned DM Demand and GroupIT Demand each carry their own `activities`, `internal_requirements`, and `external_requirements` arrays (deep copies, not references to the Project's data).
- **External requirement Function-tag routing works**: Project 3's external requirements include 1× Contractor tagged DM and 1× OEM tagged GroupIT. After spawn, the DM Demand carries the Contractor external requirement and the GroupIT Demand carries the OEM external requirement — verifiable by inspecting each Demand's `external_requirements` list and confirming the tags match the Demand's Function.
- **Direct Demand external Function-tag is auto-set**: any direct Demand (D1–D4) with external requirements shows `function_tag = demand.function_id` on every external requirement. The Function-tag picker is not rendered on direct Demand edit pages.
- **Spawn drift demonstrable on Project 4 DM Demand**: the seed has the DM Demand's edited-in-Submitted requirement hour value of 80 differing from the Project's frozen record value of 60. The Project's drawer "Planning record at Submit" section shows 60; the DM Demand's drawer shows 80.
- **Manage Projects view-only from Submitted**: Project 3 (Submitted), Project 4 (Approved), Project 5 (Allocated), and Project 6 (Allocated) all show a "View" button (not "Edit") in their drawers. Their edit pages render with all fields read-only and no "+ Add" affordances anywhere.
- **Submit-for-Scoping gate uses Functions Required**: Project 1 in Draft has Functions Required populated and at least one Activity — the Submit for Scoping button is enabled.

**v1.20-specific seed assertions** — added to verify the new model holds on a fresh seed load:

- **Project Draft hides requirements UI entirely**: Project 1 ("Plant D MES Concept Study") in Draft has Activities with names + dates but NO internal requirements list, NO external requirements list, NO "+ Add Internal Requirement" button, NO "+ Add External Requirement" button anywhere on its edit page or drawer. The store's `internal_requirements` and `external_requirements` arrays for this Project are both empty; the UI does not render the affordance to populate them.
- **Manage Projects Function-scoping rule**: switching the active Function from Digital Manufacturing to Group IT Enterprise Solutions changes the visible set of Projects on Manage Projects. Specifically, Project 5 ("MBM Foundation Library", DM-only) is hidden under Group IT but visible under DM; Project 4 ("Plant C MES Platform Migration", cross-Function) is visible under both.
- **Project Type labels resolve, never show system keys**: every Project / Demand surface (drawer headers, Manage Projects cards, Manage Demand cards, table columns, capacity legends) renders Project Type as the resolved `name` (e.g. "Plant Project", "Group Strategy Project") — never as the system key (`pt_plant_project`, `pt_group_strat`). A runtime assertion scans rendered DOM text and fails on any `pt_*` match.
- **Project Type admin shows system key**: opening the Project Types admin screen displays `id` (e.g. `pt_plant_project`) as a read-only monospace tag below or beside each `name` field. Editing `name` updates the displayed name but does not change the `id`.
- **Demand auto-name has no Function suffix**: spawned Demands' default `name` equals the parent Project's `name` exactly (no " — Function Name" suffix). Project 4's two spawned Demands both have `name: "Plant C MES Platform Migration"` (verified by inspecting each Demand's `name` field). The Function chip in the Demand drawer header is the disambiguator.
- **Activity terminology applies everywhere**: every UI label and every store field uses "Activity" (not "Phase"). Includes UI strings (`+ Add Activity`, `Activity timeline`, "Activity 1 · Design"), data fields (`activities`, `activity_id`, `activity_name`, `activity_start_month`, `activity_end_month`), and import workbook tabs (`Activities` tab, `activity_*` columns). A search for the exact word "Phase" in the rendered DOM returns zero results.
- **Date pickers on Activity dates with validation**: opening Project 1 (Draft) and clicking the start month or end month input on any Activity opens a month-year picker (not a free text field). Setting the end month to a value earlier than the start month surfaces an inline error and disables Save until corrected. The "No end date (indefinite)" checkbox remains functional.
- **Mode B shows total target hours per requirement**: opening Project 4's GroupIT Demand (Approved) in Mode B shows for each requirement, alongside skill+level, a "Target: N hrs total" line and an "Allocated: M hrs (X%)" coverage summary. The total reads from the requirement's `hours_by_month` sum (finite) or `steady_state_hours · indefinite` (indefinite).
- **Skill picker is two-step on Project Scoping**: opening Project 2 (Scoping) and clicking "+ Add internal requirement" presents a Function-first picker (step 1: pick a Function; step 2: see that Function's Domain → Skill tree). The picker is not a single flat list. Selected skill displays as "Function · Domain > Skill" (e.g. "Digital Manufacturing · MOM > MES Platform").
- **Skill picker is single-step on Demand Submitted**: opening Project 3's DM Demand (Submitted) and clicking "+ Add internal requirement" presents a single-step Domain → Skill picker scoped to the Demand's Function (Digital Manufacturing only). No Function step.
- **Dual + Add buttons on Activities and requirements**: every Mode A edit page with at least one Activity shows "+ Add Activity" both inline with the Activities section header AND below the last Activity card. Same pattern within each Activity card for "+ Add internal requirement" and "+ Add external requirement". When a section is empty (no Activities yet, or no requirements yet), only the inline header button is shown — no duplicate empty-state button.
- **No replacement character (`U+FFFD`) in any rendered DOM text**: a runtime DOM scan after a fresh seed load and across all top-nav routes (Capacity Validation, Demand, Manage Projects, Manage Demand, Team Activity, Admin) finds zero `\uFFFD` characters. Encoding is round-trip-clean end to end.
- **Build-time seed parse from `master_seed.xlsx`**: the bundled `seed.json` is git-tracked but auto-generated from `seed/master_seed.xlsx` at build time. Modifying `seed/master_seed.xlsx` and rebuilding produces a corresponding update to `seed.json`. The build script logs "Parsed seed/master_seed.xlsx — N Projects, M direct Demands, K People, …" on success, with any warnings printed to a build report.

### 6.1 Import workbook schema

*Introduced in v1.19.* The authoritative reference for the Excel workbook used by the bulk Project import flow (section 4.6.A.1). Implementations of the Download Template generator and the Import parser must conform to this schema exactly.

**Source of truth**: a baseline workbook is checked into the repo at `assets/import_template/master.xlsx`. The Download Template generator reads this file as a structural baseline, replaces the contents of the three Reference tabs with current store data, then serialises and serves the result. The schema below documents the structure both files must hold.

#### Tab order and structure

The workbook contains exactly **nine tabs in this order**:

| # | Tab name | Visible? | Purpose |
|---|---|---|---|
| 1 | `Projects` | visible | One row per Project. Five columns. |
| 2 | `Activities` | visible | One row per Activity. Six columns. References `project_name` from tab 1. |
| 3 | `Internal Requirements` | visible | One row per skill-shaped requirement. Eight columns. References `project_name` from tab 1 and `(project_name, activity_name)` from tab 2. |
| 4 | `External Requirements` | visible | One row per external resource requirement. Seven columns. Same reference pattern. |
| 5 | `Reference - Programmes` | visible | Two columns (Name, Description). Populated from active Programmes at download time. |
| 6 | `Reference - Skills` | visible | Three columns (Function, Domain, Skill Name). Populated from active Skills at download time. |
| 7 | `Reference - Providers` | visible | One column (Provider Name). Populated from active Providers at download time. |
| 8 | `Reference - Project Types` | visible | One column (Project Type Name). Populated from active Project Types at download time, in `display_order` order (see section 2.1.2). **New in v1.19** — replaces the static `project_type` enum that previously lived in `_lists`. |
| 9 | `_lists` | hidden | Two columns carrying enum dropdown sources (funding_source, level). Static — not regenerated at download time. |

No other tabs may be added or renamed by the generator. The parser ignores any additional tabs the user might add; their presence is not an error.

#### Column reference

**Tab 1 — Projects** (5 columns)

| # | Column | Required? | Validation | Notes |
|---|---|---|---|---|
| 1 | `project_name` | Yes | Free text, non-empty, unique within the file | Link target from tabs 2–4. |
| 2 | `programme_name` | No | Dropdown sourced from `rng_programmes` | Blank = unaligned Project. |
| 3 | `project_type` | Yes | Dropdown sourced from `rng_project_types` | Must match an active Project Type record's `name`. Population reflects current admin records — see section 2.1.2. |
| 4 | `project_owner` | Yes | Free text, non-empty | Person or role name. |
| 5 | `project_description` | No | Free text | Optional. |

**Tab 2 — Activities** (6 columns)

| # | Column | Required? | Validation | Notes |
|---|---|---|---|---|
| 1 | `project_name` | Yes | Dropdown sourced from `rng_project_names` (self-referential to Projects tab) | Must match a row on tab 1. |
| 2 | `activity_name` | Yes | Free text, non-empty, unique within a Project | Link target from tabs 3–4. |
| 3 | `activity_start_month` | Yes | Free text matching `YYYY-MM` regex | E.g. `2026-05`. |
| 4 | `activity_end_month` | No | Free text matching `YYYY-MM` regex, or blank | Blank = indefinite Activity (steady-state hours). |
| 5 | `funding_source` | Yes | Dropdown sourced from `rng_funding_source` | One of: Investment Scheme, Plant/Sector Allocation, Mixed. |
| 6 | `funding_notes` | No | Free text | Optional. |

**Tab 3 — Internal Requirements** (8 columns)

| # | Column | Required? | Validation | Notes |
|---|---|---|---|---|
| 1 | `project_name` | Yes | Dropdown sourced from `rng_project_names` | Must match a row on tab 1. |
| 2 | `activity_name` | Yes | Free text | Must match a row on tab 2 with the same `project_name`. Cross-tab match validated at parse time, not in Excel. |
| 3 | `skill_function` | Yes | Dropdown sourced from `rng_functions` | Sanity-check against Skill chosen. |
| 4 | `skill_domain` | Yes | Dropdown sourced from `rng_domains` | Sanity-check against Skill chosen. |
| 5 | `skill_name` | Yes | Dropdown sourced from `rng_skills` | Must match an existing Skill record. The parser verifies that `skill_function` + `skill_domain` are consistent with the Skill's actual Function and Domain. |
| 6 | `level` | Yes | Dropdown sourced from `rng_level` | Basic / Advanced / Specialist. |
| 7 | `hours_per_month` | Yes | Decimal ≥ 0 | Single value used to fill `hours_by_month` uniformly across the Activity, or as `steady_state_hours` for indefinite Activities. |
| 8 | `notes` | No | Free text | Optional. |

**Tab 4 — External Requirements** (7 columns)

| # | Column | Required? | Validation | Notes |
|---|---|---|---|---|
| 1 | `project_name` | Yes | Dropdown sourced from `rng_project_names` | Must match a row on tab 1. |
| 2 | `activity_name` | Yes | Free text | Must match a row on tab 2 with the same `project_name`. |
| 3 | `provider` | Yes | Dropdown sourced from `rng_providers` | Must match an existing Provider record. |
| 4 | `role` | Yes | Free text, non-empty | Free-text role description. |
| 5 | `function_tag` | Yes | Dropdown sourced from `rng_functions` | Determines which spawned Demand this external materialises onto. |
| 6 | `hours_per_month` | Yes | Decimal ≥ 0 | Same semantics as Internal Requirements column 7. |
| 7 | `notes` | No | Free text | Optional. |

#### Named ranges

Nine named ranges drive the dropdowns. All are workbook-scoped:

| Name | Refers to | Purpose |
|---|---|---|
| `rng_project_types` | `'Reference - Project Types'!$A$2:$A$T+1` (T = number of active Project Types) | project_type dropdown. **New in v1.19** — relocated from `_lists` to its own visible Reference tab because Project Types are admin-managed records that must reflect live store contents at download time. |
| `rng_funding_source` | `_lists!$A$2:$A$4` | funding_source dropdown |
| `rng_level` | `_lists!$B$2:$B$4` | level dropdown |
| `rng_programmes` | `'Reference - Programmes'!$A$2:$A$N+1` (N = number of active Programmes) | programme_name dropdown |
| `rng_functions` | `'Reference - Skills'!$A$2:$A$M+1` (M = number of active Skills) | skill_function and function_tag dropdowns. Note: the range targets the Function column of the Skills tab and contains duplicates — Excel's dropdown automatically de-duplicates the displayed list. |
| `rng_domains` | `'Reference - Skills'!$B$2:$B$M+1` | skill_domain dropdown. Same de-duplication semantics. |
| `rng_skills` | `'Reference - Skills'!$C$2:$C$M+1` | skill_name dropdown. |
| `rng_providers` | `'Reference - Providers'!$A$2:$A$P+1` (P = number of active Providers) | provider dropdown |
| `rng_project_names` | `Projects!$A$2:$A$201` | Self-referential — used by tabs 2–4 to dropdown-validate `project_name`. Static range supports up to 200 Projects per import. |

The data validations on each data tab apply from row 2 down to a fixed bottom row (typically row 495–500) — generous headroom for any realistic single import. Rows beyond the validation range remain editable but lose dropdown safety; the parser still validates them at upload time.

#### Why Excel-only (not CSV)

The validation rules above only function inside an Excel workbook. CSV upload would silently lose every dropdown and every cell-level type check, producing a much worse error-prevention experience. The parser therefore accepts `.xlsx` only. This is documented in the Import button's tooltip and surfaced as a clear error if the user attempts a CSV upload.

#### Parser semantics

The parser executes in this order:

1. **Workbook structure check** — the four required data tabs are present with their expected column headers. Missing tab or wrong header → blocking error: "This file does not match the import template. Tab 'Activities' is missing." The user is invited to download a fresh template.
2. **Row-level validation** — each tab is read row by row. Empty rows are skipped silently. Required-field-missing → row-level error. Type-mismatch on `activity_start_month` / `activity_end_month` (regex fail) → row-level error. Type-mismatch on `hours_per_month` (negative or non-numeric) → row-level error.
3. **Reference resolution** — every `programme_name`, `skill_name` (with `skill_function` and `skill_domain`), `provider`, and `function_tag` is resolved to a record id. Unknown reference → row-level error: "Internal Requirements row 7 — skill_name 'PLC Programmin' not found in Function 'Digital Manufacturing', Domain 'MOM'. Did you mean 'PLC Programming'?" The "did you mean" suggestion uses Levenshtein distance ≤ 2 against the same-Function-and-Domain Skill list.
4. **Project-tab uniqueness** — `project_name` values on tab 1 are checked for duplicates within the file. Duplicate → blocking error.
5. **Cross-tab integrity** — each row on tabs 2–4 is checked against tab 1 (`project_name` exists) and against tab 2 (`activity_name` exists for the given `project_name`, where applicable). Missing → blocking error with the "did you mean" suggestion.
6. **Activity uniqueness** — `activity_name` values within a `project_name` on tab 2 are checked for duplicates. Duplicate → blocking error.
7. **Skill–Function–Domain consistency** — for each Internal Requirements row, the parser verifies that `skill_function` and `skill_domain` match the Skill's actual Function and Domain. Mismatch → row-level error.
8. **Spawn dry-run** — for each unique `project_name`, the parser computes which Functions will be involved (from `internal_requirements`) and confirms each is non-empty. A Project with no internal requirements would spawn no Demands; this is a row-level error on the Projects tab: "Project 'Plant D Concept' has no Internal Requirements rows. A Project with no internal requirements cannot be imported (it would spawn no Demands)."
9. **Warnings** — non-blocking. Examples:
   - External requirement on a Project where the `function_tag` Function has no matching internal requirements: "External Requirements row 8 — function_tag 'Group IT Enterprise Solutions' is not represented by any Internal Requirements row on Project 'Plant C Migration'. The spawned Group IT Demand will carry only this external requirement and no internal requirements." (This is permitted — externals can drive a Demand on their own — but worth flagging.)
   - `hours_per_month > 200` on any internal requirement: "Hours per month 240 looks high — typical FTE month is ~150 hrs."
   - `activity_end_month < activity_start_month` is a row-level error, not a warning, because no valid Activity can exist in negative time.

The parser surfaces all errors and warnings on the preview screen (section 4.6.A.1 — Preview screen). All blocking errors are listed; the user fixes them in the workbook and re-uploads. Warnings can be ignored — the user clicks Import to proceed.

#### Atomicity

The import commit is a single store transaction: every Project record, every materialised child Demand, and every spawned Activity / requirement / external is created atomically. Partial commits are not permitted. If any record fails to write, the entire transaction rolls back and the import is rejected with a single error.

This matters for `localStorage` quotas and other client-side limits: a 100-Project import is rejected as a unit if storage capacity is exceeded mid-transaction. The parser's pre-commit step estimates the storage footprint of the proposed records and surfaces a warning if it would push localStorage past 80% of typical browser limits.

#### Renderability invariants

These hold on a fresh seed load and on any successful import:

- A Download Template action produces a workbook with exactly 9 tabs, in the exact order specified above, with the exact headers specified above on each data tab.
- The Reference tabs in the downloaded workbook contain entries for every active Programme, Skill, Provider, **and Project Type** in the store at the moment of download. Project Types are listed in `display_order` order.
- An Import of an unmodified Download Template (just the Reference tabs populated, no data rows) produces zero Projects and surfaces no errors.
- An Import of a workbook with one Project, one Activity, and one Internal Requirement produces one Project in `Submitted` status with one materialised child Demand also in `Submitted`, with the materialised data matching the workbook rows exactly.
- An Import of a workbook referencing a Programme that doesn't exist in the store produces a blocking error and creates zero records.

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
| Excel handling | **ExcelJS** — for the Excel import/export surface (section 4.6.A.1). Used to read uploaded `.xlsx` workbooks and to generate the Download Template artefact in-browser. Bundle is lazy-loaded only when the user activates either action; not loaded on initial page render. |

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
- Swap Sarah for Chris on Activity 2 of another project
- See the combined impact across the team before committing the change

V2 will introduce:

- **Named scenarios** — saveable sets of proposed changes to committed demand (date shifts, re-allocations, reassignments), separate from the live plan.
- **Multi-item scenarios** — a scenario can move multiple demand items simultaneously so knock-on effects are visible together.
- **Scenario comparison** — view live plan vs scenario side-by-side on the same charts.
- **Commit/discard** — promote a scenario back into the live plan, or discard.
- **Scenario-mode UI** — likely a toggle on the Capacity Validation view that puts it into a sandbox state where edits affect the scenario rather than live data.

**V1 implication**: Activity dates and resource allocations must be cleanly editable in-place through the Demand Item Editor, and the capacity view must recalculate live from the underlying data. This gives users a clunky but functional "what-if" workflow today (edit → look → undo if needed) and sets up v2 scenarios as a data-layer branch without architectural rework. Claude Code should not build any scenario-specific UI or data structures in v1.

### 8.2 Approval workflow

The current Draft → Submitted → Accepted → Allocated flow is manual and unrestricted in v1. V2 will introduce:

- Role-based gating of status transitions.
- Designated reviewers per domain.
- Audit trail of status changes, including over-allocation acknowledgements.

### 8.3 Funding budget tracking

V2 may introduce scheme-level budget tracking: "Scheme X has 2000 hours, 1400 committed, 600 remaining." V1 captures funding source on Activities, which provides the data foundation for this without building the feature.

### 8.4 Actuals reconciliation

Actual time is recorded in SAP. V2 may ingest a periodic actuals feed to compare against forecast. Not in scope for v1.

### 8.5 Permissions

All edit access is open in v1. V2 will introduce authentication and role-based permissions (Domain Lead, Resource Manager, PMO, read-only).

---

## 9. Build sequencing

### v1.20 — build order

The dependency graph is: terminology rename → data model touches → admin/UI surfaces → seed pipeline → renderability invariants. v1.20 is materially smaller in scope than v1.19; the bulk is a rename, a clutch of UI tightening tasks, and the introduction of a build-time seed parse pipeline. Implementation order:

1. **Phase → Activity rename (mechanical, repo-wide)**:
   - Rename store types and field names: `Phase` → `Activity` entity name; `phases` → `activities` arrays on Project and Demand; `phase_id` → `activity_id`; `phase_name` → `activity_name`; `phase_start_month` → `activity_start_month`; `phase_end_month` → `activity_end_month`. Any `parent_phase_id` references on requirements become `parent_activity_id` (or implicit via array index, depending on existing implementation).
   - Rename UI strings everywhere: "+ Add Phase" → "+ Add Activity"; "Phase 1 · Design · …" → "Activity 1 · Design · …"; "Phase timeline (Gantt)" → "Activity timeline (Gantt)"; section/card headers; tooltips; error messages.
   - Rename import workbook tab `Phases` → `Activities`; columns `phase_name`, `phase_start_month`, `phase_end_month` → `activity_*`. Regenerate the bundled `assets/import_template/master.xlsx` to match. The import parser surfaces a clear blocking error if a v1.19 workbook is uploaded ("Tab 'Phases' is the v1.19 name; please download the latest template").
   - This rename is mechanical — search-and-replace across the codebase scoped to identifiers, then a manual review pass for any remaining occurrences of the word "phase" that were intentionally generic English (e.g. "time-phased", "pre-commit phase" — these stay).
   - **Land this step in a single commit** so subsequent commits build on consistent terminology.

2. **Data model additions**:
   - Add `created_under_function_id: string` field to Project (nullable; populated on Project create with the user's active Function id at that moment). Migrate existing seed Projects: set `created_under_function_id` to the first Function in `functions_required`, falling back to "digital_manufacturing" for legacy records with empty `functions_required`.
   - Tighten `ProjectType.id` derivation per section 2.1.2: on every Project Type create, derive the `id` from `name` as `pt_<slug>`, check uniqueness against all existing records (active and inactive), block on collision with an inline error. Existing seed Project Types already have correct ids per section 2.1.2 seed table — verify; fix if any drifted.

3. **Admin — Project Types system key visibility** (sections 2.1.2, 5):
   - Add a read-only `id` column/field to the Project Types admin list view, rendered as a small monospace tag adjacent to the `name` field on each row.
   - Add a real-time `id` preview to the Add Project Type form: as the user types `name`, the form previews "System key: `pt_<slug>`" below the input. Submission is blocked if the derived `id` collides with any existing record (active or inactive); the inline error names the colliding record.
   - Confirm `id` is immutable after creation: editing `name` updates `name` but never regenerates `id`. Test by renaming a seed Project Type and verifying its existing references still resolve.

4. **UI — Type label resolution rule** (sections 4.5.1, 4.6, 4.6.A, 5):
   - Audit every UI surface that renders a Project Type — drawer headers, drawer body chips, Manage Projects cards (board + table), Manage Demand cards (board + table), capacity stack legends, Capacity Validation tooltips, filter dropdowns, import/seed workbook reference cells. Every render path must resolve the FK reference to the Project Type record's `name` and render that string. **The system key (`pt_*`) must never appear in user-facing UI** outside the Project Types admin screen.
   - Add a runtime DOM scanner (development builds) that searches rendered text for strings matching the regex `pt_[a-z_]+` and logs a console error naming the offending element and its data path. This catches future regressions loud rather than silent.
   - Verify by switching between Project / Demand drawers across all statuses and confirming no `pt_*` string appears anywhere. Manage Projects' Type column and Manage Demand's Type column are common offenders.

5. **UI — Demand auto-name change (no Function suffix)** (section 2.2.4):
   - Update the spawn algorithm in `spawnDemandsOnProjectSubmit` to set `Demand.name = project.name` (no " — Function Name" suffix). Confirm via section 11.20 pseudocode.
   - Re-seed: Project 4's spawned Demands and any other spawned Demand in the bundled seed get their names updated to the parent Project's `name`. (After step 11 below, this happens automatically via the `master_seed.xlsx` parse.)
   - Confirm the Demand drawer header's Function chip remains the disambiguator for siblings. Verify the Sibling Demands line on a spawned Demand drawer still renders Function names (it always did — the chip alongside each sibling carries the Function), so siblings remain distinguishable post-suffix-removal.

6. **UI — Manage Projects Function-scoping** (section 4.6.A):
   - Implement the new visibility predicate in `selectProjectsForActiveFunction(store)`:
     - Draft → visible if `activeFunctionId ∈ functions_required`, OR `functions_required` is empty AND `created_under_function_id === activeFunctionId`.
     - Scoping → visible if `activeFunctionId ∈ functions_required`, OR `activeFunctionId ∈ functionsActuallyInvolved`, OR (`functions_required` empty AND `functionsActuallyInvolved` empty AND `created_under_function_id === activeFunctionId`).
     - Submitted/Approved/Allocated → visible if at least one child Demand has `function_id === activeFunctionId` (unchanged from v1.19).
   - Implement the "active Function changed; current Project no longer visible" guard: if the user has a Project drawer or edit page open and the new active Function makes the Project invisible, close the drawer/edit page, return to Manage Projects under the new Function, and surface a toast. Mirrors the analogous Demand behaviour in section 4.9.
   - Update the v1.20 seed: ensure Project 5 ("MBM Foundation Library", DM-only) has `functions_required = [DM]` and `created_under_function_id = DM` so it's visibly hidden when Group IT is the active Function.

7. **UI — Mode A Project Draft strict rule** (section 4.5.2):
   - **Hide entirely** the internal requirements list, external requirements list, and both "+ Add" affordances on every Activity card when the Project status is `Draft`. The store's `internal_requirements` and `external_requirements` arrays remain (a Project that drops back from Scoping to Draft via Delete-and-recreate would be empty anyway). The UI affordance to populate them is gone in Draft.
   - Reaffirm: Skill, level, hours, and external resource entry happen during Scoping, not Draft. The drawer body's status-aware tables (section 4.5.1, v1.20) reinforce this — Draft surfaces show no requirements detail.

8. **UI — Activity date pickers + validation** (sections 2.2.2, 4.5.2):
   - Replace free-text inputs for `activity_start_month` and `activity_end_month` on every Activity card in Mode A with a **month-year picker component** — calendar popover with year navigator + 12 month tiles, returning a `YYYY-MM` value. Picker portals (per the dropdown overflow rule).
   - Implement live validation: setting `activity_end_month < activity_start_month` rejects the selection in the picker and surfaces an inline hint. Save is disabled while any Activity has invalid dates.
   - Preserve the "No end date (indefinite)" checkbox alongside the end-month picker — when checked, the end-month picker hides and the Activity becomes indefinite. Validation rule applies only when both start and end are set.

9. **UI — Mode B requirement total hours** (section 4.5.2):
   - Add to each requirement row in Mode B (above the month coverage strip): a prominent "Target: N hrs total · {description}" line where `description` reflects the rate ("80 hrs/mo × Jun–Nov 2026" for uniform finite, "varies by month · Jun–Nov 2026" for non-uniform finite, "5 hrs/mo · indefinite from Jul 2026" for indefinite). Total computed from `hours_by_month` sum or `steady_state_hours` per the Activity type.
   - Add a coverage summary line beneath: "Allocated: N hrs (X%) · Unfilled: N hrs". Computed from the requirement's allocations vs target.
   - Both lines update live as allocation rows are edited (in-session map per section 4.5.2 capacity-preview rules).

10. **UI — Skill picker dual-mode** (section 4.5.3):
    - Refactor the shared Skill selector into two scoping modes:
      - **Single-Function mode** (existing): Domain → Skill, scoped to one Function. Used on Demand edit (Mode A on Project-spawned Submitted, direct Draft, direct Submitted), admin person-skill assignment, and Function-lensed filters.
      - **Cross-Function mode** (new): two-step Function → Domain → Skill. Used on Project Scoping. Step 1 lists Functions; step 2 reveals the picked Function's Domain → Skill tree. A search field at the top searches across all Functions/Domains/Skills (search hits show Function · Domain prefix). A back affordance returns to step 1 without context loss. Selected display: "Function · Domain > Skill".
    - The flat-list-across-Functions pattern (the v1.19 build's regression on Project Scoping) is **not acceptable** — verify on Project 2 (Scoping seed) that the picker is two-step.

11. **Drawer body status-aware refactor** (section 4.5.1):
    - Replace the previous fixed-content drawer body with a status-aware renderer that selects content per the Project / Demand status tables in section 4.5.1.
    - Project drawer:
      - Draft: Description, Programme, Type chip, Functions Required chip row, Activity summary line. No requirements detail.
      - Scoping: Description, Programme, Functions Required + Functions Actually Involved chip rows (with badges where they diverge), Activity list with internal/external requirement counts and totals.
      - Submitted/Approved/Allocated: Description, Programme, Spawned Demands list (rows with Function, status, hours, click-through), planning record collapsed-by-default expander.
    - Demand drawer:
      - Draft (direct): Description, Programme (always "Direct Demand (no Programme)"), Function chip, Origin badge, Activity list with requirement detail. No allocation summary.
      - Submitted: as above + Parent Project link (spawned) + Sibling Demands list (when applicable).
      - Approved/PartiallyAllocated/Allocated: as above + Allocation summary banner with coverage %, unfilled requirement-month count, named people count.
    - Implement the encoding-safety rules: ensure UTF-8 round-trips cleanly through localStorage and DOM rendering paths; structural rendering (separate elements / chips) for hierarchy instead of inline chevron/em-dash strings.
    - Add a runtime DOM scanner (development builds) that searches rendered text for `\uFFFD` and logs a console error naming the offending element. This catches encoding regressions loud.

12. **UI — Manage Projects / Manage Demand card cleanup** (sections 4.6, 4.6.A):
    - Manage Demand Board cards: Demand name (Project name for spawned, no Function suffix), Type badge (resolved label, not system key), Origin/parent line (Project name link or "Direct" badge), active-Function chip only when siblings exist, compact stats line with internal hours / external hours / coverage %.
    - Manage Demand Table mode: ensure the Type column resolves to `name` not `id`.
    - Manage Projects Board cards: Project name, Type badge (resolved label), Programme line, Functions Actually Involved chip row, Functions Required hint footnote on Draft/Scoping only, compact stats line (Activity count + Demand count).
    - Manage Projects Table mode: ensure the Type column resolves to `name` not `id`.
    - Both: forbid chevron-joined or em-dash-joined hierarchy strings on cards. Render hierarchy through separate elements/chips.

13. **UI — Dual + Add buttons** (section 4.5.2):
    - Add a secondary "+ Add Activity" button below the last Activity card on every Mode A edit page. Identical behaviour to the inline header button. Hidden when the Activities array is empty (only the inline button shown then).
    - Same pattern within each Activity card for "+ Add internal requirement" (below the last internal requirement row) and "+ Add external requirement" (below the last external requirement row). Hidden when the respective list is empty.
    - The bottom buttons get a visually subtler treatment per DESIGNSYSTEM.md (e.g. ghost style; smaller).

14. **Build-time seed pipeline (`master_seed.xlsx`)** (section 6.0):
    - Add `seed/master_seed.xlsx` to the repo. Schema per section 6.0 — all 9 import-workbook tabs plus 11 extra structural tabs (Functions, Domains, Skills, Teams, People, Person Skills, Project Types, Programmes, Providers, Direct Demands, Allocations).
    - Implement `scripts/build-seed.ts` (or equivalent Node script): loads the workbook with ExcelJS, parses structural tabs into in-memory records with full validation (cross-references, uniqueness, value ranges), parses Projects/Activities/Internal Reqs/External Reqs using the existing import parser logic, applies `status_override` per the Projects tab, parses Direct Demands, parses Allocations, recomputes Demand auto-transitions to verify status overrides are consistent, writes the result to `src/seed/seed.json`. Build-time errors fail the build with a clear message naming tab/row/column.
    - Wire the script into the build (`pnpm build` or `npm run build` invokes it before Vite). Document this in `README.md`.
    - Migrate the existing seed data: take the current hand-authored / Claude-Code-generated `seed.json` and round-trip it into `master_seed.xlsx`. Verify the freshly-parsed `seed.json` from the workbook is identical (or equivalent) to the original, so the renderability invariants from sections 6 and 11 still hold.
    - Document in section 7 (Technology) that `seed.json` is generated and not hand-edited; edits go to `master_seed.xlsx`.

15. **Seed updates for v1.20**:
    - Update `master_seed.xlsx` (and therefore the parsed `seed.json`) to:
      - Drop the Function suffix from spawned Demand names (the parser now produces the correct names automatically — verify).
      - Set `created_under_function_id` on every Project (DM for DM-touched, GroupIT for GroupIT-only).
      - Project 5 ("MBM Foundation Library") set to `functions_required = [DM]` and `created_under_function_id = DM` to exercise the Function-scoping rule when Group IT is active.
      - Replace any `phase_*` column references in the workbook with `activity_*`.
    - Update the seed reconciliation table (section 6) where any totals shift due to renames.

16. **Renderability invariants for v1.20** (section 6 seed assertions):
    - Wire the v1.20-specific seed assertions as runtime assertions in development builds.
    - Project Draft hides requirements UI entirely; Manage Projects Function-scoping holds across switches; Project Type labels resolve everywhere; Demand auto-name has no Function suffix; Activity terminology applies everywhere; date pickers + validation work; Mode B shows total target hours; Skill picker is two-step on Project Scoping and one-step on Demand Submitted; dual + Add buttons render correctly; no `\uFFFD` in DOM; build-time seed parse succeeds.

17. **Cleanup**:
    - Remove every remaining hardcoded "Phase" or `phase_*` identifier in the codebase outside the changelog and the v1.20 terminology section. A grep for `\bphase\b|\bPhase\b` (case-sensitive on identifiers) should return only false positives (e.g. "time-phased").
    - Remove the `seed.json` from manual edit history if it's been treated as a hand-authored file — going forward, edits go to `master_seed.xlsx`. Add a comment header to `seed.json` ("Generated from master_seed.xlsx — do not edit by hand") and a `.gitattributes` `linguist-generated=true` for diff suppression.
    - Audit DESIGNSYSTEM.md for the new month-year picker styling and the dual + Add button (subtler bottom-button) treatment. Add tokens if they don't exist.

**Testable after each step** — don't bundle. Each step has a user-observable outcome that must land and be smoke-tested before the next step builds on top.


---

## 10. Open questions and assumptions

The following are flagged. Assumptions are explicit so they can be challenged before or during build.

- **Scenario mechanics (v2)**: when a scenario shifts a project, does only the Activity date move, or do named allocations and/or skill requirements move with it? Does a scenario affect one demand item or many? Does not need answering for v1 but should be resolved before v2 planning.
- **BAU at domain level** (assumption): all BAU is per-person; there are no domain-level BAU streams. Stream name provides the roll-up view.
- **Activity name autocomplete source** (assumption): suggestions come from Activity names used on the last N demand items, not a fixed master list. No admin burden.

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

The overlay selector in the toolbar is a **single-selection** pattern. The user clicks a "Set overlay" combobox which lists Demand items in `Submitted` status **whose `function_id` matches the active Function**, searchable by name. Selecting one sets it as the single active overlay, replacing any previously-selected item. A "Clear overlay" button (or the × on the chip) removes the overlay. Only Submitted items belonging to the active Function are eligible — items in other statuses or belonging to other Functions are not offered. *(v1.21 bug-fix: the previous implementation showed all Submitted Demands regardless of Function, causing duplicates when a Project spawns sibling Demands across Functions — e.g. "Project A" appearing twice. Because the overlay models capacity impact on the active Function's skill pools, offering a Demand from another Function is meaningless — it has no requirements targeting the active Function's Skills.)*

If the user arrives via "Model Capacity" from a demand drawer, the overlay is pre-populated with that item; the user can clear it or change it using the same combobox.

### 11.3 Status transitions

Status transitions are available from:

- The **drawer** (read-only preview) — distributed across three surfaces in v1.14 per section 4.5.1: the **footer** carries the status-appropriate primary-CTA transition(s), the **overflow menu** (top-right kebab) carries the valid-but-uncommon transitions, and the **top-right Edit button** opens the edit page where the same transitions are also available. The status zone itself no longer carries action buttons.
- The **edit page** — transition buttons in the page header or footer, since the user may change status as part of an editing session.
- The **Board discovery mode** — drag-and-drop between columns, as per 4.6.

The transitions available depend on the current status. See section 3 for the complete state machine. See section 4.5.1 for the exact drawer footer / overflow split by status.

User-driven transitions exposed in the UI (summary — authoritative placement is in section 4.5.1):

- **From Draft**: `Submit for Scoping` (footer primary); `Duplicate`, `Delete` (overflow).
- **From Scoping**: `Submit for capacity assessment`, `Revert to Draft`, `Park` (footer — right-to-left, Submit is rightmost primary); `Close`, `Duplicate`, `Delete` (overflow). Submit opens the confirmation dialog described in section 3 (surfaces unconfirmed teams; does not block).
- **From Submitted**: `Approve`, `Model Capacity`, `Revert to Draft`, `Park` (footer — right-to-left in that order, Approve is the rightmost primary); `Duplicate`, `Delete` (overflow).
- **From Approved**: `Allocate` (footer primary — opens edit page in Mode B); `Revise`, `Park`, `Close`, `Duplicate`, `Delete` (overflow).
- **From Partially Allocated**: `Allocate` (footer primary); `Park`, `Close`, `Duplicate`, `Delete` (overflow).
- **From Allocated**: *(no footer button)*; `Park`, `Close`, `Duplicate`, `Delete` (overflow). Edit remains available at top-right.
- **From Parked**: `Revive` (footer primary — always to Submitted); `Duplicate`, `Delete` (overflow).
- **From Closed** (Archive view only): `Restore` (footer primary); `Duplicate`, `Delete` (overflow).

**Allocate is a navigational button, not a status transition.** It opens the edit page in Mode B. Its presence as a footer primary on Approved / PartiallyAllocated reflects that "start/continue allocating people" is the overwhelmingly common next action at those lifecycle points. Clicking it does not change the Demand's status.

**Model Capacity is a cross-view navigation**, not a status transition. It opens the Capacity Validation view with this Demand pre-selected as the overlay (section 11.11).

Status changes take effect immediately on click (they do not require the explicit save that applies to field edits on the edit page). The navigational buttons (Allocate, Model Capacity, Edit) also apply immediately — they just navigate rather than mutating status.

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

### 11.11 Model Capacity deep-link and return

The "Model Capacity" action on a Submitted demand's drawer (section 4.5.1) is a cross-view navigation pattern *(renamed from "Model Impact" in v1.17 — same behaviour, clearer label)*. Implementation expectations:

- Clicking **Model Capacity** navigates to the Capacity Validation route with a URL parameter identifying the originating demand item (e.g. `#/capacity?overlay=dmd_005&from=demand`).
- On arrival, the overlay store is initialised with that single demand item pre-selected.
- A dismissable banner is rendered above the page content: "Modelling impact of *{demand name}*. **Back to demand** · ✕". The banner is fixed at the top of the scrollable page region.
- **Back to demand** navigates back to the originating route (the Demand list) and re-opens the drawer on the same demand item.
- Dismissing the banner (✕) removes the banner only. The overlay stays selected, the user continues using Capacity Validation normally.
- If the user adds or removes other overlays while the banner is visible, the banner remains (it's about provenance, not overlay state) until they either click Back or dismiss.
- If the user navigates away from Capacity Validation via any other route (main nav, etc.), the banner is gone and "Back to demand" context is lost. This is fine — they're free to re-enter via the drawer again.

Implementation note: use the router's query params (via `HashRouter`) to carry the overlay-on-load state. Don't introduce a separate "Model Capacity mode" — it's just a normal Capacity Validation page with pre-selected overlay and a contextual banner.

### 11.12 Indefinite Activity UI — end-date toggle

In the Demand edit page (Mode A), the end-date input for each Activity is the trigger that switches between finite and indefinite UI:

- A **"No end date (indefinite)"** checkbox sits next to the end-month input.
- Checking it clears the end-month input, hides the per-month hours grid for all requirements in that Activity, and shows a single "Hours per month (indefinite)" input per requirement.
- Unchecking it prompts for an end month; the requirements' per-month grids are regenerated from `start_month` to the new `end_month`, pre-filled with the current `steady_state_hours` value for every month.
- The toggle is per-Activity — a demand item can have finite Activities and indefinite Activities side-by-side.

The allocation workspace (Mode B) mirrors this:
- Finite Activity → per-month coverage strip and per-month allocation grid, as before.
- Indefinite Activity → a single "Hours per month" target; allocation rows show a single hours value per person; the coverage indicator shows a single cell (green / amber / red).

### 11.13 Capacity model refactor — building the shared aggregation layer

Section 2.4 specifies a substantial rework of how capacity and demand are computed across the tool. This is a cross-cutting refactor with strong correctness implications — it must be done carefully and in the right order.

**Build the aggregation layer first, views second**

Before any view is updated to use the new model:

1. **Identify every place in the current codebase that reads capacity or demand numbers** — chart data generators, overlay renderers, drawer summary computations, Team Activity cell builders, over-capacity summary strip, allocation workspace's capacity-preview strip, the person picker's summary capacity, validation checks. Any place that loops over Activities/requirements/allocations or that computes "how much demand is there" or "how much capacity is free."

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

- Indefinite Activities — the `steady_state_hours` path must be read correctly by both capacity and projection logic.
- BAU-type demand items — BAU was a separate entity pre-v1.7; ensure no legacy code paths handle BAU allocations differently from project allocations.
- Items just after a status transition — stale memoisation could make an item briefly appear in both overlay and committed buckets. Recompute from the store state, don't cache across transitions.
- Multi-Activity demand — a demand item with Activities across different domains should correctly contribute demand to multiple charts.
- Cross-Activity person allocation — a person allocated to multiple Activities (potentially overlapping months) must have their real_committed_hours correctly aggregated across all Activities.

**Do not skip the audit step**. The value of this refactor comes from single-source aggregation. If two call sites keep their own summation logic, the bug comes back in a different form.

### 11.14 Programme / Project / Provider creation flow

Three creation paths, chosen by context:

**Full admin creation** — the standalone admin screens for Programmes, Projects, and Providers (section 5). Used when the user is doing a batch of setup work: adding several Programmes at once, tidying the Provider list, etc.

**Inline creation from the Demand Project-alignment picker** — used mid-flow when aligning a Demand. The picker's dropdown always shows a persistent "+ Create new Project…" entry at the bottom. Selecting it opens a small inline form with: Project name (required), Programme picker (required, with its own "+ Create new Programme…" entry at the bottom of its own dropdown), optional description. On submit, the record(s) are created in the store, the new Project is immediately selected as the Demand's alignment, and the user is returned to where they were with no page navigation. On cancel, nothing is created and the original picker state is restored.

**Inline creation from the Provider dropdown** — when adding an external requirement and the admin list is empty, the form surfaces a link to the Provider admin screen. The dropdown itself does not offer inline Provider creation — Providers are a shared taxonomy that should be curated centrally, not created ad-hoc by every user adding a requirement. This is a deliberate asymmetry with Project/Programme inline creation: Projects are intrinsically tied to specific Demands and it's reasonable to create them in flow; Providers are reference data and should be controlled.

**Naming collision handling**: on creation, a uniqueness check is applied (Programme names globally unique; Project names unique within their parent Programme; Provider names globally unique). Collisions show an inline validation error on the name field and block submission. Case-insensitive matching — "Managed Services" collides with "managed services."

### 11.15 External requirement editing and validation rules

External requirements follow the same "locked once committed" discipline as internal skill-shaped requirements, but with their own specifics:

- **Editable in Mode A** — on Project Draft, Project Scoping, and direct Demand Draft. Add, remove, edit provider/role/notes/hours.
- **Read-only everywhere else** — Project Submitted onwards, direct Demand Submitted onwards, and at every Demand status when viewed via a Project-spawned Demand. To edit external requirements, the user must Delete the parent Project (or direct Demand) and recreate, per the v1.18 simplification (no Park or Revise paths back).
- **No allocation layer** — external requirements never have a Mode B workspace. They're demand-shaped only (section 2.6). Mode B simply renders them read-only alongside the internal allocation workspace.
- **Validation on save** (Mode A):
  - Provider is required (must be selected from the admin-configured list).
  - Role is required (free text, min 1 character after trim).
  - Hours values are required for every month in the Activity's range (finite) or a single steady-state value (indefinite), non-negative, no upper bound enforced. Zero-hour months are permitted for ramp-up/ramp-down shapes — they're valid data, not a validation error.
  - No cross-requirement validation (unlike internal requirements, there's no "over-allocation" to check — external requirements don't interact).
- **Delete is immediate** (in Mode A) — no confirmation required unless the requirement has non-zero hours in any month, in which case a lightweight "Delete external requirement for *{Provider}* — *{Role}*? This will remove {X} total hours across the Activity." confirmation is shown.
- **Provider rename cascade**: if a Provider is renamed in admin, all existing external requirements referencing that Provider show the new name immediately. No data migration needed — requirements store the Provider's id, not its name.
- **Provider delete handling**: hard-delete of a Provider is blocked if any external requirement references it (section 5). The bulk-reassign action lets the user pick a replacement Provider for all affected requirements in one operation.

### 11.16 Drawer button behaviours — navigational vs transitional

The drawer footer contains a mix of button types. Claude Code should treat them correctly:

- **Transitional buttons** (Submit for Scoping, Submit Project, Submit Demand, Approve): change the entity's status in the store and re-render the drawer with the new status's footer/overflow contents. No navigation. The drawer stays open; the user can observe the status pill change and the footer/overflow contents update in place. Submit Project (Project Scoping → Submitted) additionally surfaces the spawn confirmation dialog described in section 11.18 before applying the transition.
- **Navigational buttons** (Allocate, Model Capacity, Edit): navigate to a different route. Allocate and Edit both open the edit page — Edit opens it in whatever mode applies (Mode A for Project Draft/Scoping or direct Demand Draft; Mode B for Demand Approved/PartiallyAllocated/Allocated; read-only summary on Submitted/Approved/Allocated Projects). Allocate opens Mode B regardless (only surfaced on Demand Approved/PartiallyAllocated). Model Capacity opens the Capacity Validation view with the current Demand pre-selected as the overlay (section 11.11).
- **Overflow destructive button** (Delete): requires confirmation. Per section 3 Deletion, the dialog surfaces the cascade scope (count of child Demands and named allocations for Projects; count of allocations for direct Demands) and requires explicit confirmation. Delete is a hard delete — the user must understand cascading removal is permanent, with no Archive to retrieve from. The dialog uses the destructive-action treatment (red primary button, friction-confirmation per DESIGNSYSTEM.md).

The **top-right Edit button** behaves identically to a navigational button — same Mode A/B/read-only routing logic based on current status. It is not a transition; it's navigation.

**Removed in v1.18**: Park, Revive, Revert to Draft, Revise, Close, Restore, Duplicate. These transitional and overflow buttons existed in v1.17 and earlier; they are eliminated in v1.18 (see Changelog). The drawer footer and overflow are correspondingly leaner — see section 4.5.1's footer/overflow tables.

### 11.17 Function selector lens behaviour

The Function selector (section 4.9) is the single most cross-cutting addition in v1.16. Implementing it correctly matters because almost every other view depends on it.

**Implementation approach — selectors, not filter props**

The active Function is a single piece of store state: `activeFunctionId`. Every view that needs Function-scoped data reads from a **memoised selector** that takes the active Function as an implicit input. Do not pass `activeFunctionId` as a prop through the component tree; subscribing to the store directly is cleaner and ensures re-renders fire on every Function change without a parent having to remember to thread the prop down.

Concretely, views should call selectors like:

- `selectActiveFunctionDomains(store)` → Domain[]
- `selectActiveFunctionSkills(store)` → Skill[]
- `selectActiveFunctionTeams(store)` → Team[]
- `selectActiveFunctionPeople(store)` → Person[]
- `selectVisibleDemands(store)` → Demand[] — applies the Function lens rule (at least one requirement touches the active Function, OR `createdUnderFunctionId` matches and the Demand has zero requirements)

Every existing view that today computes Domain/Skill/Team/Person lists by iterating over the raw store must be rewritten to use the new selectors. No view should do its own Function filtering.

**URL state — source of truth for deep linking**

The active Function lives in two places: the Zustand store (for fast in-memory reads) and the URL hash (`?fn=<slug>`). On Function change, both are updated atomically via a single store action. On page load, the URL hash is read first; if present and referring to an active Function, it wins over whatever is persisted in localStorage. If absent or stale, localStorage is consulted; if also absent or stale, the default is the first alphabetically-ordered active Function.

**Store and URL must never disagree.** A pattern where the URL is the reactive source and the store is hydrated from it (via a URL-change listener) is the cleanest — it handles back/forward browser navigation naturally and means a manually-edited URL switches Function as expected.

**Guardrails**

- Deactivating the currently-active Function is permitted (via admin), but the active-Function selector must immediately fall back to the first alphabetical active Function. A toast confirms: "Function *{name}* deactivated. Switched to *{new active}*."
- Deactivating the last active Function is blocked at the admin screen — the tool cannot have zero active Functions (section 5). The admin screen disables the toggle with an explanation rather than failing silently.
- A Demand whose `createdUnderFunctionId` points to a deactivated Function remains in the store; its visibility on the Demand page is driven purely by its requirements. If it has no requirements, it becomes invisible until either its `createdUnderFunctionId` is updated (via an admin action, not in v1) or a requirement is added that pulls it into some Function's view.

**Drawer auto-close behaviour on Function switch**

If a Demand drawer is open when the user switches Function, apply this rule:

- If the open Demand has at least one internal skill-shaped requirement targeting a Skill in the new active Function, keep the drawer open — the user is looking at a cross-Function Demand and the switch is deliberate.
- If the Demand has zero requirements touching the new Function, close the drawer and return to the Demand page list.
- In the edge case where the Demand has zero requirements at all, keep the drawer open only if its `createdUnderFunctionId` matches the new active Function; otherwise close.

**Filter reset on Function switch**

Page-level filters that depend on the active Function's taxonomy must reset to defaults on switch. Specifically:

- Demand page Domain multi-select filter resets to empty (all Domains).
- Capacity Validation work-type filter does not reset (work types are Function-agnostic).
- Capacity Validation Programme/Project filter does not reset (Programmes/Projects are Function-agnostic).
- Team Activity Domain, Team, and Person filters reset to empty (they reference Function-scoped entities).

A single toast after the switch confirms: "Switched to *{New Function}*. Some filters reset."

**Demand view — Function lens applies as of v1.18**

In v1.17 the Demand view (section 4.10) was the single exception to the lens-everywhere rule. v1.18 reverses that: the Demand view now respects the active Function lens like every other view. The aggregation functions take a `function_id` parameter (section 2.4.9) and the page re-renders on Function switch. Two toolbar toggles ("Show external resource", "Show demand on other Functions") expand the picture beyond the active Function when wanted. There is no longer any view in the tool that ignores the lens.

### 11.18 Scoping → Submitted confirmation dialog (Project)

*Substantially rewritten in v1.19.* This dialog applies to **Projects** (not direct Demands — direct Demands have no Scoping step). The manual transition from Project Scoping to Submitted (section 3) triggers the spawn rule; the **Submit Project** button in the Project drawer footer always opens a confirmation dialog because spawning child Demands and freezing the Project's planning record is a real change in operational state that deserves a deliberate click.

The v1.19 dialog focuses on the **spawn outcome** — which Demands will be created and the materialised hours each will receive — rather than on team-assignment confirmation status (the Teams Assigned model is removed in v1.19).

**Dialog content — standard path**

> **Submit "Plant C MES Platform Migration"?**
>
> 2 Demands will be spawned, with Activities and requirements materialised onto each:
> • **Digital Manufacturing** — 6 internal requirements across 3 Activities, 2 external requirements (1× OEM, 1× Managed Services). 920 internal hrs, 240 external hrs over the next 12 months.
> • **Group IT Enterprise Solutions** — 3 internal requirements across 2 Activities, 1 external requirement (1× Contractor). 480 internal hrs, 120 external hrs over the next 12 months.
>
> The Project's planning record (Activities, Functions Required, requirements) will be frozen at this point. Spawned Demands will be independently editable in Submitted before approval — Function teams can refine technical detail without affecting the Project record.
>
> **[Cancel]  [Submit]**

**Dialog content — Functions Required mismatch path**

When one or more Functions appear in `functions_actually_involved` but not in `functions_required` (i.e. Scoping added Functions the originator didn't anticipate), the dialog surfaces this as planning context — informational, not blocking:

> **Submit "Plant C MES Platform Migration"?**
>
> 3 Demands will be spawned. **Note: Group IT Enterprise Solutions was added during Scoping and was not in the originator's plan (Functions Required: Digital Manufacturing).**
> • **Digital Manufacturing** — 6 internal requirements across 3 Activities, 2 external requirements. 920 internal hrs, 240 external hrs over the next 12 months.
> • **Group IT Enterprise Solutions** *(added during Scoping)* — 3 internal requirements across 2 Activities, 1 external requirement. 480 internal hrs, 120 external hrs over the next 12 months.
>
> The Project's planning record (Activities, Functions Required, requirements) will be frozen at this point. Spawned Demands will be independently editable in Submitted before approval.
>
> **[Cancel]  [Submit]**

The button label remains "Submit" in both paths (no "Submit anyway" friction signal — the Functions-Required hint is informational, not a soft warning). The dialog explicitly notes that Demands remain editable in Submitted, framing Submit as the moment ownership transfers to the Functions, not as a final lock.

**Zero-requirements path — blocking error**

If the Project has zero internal requirements (no Functions actually involved), the dialog is replaced by a blocking error: *"This Project has no internal requirements. Add at least one internal requirement to a Activity before submitting — the Submit step spawns one Demand per Function actually involved, and a Project with no requirements has no Demands to spawn."* The user cancels back to the Project edit page.

**After submit**

On confirmation, the spawn rule (section 2.2.4) executes atomically with the Project status flip — Activities, internal requirements, and external requirements are deep-copied (Function-scoped) onto each spawned Demand. The Project's `activities`, `internal_requirements`, `external_requirements`, and `functions_required` are frozen as a planning record. The Manage Projects page becomes view-only for this Project. The drawer re-renders showing the spawned Demands as a read-only summary (one row per child Demand, with click-through to each Demand's drawer). The Project's footer becomes empty.

### 11.19 Navigation order and rename

*Introduced in v1.17.* The top-nav order is fixed and reads left-to-right:

1. **Capacity Validation** — section 4 View 1.
2. **Demand** — section 4.10. Programme-level demand-shape view (Function-lensed as of v1.18).
3. **Manage Projects** — *new in v1.18*, section 4.6.A. Project lifecycle Kanban.
4. **Manage Demand** — section 4.6. Per-Function Demand lifecycle Kanban.
5. **Team Activity** — section 4 View 2.
6. **Forecast** — section 4 View 3 (post-MVP).
7. **Skills Development** — section 4 View 4 (post-MVP).
8. **Admin** — section 5.

The Function selector (section 4.9) sits to the right of the nav links, in the same horizontal bar.

**Removed in v1.18**: the **Archive** nav link (section 4.7 deleted along with the Closed status — see section 3 Deletion).

**Rationale for placement of Manage Projects and Manage Demand together (positions 3 and 4)**: the two Manage views form a natural pair — Projects are the planning vehicle, Demands are the execution slices that spawn from them. Placing them next to each other in the nav reinforces that mental model. Manage Projects sits before Manage Demand because Projects come first in the lifecycle (Draft Project → Scoping Project → Submitted Project, which spawns Demands). Putting Team Activity after the Manage views (rather than between them) keeps the planning-vs-execution group cohesive; Team Activity is "what is each person doing?" and is conceptually downstream of both planning and approval.

**Rationale for Demand staying second**: it answers a planning-shape question that complements Capacity Validation. Both are read-only consumption views; placing them next to each other lets a user move quickly between "what shape is the demand?" and "can we resource it?". Manage Projects and Manage Demand are doing-views (the user is taking action there), so they form the next group.

**Implementation note**: routing — `/demand` is the Demand view (section 4.10), `/manage-projects` is Manage Projects, `/manage-demand` is Manage Demand. Existing deep links from Capacity Validation segment-clicks and drawer Edit buttons should be reviewed and updated where they target the wrong page in the new model.

### 11.20 Project / Demand spawn mechanics

*Substantially rewritten in v1.19 — spawn now materialises requirements onto child Demands.* The Project → Demand spawn (section 2.2.4) is the core coupling between the Project and Demand state machines. Implementation guidance:

**Selectors**

- `selectProjectsForActiveFunction(store)` → Projects visible on Manage Projects under the active Function lens (Draft and Scoping Projects always visible; Submitted/Approved/Allocated Projects visible if at least one of their child Demands belongs to the active Function).
- `selectDemandsForActiveFunction(store)` → Demands belonging to the active Function (`function_id = activeFunctionId`). Used by Manage Demand and the Demand view's Direct Demands card.
- `selectChildDemandsOfProject(store, projectId)` → Demands with `parent_project_id = projectId`. Used by the Project drawer's read-only summary and by the Project state-machine auto-transition logic.
- `selectSiblingDemandsOfDemand(store, demandId)` → for Project-spawned Demands, the other Demands sharing the same `parent_project_id`. Used by the Demand drawer's "Sibling Demands" line.

**Spawn algorithm (Project Submit — v1.19 materialisation, v1.20 name change)**

```
function spawnDemandsOnProjectSubmit(project) {
  // Compute Functions actually involved from internal requirements
  const functionsInvolved = new Set(
    project.activities
      .flatMap(a => a.internal_requirements)
      .map(r => r.skill.domain.function_id)
  );

  if (functionsInvolved.size === 0) {
    throw new BlockingError('Project has no internal requirements; cannot spawn Demands.');
  }

  // Atomic: materialise per-Function slices and spawn Demands
  store.transaction(() => {
    for (const fnId of functionsInvolved) {
      // For this Function, build the Demand's Activities by Function-scoping the Project's Activities
      const demandActivities = project.activities
        .map(a => {
          const fnInternalReqs = a.internal_requirements
            .filter(r => r.skill.domain.function_id === fnId)
            .map(r => deepClone(r));  // deep copy — Demand owns its data
          const fnExternalReqs = a.external_requirements
            .filter(e => resolveFunctionTag(e, project, fnId) === fnId)
            .map(e => deepClone(e));
          if (fnInternalReqs.length === 0 && fnExternalReqs.length === 0) return null;
          return {
            ...deepClone(a),  // name, dates, funding, etc.
            internal_requirements: fnInternalReqs,
            external_requirements: fnExternalReqs,
          };
        })
        .filter(Boolean);

      store.demands.create({
        function_id: fnId,
        parent_project_id: project.id,
        name: project.name,  // v1.20 — Function suffix dropped; Function chip distinguishes siblings
        type: project.type,
        owner: project.owner,
        description: project.description,
        status: 'Submitted',
        activities: demandActivities,  // materialised — owned by this Demand from now on
      });
    }
    store.projects.update(project.id, { status: 'Submitted' });
    // The Project's activities / requirements / functions_required remain on the Project as a frozen audit record.
  });
}

// resolveFunctionTag: returns the external requirement's Function tag.
// Defaults applied at spawn if tag is null:
//   1. If project owner's primary Function is in functionsInvolved, use that.
//   2. Otherwise the alphabetically-first Function from functionsInvolved.
function resolveFunctionTag(externalReq, project, candidateFunction) {
  if (externalReq.function_tag) return externalReq.function_tag;
  // null tag — fall through to defaults
  const ownerFn = project.owner_primary_function_id;
  if (ownerFn && [...functionsInvolved].includes(ownerFn)) return ownerFn;
  return [...functionsInvolved].sort()[0];
}
```

The transaction must be atomic: if any Demand fails to spawn, the entire spawn is rolled back and the Project remains in Scoping. The user sees a single error.

After spawn, each Demand owns its own `activities`, `internal_requirements`, `external_requirements`, and (post-Approve) named allocations. The Project's frozen planning record is no longer the source of truth for any Demand — edits to a Demand's data do not affect the Project, and edits to the Project (which is read-only from Submitted, so this is moot in practice) would not affect any Demand.

**Project status auto-transition logic**

Triggered after any Demand status change. Read all child Demands of the Project; compute the Project's new auto-status:

- If all child Demands are in `{Allocated}` → Project = `Allocated`.
- Else if all child Demands are in `{Approved, PartiallyAllocated, Allocated}` → Project = `Approved`.
- Else → Project = `Submitted`.

Apply the auto-status only if it differs from the current; record no audit trail in v1.

**Project Delete cascade** *(v1.19 — `ProjectTeamAssignment` removed)*

```
function deleteProject(projectId) {
  const childDemands = selectChildDemandsOfProject(store, projectId);
  store.transaction(() => {
    for (const demand of childDemands) {
      // Delete demand's named allocations
      store.allocations.deleteWhere(a => a.demand_id === demand.id);
      // Demand owns its Activities/requirements/external_requirements — they go with the Demand record
      store.demands.delete(demand.id);
    }
    // Project is deleted along with its frozen planning record (Activities, requirements, external_requirements, functions_required)
    store.projects.delete(projectId);
  });
}
```

The confirmation dialog computes the cascade scope (count of child Demands, count of allocations, count of materialised Activities on Demands) before invoking this and shows the user the impact.

**Direct Demand Delete cascade**

```
function deleteDirectDemand(demandId) {
  store.transaction(() => {
    store.allocations.deleteWhere(a => a.demand_id === demandId);
    // Demand owns its Activities/requirements/external_requirements
    store.demands.delete(demandId);
  });
}
```

Project-spawned Demands cannot be invoked through this path — their delete-cascade only happens via `deleteProject`.

**Renderability invariants — spawn produces correct sibling counts and materialised data**

On a fresh seed load with the headline cross-Function Project (e.g. "Plant C MES Platform Migration") in any post-Submit status:

- The Project must have exactly N child Demands where N = the count of distinct Functions touched by the Project's `internal_requirements`. The Project drawer's "Sibling Demands" line on each child Demand must list N-1 siblings.
- Each child Demand must have non-zero `Activities.length` (materialisation produced at least one Activity per Function).
- The union of internal hours across all child Demands' materialised requirements must equal the total internal hours on the Project's frozen record at the moment of spawn (drift introduced by post-spawn Demand edits is permitted — but must equal at spawn time, verifiable by a flag set on the Demand `is_materialisation_drift_unsynchronised`).
- Every external requirement on a child Demand must have a `function_tag` matching the Demand's `function_id`.

These are verified as runtime assertions in development builds.

---

## Changelog

**v1.21** (this revision): **Bug-fix release — three rendering/filtering regressions. No data model changes, no state machine changes, no aggregation changes, no seed changes.**

Overlay selector — Function scoping (sections 11.2, 4 View 1 Required features):

- **Set Overlay combobox now filters to Demands where `function_id = activeFunctionId`**, in addition to the existing `status = Submitted` filter. Previously the picker showed all Submitted Demands regardless of Function, causing duplicates when a Project spawns sibling Demands across Functions (e.g. "Project A" appearing twice — once for Digital Manufacturing, once for Group IT). The overlay models capacity impact on the active Function's skill pools, so offering a Demand from another Function is meaningless. The existing Programme/Project filter further narrows from there (unchanged).

Activity timeline — bar end-month coordinate fix (section 4.5.2):

- **Bar coordinate rule added**: right edge = `monthToX(addMonths(activity_end_month, 1))`, not `monthToX(activity_end_month)`. The previous implementation placed the right edge at the start of the end month instead of the end, producing bars that appeared one month short and left phantom gaps between sequential Activities. The fix applies universally to all Gantt bar rendering: Mode A Activity timeline, Mode B read-only Activity Gantt, and Skill detail view Demand Gantt (section 4.8). No data model or aggregation change — pure rendering.

Team Activity — Domain grouping person-inclusion predicate (section 4 View 2, Required features):

- **Person-inclusion rule for Domain grouping made explicit**: a person appears under a Domain header if they hold at least one Skill belonging to that Domain. People with skills spanning multiple Domains appear under each relevant Domain. Utilisation bars show total utilisation (all commitments), consistent with Skill detail view (section 4.8). Domains with no skill-holders are not rendered.
- **Domain filter behaviour clarified** for both grouping modes: in Domain grouping mode, collapses to the selected Domain group; in Team grouping mode, filters each Team's person list to those holding at least one Skill in the selected Domain. The predicate is the same in both cases.

No changes to: data model (section 2.1), state machine (section 3), aggregation layer (section 2.4), seed data (section 6), capacity formulas, projection algorithm, or any other view.

**v1.20**: **Phase → Activity rename. Targeted UX clean-up across drawers, cards, edit page, and Skill picker. Build-time seed pipeline from XLSX. Date pickers + validation. Manage Projects Function-scoping. Project Type system key visibility.**

v1.20 is materially smaller than v1.19 — no data-model architectural changes, no workflow refactors. It addresses a focused list of friction points observed in the live v1.19 build during stakeholder demos:

Terminology rename — Phase → Activity (sections 2.0, throughout):

- **All user-facing labels and internal data-model field names rename from "Phase" to "Activity"**. Covers: entity name (`Phase` → `Activity`); collection field (`phases` → `activities`); identifier fields (`phase_id` → `activity_id`); the three-column trio on records (`phase_name`, `phase_start_month`, `phase_end_month` → `activity_*`); UI strings ("+ Add Phase", "Phase 1 · Design", "Phase timeline (Gantt)" → "Activity …"); import workbook tab `Phases` → `Activities` and column renames; `parent_phase` → `parent_activity` in capacity calculations.
- **Master template at `assets/import_template/master.xlsx` regenerated** to match the v1.20 schema. Pre-v1.20 workbooks held by users will fail the import structure check with a clear "this is a v1.19 template — please download the latest" error.
- **`hours_by_month` and `steady_state_hours` are unchanged** — already keyed by month, not by Phase entity name.
- **Generic English usages of "phase" are preserved** — "time-phased", "pre-commit phase" etc. are not entity references and stay as-is.

Project Draft strictly hides requirements UI (section 4.5.2):

- **Re-affirms the v1.18+ rule** that Project Draft hides internal requirements list, external requirements list, and "+ Add" affordances entirely on every Activity card. Observed v1.19 build showed Draft Projects exposing requirement UIs prematurely; v1.20 makes the rule explicit with anti-regression language.

Manage Projects — Function-scoped visibility (section 4.6.A):

- **Visibility predicate tightened**. A Project is visible to the active Function only if the active Function is in `functions_required`, OR the Project's requirements touch the active Function (Scoping onwards), OR (for Drafts/Scoping with empty `functions_required`) `created_under_function_id` matches.
- **New field `created_under_function_id` on Project** — set on create to the user's active Function. Not ownership, just a tiebreaker for visibility while planning fields are empty. Mirrors the Demand `created_under_function_id` pattern from v1.16.
- **Switching Function while a Project is open** closes the drawer/edit page if the new Function makes the Project invisible, with a toast.
- **Replaces the v1.18/v1.19 rule** that Drafts/Scoping Projects were visible to all Functions regardless of involvement.

Project Type system key visibility and label resolution (sections 2.1.2, 5):

- **`ProjectType.id` derivation made explicit**: auto-derived from `name` on create as `pt_<slugified_name>`. Uniqueness checked at creation across all records (active and inactive); collision blocks the create with an inline error. Immutable after creation — renaming a record never changes the id.
- **Admin surfaces the system key** read-only as a small monospace tag adjacent to each `name`. Add Project Type form previews the derived `id` in real time.
- **Label resolution rule** (new): every UI surface rendering a Project Type **must** resolve the FK to the record's `name` and render that. The system key (`pt_*`) appearing in user-facing UI outside admin is a bug. A runtime DOM scanner (development builds) logs a console error on any `pt_*` text in rendered output.

Demand auto-name change — drop Function suffix (section 2.2.4):

- **Spawned Demand `name` defaults to the parent Project's `name`**, no longer `<Project name> — <Function name>`. The Function chip in the Demand drawer header and the Function chip on cards (where siblings exist) carry the disambiguation. Editable thereafter as before.
- **Section 11.20 spawn pseudocode updated**.

Drawer body — status-aware, deduplicated, encoding-safe (section 4.5.1):

- **Body content is now status-aware** for both Project and Demand drawers. Different fields surface depending on lifecycle position — Draft shows Functions Required + Activity summary; Scoping adds requirements detail; Submitted+ shows Spawned Demands list with planning record collapsed by default; Demand Approved+ adds Allocation summary banner.
- **Encoding safety rules** added: ensure UTF-8 round-trips cleanly through localStorage and DOM rendering paths; structural rendering (separate elements/chips) for hierarchy instead of inline chevron/em-dash strings; runtime DOM scanner logs `\uFFFD` occurrences. Addresses observed `�` rendering bug in the live v1.19 build.

Manage Projects / Manage Demand — card content cleanup (sections 4.6, 4.6.A):

- **Manage Demand cards**: Demand name (Project name — no Function suffix per v1.20 spawn rule), Type badge (resolved label, never system key), Origin/parent line, active-Function chip when siblings exist, compact stats line.
- **Manage Projects cards**: Project name, Type badge (resolved label), Programme line, Functions Actually Involved chip row, Functions Required hint footnote on Draft/Scoping only, compact stats.
- **Chevron- and em-dash-joined hierarchy strings forbidden** on cards. Render hierarchy through separate elements/chips.

Activity date pickers + validation (sections 2.2.2, 4.5.2):

- **Free-text inputs replaced with month-year picker component** for `activity_start_month` and `activity_end_month`. Picker portals (per dropdown overflow rule).
- **End ≥ start validation** runs live, not just on save. Invalid selection rejected at the picker. Save disabled while any Activity has invalid dates.
- **Indefinite Activity toggle preserved** — "No end date (indefinite)" checkbox alongside the end-month picker; validation rule applies only when both start and end are set.

Mode B requirement total hours visibility (section 4.5.2):

- **Each requirement row in Mode B gains a prominent "Target: N hrs total · {description}" line** above the month coverage strip. Description varies by Activity type (uniform finite, non-uniform finite, indefinite).
- **Coverage summary line beneath**: "Allocated: N hrs (X%) · Unfilled: N hrs". Both lines update live as allocations are edited.

Skill picker dual-mode (section 4.5.3):

- **Single-Function mode (existing)**: Domain → Skill, scoped to one Function. Used on Demand edit and admin person-skill assignment.
- **Cross-Function mode (new, used on Project Scoping only)**: two-step picker — Step 1 lists Functions; Step 2 reveals the picked Function's Domain → Skill tree. Search field at top searches across all Functions/Domains/Skills with Function · Domain prefix on hits. Selected display: "Function · Domain > Skill".
- **Flat-list-across-Functions pattern is not acceptable** — the v1.19 build's regression on Project Scoping is fixed.

Build-time seed pipeline from `master_seed.xlsx` (section 6.0):

- **Seed source moves from hand-authored JSON to a master Excel workbook** at `seed/master_seed.xlsx`. Build script parses the workbook into the bundled `seed.json` at build time using the existing import parser logic plus extra structural tabs (Functions, Domains, Skills, Teams, People, Person Skills, Project Types, Programmes, Providers, Direct Demands, Allocations).
- **Hours per month — flat value** per Tim's constraint. Single number per requirement, expanded uniformly across the Activity at parse time.
- **`status_override` column on Projects tab** allows seed Projects to land in Draft, Scoping, Submitted, Approved, or Allocated — mirroring the import default of Submitted but with explicit override for seed status coverage.
- **No runtime upload in v1.20** — purely a build-time pipeline. Tim edits the workbook offline and rebuilds.
- **Same parser logic as the import flow** — section 6.1 schema, validation rules, and error catalogue. Errors at build time fail the build with clear messages.

Dual + Add buttons (section 4.5.2):

- **Top-and-bottom button placement** for the Activities section ("+ Add Activity"), and within each Activity card for "+ Add internal requirement" and "+ Add external requirement". Top button (inline with section heading) is the existing primary; bottom button (below the last item) is new and visually subtler, removing the need to scroll up after adding several items in a row.
- **Bottom button hidden when the section is empty** — only the inline header button appears in empty state.

Build sequencing rewritten (section 9):

- v1.20 build order replaces v1.19's. Historical orders are not retained — the Changelog captures what changed; the build order is forward-looking only.

No changes to: the capacity model and aggregation layer (sections 2.4.1–2.4.8), Function selector and lens behaviour at the Function-switch level (section 4.9), Skill detail view (section 4.8), Capacity Validation visual treatment, projection grey band, Team Activity, Demand view (section 4.10), or the Project / Demand state machines (section 3 — only the Project Draft requirements-UI hide rule and the Manage Projects visibility rule are tightened; transitions are unchanged).

---

**v1.19**: **Manage Project simplified — Teams Assigned removed; Functions Required (originator's hint) added. Submitted Demand becomes editable. Spawn materialises requirements onto child Demands.**

This refactor flows from a focused review of the Manage Project / Manage Demand experience. Three coupled changes:

Manage Project simplification (sections 2.1.1, 2.2.4, 3, 4.5.2, 4.6.A, 6, 11.18):

- **Teams Assigned removed entirely**. The per-phase Teams Assigned picker, the `ProjectTeamAssignment` entity, the per-team confirmation strip, the `confirmed`/`confirmedBy`/`confirmedAt` fields, and the requirement-level `owning_team_id` are all eliminated. Teams remain an organisational concept under People (capacity grouping) but play no role in the Project workflow. Submit-for-Scoping no longer gates on team assignments.
- **Functions Required (originator's hint, not binding) added at Project Draft**. Multi-select picker capturing which Functions the originator thinks should engage in Scoping. **Hint, not binding** — Scoping users can add requirements under any Function regardless of what's declared. Frozen at Submit as a planning audit record. Editable in Scoping (lower friction than forcing a Draft round-trip).
- **Functions Actually Involved (derived) shown alongside**. Live in Draft/Scoping, frozen at Submit. When the two sets diverge (Scoping added Functions the originator didn't anticipate), the additional Functions carry an "added during Scoping" badge — useful for retrospective reflection without blocking.
- **Skill picker scoping in Project Scoping is full-catalogue**. The DOMAIN > SKILL selector shows every Skill across every Function, grouped by Function then Domain. Removes the previous Function-of-owning-team scoping rule (which is moot now that owning team is gone).
- **Submit-for-Scoping gate**: enabled when ≥1 phase AND ≥1 entry in Functions Required. Replaces the previous "every phase has at least one team assigned" gate.
- **Submit-Project confirmation dialog rewritten** (section 11.18): surfaces the spawn outcome (which Demands will be created, materialised hour totals per Demand) instead of team-confirmation status. Functions-Required-vs-Actually-Involved mismatch is shown as informational planning context, not a blocking warning.
- **Manage Projects view-only from Submitted**. Submitted, Approved, and Allocated Projects show "View" (not "Edit") in the drawer; the edit page renders read-only with no "+ Add" affordances. The Project's frozen phases/requirements/Functions Required are a planning audit record.

Spawn materialisation (sections 2.1.1, 2.2.4, 11.20):

- **Spawn now deep-copies Function-scoped phases, internal requirements, and external requirements onto each child Demand**. Previously v1.18 spawned a Demand with structural reference only — phases/requirements were computed live from the Project. v1.19 severs that link: each Demand owns its own data from spawn onwards.
- **Project's phases/requirements remain on the Project as a frozen planning record** post-Submit, no longer the source of truth for any Demand.
- **Drift after spawn is permitted and tracked**. Editing a Submitted Demand's requirements (see below) does not affect the parent Project. The Project shows the planning record at Submit; the Demands show the live picture.
- **External requirements gain a Function tag field** (section 2.6) used at spawn to route each external requirement onto the matching Function's Demand. On Project Scoping, the user sets the tag explicitly (with a sensible default); on direct Demands, the tag is auto-set to the Demand's Function and not user-editable.

Demand Submitted becomes editable (sections 2.2, 3, 4.5.2):

- **The Demand definition lock point moves from Submit to Approve.** In v1.18, a Submitted Demand was read-only on its definition. In v1.19, the owning Function uses Submitted as a working state to refine technical detail (skills, levels, hours, externals) before approving. Approve crystallises the definition; from Approved onwards the Demand is locked and the workspace shifts to allocation.
- **Mode A is now active on Demand Submitted** — both Project-spawned and direct. For Project-spawned Demands, phases are read-only (they belong to the parent Project's planning shape); internal and external requirements are editable. For direct Demands, all fields including phases are editable.
- **Mode B definition-lock banner copy updated** to reflect the v1.19 lock-at-Approve rule.
- **Skill picker scoping in Demand Submitted** is single-Function — the Demand's own Function. Project-spawned Demands cannot acquire requirements outside their Function (that would belong to a sibling Demand); direct Demands cannot acquire requirements outside their immutable Function.

Excel import for bulk Project creation (sections 4.6.A.1, 6.1, 11.20):

- **Download Template** action on Manage Projects produces a fully-populated `.xlsx` workbook (Projects / Phases / Internal Requirements / External Requirements tabs plus three Reference tabs and a hidden enum-helper tab) with cell-level data validation, header tooltips, and named ranges driving every dropdown. Reference tabs are populated from the live store at the moment of download.
- **Import from Excel** action on Manage Projects accepts a filled-in workbook, parses + validates against the v1.19 data model, surfaces a structured preview of what will be created (the preview plays the role of the Submit-Project confirmation dialog from section 11.18), and on Import commit creates the records atomically.
- **Imported Projects land directly in Submitted status** — the spawn rule (section 2.2.4) executes at upload time, materialising one Demand per Function actually involved in `Submitted` status alongside the Project. This skips Draft and Scoping for the import path; the Preview step is the deliberate-commitment moment that the manual Submit-Project click would otherwise be.
- **`functions_required` is left empty on imported Projects.** The drawer body shows "Originator's plan: not declared (imported)". Functions Actually Involved is derived from the Skill rows, as in any other Project. This is honest — the import path doesn't have an originator-declared list, and fabricating one would be misleading.
- **Master data is not auto-created.** Programmes, Skills, and Providers referenced in the workbook must already exist (managed via Admin). Unknown references surface as blocking errors on the preview screen.
- **Workbook schema** (section 6.1) is the authoritative reference for tab structure, column definitions, validation rules, and parser semantics. Build target file is checked into the repo as `assets/import_template/master.xlsx` so the live download can serve a known-good baseline; reference tabs are populated from the live store at download time, not baked in.

Project Type becomes admin-managed (sections 2.1.2, 5, 4 View 1, 4.5.2, 4.6.A, 6, 6.1):

- **Project Type is now a first-class admin-managed entity** (section 2.1.2) rather than a hardcoded enum. Seeded with the existing four values (BAU, NPD Demand, Plant Project, Group Strategy Project), but admin can rename, reorder (`display_order`), recolour (from a fixed design-system palette), deactivate, or add new types.
- **`is_bau` flag is system-fixed** — exactly one record carries it, and admin cannot move it. Renaming the BAU record is permitted (e.g. to "Operational Support") but the flag follows the record.
- **`Project.type` and `Demand.type` migrate from string-enum to FK reference**. Hardcoded enum lists are removed from the codebase; everywhere that previously listed the four values now reads from active records sorted by `display_order`.
- **Capacity stack ordering is data-driven** — bottom-to-top order on Capacity Validation charts matches `display_order` ascending. Team Activity per-person heatmap uses the same ordering left-to-right. Stack colours read from each record's `colour_token`.
- **New admin surface — Project Types** (section 5) — flat list with drag-handle reordering, swatch picker for colour, in-use indicator, soft-delete via active flag, hard-delete blocked when records reference the type. BAU record cannot be hard-deleted ever.
- **Excel import workbook gains a fourth Reference tab** (`Reference - Project Types`) populated from the active records at download time, in `display_order` order. The static `project_type` enum on the hidden `_lists` tab is removed.

Drawer title cleanup (section 4.5.1):

- **Programme is dropped from drawer titles** on both the Project and Demand drawers. Earlier versions packed `Programme › Project` (and `Programme › Project › Function` for spawned Demands) into the title row using a chevron separator that didn't render reliably across font fallback chains, and the combined string truncated on long names. The title is now just the entity's name, full width.
- **Programme and parent-Project context move to the body zone** alongside other reference fields. The Project drawer body gains a "Programme: …" line (or "No Programme" in muted italic when null). The Demand drawer body gains a "Programme: …" line (reflecting the parent Project's Programme for spawned Demands, "Direct Demand (no Programme)" for direct) plus a "Part of: [Project name]" link to the parent Project's drawer (Project-spawned only).

Seed regeneration (section 6):

- All `ProjectTeamAssignment` records dropped. Functions Required populated on every Project (Project 2 set to `[DM]` only with GroupIT requirements added during Scoping to demonstrate the hint-not-binding flow). Function tags set on every external requirement. Project 4's DM Demand carries a post-spawn requirement-hours edit (60 → 80) demonstrating drift between Project frozen record and live Demand data.
- v1.19-specific renderability invariants added (no Teams anywhere, Functions Required field present and editable in correct statuses, materialisation produces independent Demand data, Function-tag routing works, Manage Projects view-only from Submitted, etc.).

Build sequencing rewritten (section 9):

- v1.19 build order replaces v1.18's. Historical orders are not retained — the Changelog captures what changed; the build order is forward-looking only.

No changes to: the capacity model and aggregation layer (sections 2.4.1–2.4.8), Function selector and lens behaviour (sections 4.9, 11.17), Skill detail view (section 4.8), Capacity Validation visual treatment, projection grey band, Team Activity, or Demand view (section 4.10).

---

**v1.18**: **Workflow refactor — split planning (Project) from execution (Demand). Capacity-line bug invariants. Demand view re-lensed by Function with shared toolbar toggles. By-Team stacking removed. Park/Close/Revert/Revise/Duplicate eliminated.**

This is the largest single revision since v1.10. Approximately 30% of the spec touches; readers familiar with v1.17 should treat the data model (section 2), workflow (section 3), Manage views (section 4.6, new 4.6.A), Demand view (section 4.10), and seed (section 6) as effectively rewritten.

Workflow refactor — Project / Demand split (sections 2.1.1, 2.2, 3, 4.5, 4.6, new 4.6.A, 6, 11.20):

- **New Project entity replaces today's Project grouping layer**. The old "Project" — a thin grouping under Programme — is gone. The new **Project** is the planning unit that users scope: name, owner, description, optional Programme, phases (with shared timeline), Functions involved (derived from requirements), and skill-shaped + external requirements. Programmes remain as the optional parent grouping for new Projects. Today's `Project` records in seed migrate to new Project records.
- **Demand redefined as the per-Function execution slice**. A Demand belongs to **exactly one Function** (`function_id` required). Demands have **two creation paths**: (1) Project-spawned — automatically created when a Project transitions Scoping → Submitted, one Demand per Function whose Skills are touched by any of the Project's requirements; (2) **Direct** — created manually from Manage Demand without a parent Project, for ad-hoc and BAU work that doesn't justify cross-Function planning. Project-spawned Demands carry `parent_project_id`; direct Demands carry `parent_project_id = null`. Both paths converge at the Submitted swimlane.
- **Phases live on the Project** (for Project-spawned Demands) or **on the Demand directly** (for direct Demands). For direct Demands the model is identical to today's Demand-with-phases. For Project-spawned Demands a single Project phase can carry requirements across multiple Functions; each Demand is a Function-scoped view onto the Project's phases — phases with no requirements for that Function are hidden in that Demand's view. The Project's phase timeline is the shared, canonical timeline for Project-spawned work.
- **Project state machine**: `Draft → Scoping → Submitted → Approved → Allocated`. Draft and Scoping are user-driven; Submitted is the spawn point (creates child Demands); Approved is auto when all child Demands reach Approved+; Allocated is auto when all child Demands reach Allocated.
- **Demand state machine** (both paths): `Draft → Submitted → Approved → PartiallyAllocated → Allocated`. Project-spawned Demands skip Draft (they are spawned directly into Submitted at Project-Submit time). Direct Demands begin in Draft. Submitted onwards is identical regardless of origin. PartiallyAllocated and Allocated are auto from named-allocation coverage (rules unchanged from v1.17).
- **Park, Closed, Archive view, Revert to Draft, Revise, Duplicate, Parked reason field, Restore action — all removed**. Only **Delete** remains as an off-flow action. This is a deliberate simplification for v1.18; richer lifecycle controls return in a later version once the core flow is bedded in.
- **Submitted Demand drawer footer**: `Approve` (primary) and `Model Capacity` (secondary). Model Capacity is the only allowed off-flow action because it is decision-support (does not change state).
- **Manage Demand reshaped** (section 4.6) — **5-column** Kanban: Draft / Submitted / Approved / PartiallyAllocated / Allocated. The Draft column shows direct Demands only; Submitted onwards mixes Project-spawned and direct Demands. Each card represents a single-Function Demand (active Function lens applies). Domain filter and group-by-Project still apply.
- **New Manage Projects view** (section 4.6.A) — 5-column Kanban: Draft / Scoping / Submitted / Approved / Allocated. The planning surface for cross-Function and Project-shaped work.
- **Navigation order updated** (section 11.19): Capacity Validation, Demand, Manage Projects, Manage Demand, Team Activity, Forecast, Skills Development, Admin. Archive removed from nav (Closed status no longer exists).

Demand view re-lensed by Function (sections 4.10, 11.17, 2.4.9):

- **Function lens now applies** to the Demand view, reversing the v1.17 exception. Section 11.17's exception note is removed.
- **Two toolbar toggles added**: "Show external resource" (default OFF) and "Show demand on other Functions" (default OFF). Names and behaviour mirror Capacity Validation Sections C and D.
- **"Include Submitted" no longer differentiates Submitted from committed** — Submitted hours merge into the same funding-source bucket as Approved/PartiallyAllocated/Allocated. No hatched fill, no opacity change, no `(Submitted)` suffix in tooltips. The whole stack is "demand," and the toggle just expands `status_set`.
- **By-Team stacking option removed entirely**. The Stacking selector (segmented control) is removed from the toolbar — only By Funding Source remains. Aggregation functions `programme_demand_by_team` and `project_demand_by_team` are deleted.
- **Aggregation function signatures change**: `programme_demand_by_funding(programme_id, month, {status_set, function_id, include_external, include_other_functions})` and the project-level equivalent. The function_id parameter applies the active Function lens; toggles control external and other-Functions inclusion.

Capacity Validation — bug-fix invariants (sections 2.4.8, 4 View 1):

- **Per-Function and per-Domain capacity reconciliation invariants added** to section 2.4.8. The fresh-seed must produce specific known capacity values for each Function and each Domain in known months. The v1.18 Group IT "Data & Integration shows phantom capacity in Jul–Aug 2026" symptom is investigated under this invariant — implementation must verify and reconcile.
- **Function-switch renderability invariant strengthened**: switching the active Function must change `domain_capacity` results for at least one Domain in at least one visible month to a different known value. Section A's chart re-render is verified by the same.
- **Section D reframed** (section 4 View 1) — "other Functions' Demands on shared Projects" replaces v1.16's "demand my Function's Demands are placing on other Functions." The chart vocabulary (D1 stacked by receiving Function, D2 per-Function with team drill-down) is unchanged; only the scope rule changes — the in-scope Demands are now those whose **Project** has at least one Demand belonging to the active Function. Aggregation function `cross_function_demand_hours` rewrites accordingly.

No changes to: capacity formulas (sections 2.4.1–2.4.7), the projection algorithm (section 2.4.5), Team Activity (section 4 View 2), Skill detail view (section 4.8), the Function selector (section 4.9) other than the Demand-view exception removal, BAU's structural shape (now flowing through the same Project mechanism), Programme entity (unchanged).

**v1.17**: **Five changes. Demand workflow is tidied around clearer Draft / Scoping / Submitted responsibilities; new "Demand" view answers Programme-level demand-shape questions; minor labelling and de-duplication fixes.**

Capacity Validation — Section A label (section 4 View 1):

- **"Overall Team Capacity" renamed to "Overall Function Capacity"** — the chart now correctly indicates it is scoped to the active Function (not a fixed team), and it re-renders on Function switch. No data or aggregation change; pure label clarification.

Demand workflow tidied (sections 3, 4.5.1, 4.5.2):

- **Draft scope narrowed**: Draft now captures metadata (name, type, owner, description, Project alignment), phases (name, dates, funding source, funding notes), and **per-phase Teams Assigned** only. The skill-shaped requirements UI and external resource requirements UI are **hidden** in Draft. Skills, levels, and hours are no longer entered in Draft.
- **Teams Assigned moves earlier** — the picker is now visible from Draft onwards (previously Scoping onwards). Selecting a team creates a `DemandTeamAssignment` record immediately. The Draft → Scoping transition is therefore a pure status flip — the team-assignment dialog that previously fired on Submit-for-Scoping has been removed.
- **Submit for Scoping** is now disabled until the Demand has at least one phase and every phase has at least one team assigned, with an inline hint identifying what's missing.
- **Scoping** is now where skill-shaped and external resource requirements are added — Mode A reveals these UIs only when status ≥ Scoping. The per-team confirmation strip remains Scoping-only as before.
- **Submitted** rationale clarified — the page is read-only on definition; primary user actions are **Approve** and **Model Capacity** (renamed from Model Impact in v1.17).
- **Allocated** has no footer primary CTA — already true in v1.16, restated here as part of the workflow tidy.
- **Teams Assigned picker redesigned** — replaces the v1.16 chip-based multi-select with a cleaner pattern: a searchable single-line picker (combobox grouped by Function) with an assigned list below showing each team's parent Function as a subtitle and a small Function-coloured dot indicator. Read-only in Submitted and Parked. Improves cross-Function legibility and is more professional in feel.
- **"Model Impact" renamed to "Model Capacity"** across the spec — drawer footer button, edit page header, deep-link section 11.11, navigational button taxonomy 11.16, and the post-submit re-render note in 11.18. Same behaviour, clearer label.

Demand drawer — Project alignment de-duplication (section 4.5.1):

- **Drawer body's Project alignment block is removed**. The header zone keeps the "Programme › Project" reference (and the "Unaligned" treatment for unaligned Demands); the body no longer repeats it. Re-alignment of a Demand to a different Project is now performed via the Edit page (Mode A's Project alignment field) only, not via the drawer.
- The drawer's "Read-only apart from Project-alignment affordance" caveat is removed — the drawer is now fully read-only apart from action buttons, consistent with its "preview, not editor" mental model.

Manage Demand rename and new Demand view (sections 4.6, 4.10, 11.19, 2.4.9):

- **Section 4.6 renamed** "Demand discovery" → "Manage Demand". Section content (Board / Table / Search modes, filters, group-by-Programme/Project) is unchanged in v1.17.
- **New section 4.10 — Demand view**. A two-level Programme-shape view: a landing page with one stacked-area chart per Programme (plus a virtual "Unaligned Demand" card), and a Project drill-down page reached by clicking a Programme. Each chart can be stacked **By Funding Source** (default — Investment Scheme / Plant/Sector Allocation / Mixed) or **By Team** (one stack per Team across all Functions plus Provider stacks under a virtual "External" Function). A toolbar toggle "Include Submitted" overlays Submitted Demand on top of the Approved-onwards baseline (default OFF). No capacity line, no projection grey band — this is a demand-shape view, not a capacity view.
- **Demand view ignores the Function lens** — single deliberate exception to the lens-everywhere pattern. Documented in section 11.17.
- **Two new aggregation function families in section 2.4.9**: `programme_demand_by_funding(programme_id, month, {status_set})`, `programme_demand_by_team(programme_id, month, {status_set})`, plus per-Project equivalents. Internal hours respect `status_set` (caller chooses Approved-onwards or Submitted-onwards); external hours always include all non-Parked, non-Closed Demand (matching existing `project_external_hours` semantics). The By-Team function returns a sorted array with `parent_function_label` metadata so the consumer can group stacks by Function with "External" placed last.
- **Navigation order updated** — Capacity Validation, Demand (new), Team Activity, Manage Demand, Forecast, Skills Development, Archive, Admin. Documented in new section 11.19.

No changes to: the capacity model (sections 2.4.1–2.4.7), the projection algorithm (section 2.4.5), the state machine transitions (sections 3 transition tables — only the Draft → Scoping transition's *behaviour* changes, not the transition itself), the existing visual treatment on Capacity Validation charts, Team Activity, the Skill detail view, or the existing aggregation functions. v1.17 is additive on the new view and behaviourally narrowing on Draft.

**v1.16**: **Eight changes. Multi-Function support is the headline; six other changes clean up gaps identified against v1.15 implementation.**

Multi-Function support (sections 2.1, 2.2, 4.9, 5, 6, 11.17):

- **Multi-Function store**: multiple Function records are now permitted. The seed ships with two Functions — **Digital Manufacturing** (existing MOM/MI&V/MBM) and **Group IT Enterprise Solutions** (new: Infrastructure & Platforms / Enterprise Applications / Data & Integration). The store permits any number of Functions; v1.16 tests the two-Function path concretely.
- **New Function selector** (section 4.9) — a global header dropdown acting as a **lens** over the data. Changing the active Function changes which Domains, Skills, Teams, People, capacity charts, Team Activity rows, and admin lists are shown. Programmes, Projects, and Providers are Function-agnostic and visible regardless of active Function. Persisted to localStorage and mirrored to the URL hash for deep-linkability.
- **Demands are Function-agnostic**. A Demand does not belong to any Function. Its requirements reveal which Functions are involved — each skill-shaped requirement targets a Skill, which belongs to a Domain, which belongs to a Function. A Demand with requirements spanning two Functions appears in both Functions' Demand lists when each is the active lens.
- **Function admin is full CRUD** (section 5), replacing the single-Function view-only surface from v1.15. Cannot deactivate the last active Function; hard-delete blocked when Function has children.
- **Cross-Function Demand visibility on Capacity Validation** — new Section D ("Show demand on other Functions") with overview chart stacked by receiving Function (D1) and per-Function breakdowns with team drill-down (D2). Shows what the active Function's Demands are placing on other Functions. See section 4 View 1.
- **New aggregation function** `crossFunctionDemandHours(activeFunctionId, month, {by})` added to the shared aggregation module (section 2.4.9 scope). Filters Demands to those touching the active Function and sums their requirements targeting Skills outside the active Function, grouped by receiving Function or Team.
- **Interpretation guidance 11.17 — Function selector lens behaviour** — selectors-not-props pattern, URL/store sync rules, guardrails, drawer auto-close on Function switch, filter reset on switch.

Primary Domain — removed entirely (sections 2.1, 2.2, 4.5.1, 4.5.2, 4.5.3, 4.6, 4.8, 5):

- **Person's Primary Domain** field dropped. Admin does not derive or display a Primary Domain; People are shown with their Team instead.
- **Demand Item's Primary Domain** field dropped (it was "auto-derived" in v1.15 — now it is gone from the store, the drawer, the edit page, and the Demand page table/filters). Replaced in the drawer body by a **Functions involved** read-only line listing the distinct Functions touched by any of the Demand's requirements.
- **Demand page Table mode column**: Primary Domain replaced with "Functions involved".
- **Demand page filter**: Primary Domain filter replaced with Domain multi-select (populated from the active Function's Domains).
- **Skill detail view people list**: Primary Domain tag replaced with Team tag ("Team Name · Function Name").
- **Duplicate behaviour**: no Primary Domain re-derivation is needed because the field no longer exists.

Team — Lead field removed (sections 2.1, 5):

- Team no longer has a Lead. Admin dropped the Lead picker. Existing seed Teams migrate with `leadPersonId` discarded.

Capacity Validation — Team filter removed (section 4 View 1):

- The Team filter toolbar control is **removed**. Rationale — Capacity Validation is a Functional Domain/Skill pool view; a team-level capacity line would misrepresent the polymorphic-capacity principle. Team-level detail belongs on Team Activity (View 2) via Group-by-Team.

Scoping → Submitted — manual only (section 3, section 4.5.1, section 11.3, section 11.18):

- The auto-transition rule "Scoping → Submitted when all assignments confirmed" is **removed**. The move is now strictly manual via the **Submit for capacity assessment** button in the drawer footer.
- Team confirmation via `DemandTeamAssignment.confirmed` remains as an **informational signal**, surfaced in the confirmation dialog, but is not a gate.
- **New section 11.18** — Scoping → Submitted confirmation dialog. Three paths: all-confirmed, unconfirmed (with "Submit anyway" friction label), and empty-teams.

Demand page — Kanban filter fix and Scoping column (section 4.6):

- **Explicit rule that all filters apply to every mode**, including Board — a fix for the v1.15 observed bug where Programme, Project, and Has-external-requirements filters did nothing on the Kanban view.
- Board mode adds a Scoping column between Draft and Submitted (seven columns total).
- Empty-column behaviour specified (column remains visible with "No Demands match" message); drag-to-filtered-column behaviour specified (card disappears with toast).

Mode A — Teams assigned picker and per-team confirmation strip (section 4.5.2):

- Each phase card gains a **Teams assigned** multi-select picker (shown from Scoping onwards). Picker lists all active Teams across all Functions. Selection creates/removes `DemandTeamAssignment` records.
- In Scoping, a **per-team confirmation strip** shows green/amber confirmation status per team plus a "Confirm requirements" button. Editing a requirement resets that team's `confirmed` flag.
- Internal requirements gain an **owning team** field (required when the phase has assigned teams). The DOMAIN > SKILL selector scopes to the chosen owning team's Function — this is how cross-Function requirements get added to a single Demand.

Seed (section 6):

- Group IT Enterprise Solutions added with 3 Domains, 9 Skills, 2 Teams, 5–7 People.
- Headline cross-Function Demand — "Plant C MES Platform Migration" gains requirements targeting Group IT's Data Engineering Specialist (60 hrs/mo) and Integration Architecture Advanced (40 hrs/mo).
- Scoping seed item updated: one DM team, one Group IT team assigned.
- New renderability invariants: cross-Function Demand visible (Section D), Function switch effect visible.

No changes to the capacity model (section 2.4.1–2.4.8), the projection algorithm (section 2.4.5), the state machine structure (except the Scoping→Submitted transition mechanics), or any existing visual treatment on the Capacity Validation charts / Team Activity / Skill detail view for scenarios that do not touch multi-Function.

**v1.15**: **Six changes: Function/Team data model; Scoping status; Domain rename; Primary Domain auto-derived; drawer header fixes; External Resource Demand chart; Fill All on external requirements.**

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
