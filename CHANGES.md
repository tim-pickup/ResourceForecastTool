# v1.16 changes

Tracks implementation progress against REQUIREMENTS.md v1.16. REQUIREMENTS.md is the source of truth — this file is a checklist and section pointer.

**Implementation order matters.** Items in this list respect dependencies. Don't skip ahead.

---

## 1. Data model additions and removals

- [x] Drop `primaryDomainId` from the Demand Item schema. Drop `leadPersonId` from the Team schema. Add `createdUnderFunctionId` to the Demand Item schema.
- **Scope**: store schema only, no UI changes yet
- **Dependencies**: none (first step)
- **Reference**: section 2.1 (Team, Person), section 2.2 (Demand Item), section 9 build step 1

## 2. State machine update — remove Scoping auto-advance

- [x] Remove the auto-transition `Scoping → Submitted on all assignments confirmed`. Add a user-driven transition via `Submit for capacity assessment` action.
- **Scope**: state machine implementation + transitions table
- **Dependencies**: none
- **Reference**: section 3 (transitions table, Scoping workflow subsection), section 9 build step 2

## 3. Multi-Function store support

- [x] Allow multiple Function records. Seed creates Digital Manufacturing and Group IT Enterprise Solutions. Every Function-scoped record carries valid `functionId`. Add `activeFunctionId` state slice persisted to localStorage and mirrored to URL hash.
- **Scope**: store structure, seed data, URL routing
- **Dependencies**: item 1
- **Reference**: section 2.1 (Function), section 6 (Seed data), section 7 (Technology — routing), section 4.9 (persistence), section 9 build step 3

## 4. New `crossFunctionDemandHours` aggregation function

- [x] Add `crossFunctionDemandHours(activeFunctionId, month, {by: 'function' | 'team'})` to the shared aggregation module. Add renderability invariant (non-zero for Group IT in at least one visible month when DM active on fresh seed).
- **Scope**: aggregation module + dev-mode assertion
- **Dependencies**: items 1, 3
- **Reference**: section 2.4.8 (invariants pattern), section 2.4.9 (aggregation scope), section 4 View 1 Section D, section 9 build step 3

## 5. Function selector UI

- [x] Global header dropdown with the behaviour in section 4.9: single-Function-degrades-to-label, lens-switch re-renders, filter reset on switch, drawer auto-close if Demand has no requirements touching the new Function, URL hash update.
- **Scope**: new global header component + store wiring
- **Dependencies**: items 3, 4
- **Reference**: section 4.9 (full spec), section 11.17 (implementation guidance), section 9 build step 4

## 6. Admin surfaces — multi-Function

- [x] Functions admin full CRUD. Domains / Skills / Teams / People admin scoped to active Function. Drop Lead picker from Team admin. Programmes / Projects / Providers admin remains global.
- **Scope**: admin UI changes + CRUD actions
- **Dependencies**: items 3, 5
- **Reference**: section 5 (all bullets), section 9 build step 5

## 7. Demand page corrections

- [x] Remove Primary Domain column and filter. Add "Functions involved" column and Domain (multi-select) filter. Add Scoping Kanban column. Fix filter behaviour — Programme, Project, Has-external-requirements must apply to Board mode. Apply active-Function lens to visible Demands.
- **Scope**: Demand page Table, Board, Search modes
- **Dependencies**: items 1, 5
- **Reference**: section 4.6 (all content), section 9 build step 6

## 8. Drawer and edit page corrections

- [x] Drawer header: remove Primary Domain. Drawer body: replace Primary Domain with "Functions involved" chips line. Drawer footer: Scoping row (Submit for capacity assessment / Revert to Draft / Park). Overflow: Scoping includes Close. Mode A: Teams-assigned picker per phase, per-team confirmation strip (Scoping only), owning-team field on internal requirements, DOMAIN > SKILL selector scoped to owning team's Function. Mode B top summary: replace "domain" with "Functions involved".
- **Scope**: drawer + edit page in both modes
- **Dependencies**: items 1, 2, 3
- **Reference**: section 4.5.1 (drawer), section 4.5.2 (Mode A, Mode B), section 11.18 (Submit dialog), section 9 build step 7

## 9. Capacity Validation — remove Team filter, add Section D

- [x] Remove Team filter toolbar control and its dashed-line / tinted-stack logic. Scope every chart to active Function. Add Section D ("Show demand on other Functions") with D1 overview and D2 per-Function breakdowns with team drill-down. Update Section C scope rule to filter by active Function.
- **Scope**: Capacity Validation view 1 chrome + charts
- **Dependencies**: items 3, 4, 5
- **Reference**: section 4 View 1 (full section, especially Section D), section 9 build step 8

## 10. Team Activity — active-Function scope

- [x] Restrict rows to the active Function's People. Group-by-Domain uses the active Function's Domains; Group-by-Team uses the active Function's Teams.
- **Scope**: Team Activity view 2
- **Dependencies**: items 3, 5
- **Reference**: section 4 View 2, section 9 build step 9

## 11. Seed data rewrite

- [ ] Add Group IT Enterprise Solutions Function with 3 Domains, 9 Skills, 2 Teams, 5–7 People. Add cross-Function Demand (Plant C MES Platform Migration with Group IT requirements). Migrate Scoping seed item to have one DM team and one Group IT team assigned. Verify all seed assertions pass.
- **Scope**: seed.json rewrite
- **Dependencies**: items 1, 2, 3, 6
- **Reference**: section 6 (full section), section 9 build step 10

---

## Verification after all items complete

Run the seed-assertion checks from section 6 on a fresh load of the app:

- [ ] Programme/Project roll-up visibility invariant passes
- [ ] Scoping column visible with mixed confirmation strip
- [ ] **Cross-Function Demand visible** (Section D non-zero for Group IT when DM active)
- [ ] **Function switch effect visible** (Domain charts change, Demand list changes)
- [ ] Grey band renderability invariants (from v1.12) still pass
