# CHANGES — v1.21

Bug-fix release. Three rendering/filtering regressions. No data model, state machine, aggregation, or seed changes.

---

## Change 1 — Overlay selector: scope to active Function

- [x] **Completed**
- **Description**: Set Overlay combobox must filter Demands to `function_id = activeFunctionId` AND `status = 'Submitted'`. Currently shows all Submitted Demands regardless of Function, causing duplicates for cross-Function Projects.
- **Scope**: Capacity Validation toolbar overlay picker component only. No aggregation or data model changes.
- **Dependencies**: None.
- **Spec sections**: 11.2 (overlay selector — updated filter rule and rationale), section 4 View 1 Required features (updated overlay bullet).

---

## Change 2 — Activity timeline Gantt: fix bar end-month coordinate

- [x] **Completed**
- **Description**: Bar right-edge x-coordinate must use `monthToX(addMonths(activity_end_month, 1))` instead of `monthToX(activity_end_month)`. Current bars render one month short and leave phantom gaps between sequential Activities.
- **Scope**: All Gantt bar rendering — Mode A Activity timeline (section 4.5.2), Mode B read-only Activity Gantt (section 4.5.2), Skill detail view Demand Gantt (section 4.8). Pure rendering fix.
- **Dependencies**: None.
- **Spec sections**: 4.5.2 (new "Bar coordinate rule" sub-bullet under Activity timeline Gantt). The rule is stated once and declared universal across all three Gantt contexts.

---

## Change 3 — Team Activity Domain grouping: add person-inclusion predicate

- [x] **Completed**
- **Description**: Domain grouping mode currently renders a blank page. Fix: a person appears under a Domain header if they hold at least one Skill belonging to that Domain in their skill profile. People spanning multiple Domains appear under each. Utilisation bar shows total utilisation (all commitments). Domain filter in Team grouping mode must also use the same predicate to filter people.
- **Scope**: Team Activity view (View 2) — Domain grouping logic and Domain filter logic in both grouping modes.
- **Dependencies**: None.
- **Spec sections**: Section 4 View 2 (Domain grouping bullet — expanded with inclusion rule, total-utilisation rationale, empty-Domain suppression), Required features (Domain filter bullet — clarified cross-mode behaviour).
