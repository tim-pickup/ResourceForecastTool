/**
 * Dev-mode renderability invariant assertions — §2.4.8 / §6
 *
 * Run on app startup in development to verify that the aggregation layer
 * produces the non-zero outputs the spec promises for the v1.18 seed fixture.
 * Failures indicate a stubbed or broken aggregation function, not a data
 * problem.
 *
 * Assertions are against a normalised copy of the seed, independent of
 * localStorage state, so they reflect the canonical seed fixture.
 */

import type { AppState, DemandItem, DemandStatus, ProjectStatus, ProjectType } from '../types'
import {
  computeProjection,
  projected_consumption,
  grey_band,
  demand_hours_for,
  project_internal_hours,
  project_external_hours,
  project_external_hours_by_provider,
  crossFunctionDemandHours,
  function_capacity,
  domain_capacity,
  person_capacity,
  programme_demand_by_funding,
  direct_demand_by_funding,
} from './capacity'
import { generateMonths, getCurrentMonth } from '../utils/capacity'
import seedRaw from '../../DEMOSEED.json'

// ─── Normalise raw seed (mirrors useAppStore.normalizeSeed) ──────────────────

function buildSeedState(): AppState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = seedRaw as Record<string, any>
  const items: Record<string, unknown>[] = raw.demand_items || []
  return {
    activeFunctionId: (() => {
      const fns = (raw.functions || []).filter((f: Record<string, unknown>) => f.active)
      fns.sort((a: Record<string, unknown>, b: Record<string, unknown>) => (a.name as string).localeCompare(b.name as string))
      return (fns[0]?.id ?? null) as string | null
    })(),
    functions: raw.functions || [],
    teams: raw.teams || [],
    projectTypes: (raw.project_types || []) as ProjectType[],
    domains: raw.domains || [],
    skills: raw.skills || [],
    people: (raw.people || []).map((p: Record<string, unknown>) => ({ ...p, teamId: (p.teamId ?? '') as string })),
    programmes: raw.programmes || [],
    projects: (raw.projects || []).map((p: Record<string, unknown>) => ({
      ...p,
      owner: (p.owner ?? '') as string,
      type: (p.type ?? 'pt_group_strategy_project') as string,
      programme_id: (p.programme_id ?? null) as string | null,
      status: (p.status ?? 'Draft') as ProjectStatus,
      activities: (p.activities ?? []) as [],
      active: (p.active ?? true) as boolean,
      functions_required: (p.functions_required ?? []) as string[],
      functions_actually_involved: (p.functions_actually_involved ?? []) as string[],
      created_under_function_id: (p.created_under_function_id ?? null) as string | null,
    })),
    providers: raw.providers || [],
    externalResourceRequirements: (raw.external_resource_requirements || []).map((e: Record<string, unknown>) => ({
      ...e,
      notes: (e.notes ?? null) as string | null,
      hours_by_month: (e.hours_by_month ?? {}) as Record<string, number>,
      steady_state_hours: (e.steady_state_hours ?? null) as number | null,
      function_tag: (e.function_tag ?? null) as string | null,
    })),
    demandItems: items.map((d): DemandItem => ({
      id: d.id as string,
      name: d.name as string,
      type: d.type as string,
      status: (['Parked', 'Closed', 'Scoping'].includes(d.status as string) ? 'Draft' : d.status === 'Accepted' ? 'Approved' : d.status) as DemandStatus,
      owner: d.owner as string,
      description: d.description as string,
      function_id: (d.function_id ?? d.createdUnderFunctionId ?? '') as string,
      parent_project_id: (d.parent_project_id ?? d.project_id ?? null) as string | null,
      activities: ((d.activities || []) as Record<string, unknown>[]).map(p => ({
        id: p.id as string,
        name: p.name as string,
        start_month: p.start_month as string,
        end_month: (p.end_month ?? null) as string | null,
        funding_source: p.funding_source as DemandItem['activities'][0]['funding_source'],
        funding_notes: (p.funding_notes ?? '') as string,
        requirements: ((p.requirements || []) as Record<string, unknown>[]).map(r => ({
          id: r.id as string,
          shape: 'skill' as const,
          skill_id: r.skill_id as string,
          level: r.level as DemandItem['activities'][0]['requirements'][0]['level'],
          hours_by_month: (r.hours_by_month ?? {}) as Record<string, number>,
          steady_state_hours: (r.steady_state_hours ?? null) as number | null,
          notes: (r.notes ?? null) as string | null,
          allocations: ((r.allocations ?? []) as Record<string, unknown>[]).map(a => ({
            id: a.id as string,
            person_id: a.person_id as string,
            hours_by_month: (a.hours_by_month ?? {}) as Record<string, number>,
            steady_state_hours: (a.steady_state_hours ?? null) as number | null,
            notes: (a.notes ?? null) as string | null,
          })),
        })),
      })),
    })),
  }
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

function assert(label: string, value: number, comparator: '>' | '==', expected: number): boolean {
  const pass = comparator === '>' ? value > expected : Math.abs(value - expected) <= 0.01
  if (!pass) {
    console.error(`[SeedAssertion FAIL] ${label}: got ${value.toFixed(2)}, expected ${comparator} ${expected}`)
  }
  return pass
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function runSeedAssertions(): void {
  const state = buildSeedState()
  const months = generateMonths(getCurrentMonth(), 18)

  // ── No-overlay projection ────────────────────────────────────────────────
  const projNoOverlay = computeProjection(state, months)

  // dmd_p4_dm "Plant C MES Platform Migration — DM" is PartiallyAllocated.
  // Its Activity 2 has 40 hrs/mo of skl_mom_workflow (Advanced) that is UNALLOCATED.
  // Alex Morgan (per_001) holds both skl_mom_mes AND skl_mom_workflow — the
  // Workflow projection consumes his headroom and appears as a grey band on the
  // MES chart (other-skill demand projecting onto MES pool members).
  const bandMomMes = grey_band(
    { type: 'skill', id: 'skl_mom_mes' },
    '2026-08',
    state,
    projNoOverlay
  )
  assert('grey_band(skl_mom_mes, 2026-08) — unallocated Workflow demand', bandMomMes, '>', 0)

  // Alex Morgan (per_001) is the MES Specialist; unallocated Workflow demand
  // projects onto him in 2026-08, consuming headroom.
  const alexProj = projected_consumption('per_001', '2026-08', projNoOverlay)
  assert('projected_consumption(per_001, 2026-08)', alexProj, '>', 0)

  // dmd_d5 "Plant A OEE enhancement" is Approved (no allocs). It has 40 hrs/mo
  // of skl_miv_analytics (Advanced) in 2026-09 and 2026-10. James Whitfield
  // (per_005) and Fatima Al-Rashid (per_006) hold Analytics; both also hold
  // Integration — so Analytics projection produces a grey band on the
  // Integration chart (activity-level requirement).
  const bandIntSep = grey_band(
    { type: 'skill', id: 'skl_miv_integration' },
    '2026-09',
    state,
    projNoOverlay
  )
  assert('grey_band(skl_miv_integration, 2026-09) — Analytics demand cross-skill', bandIntSep, '>', 0)

  // ── Corporate Data Lake DM overlay (dmd_p3_dm) ───────────────────────────
  // dmd_p3_dm "Corporate Data Lake — Digital Manufacturing" is Submitted.
  const overlayId = 'dmd_p3_dm'
  const overlayItem = state.demandItems.find(d => d.id === overlayId)
  if (!overlayItem) {
    console.error('[SeedAssertion FAIL] dmd_p3_dm not found in seed — Corporate Data Lake DM item missing')
    return
  }

  // ── Invariant A — Submitted overlay === Approved-unallocated ────────────
  // The overlay item treated as Submitted vs hypothetically promoted to Approved
  // with no allocations must produce identical demand numbers.
  const COMMITTED_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])
  const EMPTY = new Set<DemandStatus>()
  const fakeState: AppState = {
    ...state,
    demandItems: state.demandItems.map(d =>
      d.id === overlayId
        ? {
            ...d,
            status: 'Approved' as DemandStatus,
            activities: d.activities.map(ac => ({
              ...ac,
              requirements: ac.requirements.map(r => ({ ...r, allocations: [] })),
            })),
          }
        : d
    ),
  }
  let invariantAOk = true
  for (const domain of state.domains) {
    for (const month of ['2026-08', '2026-09']) {
      const withOv = demand_hours_for({ type: 'domain', id: domain.id }, EMPTY, month, state, overlayId)
      const withPr = demand_hours_for({ type: 'domain', id: domain.id }, COMMITTED_STATUSES, month, fakeState)
      const ovTotal = withOv.strategy + withOv.plant + withOv.npd + withOv.bau
      const prTotal = withPr.strategy + withPr.plant + withPr.npd + withPr.bau
      if (Math.abs(ovTotal - prTotal) > 0.01) {
        console.error(
          `[SeedAssertion FAIL] Invariant A: domain ${domain.name} ${month} — overlay(${ovTotal.toFixed(1)}) ≠ promoted(${prTotal.toFixed(1)})`
        )
        invariantAOk = false
      }
    }
  }

  // ── §2.4.9 Project roll-up assertions ────────────────────────────────────
  // prj_004 "Plant C MES Platform Migration" has dmd_p4_dm (PartiallyAllocated)
  // and dmd_p4_git (Approved) with internal requirements active in 2026-08,
  // plus ext_p4_oem (OEM 40h/mo) and ext_p4_ms (Managed Services 120h/mo)
  // on the Build phase.

  const plantCProjectId = 'prj_004'

  const projInternal = project_internal_hours(plantCProjectId, '2026-08', state)
  assert('project_internal_hours(prj_004, 2026-08)', projInternal, '>', 0)

  const projExternal = project_external_hours(plantCProjectId, '2026-08', state)
  assert('project_external_hours(prj_004, 2026-08)', projExternal, '>', 0)

  const providerBreakdown = project_external_hours_by_provider(plantCProjectId, '2026-08', state)
  const providerCount = Object.keys(providerBreakdown).length
  if (providerCount < 2) {
    console.error(
      `[SeedAssertion FAIL] project_external_hours_by_provider(prj_004, 2026-08) has ${providerCount} provider(s), expected >= 2 (OEM + Managed Services)`
    )
  }

  // ── §4 Section D — crossFunctionDemandHours renderability invariant ────────
  // With Digital Manufacturing (func_001) active, prj_004 has a DM Demand
  // (dmd_p4_dm, PartiallyAllocated) → qualifies as shared Project.
  // dmd_p4_git (func_002, Approved) has Data Engineering + Integration
  // Architecture requirements in phs_p4git_build (2026-08 to 2026-10).
  const dmFunctionId = 'func_001'
  const groupItFunctionId = 'func_002'
  let cfNonZero = false
  for (const m of months) {
    const cf = crossFunctionDemandHours(dmFunctionId, m, { by: 'function' }, state)
    if ((cf[groupItFunctionId] ?? 0) > 0) { cfNonZero = true; break }
  }
  if (!cfNonZero) {
    console.error(
      '[SeedAssertion FAIL] crossFunctionDemandHours(func_001, *, {by:function}) returned zero for func_002 across all months — ' +
      'seed is missing a cross-Function demand or the function has a bug'
    )
  }

  const existingOk =
    bandMomMes > 0 &&
    alexProj > 0 &&
    bandIntSep > 0 &&
    invariantAOk &&
    projInternal > 0 &&
    projExternal > 0 &&
    providerCount >= 2 &&
    cfNonZero
  if (existingOk) {
    console.info('[SeedAssertions] §2.4.8 + §2.4.9 grey-band/projection/roll-up invariants passed ✓')
  }

  // ── §2.4.8 Capacity reconciliation invariants (v1.18) ───────────────────
  // v1.18 seed: DM function_capacity(2026-08) = 1534h, GroupIT = 882h.
  // Data & Integration domain: 152h in Jul-2026 (Anya only, Henrik not yet
  // available), 304h in Aug-2026 (Anya + Henrik both active, no commitments).

  const dmFnId = 'func_001'
  const gitFnId = 'func_002'
  const capacityTestMonths = ['2026-07', '2026-08']

  // 1. function_capacity consistency: must equal sum of person_capacity.
  let capacityConsistencyOk = true
  for (const fnId of [dmFnId, gitFnId]) {
    const fnName = state.functions.find(f => f.id === fnId)?.name ?? fnId
    const fnTeamIds = new Set(state.teams.filter(t => t.functionId === fnId).map(t => t.id))
    for (const month of capacityTestMonths) {
      const actual = function_capacity(fnId, month, state)
      const expected = state.people
        .filter(p => p.active && fnTeamIds.has(p.teamId))
        .reduce((s, p) => s + person_capacity(p.id, month, state), 0)
      if (Math.abs(actual - expected) > 0.01) {
        console.error(
          `[SeedAssertion FAIL] function_capacity(${fnName}, ${month}): ` +
          `got ${actual.toFixed(1)}, expected sum-of-person-capacity ${expected.toFixed(1)}`
        )
        capacityConsistencyOk = false
      }
    }
  }

  // 2. Explicit expected values for 2026-08 (§6 capacity reconciliation table).
  //    DM = 1534h: all 12 DM people active, respecting available_from/to and allocs.
  //    GroupIT = 882h: all 6 GroupIT people active (Henrik available_from=2026-08).
  const dmCap0826 = function_capacity(dmFnId, '2026-08', state)
  const gitCap0826 = function_capacity(gitFnId, '2026-08', state)
  assert('function_capacity(DM, 2026-08) == 1534h', dmCap0826, '==', 1534)
  assert('function_capacity(GroupIT, 2026-08) == 882h', gitCap0826, '==', 882)

  // 3. Function-switch assertion: DM and GroupIT must produce different Section A
  //    capacity-line values in at least one visible month.
  let fnSwitchDiffers = false
  for (const month of months) {
    const dmCap = function_capacity(dmFnId, month, state)
    const gitCap = function_capacity(gitFnId, month, state)
    if (Math.abs(dmCap - gitCap) > 0.01) { fnSwitchDiffers = true; break }
  }
  if (!fnSwitchDiffers) {
    console.error(
      '[SeedAssertion FAIL] function_capacity(DM) === function_capacity(GroupIT) in every visible month — ' +
      'seed must differentiate Functions for the Section A re-render invariant to be observable'
    )
  }

  // 4. Per-domain reconciliation — Group IT Enterprise Solutions: Data & Integration.
  //    2026-07: 152h — Anya Petrov (per_017, 152h contracted); Henrik Sørensen
  //             (per_018) has available_from=2026-08 so is not active in Jul 2026.
  //    2026-08: 304h — Anya (152h) + Henrik (152h); both active, no non-D&I
  //             commitments in either month.
  const dataIntDomainId = 'thm_git_data'
  const domainRecTable: Array<{ month: string; expected: number }> = [
    { month: '2026-07', expected: 152 },
    { month: '2026-08', expected: 304 },
  ]
  let domainCapOk = true
  for (const { month, expected } of domainRecTable) {
    const actual = domain_capacity(dataIntDomainId, month, state)
    if (Math.abs(actual - expected) > 0.01) {
      const domainName = state.domains.find(d => d.id === dataIntDomainId)?.name ?? dataIntDomainId
      console.error(
        `[SeedAssertion FAIL] domain_capacity(${domainName}, ${month}): ` +
        `got ${actual.toFixed(1)}, expected ${expected} — ` +
        `(Domain, month, expected, actual) = (${domainName}, ${month}, ${expected}, ${actual.toFixed(1)}) — ` +
        `check §6 capacity reconciliation table`
      )
      domainCapOk = false
    }
  }

  if (capacityConsistencyOk && fnSwitchDiffers && domainCapOk) {
    console.info('[SeedAssertions] §2.4.8 capacity reconciliation invariants passed ✓')
  }

  // ── Demand pipeline coverage assertions ──────────────────────────────────
  // All 5 Demand statuses must appear in the seed (across all demands).
  const allStatuses = new Set(state.demandItems.map(d => d.status))
  const requiredStatuses: DemandStatus[] = ['Draft', 'Submitted', 'Approved', 'PartiallyAllocated', 'Allocated']
  for (const s of requiredStatuses) {
    if (!allStatuses.has(s)) {
      console.error(`[SeedAssertion FAIL] No demand item with status "${s}" in seed — Manage Demand board column will be empty`)
    }
  }
  // DM Function (func_001) must have all 5 statuses to populate Manage Demand
  // when DM is the active Function.
  const dmStatuses = new Set(state.demandItems.filter(d => d.function_id === 'func_001').map(d => d.status))
  for (const s of requiredStatuses) {
    if (!dmStatuses.has(s)) {
      console.error(`[SeedAssertion FAIL] No DM (func_001) demand with status "${s}" — DM Manage Demand board missing that column`)
    }
  }
  // All 5 Project statuses must appear.
  const projectStatuses = new Set(state.projects.map((p: { status: string }) => p.status))
  const reqProjectStatuses = ['Draft', 'Scoping', 'Submitted', 'Approved', 'Allocated']
  for (const s of reqProjectStatuses) {
    if (!projectStatuses.has(s)) {
      console.error(`[SeedAssertion FAIL] No Project with status "${s}" — Manage Projects board column will be empty`)
    }
  }
  // Project 4 must have exactly 2 child Demands (DM + GroupIT).
  const p4Demands = state.demandItems.filter(d => d.parent_project_id === 'prj_004')
  if (p4Demands.length !== 2) {
    console.error(`[SeedAssertion FAIL] prj_004 (Plant C MES Platform Migration) has ${p4Demands.length} child Demands, expected 2 (DM + GroupIT)`)
  }
  // v1.20: spawned Demand names must match parent Project name exactly (no Function suffix).
  const projectNameMap = new Map(state.projects.map(p => [p.id, p.name]))
  const wronglyNamedSpawned = state.demandItems.filter(d =>
    d.parent_project_id && d.name !== projectNameMap.get(d.parent_project_id)
  )
  if (wronglyNamedSpawned.length > 0) {
    console.error(`[SeedAssertion FAIL] §6 v1.20: Spawned Demands with names differing from parent Project: ${wronglyNamedSpawned.map(d => `${d.id}("${d.name}")`).join(', ')}`)
  }

  // At least one direct Demand with null parent must exist for DM.
  const directDmDemands = state.demandItems.filter(d => d.function_id === 'func_001' && d.parent_project_id === null)
  if (directDmDemands.length === 0) {
    console.error('[SeedAssertion FAIL] No direct DM Demands (parent_project_id = null) in seed — Direct Demands card will be hidden')
  }

  const coverageOk =
    requiredStatuses.every(s => allStatuses.has(s)) &&
    requiredStatuses.every(s => dmStatuses.has(s)) &&
    reqProjectStatuses.every(s => projectStatuses.has(s)) &&
    p4Demands.length === 2 &&
    directDmDemands.length > 0
  if (coverageOk) {
    console.info('[SeedAssertions] §6 demand and project pipeline coverage assertions passed ✓')
  }

  // ── §6 Demand view Function-lens assertions ───────────────────────────────
  // Demand view Function lens applies: the same Programme must produce
  // different total hours under DM vs GroupIT lens, demonstrating the re-render.
  // prg_001 (MES Modernisation) in 2026-08:
  //   DM lens (func_001): prj_004 DM Demand (PartiallyAllocated) contributes
  //     MES Spe 80h + Workflow Adv 40h + Integration Adv 40h = 160h.
  //   GroupIT lens (func_002): prj_004 GroupIT Demand (Approved) contributes
  //     Data Engineering Spe 60h + Integration Architecture Adv 40h = 100h.
  const REAL_SET = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])
  const dmSlice = programme_demand_by_funding('prg_001', '2026-08', { status_set: REAL_SET, function_id: 'func_001' }, state)
  const gitSlice = programme_demand_by_funding('prg_001', '2026-08', { status_set: REAL_SET, function_id: 'func_002' }, state)
  const dmSliceTotal = Object.values(dmSlice).reduce((s: number, v: number) => s + v, 0)
  const gitSliceTotal = Object.values(gitSlice).reduce((s: number, v: number) => s + v, 0)
  assert('programme_demand_by_funding(prg_001, 2026-08, DM lens) > 0', dmSliceTotal, '>', 0)
  assert('programme_demand_by_funding(prg_001, 2026-08, GroupIT lens) > 0', gitSliceTotal, '>', 0)
  if (Math.abs(dmSliceTotal - gitSliceTotal) < 0.01) {
    console.error(
      `[SeedAssertion FAIL] DM(${dmSliceTotal.toFixed(1)}h) and GroupIT(${gitSliceTotal.toFixed(1)}h) slices of prg_001 ` +
      'are identical — Function lens is not differentiating; Demand view will not visibly re-render on Function switch'
    )
  }

  // Direct Demands card: DM has active direct demands in committed statuses
  // (D3 PartiallyAllocated steady-state + D5 Approved 2026-09 to 2026-10).
  // GroupIT has none — card must be hidden when GroupIT is active.
  const directDmFunding = direct_demand_by_funding('2026-09', { status_set: REAL_SET, function_id: 'func_001' }, state)
  const directDmFundingTotal = Object.values(directDmFunding).reduce((s: number, v: number) => s + v, 0)
  assert('direct_demand_by_funding(2026-09, DM) > 0', directDmFundingTotal, '>', 0)

  const directGitFunding = direct_demand_by_funding('2026-09', { status_set: REAL_SET, function_id: 'func_002' }, state)
  const directGitTotal = Object.values(directGitFunding).reduce((s: number, v: number) => s + v, 0)
  assert('direct_demand_by_funding(2026-09, GroupIT) == 0 — no direct GroupIT demands', directGitTotal, '==', 0)

  const lensOk = dmSliceTotal > 0 && gitSliceTotal > 0 &&
    Math.abs(dmSliceTotal - gitSliceTotal) > 0.01 &&
    directDmFundingTotal > 0 && directGitTotal === 0
  if (lensOk) {
    console.info('[SeedAssertions] §6 Demand view Function-lens assertions passed ✓')
  }

  // ── §11.20 v1.19 Spawn renderability invariants ───────────────────────────
  // Verify Project 4 carries its frozen planning record, child Demands carry
  // their materialised activities, and the spawn-drift example is demonstrable.

  // 1. prj_004 must have non-empty frozen activities (planning record at Submit).
  const prj4 = state.projects.find(p => p.id === 'prj_004')
  let spawnInvariantsOk = true

  if (!prj4 || prj4.activities.length === 0) {
    console.error('[SeedAssertion FAIL] §11.20: prj_004 has no frozen activities — Project planning record missing')
    spawnInvariantsOk = false
  }

  // 2. Each child Demand of prj_004 must have non-zero activities.
  for (const d of state.demandItems.filter(d => d.parent_project_id === 'prj_004')) {
    if (d.activities.length === 0) {
      console.error(
        `[SeedAssertion FAIL] §11.20: ${d.id} (${d.name}) has zero activities — materialisation incomplete`
      )
      spawnInvariantsOk = false
    }
  }

  // 3. Every external requirement on a child Demand's activity must have a
  //    function_tag matching the Demand's function_id.
  const demandActivityToFn = new Map<string, string>() // activity_id → demand.function_id
  for (const d of state.demandItems) {
    for (const ac of d.activities) demandActivityToFn.set(ac.id, d.function_id)
  }
  for (const ext of state.externalResourceRequirements) {
    const fnId = demandActivityToFn.get(ext.activity_id)
    if (fnId === undefined) continue // Project frozen activity — not checked here
    if (ext.function_tag !== fnId) {
      console.error(
        `[SeedAssertion FAIL] §11.20: External req ${ext.id} on Demand activity ${ext.activity_id} ` +
        `has function_tag "${ext.function_tag}" but Demand function_id is "${fnId}"`
      )
      spawnInvariantsOk = false
    }
  }

  // 4. Spawn drift demonstration: prj_004 frozen Build-activity MES Specialist
  //    requirement = 60h/mo (spawn-time value); dmd_p4_dm Build-activity MES req = 80h/mo (post-drift).
  const dmdP4Dm = state.demandItems.find(d => d.id === 'dmd_p4_dm')
  const prj4BuildActivity = prj4?.activities.find(ac => ac.name === 'Build & Integration')
  const prj4MesReq = prj4BuildActivity?.requirements.find(r => r.skill_id === 'skl_mom_mes')
  const dmdBuildActivity = dmdP4Dm?.activities.find(ac => ac.name === 'Build & Integration')
  const dmdMesReq = dmdBuildActivity?.requirements.find(r => r.skill_id === 'skl_mom_mes')

  const frozenMesHours = prj4MesReq?.hours_by_month?.['2026-08'] ?? -1
  const driftedMesHours = dmdMesReq?.hours_by_month?.['2026-08'] ?? -1

  if (frozenMesHours !== 60) {
    console.error(
      `[SeedAssertion FAIL] §11.20 drift: prj_004 frozen Build activity MES hours at 2026-08 = ${frozenMesHours}, expected 60 (spawn-time value)`
    )
    spawnInvariantsOk = false
  }
  if (driftedMesHours !== 80) {
    console.error(
      `[SeedAssertion FAIL] §11.20 drift: dmd_p4_dm Build activity MES hours at 2026-08 = ${driftedMesHours}, expected 80 (post-spawn drift value)`
    )
    spawnInvariantsOk = false
  }

  if (spawnInvariantsOk) {
    console.info(
      '[SeedAssertions] §11.20 spawn invariants passed ✓ ' +
      `(frozen=60h/mo, dmd_p4_dm drifted=80h/mo)`
    )
  }

  // ── §6 v1.19-specific seed assertions ────────────────────────────────────
  // These verify that the v1.19 data model is correctly embodied in the seed.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawSeed = seedRaw as Record<string, any>
  let v119Ok = true

  // 1. Zero ProjectTeamAssignment records (§2 — Teams Assigned removed in v1.19)
  const ptaCount = (rawSeed.project_team_assignments as unknown[])?.length ?? 0
  if (ptaCount !== 0) {
    console.error(`[SeedAssertion FAIL] §6 v1.19: seed contains ${ptaCount} ProjectTeamAssignment records, expected 0`)
    v119Ok = false
  }

  // 2. Project 1 (Plant D MES Concept Study, Draft) — functions_required = [DM, GroupIT]
  const prj1 = state.projects.find(p => p.id === 'prj_001')
  if (!prj1) {
    console.error('[SeedAssertion FAIL] §6 v1.19: prj_001 not found in seed')
    v119Ok = false
  } else {
    const p1fr = new Set(prj1.functions_required)
    if (!p1fr.has('func_001') || !p1fr.has('func_002')) {
      console.error(
        `[SeedAssertion FAIL] §6 v1.19: prj_001 functions_required=${JSON.stringify(prj1.functions_required)}, ` +
        'expected [func_001, func_002] — Submit-for-Scoping gate test requires both Functions declared'
      )
      v119Ok = false
    }
  }

  // 3. Project 2 (Plant E MES Refresh, Scoping) — functions_required = [DM] only
  const prj2 = state.projects.find(p => p.id === 'prj_002')
  if (!prj2) {
    console.error('[SeedAssertion FAIL] §6 v1.19: prj_002 not found in seed')
    v119Ok = false
  } else {
    if (!prj2.functions_required.includes('func_001') || prj2.functions_required.includes('func_002')) {
      console.error(
        `[SeedAssertion FAIL] §6 v1.19: prj_002 functions_required=${JSON.stringify(prj2.functions_required)}, ` +
        'expected [func_001] only — demonstrates hint-not-binding behaviour'
      )
      v119Ok = false
    }
    // 4. Project 2 functions_actually_involved must include GroupIT (added during Scoping)
    const p2fai = new Set(prj2.functions_actually_involved)
    if (!p2fai.has('func_001') || !p2fai.has('func_002')) {
      console.error(
        `[SeedAssertion FAIL] §6 v1.19: prj_002 functions_actually_involved=${JSON.stringify(prj2.functions_actually_involved)}, ` +
        'expected both func_001 and func_002 — GroupIT added during Scoping badge test'
      )
      v119Ok = false
    }
  }

  // 5. Project 3 (Corporate Data Lake, Submitted) — frozen activities must be non-empty after Change 10
  const prj3 = state.projects.find(p => p.id === 'prj_003')
  if (!prj3 || prj3.activities.length === 0) {
    console.error('[SeedAssertion FAIL] §6 v1.19: prj_003 has no frozen activities — Change 10 seed rebuild incomplete')
    v119Ok = false
  }

  // 6. Project 4 (Plant C MES Platform Migration, Approved) — functions_required non-empty (frozen at Submit)
  if (prj4 && prj4.functions_required.length === 0) {
    console.error('[SeedAssertion FAIL] §6 v1.19: prj_004 functions_required is empty — should be frozen at Submit with DM + GroupIT')
    v119Ok = false
  }

  // 7. Project 3 external Function-tag routing — DM Demand carries DM-tagged ext, GroupIT carries GroupIT-tagged ext
  const p3dmDemand = state.demandItems.find(d => d.id === 'dmd_p3_dm')
  const p3gitDemand = state.demandItems.find(d => d.id === 'dmd_p3_git')
  if (!p3dmDemand || !p3gitDemand) {
    console.error('[SeedAssertion FAIL] §6 v1.19: dmd_p3_dm or dmd_p3_git not found in seed')
    v119Ok = false
  } else {
    const p3dmActivityIds = new Set(p3dmDemand.activities.map(ac => ac.id))
    const p3gitActivityIds = new Set(p3gitDemand.activities.map(ac => ac.id))
    const p3dmExts = state.externalResourceRequirements.filter(e => p3dmActivityIds.has(e.activity_id))
    const p3gitExts = state.externalResourceRequirements.filter(e => p3gitActivityIds.has(e.activity_id))
    if (!p3dmExts.some(e => e.function_tag === 'func_001')) {
      console.error('[SeedAssertion FAIL] §6 v1.19: dmd_p3_dm has no external req with function_tag=func_001 (DM-tagged Contractor expected)')
      v119Ok = false
    }
    if (!p3gitExts.some(e => e.function_tag === 'func_002')) {
      console.error('[SeedAssertion FAIL] §6 v1.19: dmd_p3_git has no external req with function_tag=func_002 (GroupIT-tagged OEM expected)')
      v119Ok = false
    }
  }

  // 8. Direct Demand D3 external function_tag auto-set to demand's function_id
  const d3 = state.demandItems.find(d => d.id === 'dmd_d3')
  if (d3) {
    const d3ActivityIds = new Set(d3.activities.map(ac => ac.id))
    const d3Exts = state.externalResourceRequirements.filter(e => d3ActivityIds.has(e.activity_id))
    for (const ext of d3Exts) {
      if (ext.function_tag !== d3.function_id) {
        console.error(
          `[SeedAssertion FAIL] §6 v1.19: D3 external ${ext.id} has function_tag="${ext.function_tag}" ` +
          `but demand function_id="${d3.function_id}" — direct Demand externals must be auto-tagged`
        )
        v119Ok = false
      }
    }
  }

  // 9. Project 4 DM and GroupIT Demands each have their own independent activities
  const p4dm = state.demandItems.find(d => d.parent_project_id === 'prj_004' && d.function_id === 'func_001')
  const p4git = state.demandItems.find(d => d.parent_project_id === 'prj_004' && d.function_id === 'func_002')
  if (!p4dm || !p4git) {
    console.error('[SeedAssertion FAIL] §6 v1.19: Project 4 DM or GroupIT Demand not found')
    v119Ok = false
  } else {
    if (p4dm.activities.length === 0) {
      console.error('[SeedAssertion FAIL] §6 v1.19: prj_004 DM Demand has zero activities — materialisation incomplete')
      v119Ok = false
    }
    if (p4git.activities.length === 0) {
      console.error('[SeedAssertion FAIL] §6 v1.19: prj_004 GroupIT Demand has zero activities — materialisation incomplete')
      v119Ok = false
    }
    // Verify sibling count: each sibling sees the other
    const p4Siblings = state.demandItems.filter(d => d.parent_project_id === 'prj_004')
    if (p4Siblings.length !== 2) {
      console.error(`[SeedAssertion FAIL] §6 v1.19: prj_004 has ${p4Siblings.length} child Demands, expected exactly 2 (DM + GroupIT)`)
      v119Ok = false
    }
  }

  if (v119Ok) {
    console.info(
      '[SeedAssertions] §6 v1.19-specific invariants passed ✓ ' +
      '(zero PTAs, functions_required/involved, frozen phases, ext routing, drift)'
    )
  }
}
