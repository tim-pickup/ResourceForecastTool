# Changes — v1.19

**Spec version:** REQUIREMENTS.md v1.19
**Created:** 28 April 2026

This file tracks v1.19 implementation progress and directs Claude Code to the right parts of REQUIREMENTS.md for full implementation detail. Each change is scoped tightly; complete them in order — later changes depend on earlier ones.

REQUIREMENTS.md is the single source of implementation detail. This file is the navigational map and progress tracker.

---

## v1.19 — Manage Project simplification + Submitted-Demand editability + spawn materialisation

### 1. Data model migration

- [x] **Scope:** Add `functions_required: string[]` and `functions_actually_involved: string[]` to Project. Drop `ProjectTeamAssignment` entity entirely. Drop `owning_team_id` from internal requirements. Add `function_tag: string` to ExternalResourceRequirement (required field). Add `phases`, `internal_requirements`, `external_requirements` arrays to Demand entity (previously only on direct Demands). **Add `ProjectType` entity** (`id`, `name`, `display_order`, `colour_token`, `is_bau`, `active`) with four seeded records (BAU, NPD Demand, Plant Project, Group Strategy Project — `is_bau = true` on BAU only); migrate `Project.type` and `Demand.type` from string-enum to FK reference to ProjectType records; remove the hardcoded enum from the codebase entirely. Migrate seed: drop all `ProjectTeamAssignment` records; populate `functions_required` on every Project; set `function_tag` on every external requirement; for each existing Project-spawned Demand, materialise the Function-scoped slice from the parent Project as a deep copy; replace every Project's and Demand's type-enum value with the matching ProjectType record id.
- **Dependencies:** None — this is the foundation.
- **Read in REQUIREMENTS.md:** Sections 2.1.1 (Project entity table — `functions_required` / `functions_actually_involved` fields, `Type` references ProjectType), 2.1.2 (Project Type entity full definition + seed records), 2.2 (unified data ownership model on Demands; `Type` references ProjectType), 2.2.3 (Resource Requirement — `owning_team_id` removed), 2.6 (External Resource Requirement — `function_tag` field), section 9 build order step 1.

### 2. Spawn / materialisation logic

- [ ] **Scope:** Implement the v1.19 spawn algorithm: deep-copy Function-scoped phases, internal requirements, and external requirements (Function-tag-routed) onto each spawned Demand atomically with Project status flip. Project's data is frozen post-spawn. Implement `resolveFunctionTag` helper for null-tagged externals (defaults to Project owner's primary Function, falling back to alphabetically-first Function in spawn set, with dev-mode warning). Wire the v1.19 spawn renderability invariants. Add Project 4 DM Demand spawn drift example to seed.
- **Dependencies:** Change 1 (data model must be in place).
- **Read in REQUIREMENTS.md:** Section 2.2.4 (spawn rule — full materialisation specification), section 11.20 (spawn algorithm pseudocode and renderability invariants), section 9 build order step 2.

### 3. State machine adjustments

- [ ] **Scope:** Update Project Submit-for-Scoping gate to require ≥1 phase AND ≥1 entry in `functions_required` (replaces the previous "every phase has at least one team assigned" gate). Allow editing Demand definition in Submitted (lock point moves from Submit to Approve). Direct Demand Submitted permits phase edits; Project-spawned Demand Submitted does not (phases are frozen on the Project). Update section 11.18 confirmation dialog content to surface spawn outcome (Demands and materialised hour totals) instead of team-confirmation status.
- **Dependencies:** Change 1.
- **Read in REQUIREMENTS.md:** Section 3 (Project state machine, Project transition reference, Project workflow narrative; Demand state machine, Demand transition reference, Demand workflow narrative; Allocation editing — v1.19 lock-at-Approve rule), section 11.18 (rewritten confirmation dialog), section 9 build order step 3.

### 4. UI — Mode A reshape

- [ ] **Scope:** Mode A becomes active on five status combinations: Project Draft, Project Scoping, Direct Demand Draft, Direct Demand Submitted, Project-spawned Demand Submitted. Add Functions Required multi-select picker on Projects (Draft and Scoping; frozen at Submit). Show Functions Actually Involved chips alongside Functions Required, with "added during Scoping" badge when they diverge. Remove the entire Teams Assigned picker section, per-team confirmation strip, and `owning_team_id` dropdown from internal requirement entry forms. Update Skill picker scoping: Project Scoping = full catalogue across all Functions; Demand Submitted = scoped to the Demand's Function only. Add Function tag picker on external requirement rows (Project Scoping only — auto-set and read-only on Demands). Phase fields read-only on Project-spawned Demand Submitted; editable on Direct Demand Submitted.
- **Dependencies:** Changes 1, 3.
- **Read in REQUIREMENTS.md:** Section 4.5.2 (Mode A status-aware list, content blocks, Internal/External requirements entry, Skill picker scoping rules, Functions Required picker), section 9 build order step 4.

### 5. UI — Mode B touchups

- [ ] **Scope:** Update read-only Gantt scope language to "the Demand's own phases" (no more parent-Project-scoping filter). Update "Definition is Locked" banner copy to v1.19 language: locked from Approve onwards; Delete-and-recreate is the only path (parent Project for spawned Demands, this Demand for direct Demands).
- **Dependencies:** Changes 1, 2 (Demand owns its data now).
- **Read in REQUIREMENTS.md:** Section 4.5.2 (Mode B — Allocation Workspace; Phase timeline read-only; "Definition is Locked" banner), section 9 build order step 5.

### 6. UI — drawer header & body updates

- [ ] **Scope:** **Drawer header zone** — drop chevron-joined `Programme › Project` (and `Programme › Project › Function`) hierarchy from titles on both Project and Demand drawers. Title is now just the entity's name on its own row, full width. The "Edit" button on Submitted/Approved/Allocated Projects in Manage Projects is replaced with "View" (same position). **Drawer body zone** — add Programme line to both Project and Demand drawers ("No Programme" muted-italic when null; "Direct Demand (no Programme)" for direct Demands). Add "Part of: [Project name]" line to Demand drawer for Project-spawned Demands. Replace single "Functions involved" line with two adjacent chip rows on Project drawer: "Required (originator's plan):" (with "not declared (imported)" muted-italic for import-created Projects) and "Actually involved:" with mismatch badging. **Mode B top section** — drop chevron-joined "Programme › Project name" inline string; replace with separate "Part of: [Project name]" and "Programme: [Programme name]" lines, mirroring the drawer body convention. **Manage Demand surfaces** — Board mode card replaces "Programme › Project" tag with parent-Project name on its own line (no Programme prefix); Group-by-Project header becomes a two-row layout (Project name as primary, Programme as muted subtitle). **Delete cascade dialog scope text** — drop `ProjectTeamAssignment` count; replace with "this Project's child Demands and their materialised phases/requirements."
- **Dependencies:** Changes 1, 2.
- **Read in REQUIREMENTS.md:** Section 4.5.1 (drawer Header zone and Body zone — both updated), section 4.5.2 (Mode B top section), section 4.6 (Manage Demand Board mode card and Group-by-Project header), section 3 Deletion (cascade language), section 9 build order step 6.

### 7. Admin — Project Types surface

- [ ] **Scope:** New flat admin screen listing all Project Type records with name, drag-handle for reordering (drives `display_order`), colour swatch picker (single-select from a fixed design-system palette of 8–12 named tokens — no arbitrary hex input), `is_bau` read-only badge ("BAU" on the one record), active toggle, and in-use indicator (count of Projects + Demands referencing this type). Add Project Type form: name (required, unique among active records, case-insensitive), `colour_token` (palette pick), `display_order` set via drag handle on the list, `is_bau` defaults to false and is not user-editable. Renames cascade trivially. Reordering changes capacity-stack ordering on every chart that stacks by Project Type — intentional. Hard-delete blocked when in-use count > 0; bulk-reassign action provided. **BAU record cannot be hard-deleted ever** — system requires exactly one record with `is_bau = true` at all times. BAU record can be renamed, reordered, recoloured, or deactivated like any other type. Soft-delete via active flag — inactive types stay on existing records but disappear from pickers.
- **Dependencies:** Change 1 (the ProjectType entity must exist in the store).
- **Read in REQUIREMENTS.md:** Section 5 (Project Types admin entry), section 2.1.2 (entity definition + seed records + colour palette + `is_bau` semantics), section 9 build order step 1 (data model migration).

### 8. UI — Manage Projects view-only post-Submit

- [ ] **Scope:** Submitted, Approved, and Allocated Projects: drawer's "Edit" button replaced with "View" (opens the same edit page in fully read-only mode — no field editing, no "+ Add" affordances). Card content tweak: Functions Actually Involved chip row is the primary card content; "Required: …" footnote shown on Draft/Scoping cards only. Filter rename: "Functions involved" → "Functions Actually Involved" with clarifying tooltip.
- **Dependencies:** Changes 1, 4 (Mode A read-only behaviour must be wired).
- **Read in REQUIREMENTS.md:** Section 4.6.A (Manage Projects — Editability rule, Board mode card content, filter table), section 9 build order step 7.

### 9. Excel import for bulk Project creation

- [ ] **Scope:** Add `assets/import_template/master.xlsx` to the repo (the structural baseline workbook — checked-in artefact bundled with the build). Implement Download Template action on Manage Projects: read live store (Programmes, Skills, Providers, **Project Types**), populate the four Reference tabs, serialise via ExcelJS in-browser, trigger download. Project Types written in `display_order` order. Implement Import from Excel action: file picker (.xlsx only, CSV rejected with a clear error), parse + validate per the parser semantics in section 6.1; `project_type` validates against active Project Type records by `name` (case-sensitive match with "did you mean" suggestions). Render Preview screen with errors/warnings/Project preview cards including spawn outcome. On commit, atomic transaction creates Project records in `Submitted` with `functions_required = []` and immediately fires the spawn rule for each, materialising child Demands also in `Submitted`. Wire toolbar button order: `[Download Template] [Import from Excel] [+ New Project]`.
- **Dependencies:** Changes 1, 2, 3, 4, 7, 8 (data model + spawn logic + state machine + Mode A + Project Types admin + Manage Projects view-only must all be in place — Project Types admin must exist before the import can read records for the dropdown source).
- **Read in REQUIREMENTS.md:** Section 4.6.A.1 (Excel import surface — Download Template flow, Import from Excel flow, Preview screen, Authority and bypass semantics, What import does not support), section 6.1 (Import workbook schema — 9 tabs including the new `Reference - Project Types`, full tab/column/validation/parser specification), section 3 Project workflow narrative (Excel import path), section 7 Technology (ExcelJS row), section 9 build order step 9.

### 10. Seed rebuild for v1.19

- [ ] **Scope:** Regenerate seed module to embody the new model: Functions Required entries on every Project (Project 2 set to `[DM]` only with GroupIT requirements added during Scoping to demonstrate the hint-not-binding flow); Function tags on every external requirement (DM-tagged and GroupIT-tagged on Project 3 to exercise both routes; auto-tagged on direct Demand externals); spawn drift example on Project 4 DM Demand (60 → 80); zero `ProjectTeamAssignment` records anywhere; ProjectType FK references on every Project and Demand. Update seed reconciliation table where totals shift due to materialisation drift.
- **Dependencies:** Changes 1, 2.
- **Read in REQUIREMENTS.md:** Section 6 (Projects table updated for v1.19, Project-spawned Demands, capacity reconciliation), section 9 build order step 10.

### 11. Renderability invariants and tests

- [ ] **Scope:** Wire all v1.19-specific seed assertions (section 6) as runtime assertions in development builds. Verify spawn produces correct sibling counts, materialised data integrity, external Function-tag routing, frozen Project record, drift example. Verify Mode A is reachable on Demand Submitted (Project-spawned and direct) and that the Skill picker is correctly scoped. Verify Manage Projects renders view-only from Submitted onwards (no edit affordances anywhere on the Project surface). Verify the Excel import invariants from section 6.1: Download Template produces a 9-tab workbook with correct headers; Import of empty template produces zero records; Import of a single-Project workbook produces one Project + N spawned Demands all in `Submitted`; Import with unknown reference produces blocking error with zero records created. Verify Project Types behaviour: admin reorder via drag updates `display_order` and immediately changes capacity-stack ordering on Capacity Validation; admin recolour updates the stack colour; admin add of a new type makes it pickable in the Mode A type dropdown and in the import workbook's Reference tab on next download; hard-delete blocked when in-use; BAU record hard-delete blocked unconditionally.
- **Dependencies:** Changes 1–10.
- **Read in REQUIREMENTS.md:** Section 6 (Seed assertions — v1.19-specific block at the end), section 6.1 (Renderability invariants subsection), section 11.20 (spawn renderability invariants), section 9 build order step 11.

### 12. Cleanup

- [ ] **Scope:** Remove all references to `ProjectTeamAssignment`, `DemandTeamAssignment`, `owning_team_id`, "Teams Assigned", and "per-team confirmation" in code, route paths, test fixtures, and store types. Remove the v1.18 "Function-scoped slice of the parent Project" computed-view code path on spawned Demands. Remove every hardcoded list of Project Type enum values from the codebase — every runtime use must read from active ProjectType records sorted by `display_order`. Audit DESIGNSYSTEM.md for any team-related visual tokens that are no longer used.
- **Dependencies:** Changes 1–11.
- **Read in REQUIREMENTS.md:** Section 9 build order step 12.

---

## Notes for Claude Code

1. The dependency graph is strict: data model first, spawn logic second, state machine third, then UI surfaces in any order, then seed, then assertions, then cleanup. Don't bundle.
2. After each change, smoke-test the user-observable outcome. Each change has one.
3. The aggregation layer (sections 2.4.1–2.4.8) and Function selector behaviour (sections 4.9, 11.17) are unchanged in v1.19. Don't modify those code paths unless explicitly required by one of the changes above.
4. The capacity model and visual treatment on Capacity Validation, Team Activity, Skill detail view, and Demand view are unchanged. The Demand drawer body (other than item 6 above) is also unchanged — phases and requirements are now read from the Demand directly, but for direct Demands that was always true and for spawned Demands the data shape is identical (just sourced differently).
5. Section D2's team drill-down sub-view is removed in v1.19 alongside the broader removal of Teams from the workflow. The aggregation function `cross_function_demand_hours` loses its `by: 'team'` decomposition.
