# v1.20 Changes — Resource Load & Capacity Tool

This file tracks v1.20 implementation progress. Each change has a checkbox, a one-line description, scope, dependencies, and a pointer to the relevant sections in `REQUIREMENTS.md` where Claude Code reads the full implementation detail.

**Implementation rule**: tackle changes in the order below. Each change must land and be smoke-tested before the next builds on top — see `REQUIREMENTS.md` section 9 for the full v1.20 build order. Do not bundle changes.

---

## Change 1 — Phase → Activity rename (mechanical, repo-wide)

- [x] Rename "Phase" entity and all related identifiers + UI labels to "Activity" throughout the codebase, store, UI, import workbook, and bundled template.

**Scope**: data model field names (`phases` → `activities`, `phase_*` → `activity_*`); UI strings ("+ Add Phase" → "+ Add Activity", "Phase 1 · Design …" → "Activity 1 · Design …", "Phase timeline (Gantt)" → "Activity timeline (Gantt)"); import workbook tab `Phases` → `Activities` and column renames; regenerated `assets/import_template/master.xlsx`. Generic English usages of "phase" (e.g. "time-phased") are preserved.

**Dependencies**: none — this is the first change. Land in a single commit so subsequent commits build on consistent terminology.

**Spec sections**: section 2.0 (terminology rule and rename map), section 2.2.2 (Activity entity), section 6.1 (import workbook schema), section 9 step 1 (build order — mechanical rename).

---

## Change 2 — Add `created_under_function_id` to Project; tighten Project Type id derivation

- [x] Add `created_under_function_id` field to Project (set on create to the user's active Function). Verify all seed Project Types' ids match the auto-derived `pt_<slug>` form per section 2.1.2.

**Scope**: store schema addition; seed migration (set `created_under_function_id` on every existing Project — first Function in `functions_required`, falling back to `digital_manufacturing` for empty); Project Types admin form's id derivation logic (already specified — verify implementation).

**Dependencies**: Change 1 (rename) must land first so the data model is on the v1.20 baseline.

**Spec sections**: section 2.1.1 (Project entity table), section 2.1.2 (Project Type id rules), section 9 step 2 (build order — data model additions).

---

## Change 3 — Project Types admin: surface system key

- [ ] Add a read-only `id` display to the Project Types admin list (small monospace tag adjacent to `name`). Add real-time `id` preview to the Add Project Type form ("System key: `pt_<slug>`" below the name input).

**Scope**: Project Types admin screen UI; Add form preview logic; uniqueness check at submit time (block on collision against any existing record, active or inactive).

**Dependencies**: Change 2 (Project Type id derivation).

**Spec sections**: section 2.1.2 (Project Type entity), section 5 (admin — Project Types), section 9 step 3.

---

## Change 4 — Type label resolution rule (no `pt_*` in user-facing UI)

- [ ] Audit every UI surface rendering a Project Type and ensure it resolves the FK reference to the record's `name`. Add a runtime DOM scanner (development builds) that logs an error on any rendered text matching `pt_[a-z_]+` outside the admin screen.

**Scope**: Project drawer headers, Demand drawer headers, Manage Projects cards (board + table), Manage Demand cards (board + table), capacity stack legends, Capacity Validation tooltips, filter dropdowns. Add the runtime scanner.

**Dependencies**: none structural — but easier to validate after Change 2 confirms ids are correct.

**Spec sections**: section 4.5.1 (drawer body — Type render rules), section 4.6 (Manage Demand cards — Type label resolution), section 4.6.A (Manage Projects cards), section 5 (admin — type label resolution rule paragraph), section 9 step 4.

---

## Change 5 — Demand auto-name: drop Function suffix

- [ ] Update the spawn algorithm in `spawnDemandsOnProjectSubmit` so spawned Demand `name` equals the parent Project's `name` exactly (no " — Function Name" suffix). Re-seed the bundled seed (Project 4's spawned Demands) accordingly.

**Scope**: spawn pseudocode (already updated in spec); seed regeneration (after Change 14, this happens automatically via the `master_seed.xlsx` parse); verify the Function chip in the Demand drawer header continues to disambiguate siblings.

**Dependencies**: Change 1 (rename — `Activities:` field instead of `Phases:` in spawn pseudocode).

**Spec sections**: section 2.2.4 (spawn rule), section 11.20 (spawn pseudocode), section 9 step 5.

---

## Change 6 — Manage Projects Function-scoping

- [ ] Implement the new visibility predicate in `selectProjectsForActiveFunction` per the v1.20 rules: Draft/Scoping require Function involvement (via `functions_required`, requirements, or `created_under_function_id`); Submitted+ unchanged.

**Scope**: `selectProjectsForActiveFunction` selector logic; Function-switch guard that closes a drawer/edit page when the active Function changes and the Project becomes invisible; toast on Function switch when this occurs. Update seed so Project 5 (`functions_required = [DM]`, `created_under_function_id = DM`) is invisible under Group IT to exercise the rule.

**Dependencies**: Change 2 (`created_under_function_id` field).

**Spec sections**: section 4.6.A (Manage Projects — Function lens visibility rule), section 9 step 6.

---

## Change 7 — Project Draft strictly hides requirements UI

- [ ] In Mode A on Project Draft, hide the internal requirements list, external requirements list, and both "+ Add" affordances on every Activity card. Activity-level metadata (name, dates, funding source, funding notes) remains editable.

**Scope**: Mode A status-aware rendering; ensure the affordance is gone (not just the list), so users cannot add requirements until the Project transitions to Scoping.

**Dependencies**: Change 1 (rename — Activity terminology in Mode A).

**Spec sections**: section 4.5.2 ("Project Draft strict rule" sub-section), section 9 step 7.

---

## Change 8 — Activity date pickers + end-≥-start validation

- [ ] Replace free-text inputs for `activity_start_month` and `activity_end_month` on every Activity card in Mode A with a portalled month-year picker component. Implement live end-≥-start validation; preserve the "No end date (indefinite)" toggle.

**Scope**: month-year picker component (new); replacement on every Activity card; validation logic; Save button disable when any Activity has invalid dates with a banner naming the offending Activity.

**Dependencies**: Change 1 (rename); Change 7 (so the affordances on Draft/Scoping are correctly placed before adding the picker).

**Spec sections**: section 2.2.2 ("Date input UI — month-year picker with validation"), section 4.5.2 (Activity card rendering), section 11.12 (indefinite phase UI — preserved), section 9 step 8.

---

## Change 9 — Mode B requirement total hours

- [ ] Add a prominent "Target: N hrs total · {description}" line above each requirement's coverage strip in Mode B, plus a coverage summary line ("Allocated: N hrs (X%) · Unfilled: N hrs"). Both lines update live as allocations are edited.

**Scope**: Mode B requirement row rendering. Total computed from `hours_by_month` sum (finite) or `steady_state_hours` (indefinite). Description format varies by Activity type.

**Dependencies**: Change 1 (rename); Change 8 (date pickers — affects Activity-level data the total reads from).

**Spec sections**: section 4.5.2 ("Per requirement within a phase" — v1.20 update), section 9 step 9.

---

## Change 10 — Skill picker dual-mode

- [ ] Refactor the shared Skill selector into single-Function mode (existing — Domain → Skill) and cross-Function mode (new — two-step Function → Domain → Skill, used only on Project Scoping). Implement search across the full hierarchy with Function · Domain prefix on hits.

**Scope**: Skill selector component refactor; mode selection driven by context (Project Scoping → cross-Function mode; everywhere else → single-Function mode); selected-skill display format updates.

**Dependencies**: Change 1 (rename) for context label updates.

**Spec sections**: section 4.5.3 ("Two scoping modes"), section 9 step 10.

---

## Change 11 — Drawer body status-aware refactor

- [ ] Replace the previous fixed-content drawer body with a status-aware renderer per the v1.20 Project and Demand status tables. Implement the encoding-safety rules including the runtime `\uFFFD` DOM scanner.

**Scope**: drawer body renderer for both Project and Demand drawers — different fields surface based on lifecycle position; structural rendering for hierarchy (no chevron-joined inline strings); runtime DOM scanner for replacement characters.

**Dependencies**: Changes 4 (type label resolution), 5 (Demand name without suffix), 6 (Function-scoping rule — affects what surfaces in drawer when the Project is open).

**Spec sections**: section 4.5.1 (drawer body — status-aware tables; encoding safety), section 9 step 11.

---

## Change 12 — Manage Projects / Manage Demand card cleanup

- [ ] Update Kanban / Table card content per the v1.20 rules: Demand cards (no Function suffix on name, resolved Type label, Origin/parent line, active-Function chip when siblings exist, compact stats); Project cards (resolved Type label, Programme line, Functions chip rows, hint footnote on Draft/Scoping). Forbid chevron- or em-dash-joined hierarchy strings on cards.

**Scope**: Manage Demand Board + Table card rendering; Manage Projects Board + Table card rendering; ensure Type column on Table mode resolves the FK to `name`.

**Dependencies**: Changes 4 (Type label resolution), 5 (Demand name without suffix).

**Spec sections**: section 4.6 (Manage Demand cards), section 4.6.A (Manage Projects cards), section 9 step 12.

---

## Change 13 — Dual + Add buttons (top + bottom)

- [ ] Add a secondary "+ Add Activity" button below the last Activity card on Mode A pages. Same pattern within each Activity card for internal and external requirement lists. Bottom button hidden when the section is empty (only the inline header button appears).

**Scope**: Mode A edit-page layout — render conditional bottom buttons. Visually subtler treatment per DESIGNSYSTEM.md (e.g. ghost style; smaller).

**Dependencies**: Changes 1 (rename — button labels), 7 (Project Draft hide rule for requirements buttons), 8 (date pickers — Activity layout finalised).

**Spec sections**: section 4.5.2 ("Dual '+ Add' button placement — top and bottom of long sections"), section 9 step 13.

---

## Change 14 — Build-time seed pipeline (`master_seed.xlsx`)

- [ ] Add `seed/master_seed.xlsx` to the repo with the v1.20 schema (all 9 import-workbook tabs plus 11 extra structural tabs). Implement `scripts/build-seed.ts` that parses the workbook at build time into `src/seed/seed.json`. Wire into the build (`pnpm build` / `npm run build`). Migrate the existing seed by round-tripping it through the workbook.

**Scope**: workbook authoring (one-time data migration of current seed); build script (parser logic shared with import flow + extra structural tabs); build wiring; documentation in README. Hours per month is a single flat value per requirement, expanded uniformly at parse time.

**Dependencies**: Change 1 (rename — workbook tabs and columns); Changes 2–6 (data-model additions and rules — the workbook must reflect them); ideally land after most UI changes so the seed exercises them on first parse.

**Spec sections**: section 6.0 (seed source — `master_seed.xlsx`), section 6.1 (import workbook schema — extended for seed), section 7 (technology — note that `seed.json` is generated), section 9 step 14.

---

## Change 15 — Seed updates for v1.20

- [ ] Update `master_seed.xlsx` to reflect v1.20 model: Demand names without Function suffix; `created_under_function_id` on every Project; Project 5 set as DM-only with `created_under_function_id = DM`; all `phase_*` references replaced with `activity_*`. Update the seed reconciliation table (section 6) where any totals shift.

**Scope**: workbook edits; verify renderability invariants still hold post-parse.

**Dependencies**: Change 14 (workbook + parser must exist).

**Spec sections**: section 6 (seed records and renderability invariants — v1.20 additions), section 9 step 15.

---

## Change 16 — Renderability invariants for v1.20

- [ ] Wire the v1.20-specific seed assertions as runtime assertions in development builds. Includes: Project Draft hides requirements UI; Manage Projects Function-scoping holds; Project Type labels resolve; Demand auto-name has no Function suffix; Activity terminology applies; date pickers + validation work; Mode B shows total hours; Skill picker mode-correct per context; dual + Add buttons render; no `\uFFFD` in DOM; build-time seed parse succeeds.

**Scope**: a runtime assertion module exercised on fresh seed load (development builds only). Each assertion failure logs a console error naming the failing predicate.

**Dependencies**: all previous changes — this is the verification layer.

**Spec sections**: section 6 ("v1.20-specific seed assertions"), section 9 step 16.

---

## Change 17 — Cleanup

- [ ] Remove every remaining hardcoded "Phase" / `phase_*` identifier from the codebase outside the changelog and section 2.0 terminology table. Add a generated-file header to `seed.json` and `.gitattributes` `linguist-generated=true` to suppress diffs. Audit DESIGNSYSTEM.md for new tokens (month-year picker, dual + Add ghost button) and add if missing.

**Scope**: grep-driven cleanup; documentation polish; design-system additions.

**Dependencies**: Changes 1 (rename) and 14 (seed pipeline).

**Spec sections**: section 9 step 17.

---

## Notes for Claude Code

- **Spec is the source of truth.** Where this file gives a one-line description, the spec gives the full implementation detail. Read the referenced spec sections before implementing.
- **Renderability invariants live in section 6 ("v1.20-specific seed assertions"). Wire them as runtime assertions** so future regressions are loud rather than silent — same pattern as the v1.12 grey-band invariant and the v1.18 capacity reconciliation invariants.
- **The Phase → Activity rename (Change 1) is a breaking change for any pre-v1.20 import workbooks Tim may have created.** None should exist yet — this is the first version with the rename — but the parser must surface the v1.19-template error message clearly (section 2.0).
- **No changes to**: capacity model (sections 2.4.1–2.4.8), aggregation layer (section 2.4.8), projection algorithm (section 2.4.5), Function selector lens (section 4.9), Skill detail view (section 4.8), Capacity Validation visual treatment, Team Activity, Demand view (section 4.10), or state machine transitions (section 3 — only Project Draft requirements-UI hide rule and Manage Projects visibility rule are tightened).
