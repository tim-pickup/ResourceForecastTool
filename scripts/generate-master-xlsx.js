/**
 * scripts/generate-master-xlsx.js
 * ONE-TIME migration: converts DEMOSEED.json → seed/master_seed.xlsx
 *
 * Run once: node scripts/generate-master-xlsx.js
 * After running, commit seed/master_seed.xlsx.
 * Future seed changes go directly in the workbook; this script is for reference only.
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

async function main() {
  const seedPath = path.join(ROOT, 'DEMOSEED.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  // ── Lookup maps ────────────────────────────────────────────────────────────

  const fnById   = new Map(seed.functions.map(f => [f.id, f]));
  const domById  = new Map(seed.domains.map(d => [d.id, d]));
  const sklById  = new Map(seed.skills.map(s => [s.id, s]));
  const teamById = new Map(seed.teams.map(t => [t.id, t]));
  const prvById  = new Map(seed.providers.map(p => [p.id, p]));
  const ptById   = new Map(seed.project_types.map(pt => [pt.id, pt]));
  const prgById  = new Map(seed.programmes.map(p => [p.id, p]));
  const perById  = new Map(seed.people.map(p => [p.id, p]));

  // Which activities belong to projects vs demands
  // For the Excel: project activities go under project_name; direct demand activities under "direct:<name>"
  // Spawned demand activities are re-derived at build time via spawn rule — not written to the activities tab

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ResourceForecastTool seed migration';

  // ── Helper: write a sheet with headers + rows ────────────────────────────────

  function addSheet(name, headers, rows, hidden = false) {
    const ws = wb.addWorksheet(name, { state: hidden ? 'hidden' : 'visible' });
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    for (const row of rows) {
      ws.addRow(row);
    }
    // Auto-width approximate
    headers.forEach((h, i) => {
      const col = ws.getColumn(i + 1);
      const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length));
      col.width = Math.min(50, Math.max(12, maxLen + 2));
    });
    return ws;
  }

  // ── 1. Projects ─────────────────────────────────────────────────────────────

  // The import-workbook Projects tab (with extra status_override column for seed)
  const projectRows = seed.projects.map(p => [
    p.name,
    p.programme_id ? prgById.get(p.programme_id)?.name ?? '' : '',
    ptById.get(p.type)?.name ?? '',
    p.owner,
    p.description,
    p.functions_required.map(id => fnById.get(id)?.name ?? id).join(', '),
    p.status, // status_override
  ]);

  addSheet('Projects', [
    'project_name', 'programme_name', 'project_type', 'project_owner',
    'project_description', 'functions_required', 'status_override',
  ], projectRows);

  // ── 2. Activities ────────────────────────────────────────────────────────────

  // Build map: project_id → spawned demands (for filling in missing project activities)
  const spawnedByProject = new Map();
  for (const d of seed.demand_items) {
    if (!d.parent_project_id) continue;
    if (!spawnedByProject.has(d.parent_project_id)) spawnedByProject.set(d.parent_project_id, []);
    spawnedByProject.get(d.parent_project_id).push(d);
  }

  // Project activities — for projects with empty activities, use the first spawned demand's activities
  const activityRows = [];

  for (const p of seed.projects) {
    let activities = p.activities;
    if (activities.length === 0) {
      // Fill from spawned demands (merge unique activity names)
      const spawned = spawnedByProject.get(p.id) ?? [];
      const seen = new Set();
      activities = [];
      for (const d of spawned) {
        for (const act of d.activities) {
          if (!seen.has(act.name)) {
            seen.add(act.name);
            activities.push(act);
          }
        }
      }
    }
    for (const act of activities) {
      activityRows.push([
        p.name,
        act.name,
        act.start_month,
        act.end_month ?? '',
        act.funding_source,
        act.funding_notes,
      ]);
    }
  }

  // Direct demand activities (under "direct:<name>")
  const directDemands = seed.demand_items.filter(d => d.parent_project_id === null);
  for (const d of directDemands) {
    for (const act of d.activities) {
      activityRows.push([
        `direct:${d.name}`,
        act.name,
        act.start_month,
        act.end_month ?? '',
        act.funding_source,
        act.funding_notes,
      ]);
    }
  }

  addSheet('Activities', [
    'project_name', 'activity_name', 'activity_start_month', 'activity_end_month',
    'funding_source', 'funding_notes',
  ], activityRows);

  // ── 3. Internal Requirements ─────────────────────────────────────────────────

  // Project-level requirements only (spawned demands are derived at build time)
  // For Draft/Scoping projects: include their requirements
  // For Submitted+: include project-level requirements (the frozen record)
  // We also include Direct demand requirements under "direct:<name>"

  const intReqRows = [];

  function addReqsForActivities(projOrDemandName, activities) {
    for (const act of activities) {
      for (const req of act.requirements) {
        const skill = sklById.get(req.skill_id);
        const dom   = skill ? domById.get(skill.domain_id) : null;
        const fn    = dom ? fnById.get(dom.functionId) : null;
        if (!skill) continue;

        // hours_per_month: use the first month's value (seed uses uniform hours)
        let hpm = 0;
        if (req.steady_state_hours !== null && req.steady_state_hours !== undefined) {
          hpm = req.steady_state_hours;
        } else {
          const vals = Object.values(req.hours_by_month ?? {});
          hpm = vals.length > 0 ? vals[0] : 0;
        }

        intReqRows.push([
          projOrDemandName,
          act.name,
          fn?.name ?? '',
          dom?.name ?? '',
          skill?.name ?? '',
          req.level,
          hpm,
          req.notes ?? '',
        ]);
      }
    }
  }

  // Project requirements
  for (const p of seed.projects) {
    let activities = p.activities;
    if (activities.length === 0) {
      // Use spawned demand activities (merge unique by name, union of requirements)
      const spawned = spawnedByProject.get(p.id) ?? [];
      const seen = new Set();
      const merged = [];
      for (const d of spawned) {
        for (const act of d.activities) {
          if (!seen.has(act.name)) {
            seen.add(act.name);
            // Collect all requirements across all spawned demands for this activity
            const allReqs = [];
            for (const d2 of spawned) {
              const matchAct = d2.activities.find(a => a.name === act.name);
              if (matchAct) allReqs.push(...matchAct.requirements);
            }
            merged.push({ ...act, requirements: allReqs });
          }
        }
      }
      activities = merged;
    }
    addReqsForActivities(p.name, activities);
  }

  // Direct demand requirements
  for (const d of directDemands) {
    addReqsForActivities(`direct:${d.name}`, d.activities);
  }

  addSheet('Internal Requirements', [
    'project_name', 'activity_name', 'skill_function', 'skill_domain', 'skill_name',
    'level', 'hours_per_month', 'notes',
  ], intReqRows);

  // ── 4. External Requirements ─────────────────────────────────────────────────

  // Build a map: activity_id → parent name (project or direct demand prefix)
  const actParentName = new Map();
  for (const p of seed.projects) {
    for (const act of p.activities) actParentName.set(act.id, p.name);
  }
  for (const d of directDemands) {
    for (const act of d.activities) actParentName.set(act.id, `direct:${d.name}`);
  }

  // Activity id → activity record (to get name)
  const actById = new Map();
  for (const p of seed.projects) for (const act of p.activities) actById.set(act.id, act);
  for (const d of seed.demand_items) for (const act of d.activities) actById.set(act.id, act);

  const extReqRows = [];
  for (const ext of seed.external_resource_requirements) {
    const parentName = actParentName.get(ext.activity_id);
    if (!parentName) continue; // demand-level ext req — skip (derived from project ext reqs at build)

    const act = actById.get(ext.activity_id);
    if (!act) continue;

    const prv = prvById.get(ext.provider_id);
    const fnTag = fnById.get(ext.function_tag);

    let hpm = 0;
    if (ext.steady_state_hours !== null && ext.steady_state_hours !== undefined) {
      hpm = ext.steady_state_hours;
    } else {
      const vals = Object.values(ext.hours_by_month ?? {});
      hpm = vals.length > 0 ? vals[0] : 0;
    }

    extReqRows.push([
      parentName,
      act.name,
      prv?.name ?? '',
      ext.role,
      fnTag?.name ?? '',
      hpm,
      ext.notes ?? '',
    ]);
  }

  addSheet('External Requirements', [
    'project_name', 'activity_name', 'provider', 'role', 'function_tag',
    'hours_per_month', 'notes',
  ], extReqRows);

  // ── 5–8. Reference tabs ──────────────────────────────────────────────────────

  addSheet('Reference - Programmes',
    ['Name', 'Description'],
    seed.programmes.filter(p => p.active).map(p => [p.name, p.description])
  );

  const sklRefRows = [];
  for (const s of seed.skills) {
    const dom = domById.get(s.domain_id);
    const fn  = dom ? fnById.get(dom.functionId) : null;
    sklRefRows.push([fn?.name ?? '', dom?.name ?? '', s.name]);
  }
  addSheet('Reference - Skills', ['Function', 'Domain', 'Skill Name'], sklRefRows);

  addSheet('Reference - Providers',
    ['Provider Name'],
    seed.providers.map(p => [p.name])
  );

  addSheet('Reference - Project Types',
    ['Project Type Name'],
    seed.project_types.filter(pt => pt.active)
      .sort((a, b) => a.display_order - b.display_order)
      .map(pt => [pt.name])
  );

  // ── 9. _lists (hidden) ───────────────────────────────────────────────────────

  addSheet('_lists',
    ['funding_source', 'level'],
    [
      ['Investment Scheme', 'Basic'],
      ['Plant/Sector Allocation', 'Advanced'],
      ['Mixed', 'Specialist'],
    ],
    true // hidden
  );

  // ── 10. Functions ────────────────────────────────────────────────────────────

  addSheet('Functions',
    ['name', 'description', 'active'],
    seed.functions.map(f => [f.name, f.description, f.active ? 'true' : 'false'])
  );

  // ── 11. Domains ──────────────────────────────────────────────────────────────

  addSheet('Domains',
    ['function_name', 'name', 'description'],
    seed.domains.map(d => [fnById.get(d.functionId)?.name ?? '', d.name, d.description])
  );

  // ── 12. Skills ───────────────────────────────────────────────────────────────

  addSheet('Skills',
    ['function_name', 'domain_name', 'name'],
    seed.skills.map(s => {
      const dom = domById.get(s.domain_id);
      const fn  = dom ? fnById.get(dom.functionId) : null;
      return [fn?.name ?? '', dom?.name ?? '', s.name];
    })
  );

  // ── 13. Teams ────────────────────────────────────────────────────────────────

  addSheet('Teams',
    ['function_name', 'name', 'type', 'active'],
    seed.teams.map(t => [fnById.get(t.functionId)?.name ?? '', t.name, t.type, t.active ? 'true' : 'false'])
  );

  // ── 14. People ───────────────────────────────────────────────────────────────

  addSheet('People',
    ['name', 'team_name', 'contracted_hours', 'available_from', 'available_to', 'active'],
    seed.people.map(p => [
      p.name,
      teamById.get(p.teamId)?.name ?? '',
      p.contracted_hours_per_month,
      p.available_from ?? '',
      p.available_to ?? '',
      p.active !== false ? 'true' : 'false',
    ])
  );

  // ── 15. Person Skills ────────────────────────────────────────────────────────

  const pskRows = [];
  for (const p of seed.people) {
    for (const sk of p.skills ?? []) {
      const skill = sklById.get(sk.skill_id);
      const dom   = skill ? domById.get(skill.domain_id) : null;
      const fn    = dom ? fnById.get(dom.functionId) : null;
      pskRows.push([p.name, fn?.name ?? '', dom?.name ?? '', skill?.name ?? '', sk.level]);
    }
  }
  addSheet('Person Skills',
    ['person_name', 'function_name', 'domain_name', 'skill_name', 'level'],
    pskRows
  );

  // ── 16. Project Types ────────────────────────────────────────────────────────

  addSheet('Project Types',
    ['name', 'display_order', 'colour_token', 'is_bau', 'active'],
    seed.project_types.map(pt => [
      pt.name, pt.display_order, pt.colour_token,
      pt.is_bau ? 'true' : 'false',
      pt.active !== false ? 'true' : 'false',
    ])
  );

  // ── 17. Programmes ───────────────────────────────────────────────────────────

  addSheet('Programmes',
    ['name', 'description', 'active'],
    seed.programmes.map(p => [p.name, p.description, p.active ? 'true' : 'false'])
  );

  // ── 18. Providers ────────────────────────────────────────────────────────────

  addSheet('Providers', ['name'], seed.providers.map(p => [p.name]));

  // ── 19. Direct Demands ───────────────────────────────────────────────────────

  addSheet('Direct Demands',
    ['name', 'function_name', 'type', 'owner', 'description', 'status'],
    directDemands.map(d => [
      d.name,
      fnById.get(d.function_id)?.name ?? '',
      ptById.get(d.type)?.name ?? '',
      d.owner,
      d.description,
      d.status,
    ])
  );

  // ── 20. Allocations ──────────────────────────────────────────────────────────

  // Flatten allocations from ALL demand items (spawned and direct)
  // demand_name = demand.name (for spawned this = project name; skill disambiguates function)
  const allocRows = [];

  for (const d of seed.demand_items) {
    for (const act of d.activities) {
      for (const req of act.requirements) {
        const skill = sklById.get(req.skill_id);
        for (const alloc of req.allocations ?? []) {
          const person = perById.get(alloc.person_id);
          if (!person || !skill) continue;

          let hpm = 0;
          if (alloc.steady_state_hours !== null && alloc.steady_state_hours !== undefined) {
            hpm = alloc.steady_state_hours;
          } else {
            const vals = Object.values(alloc.hours_by_month ?? {});
            hpm = vals.length > 0 ? vals[0] : 0;
          }

          allocRows.push([
            d.name,   // demand_name (= project name for spawned; demand name for direct)
            act.name,
            skill.name,
            req.level,
            person.name,
            hpm,
            alloc.notes ?? '',
          ]);
        }
      }
    }
  }

  addSheet('Allocations',
    ['demand_name', 'activity_name', 'skill_name', 'level', 'person_name', 'hours_per_month', 'notes'],
    allocRows
  );

  // ── Save ─────────────────────────────────────────────────────────────────────

  const outPath = path.join(ROOT, 'seed', 'master_seed.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`✓ Written seed/master_seed.xlsx`);
  console.log(`  Tabs: Projects(${projectRows.length}) Activities(${activityRows.length}) IntReqs(${intReqRows.length}) ExtReqs(${extReqRows.length})`);
  console.log(`  Allocations: ${allocRows.length}`);
}

main().catch(e => { console.error('MIGRATION FAILED:', e.message); console.error(e.stack); process.exit(1); });
