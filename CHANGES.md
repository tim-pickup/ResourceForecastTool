# v1.17 — Implementation tracker

This file tracks the changes introduced in REQUIREMENTS.md v1.17. Each section below corresponds to one logical change. Read REQUIREMENTS.md for full implementation detail at the section pointers given. Tick a checkbox when the change is shipped and verified against the live app.

Order matters: changes are listed in dependency order. Earlier items have no dependencies on later items; later items may depend on earlier ones (call-outs noted per change).

---

## Change 1 — Capacity page: rename "Overall Team Capacity" → "Overall Function Capacity"

- [x] **Description**: Rename the Section A heading on the Capacity Validation page from "Overall Team Capacity" to "Overall Function Capacity". Confirm the chart (capacity line, demand stack, over-capacity treatment) re-renders correctly when the active Function is switched.
- **Scope**: Capacity Validation page (View 1, Section A) only. No data model or aggregation change.
- **Dependencies**: None. Standalone label fix.
- **Read**: REQUIREMENTS.md § 4 View 1 — "Page structure", item 1 (Section A).

---

## Change 2 — Demand workflow tidy: Draft scope, Teams Assigned redesign, Model Capacity rename

- [ ] **Description**: Tighten the Demand state machine UI so each working stage has a single dominant purpose. **Draft** captures metadata, phases, and per-phase Teams Assigned only — skill-shaped and external requirement UIs are hidden. The **Teams Assigned picker** is redesigned (searchable picker + assigned list below, with Function-coloured indicators) and is now visible from Draft onwards rather than Scoping onwards. **Submit for Scoping** becomes a pure status flip (no team-assignment dialog) and is disabled until phases and at least one team per phase exist. **Scoping** is where skill and hours data is entered. **Submitted** is read-only with primary actions Approve and Model Capacity (renamed from Model Impact). **Allocated** has an empty footer (already the case in v1.16; no change needed but verify). The "Model Impact" → "Model Capacity" rename touches drawer footer, edit page header, deep-link logic, navigational button taxonomy, and the Scoping → Submitted post-confirm note.
- **Scope**: Sections 3 (workflow narrative + Scoping detail + transition table + state machine), 4.5.1 (drawer — footer table, footer rationale, body zone, behaviour bullet), 4.5.2 (Mode A status-aware visibility + Teams Assigned picker subsection + Internal/External requirements list status-aware visibility + actions list), 11.11 (Model Capacity deep-link rename), 11.16 (navigational buttons rename), 11.18 (post-submit note).
- **Dependencies**: Change 4 (new section 4.10 references Model Capacity in some chart-context language; the rename must be consistent across both files in the same release).
- **Read**: REQUIREMENTS.md § 3 ("Demand workflow narrative" subsection — added in v1.17 — and "Scoping workflow — detailed reference"), § 4.5.1 ("Footer buttons by status" + "Body zone" item 3), § 4.5.2 (Mode A intro listing status-aware behaviour, "Teams Assigned picker" subsection, requirements list bullets, Actions bullet), § 11.11, § 11.16, § 11.18.

---

## Change 3 — Drawer body: remove duplicate Programme > Project label

- [ ] **Description**: Remove the Project alignment block from the drawer body zone. The header zone already shows "Programme › Project" (or "Unaligned — Not Associated To A Project"); the body's repeat of the same affordance is the duplicate at the XPath the user flagged. Re-alignment of a Demand to a different Project moves to the Edit page only (Mode A's Project alignment field, which already exists). Update the drawer's "Read-only apart from..." caveat to reflect that the drawer is now fully read-only apart from action buttons.
- **Scope**: Section 4.5.1 (body zone bullet list, behaviour bullet).
- **Dependencies**: None. Pure removal.
- **Read**: REQUIREMENTS.md § 4.5.1 — "Body zone" (item 3) and the "Behaviour" bullet list at end of 4.5.1.

---

## Change 4 — New Programmes/Projects "Demand" view + Manage Demand rename + navigation reorder

- [ ] **Description**: Three coupled deliverables. (a) **Rename** the existing "Demand" page → "Manage Demand" (nav link, page heading, section 4.6 heading). (b) **Add a new "Demand" view** at section 4.10: a two-level Programme-shape view answering "how much demand does each Programme create over time, and where does it land?". The landing page lists every active Programme as a card with a stacked-area chart; clicking a Programme drills into a Project-level page with one chart per Project plus a Programme-total chart at the top. Each chart can be stacked **By Funding Source** (default) or **By Team** (one stack per Team across all Functions plus Provider stacks under a virtual "External" Function). A toolbar toggle "Include Submitted" overlays Submitted Demand on top of the Approved-onwards baseline (default OFF). The view ignores the active Function lens by design — it shows all Functions plus External together. Segment-clicks open a side panel listing contributing Demand items, which can drill to the Demand drawer. (c) **Update navigation order** to: Capacity Validation, Demand (new), Team Activity, Manage Demand, Forecast, Skills Development, Archive, Admin. (d) **Add four new aggregation functions** in section 2.4.9: `programme_demand_by_funding`, `programme_demand_by_team`, `project_demand_by_funding`, `project_demand_by_team` — these are the only place these calculations are computed; no view performs its own summation.
- **Scope**: Sections 2.4.9 (new aggregation functions), 4.6 (heading rename only — content unchanged), 4.9 (nav order in selector context note), 4.10 (entire new section), 6 (new seed renderability invariants — verify the existing cross-Function seed Demand is enough; flag if seed needs additional Programme/Project demand to demonstrate the chart variations), 11.17 (lens exception note), 11.19 (new section — navigation order and rename).
- **Dependencies**: Change 2 (Model Capacity rename — must be consistent if any Demand-view drill-down uses the new label; the spec already does). Change 3 has no dependency relationship — it can ship in either order.
- **Read**: REQUIREMENTS.md § 2.4.9 ("Functions added in v1.17 — for the new Demand view"), § 4.6 (heading + opening note), § 4.10 (full new section, especially 4.10.1 landing, 4.10.2 drill-down, 4.10.3 chart spec, 4.10.6 aggregation reference), § 6 ("Seed assertions" — Demand view renderability invariant), § 11.17 ("Exception — the Demand view ignores the Function lens"), § 11.19 (full new section — navigation order and rename, including the routing implementation note).

---

## Change ordering and sequencing notes

- Changes 1 and 3 are standalone label/structure cleanups and can be picked up in any order at the start of the work.
- Change 2 (the Demand workflow tidy) is the largest behavioural change and touches Mode A heavily. The Teams Assigned picker redesign is the most user-visible part — get the picker pattern right early so it can be reused if Mode B's read-only summary needs it.
- Change 4 should come last because it adds a new view and depends on the v1.17 aggregation function additions being in place. The new view has no allocation logic — it reads existing Demands, Phases, Requirements, and Providers and computes new decompositions over them.

After all four changes are shipped and ticked, run the seed renderability assertions in § 6 and confirm:
1. Capacity page Section A heading reads "Overall Function Capacity" and re-renders on Function switch.
2. Creating a new Demand opens in Draft with no skill/hours UI; adding a phase and a team enables Submit for Scoping.
3. Drawer body shows Programme › Project once (header only).
4. Demand view renders Programme cards with stacked charts; both stacking modes work; Include Submitted toggle works.
5. Manage Demand link reaches the previous Demand-discovery page; navigation order matches § 11.19.
