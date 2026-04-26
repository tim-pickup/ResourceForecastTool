# Changes — REQUIREMENTS.md v1.18

This file directs Claude Code to the work items for the v1.18 spec revision. Each section is a single change with a checkbox, scope, dependencies, and pointers to the authoritative spec sections in `REQUIREMENTS.md`.

**Rules**:
- Tick each checkbox only when the change is fully implemented and verified against the renderability invariants noted in the spec.
- Implement changes in the order listed below. Dependencies are explicit — do not start a change whose prerequisites are unchecked.
- This file does **not** restate spec content. For implementation detail, read the referenced sections of `REQUIREMENTS.md`.

---

## Change 1 — Data model migration (Project + Demand split)

- [x] Restructure the data model around the new Project entity and the redefined per-Function Demand entity. Direct Demands carry their own phases; Project-spawned Demands present a Function-scoped view of the parent Project's phases.

**Scope**:
- Add Project as a first-class entity (status, phases, requirements, ProjectTeamAssignments).
- Redefine Demand: add `function_id` (required), `parent_project_id` (nullable). Remove the v1.17 `Project` alignment field.
- Rename `DemandTeamAssignment` → `ProjectTeamAssignment` (FK now points at Project, not Demand).
- Drop `Parked`, `Closed` statuses, `Parked reason` field, Archive entity references, Restore action.
- Drop `Submitted → Draft` (Revert), `Approved → Submitted` (Revise), Duplicate operations from the schema-level state machine definitions.

**Dependencies**: none. This is the foundation.

**Reference sections**:
- `REQUIREMENTS.md` §2.1.1 — Programme / Project hierarchy
- `REQUIREMENTS.md` §2.2 — Demand and Project requirements (especially §2.2.1 Demand entity, §2.2.4 spawn rule)
- `REQUIREMENTS.md` §2.3 — BAU now flows through direct Demand path
- `REQUIREMENTS.md` §3 Statuses tables — Project and Demand state definitions

---

## Change 2 — Aggregation layer rewrite

- [x] Update the shared aggregation module to walk the new Project → Phases → Requirements → child Demand structure, add `direct_demand_*` functions, and revise `*_demand_by_funding` signatures with the new `opts` parameter. Delete dead-code by-team functions.

**Scope**:
- Update `project_internal_hours`, `project_external_hours`, `programme_internal_hours`, `programme_external_hours` to walk Project phases and respect child-Demand status filtering.
- Add `direct_demand_internal_hours`, `direct_demand_external_hours`, `direct_demand_by_funding`, `unaligned_project_hours`.
- Replace `*_demand_by_funding(programme_id, month, {status_set})` with the v1.18 `opts`-bearing signature: `function_id`, `status_set`, `include_external`, `include_other_functions`.
- **Delete** `programme_demand_by_team` and `project_demand_by_team` from the module.
- Reframe `cross_function_demand_hours` to the shared-Project semantics (other Functions' Demands on Projects shared with the active Function).

**Dependencies**: Change 1 (data model must exist first).

**Reference sections**:
- `REQUIREMENTS.md` §2.4.9 — full function inventory and signatures
- `REQUIREMENTS.md` §2.4.8 — aggregation consistency rules and renderability invariant pattern

---

## Change 3 — Capacity reconciliation invariants (bug-fix scaffolding)

- [x] Add per-Function and per-Domain capacity reconciliation invariants as runtime assertions in development builds. Build a seed-derived expected-value table and verify chart, aggregation, and table reconcile.

**Scope**:
- Implement `function_capacity(function_id, month)` and assert against the seed-derived table.
- Implement `domain_capacity(domain_id, month)` per-Domain assertions.
- Wire Function-switch renderability assertion: switching Functions must change `domain_capacity` results in at least one visible month.
- Investigate the v1.17 "Group IT Data & Integration phantom capacity Jul–Aug 2026" symptom against the reconciliation table — reproduce or rule out.

**Dependencies**: Change 1 (data model), Change 2 (aggregation layer).

**Reference sections**:
- `REQUIREMENTS.md` §2.4.8 — capacity reconciliation invariants block
- `REQUIREMENTS.md` §6 — capacity reconciliation table (seed-derived expected values)

---

## Change 4 — State machines (Project, Demand, spawn rule)

- [x] Implement the two state machines and the spawn rule (Project Scoping → Submitted creates child Demands atomically). Implement Project status auto-transitions from child Demand statuses. Implement Delete cascade rules.

**Scope**:
- Project state machine: Draft → Scoping → Submitted → Approved → Allocated. Submit-for-Scoping gate (phases-and-teams-assigned). Submit Project executes the spawn rule.
- Demand state machine: Draft → Submitted → Approved → PartiallyAllocated → Allocated. Direct Demands enter at Draft; Project-spawned at Submitted via spawn.
- Project status auto-transition logic (Submitted ↔ Approved ↔ Allocated based on child Demand statuses).
- Delete cascade: Project Delete cascades to child Demands and their allocations atomically; direct Demand Delete cascades to its allocations.
- Remove all Park / Close / Revert / Revise / Duplicate / Revive / Restore transitions from the codebase.

**Dependencies**: Change 1 (entities must exist).

**Reference sections**:
- `REQUIREMENTS.md` §3 — state machine diagrams, transition reference, workflow narratives, deletion rules
- `REQUIREMENTS.md` §11.20 — spawn algorithm pseudocode, Project status auto-transition logic, cascade pseudocode

---

## Change 5 — Drawer and edit page (entity-aware)

- [x] Update the drawer (header / status / body / footer) and the edit page (Mode A, Mode B) to handle Projects and Demands distinctly. Wire the v1.18 footer button tables and the single-Delete overflow.

**Scope**:
- Drawer header zone: Project drawer shows Programme name + owner; Demand drawer shows Function chip + parent-Project link or Direct badge.
- Drawer body zone: Functions involved (Project), Function badge + Origin + Sibling Demands (Demand), summary stats scoped appropriately.
- Drawer footer: per the v1.18 status × entity tables in §4.5.1.
- Drawer overflow: Delete only.
- Edit page Mode A: Project Draft (no requirements UI), Project Scoping (full requirements UI + per-team confirmation strip), direct Demand Draft (single-Function, full UI). Programme picker on Projects (replaces v1.17 Project alignment picker on Demands).
- Edit page Mode B: Demand-only, scoped to the Demand's Function for Project-spawned Demands. "Definition is Locked" banner copy updated; no return-to-Mode-A path.
- Remove `DemandTeamAssignment` references in the edit page; rename to `ProjectTeamAssignment`.

**Dependencies**: Changes 1, 2, 4.

**Reference sections**:
- `REQUIREMENTS.md` §4.5.1 — Drawer (header, body, footer button tables, overflow)
- `REQUIREMENTS.md` §4.5.2 — Edit page Mode A and Mode B
- `REQUIREMENTS.md` §11.16 — drawer button taxonomy (transitional / navigational / destructive)

---

## Change 6 — Manage Demand reshape (5-column board)

- [x] Reshape Manage Demand to a 5-column Kanban (Draft / Submitted / Approved / PartiallyAllocated / Allocated). Add the "+ New Direct Demand" button. Add the Origin filter. Apply the active Function lens.

**Scope**:
- Kanban columns reduced to 5. Draft column shows direct Demands only; Submitted onwards mixes both origins.
- Drag-and-drop transitions: Draft → Submitted (direct Demands), Submitted → Approved (any). Drags to PartiallyAllocated/Allocated rejected with tooltip.
- "+ New Direct Demand" button creates a Draft Demand with `function_id = activeFunctionId`, immutable.
- Origin filter (All / Project-spawned / Direct).
- Cards show parent-Project link or Direct badge.
- Active Function lens — only Demands matching `activeFunctionId` are shown.

**Dependencies**: Changes 1, 4, 5.

**Reference sections**:
- `REQUIREMENTS.md` §4.6 — Manage Demand
- `REQUIREMENTS.md` §11.19 — navigation order

---

## Change 7 — Manage Projects view (new)

- [x] Build the new Manage Projects view as a 5-column Kanban (Draft / Scoping / Submitted / Approved / Allocated). Add the "+ New Project" button. Apply the cross-Function visibility rule.

**Scope**:
- Kanban columns: 5 statuses. Drag-and-drop: Draft → Scoping (gated), Scoping → Submitted (triggers spawn confirmation dialog). Approved/Allocated drags rejected (auto-only).
- "+ New Project" button creates a Project Draft (Function-agnostic, picks Programme later).
- Visibility rule: Draft/Scoping Projects always visible; Submitted+ Projects visible only if at least one child Demand belongs to the active Function.
- Functions involved chips on cards.
- Filters: Status, Type, Programme, Functions involved, Has external requirements.
- Group-by-Programme view in Table mode.

**Dependencies**: Changes 1, 4, 5.

**Reference sections**:
- `REQUIREMENTS.md` §4.6.A — Manage Projects (full spec)
- `REQUIREMENTS.md` §11.18 — Submit Project confirmation dialog (all-confirmed / unconfirmed / zero-requirements paths)
- `REQUIREMENTS.md` §11.19 — navigation order

---

## Change 8 — Demand view (4.10) Function-lensed with toggles

- [x] Apply Function lens. Replace Stacking selector with funding-source-only. Add "Show external resource" and "Show demand on other Functions" toggles. Replace hatched-overlay Submitted with merged-bucket Submitted. Add Direct Demands and Unaligned Projects virtual cards.

**Scope**:
- Wire the Function lens via `function_id` parameter on `programme_demand_by_funding`, `project_demand_by_funding`, `direct_demand_by_funding`.
- Remove the Stacking segmented control from the toolbar — only By Funding Source remains.
- Add "Show external resource" toggle (default OFF; expands buckets to include externals).
- Add "Show demand on other Functions" toggle (default OFF; adds sibling Demands' hours on shared Projects to the same buckets).
- "Include Submitted" toggle behaviour change: no visual differentiation, no `(Submitted)` suffix; just expands `status_set`.
- Add Direct Demands virtual card on the landing page (active Function only; hidden when none).
- Add Unaligned Projects virtual card (Programme-less Projects with active-Function Demands).
- Update segment-click side panel rows to surface origin + Function chip.

**Dependencies**: Changes 1, 2, 4.

**Reference sections**:
- `REQUIREMENTS.md` §4.10 — Demand view (full revision)
- `REQUIREMENTS.md` §11.17 — Function lens (exception removal note)

---

## Change 9 — Capacity Validation Section A re-render bug + Section D reframe

- [ ] Fix Section A "Overall Function Capacity" so it re-renders on Function switch using the active-Function selector pattern. Reframe Section D to "Other Functions' Demands on Shared Projects."

**Scope**:
- Section A: replace any hard-coded function id captured at mount time with `selectActiveFunctionCapacityLine(store, month)`. Add a runtime regression assertion that a Function-switch action causes Section A's data to recompute.
- Section D: update in-scope rule to "Projects where the active Function has a Demand → surface other Functions' requirements on those Projects."
- Section D2: stack by **Project** (not Demand name); keep team drill-down.
- Direct Demands excluded from Section D by definition.
- Update aggregation calls to the reframed `cross_function_demand_hours` signature (Change 2).

**Dependencies**: Changes 1, 2, 3.

**Reference sections**:
- `REQUIREMENTS.md` §4 View 1 — Section A (re-render rule), Section D (reframed scope, D1/D2 specs)
- `REQUIREMENTS.md` §2.4.8 — Function-switch renderability assertion
- `REQUIREMENTS.md` §11.17 — selector pattern for active Function

---

## Change 10 — Archive view removal + nav updates

- [ ] Remove the Archive view route, remove the Archive nav item, update the nav order to the v1.18 sequence, update routing for the new `/manage-projects` route.

**Scope**:
- Delete the Archive view component and its route.
- Remove the Archive nav link.
- Update nav order: Capacity Validation, Demand, Manage Projects, Manage Demand, Team Activity, Forecast, Skills Development, Admin.
- Add `/manage-projects` route.
- Verify deep links from Capacity Validation segment-clicks and Demand drawer Edit buttons land on the correct page in the new model.

**Dependencies**: Changes 5, 6, 7.

**Reference sections**:
- `REQUIREMENTS.md` §4.7 — (now removal note only)
- `REQUIREMENTS.md` §11.19 — navigation order

---

## Change 11 — Admin updates (Programmes, Projects, Providers)

- [ ] Update the admin Programmes screen for the new Project-as-planning-entity model. Build the admin Projects list (with Delete cascade dialog). Update Provider in-use indicator to reflect new model.

**Scope**:
- Programmes admin: hard-delete blocked when Programme has Projects (no longer "Closed Projects" condition).
- Projects admin: list view across all Functions with name, Programme, status, owner, type, Demand count, rolled-up internal/external hours; Delete with cascade dialog (matches §11.20 cascade pseudocode).
- Remove "Closed Projects" / soft-delete-via-active-flag concept from Projects admin.
- Providers admin: in-use indicator counts external requirements across Projects + direct Demands.

**Dependencies**: Changes 1, 4.

**Reference sections**:
- `REQUIREMENTS.md` §5 — Admin (Programmes, Projects, Providers entries)
- `REQUIREMENTS.md` §11.20 — Project Delete cascade pseudocode

---

## Change 12 — Seed rebuild

- [ ] Rebuild the seed around the new Project + direct Demand model: 6 Projects across all 5 statuses, 4 direct Demands across all 5 statuses, headline cross-Function Project with 2 spawned Demands, and the capacity reconciliation table.

**Scope**:
- 6 Projects per the table in §6 (covering Draft, Scoping, Submitted, Approved, Allocated).
- 4 direct Demands per §6 (covering Draft, Submitted, Approved, PartiallyAllocated, Allocated — D3 BAU lands in PartiallyAllocated).
- Spawn the appropriate child Demands for each non-Draft, non-Scoping Project (6 spawned Demands total).
- Cross-Function "Plant C MES Platform Migration" with DM (PartiallyAllocated) and GroupIT (Approved) child Demands; Project sits at Approved.
- External requirements per §6.
- Capacity reconciliation table exported alongside People data.

**Dependencies**: Changes 1, 2, 3, 4. Cannot meaningfully test without all four.

**Reference sections**:
- `REQUIREMENTS.md` §6 — full seed specification including Projects table, direct Demands table, capacity reconciliation table

---

## Change 13 — Renderability invariants and final cleanup

- [ ] Wire all v1.18 seed assertions as runtime assertions. Remove residual Park / Close / Revert / Revise / Duplicate / Archive references from code, route paths, fixtures, design system tokens.

**Scope**:
- All seed assertions in §6 ("Seed assertions" block) wired as dev-build runtime assertions per the §2.4.8 pattern.
- Verify Manage Projects board, Manage Demand board, Demand view (under both Function lenses), Capacity Validation Section A re-render under Function switch.
- Remove `functionLensInactiveHint` token from `DESIGNSYSTEM.md` (no longer used after Change 8).
- Code audit for residual Park/Close/Revise/Revert/Duplicate/Archive/Revive/Restore references.
- Verify the v1.17 "Project alignment" inline picker is fully removed from edit page Mode A.

**Dependencies**: All previous changes.

**Reference sections**:
- `REQUIREMENTS.md` §6 — Seed assertions block
- `REQUIREMENTS.md` §2.4.8 — runtime assertion pattern
- `REQUIREMENTS.md` §9 v1.18 — build order section, especially step 10 (Cleanup)

---

## Verification before marking v1.18 complete

After all 13 changes are checked, perform a final verification pass:

- [ ] Fresh seed loads without runtime assertion errors.
- [ ] Manage Projects board shows all 5 columns populated.
- [ ] Manage Demand board shows all 5 columns populated.
- [ ] Function switch produces visible re-render on every page (especially Section A capacity line).
- [ ] Section D shows non-zero hours for the other Function on shared Projects only.
- [ ] Demand view's three toggles each visibly affect the chart values.
- [ ] No Park / Close / Revert / Revise / Duplicate / Archive button or route exists anywhere.
- [ ] Delete on a Project cascades to Demands + allocations with confirmation dialog showing accurate counts.
- [ ] Spec version stamp in the running app matches `REQUIREMENTS.md` v1.18.

When the verification list is complete, the build is at v1.18 parity with the spec.
