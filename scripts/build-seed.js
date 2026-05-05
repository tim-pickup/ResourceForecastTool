/**
 * scripts/build-seed.js
 * Reads seed/master_seed.xlsx and generates src/seed/seed.json.
 * Run automatically as prebuild via package.json.
 *
 * §6.0 spec: parses structural tabs + import tabs, applies spawn rule,
 * applies status_override, adds allocations, computes demand statuses.
 */

import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

function parseBoolean(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).toLowerCase().trim();
  return s !== 'false' && s !== '0' && s !== 'no';
}

function getMonths(start, end) {
  if (!start || !end) return [];
  const months = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}

/** Read a sheet as array of row-objects using row 1 as headers. Skips blank rows. */
function readSheet(wb, name) {
  const sheet = wb.getWorksheet(name);
  if (!sheet) throw new Error(`Missing sheet: "${name}"`);

  let headers = null;
  const rows = [];

  sheet.eachRow((row, rowNum) => {
    // row.values is 1-indexed; slice(1) gives 0-indexed
    const values = row.values.slice(1);
    if (rowNum === 1) {
      headers = values.map(v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_'));
      return;
    }
    if (!headers) return;
    const obj = {};
    headers.forEach((h, i) => {
      let v = values[i] ?? null;
      if (typeof v === 'string') v = v.trim() || null;
      obj[h] = v;
    });
    // Skip fully empty rows
    if (Object.values(obj).every(v => v === null)) return;
    rows.push(obj);
  });

  return rows;
}

// ─── Counter-based IDs ────────────────────────────────────────────────────────
let counters = {};
function nextId(prefix) {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}_${String(counters[prefix]).padStart(3, '0')}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function buildSeed() {
  const xlsxPath = path.join(ROOT, 'seed', 'master_seed.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    console.error(`\nSEED BUILD ERROR: seed/master_seed.xlsx not found.\nRun the migration script first: node scripts/generate-master-xlsx.js\n`);
    process.exit(1);
  }

  console.log('build-seed: reading seed/master_seed.xlsx …');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  // ── Structural tabs ─────────────────────────────────────────────────────────

  const fnRows   = readSheet(wb, 'Functions');
  const domRows  = readSheet(wb, 'Domains');
  const sklRows  = readSheet(wb, 'Skills');
  const teamRows = readSheet(wb, 'Teams');
  const perRows  = readSheet(wb, 'People');
  const pskRows  = readSheet(wb, 'Person Skills');
  const ptRows   = readSheet(wb, 'Project Types');
  const prgRows  = readSheet(wb, 'Programmes');
  const prvRows  = readSheet(wb, 'Providers');

  // ── Import-style tabs ────────────────────────────────────────────────────────

  const projRows   = readSheet(wb, 'Projects');
  const actRows    = readSheet(wb, 'Activities');
  const intRows    = readSheet(wb, 'Internal Requirements');
  const extRows    = readSheet(wb, 'External Requirements');
  const ddRows     = readSheet(wb, 'Direct Demands');
  const allocRows  = readSheet(wb, 'Allocations');

  // ── Build structural records ─────────────────────────────────────────────────

  const functions = fnRows.map((r, i) => ({
    id: `func_${String(i + 1).padStart(3, '0')}`,
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    active: parseBoolean(r.active),
  }));
  const fnByName = new Map(functions.map(f => [f.name, f]));

  const domains = domRows.map(r => {
    const fn = fnByName.get(String(r.function_name ?? ''));
    if (!fn) throw new Error(`Domain "${r.name}": unknown function "${r.function_name}"`);
    return {
      id: `thm_${slugify(r.name)}`,
      name: String(r.name ?? ''),
      description: String(r.description ?? ''),
      functionId: fn.id,
    };
  });
  const domByName = new Map(domains.map(d => [d.name, d]));

  const skills = sklRows.map(r => {
    const dom = domByName.get(String(r.domain_name ?? ''));
    if (!dom) throw new Error(`Skill "${r.name}": unknown domain "${r.domain_name}"`);
    return {
      id: `skl_${slugify(r.domain_name)}_${slugify(r.name)}`,
      name: String(r.name ?? ''),
      domain_id: dom.id,
    };
  });
  const skillByName = new Map(skills.map(s => [s.name, s]));
  // function the skill belongs to
  const skillFnId = new Map(skills.map(s => {
    const dom = domains.find(d => d.id === s.domain_id);
    return [s.id, dom?.functionId ?? null];
  }));

  const teams = teamRows.map((r, i) => {
    const fn = fnByName.get(String(r.function_name ?? ''));
    if (!fn) throw new Error(`Team "${r.name}": unknown function "${r.function_name}"`);
    return {
      id: `team_${String(i + 1).padStart(3, '0')}`,
      name: String(r.name ?? ''),
      description: '',
      functionId: fn.id,
      type: String(r.type ?? 'Central'),
      active: parseBoolean(r.active),
    };
  });
  const teamByName = new Map(teams.map(t => [t.name, t]));

  const people = perRows.map((r, i) => {
    const team = teamByName.get(String(r.team_name ?? ''));
    if (!team) throw new Error(`Person "${r.name}": unknown team "${r.team_name}"`);
    return {
      id: `per_${String(i + 1).padStart(3, '0')}`,
      name: String(r.name ?? ''),
      teamId: team.id,
      contracted_hours_per_month: Number(r.contracted_hours) || 152,
      available_from: r.available_from ? String(r.available_from) : null,
      available_to: r.available_to ? String(r.available_to) : null,
      active: parseBoolean(r.active),
      skills: [],
      primary_domain_id: null, // not used in v1.20 store but kept for normalizeSeed compat
    };
  });
  const personByName = new Map(people.map(p => [p.name, p]));

  for (const r of pskRows) {
    const person = personByName.get(String(r.person_name ?? ''));
    if (!person) { console.warn(`  WARN: Person Skills — unknown person "${r.person_name}"`); continue; }
    const dom = domByName.get(String(r.domain_name ?? ''));
    const skill = dom
      ? skills.find(s => s.domain_id === dom.id && s.name === String(r.skill_name ?? ''))
        ?? skillByName.get(String(r.skill_name ?? ''))
      : skillByName.get(String(r.skill_name ?? ''));
    if (!skill) { console.warn(`  WARN: Person Skills — unknown skill "${r.skill_name}" for "${r.person_name}"`); continue; }
    person.skills.push({ skill_id: skill.id, level: String(r.level ?? 'Basic') });
  }

  const projectTypes = ptRows.map((r, i) => ({
    id: `pt_${slugify(r.name)}`,
    name: String(r.name ?? ''),
    display_order: Number(r.display_order ?? i),
    colour_token: String(r.colour_token ?? `colour-type-${i + 1}`),
    is_bau: r.is_bau === true || r.is_bau === 1 || String(r.is_bau).toLowerCase() === 'true',
    active: parseBoolean(r.active),
  }));
  const ptByName = new Map(projectTypes.map(pt => [pt.name, pt]));

  const programmes = prgRows.map((r, i) => ({
    id: `prg_${String(i + 1).padStart(3, '0')}`,
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    active: parseBoolean(r.active),
  }));
  const prgByName = new Map(programmes.map(p => [p.name, p]));

  const providers = prvRows.map((r, i) => ({
    id: `prv_${String(i + 1).padStart(3, '0')}`,
    name: String(r.name ?? ''),
  }));
  const prvByName = new Map(providers.map(p => [p.name, p]));

  // ── Group import-tab rows ────────────────────────────────────────────────────

  function groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
      const k = String(r[key] ?? '');
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }

  const actsByProjName  = groupBy(actRows, 'project_name');
  const intByProjAct    = new Map(); // "projName|actName" → rows
  const extByProjAct    = new Map();

  for (const r of intRows) {
    const key = `${r.project_name}|${r.activity_name}`;
    if (!intByProjAct.has(key)) intByProjAct.set(key, []);
    intByProjAct.get(key).push(r);
  }
  for (const r of extRows) {
    const key = `${r.project_name}|${r.activity_name}`;
    if (!extByProjAct.has(key)) extByProjAct.set(key, []);
    extByProjAct.get(key).push(r);
  }

  // ── Activity + requirement builders ─────────────────────────────────────────

  let actCounter = 0;
  let reqCounter = 0;
  let extCounter = 0;

  /** Build requirement rows for a (projectName, actName) using the Internal Requirements tab. */
  function buildReqs(projName, actName, startMonth, endMonth) {
    const key = `${projName}|${actName}`;
    const rows = intByProjAct.get(key) ?? [];
    const isIndef = !endMonth;
    const months = isIndef ? [] : getMonths(startMonth, endMonth);

    const result = [];
    for (const r of rows) {
      const skill = skillByName.get(String(r.skill_name ?? ''));
      if (!skill) {
        throw new Error(`Internal Requirements — project "${projName}", activity "${actName}": unknown skill "${r.skill_name}"`);
      }
      const hpm = Number(r.hours_per_month) || 0;
      const hbm = {};
      if (!isIndef) months.forEach(m => { hbm[m] = hpm; });
      reqCounter++;
      result.push({
        id: `req_${reqCounter}`,
        shape: 'skill',
        skill_id: skill.id,
        level: String(r.level ?? 'Basic'),
        hours_by_month: isIndef ? {} : hbm,
        steady_state_hours: isIndef ? hpm : null,
        notes: r.notes ? String(r.notes) : null,
        allocations: [],
      });
    }
    return result;
  }

  /**
   * Build ExternalResourceRequirement objects for a (projName, actName).
   * Returns them keyed by their function_tag so spawn can route them.
   */
  function buildExtReqsForActivity(projName, actName, actId, startMonth, endMonth) {
    const key = `${projName}|${actName}`;
    const rows = extByProjAct.get(key) ?? [];
    const isIndef = !endMonth;
    const months = isIndef ? [] : getMonths(startMonth, endMonth);

    return rows.map(r => {
      const prv = prvByName.get(String(r.provider ?? ''));
      if (!prv) console.warn(`  WARN: Ext Req — project "${projName}", activity "${actName}": unknown provider "${r.provider}"`);
      const fnTag = fnByName.get(String(r.function_tag ?? ''));
      const hpm = Number(r.hours_per_month) || 0;
      const hbm = {};
      if (!isIndef) months.forEach(m => { hbm[m] = hpm; });
      extCounter++;
      return {
        id: `ext_${extCounter}`,
        activity_id: actId,
        provider_id: prv?.id ?? '',
        role: String(r.role ?? ''),
        notes: r.notes ? String(r.notes) : null,
        function_tag: fnTag?.id ?? null,
        hours_by_month: isIndef ? {} : hbm,
        steady_state_hours: isIndef ? hpm : null,
      };
    });
  }

  /** Build one activity record (and its ext reqs separately). */
  function buildActivity(projName, actRow) {
    actCounter++;
    const actId = `phs_${actCounter}`;
    const startMonth = String(actRow.activity_start_month ?? '');
    const endMonth = actRow.activity_end_month ? String(actRow.activity_end_month) : null;
    const requirements = buildReqs(projName, actRow.activity_name, startMonth, endMonth);
    const extReqs = buildExtReqsForActivity(projName, actRow.activity_name, actId, startMonth, endMonth);
    return {
      activity: {
        id: actId,
        name: String(actRow.activity_name ?? ''),
        start_month: startMonth,
        end_month: endMonth,
        funding_source: String(actRow.funding_source ?? 'Plant/Sector Allocation'),
        funding_notes: String(actRow.funding_notes ?? ''),
        requirements,
      },
      extReqs,
    };
  }

  // ── Build projects + spawn demands ───────────────────────────────────────────

  const projects       = [];
  const demandItems    = [];
  const allExtReqs     = []; // project-level and demand-level ext reqs combined

  let projCounter = 0;
  let demandCounter = 0;

  for (const pRow of projRows) {
    const pName = String(pRow.project_name ?? '');
    const statusOverride = String(pRow.status_override ?? 'Submitted');
    const programme = prgByName.get(String(pRow.programme_name ?? ''));
    const pt = ptByName.get(String(pRow.project_type ?? ''));

    // Parse functions_required (comma-separated Function names)
    const fnReqStr = String(pRow.functions_required ?? '');
    const fnRequired = fnReqStr.split(',')
      .map(s => s.trim()).filter(Boolean)
      .map(n => fnByName.get(n)?.id).filter(Boolean);

    // Build project activities
    const projActRows = actsByProjName.get(pName) ?? [];
    const built = projActRows.map(r => buildActivity(pName, r));
    const projectActivities = built.map(b => b.activity);
    const projectExtReqs    = built.flatMap(b => b.extReqs);

    // Project-level ext reqs go directly in the global list
    allExtReqs.push(...projectExtReqs);

    // Derive functions_actually_involved
    const fnInvolvedSet = new Set();
    for (const act of projectActivities) {
      for (const req of act.requirements) {
        const fid = skillFnId.get(req.skill_id);
        if (fid) fnInvolvedSet.add(fid);
      }
    }
    const fnInvolved = [...fnInvolvedSet];

    projCounter++;
    const projectId = `prj_${String(projCounter).padStart(3, '0')}`;

    const project = {
      id: projectId,
      name: pName,
      owner: String(pRow.project_owner ?? ''),
      type: pt?.id ?? '',
      programme_id: programme?.id ?? null,
      description: String(pRow.project_description ?? ''),
      status: statusOverride,
      active: true,
      functions_required: fnRequired,
      functions_actually_involved: fnInvolved,
      created_under_function_id: fnRequired[0] ?? fnInvolved[0] ?? null,
      activities: projectActivities,
    };
    projects.push(project);

    // Spawn demands for Submitted / Approved / Allocated projects
    const shouldSpawn = ['Submitted', 'Approved', 'Allocated'].includes(statusOverride)
      && projectActivities.length > 0 && fnInvolved.length > 0;

    if (shouldSpawn) {
      for (const fnId of fnInvolved) {
        demandCounter++;
        const demandId = `dmd_${String(demandCounter).padStart(3, '0')}`;

        // Deep-copy activities keeping only this function's requirements
        const demandActivities = [];
        for (const act of projectActivities) {
          actCounter++;
          const demActId = `phs_d${actCounter}`;
          const fnReqs = act.requirements.filter(r => skillFnId.get(r.skill_id) === fnId);
          if (fnReqs.length === 0) continue;

          const demReqs = fnReqs.map(r => {
            reqCounter++;
            return { ...r, id: `req_d${reqCounter}`, allocations: [] };
          });

          // Route ext reqs tagged to this function onto this demand activity
          const demActExtReqs = projectExtReqs
            .filter(e => {
              const projAct = built.find(b => b.activity.id === e.activity_id || b.activity.name === act.name);
              return e.function_tag === fnId && projAct;
            })
            .map(e => {
              extCounter++;
              return { ...e, id: `ext_d${extCounter}`, activity_id: demActId };
            });
          allExtReqs.push(...demActExtReqs);

          demandActivities.push({
            id: demActId,
            name: act.name,
            start_month: act.start_month,
            end_month: act.end_month,
            funding_source: act.funding_source,
            funding_notes: act.funding_notes,
            requirements: demReqs,
          });
        }

        if (demandActivities.length === 0) continue; // no requirements for this function

        demandItems.push({
          id: demandId,
          name: pName, // no Function suffix (§2.2.4 Change 5)
          type: pt?.id ?? '',
          status: 'Submitted', // will be updated after allocations
          owner: String(pRow.project_owner ?? ''),
          description: '',
          function_id: fnId,
          parent_project_id: projectId,
          activities: demandActivities,
          _spawnedFrom: projectId,
          _projectStatusOverride: statusOverride,
        });
      }
    }
  }

  // ── Direct demands ───────────────────────────────────────────────────────────

  for (const dRow of ddRows) {
    const dName = String(dRow.name ?? '');
    const fn = fnByName.get(String(dRow.function_name ?? ''));
    const pt = ptByName.get(String(dRow.type ?? ''));
    const directKey = `direct:${dName}`;
    const ddActRows = actsByProjName.get(directKey) ?? [];
    const builtDd = ddActRows.map(r => buildActivity(directKey, r));
    const demandActivities = builtDd.map(b => b.activity);
    const ddExtReqs = builtDd.flatMap(b => b.extReqs);
    allExtReqs.push(...ddExtReqs);

    demandCounter++;
    demandItems.push({
      id: `dmd_d${String(demandCounter).padStart(3, '0')}`,
      name: dName,
      type: pt?.id ?? '',
      status: String(dRow.status ?? 'Draft'),
      owner: String(dRow.owner ?? ''),
      description: String(dRow.description ?? ''),
      function_id: fn?.id ?? '',
      parent_project_id: null,
      activities: demandActivities,
      _spawnedFrom: null,
      _projectStatusOverride: null,
    });
  }

  // ── Apply allocations ────────────────────────────────────────────────────────

  // Build requirement lookup: demand_name + act_name + skill_name + level → req
  // For spawned demands, demand_name = project name. Skill function disambiguates.
  function findReq(demandName, actName, skillName, level) {
    const skill = skillByName.get(String(skillName ?? ''));
    const skillFn = skill ? skillFnId.get(skill.id) : null;

    for (const demand of demandItems) {
      if (demand.name !== demandName) continue;
      if (demand.parent_project_id !== null && skillFn && demand.function_id !== skillFn) continue;
      for (const act of demand.activities) {
        if (act.name !== actName) continue;
        for (const req of act.requirements) {
          const sk = skills.find(s => s.id === req.skill_id);
          if (sk?.name === skillName && req.level === level) return { req, act };
        }
      }
    }
    return null;
  }

  let allocCounter = 0;
  const warnings = [];

  for (const aRow of allocRows) {
    const person = personByName.get(String(aRow.person_name ?? ''));
    if (!person) {
      warnings.push(`Allocation: unknown person "${aRow.person_name}"`);
      continue;
    }
    const hpm = Number(aRow.hours_per_month) || 0;
    const found = findReq(aRow.demand_name, aRow.activity_name, aRow.skill_name, aRow.level);
    if (!found) {
      warnings.push(`Allocation: cannot find req — demand "${aRow.demand_name}", activity "${aRow.activity_name}", skill "${aRow.skill_name}", level "${aRow.level}"`);
      continue;
    }
    const { req, act } = found;
    const isIndef = act.end_month === null;
    allocCounter++;

    if (isIndef) {
      req.allocations.push({
        id: `alc_${allocCounter}`,
        person_id: person.id,
        hours_by_month: {},
        steady_state_hours: hpm,
        notes: aRow.notes ? String(aRow.notes) : null,
      });
    } else {
      const months = getMonths(act.start_month, act.end_month);
      const hbm = {};
      months.forEach(m => { hbm[m] = hpm; });
      req.allocations.push({
        id: `alc_${allocCounter}`,
        person_id: person.id,
        hours_by_month: hbm,
        steady_state_hours: null,
        notes: aRow.notes ? String(aRow.notes) : null,
      });
    }
  }

  // ── Compute demand statuses ──────────────────────────────────────────────────

  function computeDemandStatus(demand) {
    if (demand.parent_project_id === null) return demand.status; // direct: explicit
    const projectOverride = demand._projectStatusOverride;
    if (!['Approved', 'Allocated'].includes(projectOverride)) return demand.status; // Submitted: keep

    let totalSlots = 0;
    let filledSlots = 0;
    let anyAlloc = false;

    for (const act of demand.activities) {
      const isIndef = act.end_month === null;
      for (const req of act.requirements) {
        if (req.allocations.length > 0) anyAlloc = true;
        if (isIndef) {
          totalSlots++;
          const target = req.steady_state_hours ?? 0;
          const alloc = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0);
          if (alloc >= target) filledSlots++;
        } else {
          const months = getMonths(act.start_month, act.end_month);
          for (const m of months) {
            totalSlots++;
            const target = req.hours_by_month[m] ?? 0;
            const alloc = req.allocations.reduce((s, a) => s + (a.hours_by_month?.[m] ?? 0), 0);
            if (alloc >= target) filledSlots++;
          }
        }
      }
    }

    if (totalSlots > 0 && filledSlots === totalSlots && anyAlloc) return 'Allocated';
    if (anyAlloc) return 'PartiallyAllocated';
    return 'Approved'; // advanced project but no allocations yet
  }

  for (const demand of demandItems) {
    demand.status = computeDemandStatus(demand);
    delete demand._spawnedFrom;
    delete demand._projectStatusOverride;
  }

  // ── Assemble seed ────────────────────────────────────────────────────────────

  const seed = {
    _meta: {
      version: '1.20',
      description: 'Generated from seed/master_seed.xlsx — do not edit by hand',
      generated_at: new Date().toISOString(),
    },
    functions,
    teams,
    domains,
    skills,
    people,
    programmes,
    project_types: projectTypes,
    providers,
    projects,
    demand_items: demandItems,
    external_resource_requirements: allExtReqs,
    project_team_assignments: [],
  };

  // Write output
  const outDir = path.join(ROOT, 'src', 'seed');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'seed.json');
  fs.writeFileSync(outPath, JSON.stringify(seed, null, 2), 'utf8');

  // Summary
  console.log(`build-seed: ✓ wrote src/seed/seed.json`);
  console.log(`  Functions: ${functions.length}  Teams: ${teams.length}  People: ${people.length}`);
  console.log(`  Projects: ${projects.length}  Demands: ${demandItems.length}`);
  console.log(`  Ext reqs: ${allExtReqs.length}  Allocations: ${allocCounter}`);
  if (warnings.length) {
    console.log(`  Warnings (${warnings.length}):`);
    warnings.forEach(w => console.log(`    • ${w}`));
  }

  // Write build report
  const reportPath = path.join(ROOT, 'dist');
  fs.mkdirSync(reportPath, { recursive: true });
  const report = [
    `Seed build report — ${new Date().toISOString()}`,
    `Parsed: seed/master_seed.xlsx`,
    `Output: src/seed/seed.json`,
    `Functions: ${functions.length}, Teams: ${teams.length}, People: ${people.length}`,
    `Projects: ${projects.length}, Demands: ${demandItems.length}`,
    `External reqs: ${allExtReqs.length}, Allocations: ${allocCounter}`,
    warnings.length ? `\nWarnings:\n${warnings.map(w => '  ' + w).join('\n')}` : '\nNo warnings.',
  ].join('\n');
  fs.writeFileSync(path.join(reportPath, 'seed-build-report.txt'), report, 'utf8');
}

buildSeed().catch(e => {
  console.error('\nSEED BUILD FAILED:', e.message);
  if (process.env.SEED_DEBUG) console.error(e.stack);
  process.exit(1);
});
