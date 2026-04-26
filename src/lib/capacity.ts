/**
 * Shared aggregation layer — all capacity and demand numbers across the tool
 * are computed here. No view should iterate over phases/requirements/allocations
 * directly; every consumer calls these functions.
 *
 * Section reference: REQUIREMENTS.md §2.4
 */

import type { AppState, DemandItem, DemandStatus, FundingSource, Level, Phase, Requirement, SkillRequirement } from '../types'
import { monthInRange } from '../utils/capacity'

// ─── Constants ───────────────────────────────────────────────────────────────

const REAL_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])
const LEVEL_ORDER: Record<Level, number> = { Basic: 0, Advanced: 1, Specialist: 2 }

// ─── Private helpers ─────────────────────────────────────────────────────────

function meetsLevel(held: Level, required: Level): boolean {
  return LEVEL_ORDER[held] >= LEVEL_ORDER[required]
}

function reqHoursForMonth(req: SkillRequirement, phase: Phase, month: string): number {
  if (phase.end_month === null) return req.steady_state_hours ?? 0
  return req.hours_by_month[month] ?? 0
}

function allocHoursForMonth(
  alloc: { hours_by_month: Record<string, number>; steady_state_hours?: number | null },
  phase: Phase,
  month: string
): number {
  if (phase.end_month === null) return alloc.steady_state_hours ?? 0
  return alloc.hours_by_month[month] ?? 0
}

// ─── 1. real_committed_hours ─────────────────────────────────────────────────
// Sum of every named allocation on this person in this month,
// across all demand items in status Approved / PartiallyAllocated / Allocated.

export function real_committed_hours(personId: string, month: string, state: AppState): number {
  let total = 0
  for (const item of state.demandItems) {
    if (!REAL_STATUSES.has(item.status)) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        for (const alloc of req.allocations) {
          if (alloc.person_id === personId) {
            total += allocHoursForMonth(alloc, phase, month)
          }
        }
      }
    }
  }
  return total
}

// ─── 2. person_capacity ──────────────────────────────────────────────────────
// Available hours for a person in a month: contracted minus ALL real
// commitments, floored at zero. Zero outside their employment window.

export function person_capacity(personId: string, month: string, state: AppState): number {
  const person = state.people.find(p => p.id === personId)
  if (!person || !person.active) return 0
  if (!monthInRange(month, person.available_from, person.available_to)) return 0
  return Math.max(0, person.contracted_hours_per_month - real_committed_hours(personId, month, state))
}

// ─── 3. domain_capacity ──────────────────────────────────────────────────────
// For each person who holds any skill in domain T:
//   max(0, contracted − sum of their allocs to skills NOT in T)
//
// Commitments to this domain's own skills show on the demand side of T's chart
// and are deliberately NOT subtracted here (prevents double-counting).

export function domain_capacity(domainId: string, month: string, state: AppState, teamId?: string): number {
  const domainSkillIds = new Set(state.skills.filter(s => s.domain_id === domainId).map(s => s.id))
  let total = 0

  for (const person of state.people) {
    if (!person.active) continue
    if (teamId && person.teamId !== teamId) continue
    if (!monthInRange(month, person.available_from, person.available_to)) continue
    if (!person.skills.some(ps => domainSkillIds.has(ps.skill_id))) continue

    let otherCommitted = 0
    for (const item of state.demandItems) {
      if (!REAL_STATUSES.has(item.status)) continue
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          if (domainSkillIds.has(req.skill_id)) continue  // skip this domain's skills
          for (const alloc of req.allocations) {
            if (alloc.person_id === person.id) {
              otherCommitted += allocHoursForMonth(alloc, phase, month)
            }
          }
        }
      }
    }
    total += Math.max(0, person.contracted_hours_per_month - otherCommitted)
  }
  return total
}

// ─── 4. skill_capacity ───────────────────────────────────────────────────────
// For each person who holds skill S (at any level):
//   max(0, contracted − sum of their allocs to skills other than S)

export function skill_capacity(skillId: string, month: string, state: AppState, teamId?: string): number {
  let total = 0

  for (const person of state.people) {
    if (!person.active) continue
    if (teamId && person.teamId !== teamId) continue
    if (!monthInRange(month, person.available_from, person.available_to)) continue
    if (!person.skills.some(ps => ps.skill_id === skillId)) continue

    let otherCommitted = 0
    for (const item of state.demandItems) {
      if (!REAL_STATUSES.has(item.status)) continue
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          if (req.skill_id === skillId) continue  // skip this skill
          for (const alloc of req.allocations) {
            if (alloc.person_id === person.id) {
              otherCommitted += allocHoursForMonth(alloc, phase, month)
            }
          }
        }
      }
    }
    total += Math.max(0, person.contracted_hours_per_month - otherCommitted)
  }
  return total
}

// ─── 5. demand_hours_for ─────────────────────────────────────────────────────
// Requirement target hours (not allocation hours) for the given target
// (overall / domain / skill) and status set, in a given month.
// Pass overlayItemId to include that Submitted item's demand on top of the
// committed statuses.

export interface DemandBreakdown {
  strategy: number
  plant: number
  npd: number
  bau: number
}

export type DemandTarget =
  | { type: 'overall' }
  | { type: 'domain'; id: string }
  | { type: 'skill'; id: string }

export function demand_hours_for(
  target: DemandTarget,
  statuses: ReadonlySet<DemandStatus>,
  month: string,
  state: AppState,
  overlayItemId?: string | null
): DemandBreakdown {
  const out: DemandBreakdown = { strategy: 0, plant: 0, npd: 0, bau: 0 }

  const domainSkillIds = target.type === 'domain'
    ? new Set(state.skills.filter(s => s.domain_id === target.id).map(s => s.id))
    : null

  for (const item of state.demandItems) {
    const isOverlay = overlayItemId != null && item.id === overlayItemId
    if (isOverlay && item.status !== 'Submitted') continue
    if (!isOverlay && !statuses.has(item.status)) continue

    let key: keyof DemandBreakdown | null = null
    if (item.type === 'Group Strategy Project') key = 'strategy'
    else if (item.type === 'Plant Project') key = 'plant'
    else if (item.type === 'NPD Demand') key = 'npd'
    else if (item.type === 'BAU') key = 'bau'
    if (!key) continue

    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        if (target.type === 'domain' && domainSkillIds && !domainSkillIds.has(req.skill_id)) continue
        if (target.type === 'skill' && req.skill_id !== target.id) continue
        out[key] += reqHoursForMonth(req, phase, month)
      }
    }
  }
  return out
}

// ─── 6 & 7. Projection ───────────────────────────────────────────────────────
// computeProjection runs a single pass over all unallocated demand and
// returns a ProjectionResult. Everything else derives from that.
//
// "Unallocated demand" for projection includes:
//   - Approved items: full requirement target (no named allocs yet)
//   - PartiallyAllocated items: requirement target minus already-allocated
//   - The selected Submitted overlay: full requirement target (allocs ignored)
//
// The algorithm: for each unallocated-requirement-month, distribute hours
// proportionally across eligible people's real headroom. If total headroom
// < demand, project each person at 100% of their headroom and surface the
// excess as a shortfall.
//
// §2.4.5 note: a person eligible for multiple requirements accumulates
// projected hours from each independently. We cap projected_consumption at
// real_headroom to honour Invariant B.

export interface ShortfallDrivingItem {
  demand_id: string
  demand_name: string
  status: string
  shortfall_hours: number
}

export interface ShortfallRecord {
  skill_id: string
  month: string
  shortfall_hours: number
  driving_items: ShortfallDrivingItem[]
}

interface PersonMonthEntry {
  bySkill: Map<string, number>   // skill_id → raw projected hours (before capping)
  realHeadroom: number           // contracted - real_committed in this month
}

export interface ProjectionResult {
  byPerson: Map<string, Map<string, PersonMonthEntry>>
  shortfalls: ShortfallRecord[]
}

export function computeProjection(
  state: AppState,
  months: string[],
  overlayItemId?: string | null
): ProjectionResult {
  const byPerson = new Map<string, Map<string, PersonMonthEntry>>()
  const shortfallMap = new Map<string, ShortfallRecord>()

  // Build person → skill → level index
  const personSkillIndex = new Map<string, Map<string, Level>>()
  for (const person of state.people) {
    if (!person.active) continue
    const sm = new Map<string, Level>()
    for (const ps of person.skills) sm.set(ps.skill_id, ps.level)
    personSkillIndex.set(person.id, sm)
  }

  // Cache real_committed_hours per person-month (avoid repeated full scans)
  const rchCache = new Map<string, number>()
  function getRch(personId: string, month: string): number {
    const k = `${personId}__${month}`
    if (!rchCache.has(k)) rchCache.set(k, real_committed_hours(personId, month, state))
    return rchCache.get(k)!
  }

  function ensureEntry(personId: string, month: string, headroom: number): PersonMonthEntry {
    let mmap = byPerson.get(personId)
    if (!mmap) { mmap = new Map(); byPerson.set(personId, mmap) }
    let entry = mmap.get(month)
    if (!entry) { entry = { bySkill: new Map(), realHeadroom: headroom }; mmap.set(month, entry) }
    return entry
  }

  for (const month of months) {
    for (const item of state.demandItems) {
      const isOverlay = overlayItemId != null && item.id === overlayItemId
      if (isOverlay && item.status !== 'Submitted') continue
      if (!isOverlay && item.status !== 'Approved' && item.status !== 'PartiallyAllocated') continue

      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue

        for (const req of phase.requirements) {
          const targetH = reqHoursForMonth(req, phase, month)
          if (targetH <= 0) continue

          // Unallocated hours for this requirement-month
          let allocH = 0
          if (!isOverlay) {
            for (const alloc of req.allocations) {
              allocH += allocHoursForMonth(alloc, phase, month)
            }
          }
          const unallocH = Math.max(0, targetH - allocH)
          if (unallocH <= 0) continue

          // Find eligible people and their real headroom
          const eligible: { personId: string; headroom: number }[] = []
          for (const person of state.people) {
            if (!person.active) continue
            if (!monthInRange(month, person.available_from, person.available_to)) continue
            const heldSkills = personSkillIndex.get(person.id)
            if (!heldSkills) continue
            const heldLevel = heldSkills.get(req.skill_id)
            if (!heldLevel || !meetsLevel(heldLevel, req.level)) continue
            const headroom = Math.max(0, person.contracted_hours_per_month - getRch(person.id, month))
            eligible.push({ personId: person.id, headroom })
          }

          const totalHeadroom = eligible.reduce((s, e) => s + e.headroom, 0)

          if (totalHeadroom >= unallocH) {
            // Distribute proportionally to headroom
            for (const { personId, headroom } of eligible) {
              if (headroom <= 0) continue
              const share = unallocH * (headroom / totalHeadroom)
              const entry = ensureEntry(personId, month, headroom)
              entry.bySkill.set(req.skill_id, (entry.bySkill.get(req.skill_id) ?? 0) + share)
            }
          } else {
            // Project each eligible person at 100% of their headroom; surface shortfall
            for (const { personId, headroom } of eligible) {
              if (headroom <= 0) continue
              const entry = ensureEntry(personId, month, headroom)
              entry.bySkill.set(req.skill_id, (entry.bySkill.get(req.skill_id) ?? 0) + headroom)
            }

            const shortfall = unallocH - totalHeadroom
            const sfKey = `${req.skill_id}__${month}`
            let sf = shortfallMap.get(sfKey)
            if (!sf) {
              sf = { skill_id: req.skill_id, month, shortfall_hours: 0, driving_items: [] }
              shortfallMap.set(sfKey, sf)
            }
            sf.shortfall_hours += shortfall
            sf.driving_items.push({
              demand_id: item.id,
              demand_name: item.name,
              status: isOverlay ? 'Submitted (overlay)' : item.status,
              shortfall_hours: shortfall,
            })
          }
        }
      }
    }
  }

  return { byPerson, shortfalls: Array.from(shortfallMap.values()) }
}

// ─── projected_consumption ───────────────────────────────────────────────────
// Total projected hours onto person P in month M, capped at their real
// headroom to satisfy Invariant B.

export function projected_consumption(
  personId: string,
  month: string,
  projResult: ProjectionResult
): number {
  const entry = projResult.byPerson.get(personId)?.get(month)
  if (!entry) return 0
  let total = 0
  for (const h of entry.bySkill.values()) total += h
  return Math.min(total, entry.realHeadroom)
}

// ─── grey_band ───────────────────────────────────────────────────────────────
// Projected hours onto this chart's skill pool from requirements targeting
// OTHER domains/skills. (Demand for THIS target appears on the demand stack —
// never in the grey band — to prevent double-counting: Invariant D.)

export function grey_band(
  target: DemandTarget,
  month: string,
  state: AppState,
  projResult: ProjectionResult
): number {
  if (target.type === 'overall') return 0  // not shown on overall chart

  const domainSkillIds = target.type === 'domain'
    ? new Set(state.skills.filter(s => s.domain_id === target.id).map(s => s.id))
    : null

  // People in this chart's pool
  const poolPeople = target.type === 'domain'
    ? state.people.filter(p => p.active && p.skills.some(ps => domainSkillIds!.has(ps.skill_id)))
    : state.people.filter(p => p.active && p.skills.some(ps => ps.skill_id === target.id))

  let total = 0
  for (const person of poolPeople) {
    if (!monthInRange(month, person.available_from, person.available_to)) continue
    const entry = projResult.byPerson.get(person.id)?.get(month)
    if (!entry) continue

    let fromOthers = 0
    let fromAll = 0
    for (const [skillId, hours] of entry.bySkill) {
      fromAll += hours
      const isInTarget = target.type === 'domain'
        ? domainSkillIds!.has(skillId)
        : skillId === target.id
      if (!isInTarget) fromOthers += hours
    }

    // Scale proportionally if raw total exceeds real headroom
    const scale = fromAll > 0 && fromAll > entry.realHeadroom
      ? entry.realHeadroom / fromAll
      : 1

    total += fromOthers * scale
  }
  return total
}

// ─── projection_shortfalls ───────────────────────────────────────────────────

export function projection_shortfalls(projResult: ProjectionResult): ShortfallRecord[] {
  return projResult.shortfalls
}

// ─── team capacity (unchanged from utils — static contracted sum) ─────────────

export function team_capacity(month: string, state: AppState): number {
  return state.people
    .filter(p => p.active && monthInRange(month, p.available_from, p.available_to))
    .reduce((s, p) => s + p.contracted_hours_per_month, 0)
}

// ─── §2.4.9 Programme / Project roll-up aggregation ─────────────────────────
//
// Consistency rule: no view iterates over Demands/Phases/Requirements to
// compute roll-ups. Every roll-up must call one of these functions.
// External requirements are never included in internal-hour totals.

const ACTIVE_FOR_EXTERNAL_STATUSES = new Set<DemandStatus>([
  'Draft', 'Submitted', 'Approved', 'PartiallyAllocated', 'Allocated',
])

function extHoursForMonth(
  ext: import('../types').ExternalResourceRequirement,
  parentPhase: { end_month: string | null },
  month: string
): number {
  if (parentPhase.end_month === null) return ext.steady_state_hours ?? 0
  return ext.hours_by_month[month] ?? 0
}

function phaseContainsMonth(phase: Phase, month: string): boolean {
  return monthInRange(month, phase.start_month, phase.end_month)
}

// 1. project_internal_hours — sum of internal skill-shaped requirement target
//    hours across Demands aligned to project_id in Approved/PA/Allocated.
export function project_internal_hours(
  project_id: string,
  month: string,
  state: AppState
): number {
  let total = 0
  for (const item of state.demandItems) {
    if (item.parent_project_id !== project_id) continue
    if (!REAL_STATUSES.has(item.status)) continue
    for (const phase of item.phases) {
      if (!phaseContainsMonth(phase, month)) continue
      for (const req of phase.requirements) {
        total += reqHoursForMonth(req, phase, month)
      }
    }
  }
  return total
}

// 2. project_external_hours — sum of external requirement hours across
//    Demands aligned to project_id in any active status.
export function project_external_hours(
  project_id: string,
  month: string,
  state: AppState
): number {
  // Build a phase-to-parentItem lookup so we can check item status
  const phaseToItem = new Map<string, DemandItem>()
  for (const item of state.demandItems) {
    for (const phase of item.phases) {
      phaseToItem.set(phase.id, item)
    }
  }

  let total = 0
  for (const ext of state.externalResourceRequirements) {
    const item = phaseToItem.get(ext.phase_id)
    if (!item) continue
    if (item.parent_project_id !== project_id) continue
    if (!ACTIVE_FOR_EXTERNAL_STATUSES.has(item.status)) continue
    const phase = item.phases.find(p => p.id === ext.phase_id)
    if (!phase || !phaseContainsMonth(phase, month)) continue
    total += extHoursForMonth(ext, phase, month)
  }
  return total
}

// 3. project_external_hours_by_provider — same as above, broken down by
//    {provider_id: number}.
export function project_external_hours_by_provider(
  project_id: string,
  month: string,
  state: AppState
): Record<string, number> {
  const phaseToItem = new Map<string, DemandItem>()
  for (const item of state.demandItems) {
    for (const phase of item.phases) {
      phaseToItem.set(phase.id, item)
    }
  }

  const result: Record<string, number> = {}
  for (const ext of state.externalResourceRequirements) {
    const item = phaseToItem.get(ext.phase_id)
    if (!item) continue
    if (item.parent_project_id !== project_id) continue
    if (!ACTIVE_FOR_EXTERNAL_STATUSES.has(item.status)) continue
    const phase = item.phases.find(p => p.id === ext.phase_id)
    if (!phase || !phaseContainsMonth(phase, month)) continue
    const h = extHoursForMonth(ext, phase, month)
    result[ext.provider_id] = (result[ext.provider_id] ?? 0) + h
  }
  return result
}

// 4. project_demand_count — count of child Demands, optionally filtered.
export function project_demand_count(
  project_id: string,
  state: AppState,
  status_filter?: ReadonlySet<DemandStatus>
): number {
  return state.demandItems.filter(
    d => d.parent_project_id === project_id &&
         (!status_filter || status_filter.has(d.status))
  ).length
}

// 5. programme_internal_hours — sum of project_internal_hours across the
//    Programme's active Projects.
export function programme_internal_hours(
  programme_id: string,
  month: string,
  state: AppState
): number {
  return state.projects
    .filter(p => p.programme_id === programme_id && p.active)
    .reduce((s, p) => s + project_internal_hours(p.id, month, state), 0)
}

// 6. programme_external_hours — sum across Projects.
export function programme_external_hours(
  programme_id: string,
  month: string,
  state: AppState
): number {
  return state.projects
    .filter(p => p.programme_id === programme_id && p.active)
    .reduce((s, p) => s + project_external_hours(p.id, month, state), 0)
}

// 7. programme_external_hours_by_provider — sum across Projects as
//    {provider_id: number}.
export function programme_external_hours_by_provider(
  programme_id: string,
  month: string,
  state: AppState
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const project of state.projects.filter(p => p.programme_id === programme_id && p.active)) {
    const byProvider = project_external_hours_by_provider(project.id, month, state)
    for (const [pid, h] of Object.entries(byProvider)) {
      result[pid] = (result[pid] ?? 0) + h
    }
  }
  return result
}

// 8. programme_project_count — count of active Projects in this Programme.
export function programme_project_count(
  programme_id: string,
  state: AppState
): number {
  // programme_id is now nullable on Project; only count Projects that explicitly
  // belong to this Programme (null-programme Projects are unaligned).
  return state.projects.filter(p => p.programme_id === programme_id && p.active).length
}

// 9. unaligned_demand_hours — hours for the virtual "No Project" grouping.
export function unaligned_demand_hours(
  month: string,
  kind: 'internal' | 'external',
  state: AppState
): number {
  if (kind === 'internal') {
    let total = 0
    for (const item of state.demandItems) {
      if (item.parent_project_id !== null) continue
      if (!REAL_STATUSES.has(item.status)) continue
      for (const phase of item.phases) {
        if (!phaseContainsMonth(phase, month)) continue
        for (const req of phase.requirements) {
          total += reqHoursForMonth(req, phase, month)
        }
      }
    }
    return total
  }

  // external kind
  const phaseToItem = new Map<string, DemandItem>()
  for (const item of state.demandItems) {
    for (const phase of item.phases) {
      phaseToItem.set(phase.id, item)
    }
  }

  let total = 0
  for (const ext of state.externalResourceRequirements) {
    const item = phaseToItem.get(ext.phase_id)
    if (!item) continue
    if (item.parent_project_id !== null) continue
    if (!ACTIVE_FOR_EXTERNAL_STATUSES.has(item.status)) continue
    const phase = item.phases.find(p => p.id === ext.phase_id)
    if (!phase || !phaseContainsMonth(phase, month)) continue
    total += extHoursForMonth(ext, phase, month)
  }
  return total
}

// ─── §2.4.9 crossFunctionDemandHours ─────────────────────────────────────────
// Returns internal skill-shaped requirement hours placed on *other* Functions
// by Demands that touch the active Function, for a given month.
//
// Scope (per spec §4 View 1 Section D):
//   - Only Demands in Approved / PartiallyAllocated / Allocated status
//   - A Demand qualifies if it has ≥1 requirement targeting any skill in the
//     active Function's Domain taxonomy (across any phase, any month)
//   - Returns only requirements targeting Skills in OTHER Functions
//   - External requirements are excluded (§2.6 — they are Section C's concern)
//
// opts.by = 'function'  → keyed by receiving functionId
// opts.by = 'team'      → keyed by owningTeamId of the requirement
//                         (null owningTeamId → '__unassigned__')
//                         Only requirements whose owningTeam belongs to the
//                         receiving Function are grouped by team; others go to
//                         '__unassigned__'.

export type CrossFunctionDemandGroup = Record<string, number>

export function crossFunctionDemandHours(
  activeFunctionId: string,
  month: string,
  opts: { by: 'function' | 'team' },
  state: AppState
): CrossFunctionDemandGroup {
  // Build active-Function skill set
  const activeDomainIds = new Set(
    state.domains.filter(d => d.functionId === activeFunctionId).map(d => d.id)
  )
  const activeSkillIds = new Set(
    state.skills.filter(s => activeDomainIds.has(s.domain_id)).map(s => s.id)
  )

  // Skill → owning-Function mapping
  const domainFnMap = new Map(state.domains.map(d => [d.id, d.functionId]))
  const skillFnMap = new Map(
    state.skills.map(s => [s.id, domainFnMap.get(s.domain_id) ?? ''])
  )

  // Team → owning-Function mapping
  const teamFnMap = new Map(state.teams.map(t => [t.id, t.functionId]))

  const result: CrossFunctionDemandGroup = {}

  for (const item of state.demandItems) {
    if (!REAL_STATUSES.has(item.status)) continue

    // Demand must touch active Function in at least one requirement (any phase)
    const touchesActive = item.phases.some(ph =>
      ph.requirements.some(req => activeSkillIds.has(req.skill_id))
    )
    if (!touchesActive) continue

    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        const reqFnId = skillFnMap.get(req.skill_id)
        if (!reqFnId || reqFnId === activeFunctionId) continue  // skip active-Function skills
        const hours = reqHoursForMonth(req, phase, month)
        if (hours <= 0) continue

        if (opts.by === 'function') {
          result[reqFnId] = (result[reqFnId] ?? 0) + hours
        } else {
          const teamId = req.owningTeamId
          if (teamId && teamFnMap.get(teamId) === reqFnId) {
            result[teamId] = (result[teamId] ?? 0) + hours
          } else {
            result['__unassigned__'] = (result['__unassigned__'] ?? 0) + hours
          }
        }
      }
    }
  }

  return result
}

// ─── §2.4.9 v1.17 — programme/project demand-by-funding / demand-by-team ─────
// Added for the new Demand view (§4.10). These differ from the existing roll-up
// family: status_set is configurable; internal + external combine into one
// number per stack key; they return decompositions for direct chart rendering.

export type DemandByFundingResult = Record<FundingSource, number>

export interface DemandByTeamEntry {
  key: string                    // 'team:<id>' | 'team:unassigned' | 'provider:<id>'
  hours: number
  label: string
  parent_function_label: string  // Function name, 'External', or 'Unassigned'
  source: 'internal' | 'external'
}

export function project_demand_by_funding(
  project_id: string,
  month: string,
  opts: { status_set: ReadonlySet<DemandStatus> },
  state: AppState
): DemandByFundingResult {
  const result: DemandByFundingResult = {
    'Investment Scheme': 0,
    'Plant/Sector Allocation': 0,
    'Mixed': 0,
  }

  // Internal hours: only Demands whose status is in status_set
  for (const item of state.demandItems) {
    if (item.parent_project_id !== project_id) continue
    if (!opts.status_set.has(item.status)) continue
    for (const phase of item.phases) {
      if (!phaseContainsMonth(phase, month)) continue
      for (const req of phase.requirements) {
        result[phase.funding_source] += reqHoursForMonth(req, phase, month)
      }
    }
  }

  // External hours: all active statuses regardless of status_set
  const phaseMap = new Map<string, { phase: Phase; item: DemandItem }>()
  for (const item of state.demandItems) {
    if (item.parent_project_id !== project_id) continue
    for (const phase of item.phases) phaseMap.set(phase.id, { phase, item })
  }
  for (const ext of state.externalResourceRequirements) {
    const entry = phaseMap.get(ext.phase_id)
    if (!entry) continue
    const { phase, item } = entry
    if (!ACTIVE_FOR_EXTERNAL_STATUSES.has(item.status)) continue
    if (!phaseContainsMonth(phase, month)) continue
    result[phase.funding_source] += extHoursForMonth(ext, phase, month)
  }

  return result
}

export function project_demand_by_team(
  project_id: string,
  month: string,
  opts: { status_set: ReadonlySet<DemandStatus> },
  state: AppState
): DemandByTeamEntry[] {
  const acc = new Map<string, DemandByTeamEntry>()
  const teamMap = new Map(state.teams.map(t => [t.id, t]))
  const fnMap = new Map(state.functions.map(f => [f.id, f]))
  const providerMap = new Map(state.providers.map(p => [p.id, p]))

  function getOrCreateTeam(teamId: string | null): DemandByTeamEntry {
    if (teamId === null) {
      if (!acc.has('team:unassigned')) {
        acc.set('team:unassigned', { key: 'team:unassigned', hours: 0, label: 'Unassigned', parent_function_label: 'Unassigned', source: 'internal' })
      }
      return acc.get('team:unassigned')!
    }
    const k = `team:${teamId}`
    if (!acc.has(k)) {
      const team = teamMap.get(teamId)
      const fn = team ? fnMap.get(team.functionId) : undefined
      acc.set(k, { key: k, hours: 0, label: team?.name ?? teamId, parent_function_label: fn?.name ?? 'Unknown', source: 'internal' })
    }
    return acc.get(k)!
  }

  function getOrCreateProvider(providerId: string): DemandByTeamEntry {
    const k = `provider:${providerId}`
    if (!acc.has(k)) {
      const provider = providerMap.get(providerId)
      acc.set(k, { key: k, hours: 0, label: provider?.name ?? providerId, parent_function_label: 'External', source: 'external' })
    }
    return acc.get(k)!
  }

  // Internal hours
  for (const item of state.demandItems) {
    if (item.parent_project_id !== project_id) continue
    if (!opts.status_set.has(item.status)) continue
    for (const phase of item.phases) {
      if (!phaseContainsMonth(phase, month)) continue
      for (const req of phase.requirements) {
        const h = reqHoursForMonth(req, phase, month)
        if (h > 0) getOrCreateTeam(req.owningTeamId).hours += h
      }
    }
  }

  // External hours: all active statuses regardless of status_set
  const phaseMap = new Map<string, { phase: Phase; item: DemandItem }>()
  for (const item of state.demandItems) {
    if (item.parent_project_id !== project_id) continue
    for (const phase of item.phases) phaseMap.set(phase.id, { phase, item })
  }
  for (const ext of state.externalResourceRequirements) {
    const entry = phaseMap.get(ext.phase_id)
    if (!entry) continue
    const { phase, item } = entry
    if (!ACTIVE_FOR_EXTERNAL_STATUSES.has(item.status)) continue
    if (!phaseContainsMonth(phase, month)) continue
    const h = extHoursForMonth(ext, phase, month)
    if (h > 0) getOrCreateProvider(ext.provider_id).hours += h
  }

  const sortOrder = (e: DemandByTeamEntry) =>
    e.parent_function_label === 'External' ? 2 : e.parent_function_label === 'Unassigned' ? 1 : 0

  return [...acc.values()]
    .filter(e => e.hours > 0)
    .sort((a, b) => {
      const ao = sortOrder(a), bo = sortOrder(b)
      if (ao !== bo) return ao - bo
      const pfCmp = a.parent_function_label.localeCompare(b.parent_function_label)
      if (pfCmp !== 0) return pfCmp
      return a.label.localeCompare(b.label)
    })
}

export function programme_demand_by_funding(
  programme_id: string,
  month: string,
  opts: { status_set: ReadonlySet<DemandStatus> },
  state: AppState
): DemandByFundingResult {
  const result: DemandByFundingResult = { 'Investment Scheme': 0, 'Plant/Sector Allocation': 0, 'Mixed': 0 }
  for (const project of state.projects.filter(p => p.programme_id === programme_id && p.active)) {
    const pr = project_demand_by_funding(project.id, month, opts, state)
    result['Investment Scheme'] += pr['Investment Scheme']
    result['Plant/Sector Allocation'] += pr['Plant/Sector Allocation']
    result['Mixed'] += pr['Mixed']
  }
  return result
}

export function programme_demand_by_team(
  programme_id: string,
  month: string,
  opts: { status_set: ReadonlySet<DemandStatus> },
  state: AppState
): DemandByTeamEntry[] {
  const acc = new Map<string, DemandByTeamEntry>()
  for (const project of state.projects.filter(p => p.programme_id === programme_id && p.active)) {
    for (const entry of project_demand_by_team(project.id, month, opts, state)) {
      if (acc.has(entry.key)) {
        acc.get(entry.key)!.hours += entry.hours
      } else {
        acc.set(entry.key, { ...entry })
      }
    }
  }

  const sortOrder = (e: DemandByTeamEntry) =>
    e.parent_function_label === 'External' ? 2 : e.parent_function_label === 'Unassigned' ? 1 : 0

  return [...acc.values()].sort((a, b) => {
    const ao = sortOrder(a), bo = sortOrder(b)
    if (ao !== bo) return ao - bo
    const pfCmp = a.parent_function_label.localeCompare(b.parent_function_label)
    if (pfCmp !== 0) return pfCmp
    return a.label.localeCompare(b.label)
  })
}

// ─── Runtime invariant checker (dev mode) ────────────────────────────────────
// Call from a debug panel or the browser console to verify correctness.

export interface InvariantResult {
  ok: boolean
  failures: string[]
}

export function checkInvariants(
  state: AppState,
  months: string[],
  overlayItemId?: string | null
): InvariantResult {
  const failures: string[] = []
  const proj = computeProjection(state, months, overlayItemId)

  // Invariant B: for every person-month, real_committed + projected_consumption <= contracted
  for (const person of state.people) {
    if (!person.active) continue
    for (const month of months) {
      if (!monthInRange(month, person.available_from, person.available_to)) continue
      const rch = real_committed_hours(person.id, month, state)
      const pc = projected_consumption(person.id, month, proj)
      const contracted = person.contracted_hours_per_month
      if (rch + pc > contracted + 0.01) {
        failures.push(
          `Invariant B violated: ${person.name} ${month} — rch(${rch.toFixed(1)}) + projected(${pc.toFixed(1)}) = ${(rch + pc).toFixed(1)} > contracted(${contracted})`
        )
      }
    }
  }

  // Invariant C: shortfalls must exist for every skill-month where headroom < demand
  // (implicitly guaranteed by computeProjection surfacing them — just verify non-zero)
  for (const sf of proj.shortfalls) {
    if (sf.shortfall_hours <= 0) {
      failures.push(`Invariant C: shortfall record for ${sf.skill_id} ${sf.month} has zero hours`)
    }
  }

  // Invariant A: submitted overlay === approved-no-allocs
  // Check: if we set overlay item to Approved with no allocs, demand numbers must match
  if (overlayItemId) {
    const overlayItem = state.demandItems.find(d => d.id === overlayItemId)
    if (overlayItem && overlayItem.status === 'Submitted') {
      // Compare demand_hours_for with overlay vs with item promoted to Approved
      const fakeState: AppState = {
        ...state,
        demandItems: state.demandItems.map(d =>
          d.id === overlayItemId
            ? { ...d, status: 'Approved' as DemandStatus, phases: d.phases.map(ph => ({ ...ph, requirements: ph.requirements.map(r => ({ ...r, allocations: [] })) })) }
            : d
        ),
      }
      const COMMITTED_STATUSES: ReadonlySet<DemandStatus> = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])
      for (const domain of state.domains) {
        for (const month of months) {
          const withOverlay = demand_hours_for({ type: 'domain', id: domain.id }, COMMITTED_STATUSES, month, state, overlayItemId)
          const withPromo = demand_hours_for({ type: 'domain', id: domain.id }, COMMITTED_STATUSES, month, fakeState)
          const ovTotal = withOverlay.strategy + withOverlay.plant + withOverlay.npd + withOverlay.bau
          const promoTotal = withPromo.strategy + withPromo.plant + withPromo.npd + withPromo.bau
          if (Math.abs(ovTotal - promoTotal) > 0.01) {
            failures.push(
              `Invariant A: domain ${domain.name} ${month} — overlay(${ovTotal.toFixed(1)}) ≠ promoted(${promoTotal.toFixed(1)})`
            )
          }
        }
      }
    }
  }

  return { ok: failures.length === 0, failures }
}
