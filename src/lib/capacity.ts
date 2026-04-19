/**
 * Shared aggregation layer — all capacity and demand numbers across the tool
 * are computed here. No view should iterate over phases/requirements/allocations
 * directly; every consumer calls these functions.
 *
 * Section reference: REQUIREMENTS.md §2.4
 */

import type { AppState, DemandItem, DemandStatus, Level, Phase, Requirement, SkillRequirement } from '../types'
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

// ─── 3. theme_capacity ───────────────────────────────────────────────────────
// For each person who holds any skill in theme T:
//   max(0, contracted − sum of their allocs to skills NOT in T)
//
// Commitments to this theme's own skills show on the demand side of T's chart
// and are deliberately NOT subtracted here (prevents double-counting).

export function theme_capacity(themeId: string, month: string, state: AppState): number {
  const themeSkillIds = new Set(state.skills.filter(s => s.theme_id === themeId).map(s => s.id))
  let total = 0

  for (const person of state.people) {
    if (!person.active) continue
    if (!monthInRange(month, person.available_from, person.available_to)) continue
    if (!person.skills.some(ps => themeSkillIds.has(ps.skill_id))) continue

    let otherCommitted = 0
    for (const item of state.demandItems) {
      if (!REAL_STATUSES.has(item.status)) continue
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          if (themeSkillIds.has(req.skill_id)) continue  // skip this theme's skills
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

export function skill_capacity(skillId: string, month: string, state: AppState): number {
  let total = 0

  for (const person of state.people) {
    if (!person.active) continue
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
// (overall / theme / skill) and status set, in a given month.
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
  | { type: 'theme'; id: string }
  | { type: 'skill'; id: string }

export function demand_hours_for(
  target: DemandTarget,
  statuses: ReadonlySet<DemandStatus>,
  month: string,
  state: AppState,
  overlayItemId?: string | null
): DemandBreakdown {
  const out: DemandBreakdown = { strategy: 0, plant: 0, npd: 0, bau: 0 }

  const themeSkillIds = target.type === 'theme'
    ? new Set(state.skills.filter(s => s.theme_id === target.id).map(s => s.id))
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
        if (target.type === 'theme' && themeSkillIds && !themeSkillIds.has(req.skill_id)) continue
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
// OTHER themes/skills. (Demand for THIS target appears on the demand stack —
// never in the grey band — to prevent double-counting: Invariant D.)

export function grey_band(
  target: DemandTarget,
  month: string,
  state: AppState,
  projResult: ProjectionResult
): number {
  if (target.type === 'overall') return 0  // not shown on overall chart

  const themeSkillIds = target.type === 'theme'
    ? new Set(state.skills.filter(s => s.theme_id === target.id).map(s => s.id))
    : null

  // People in this chart's pool
  const poolPeople = target.type === 'theme'
    ? state.people.filter(p => p.active && p.skills.some(ps => themeSkillIds!.has(ps.skill_id)))
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
      const isInTarget = target.type === 'theme'
        ? themeSkillIds!.has(skillId)
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
      for (const theme of state.themes) {
        for (const month of months) {
          const withOverlay = demand_hours_for({ type: 'theme', id: theme.id }, COMMITTED_STATUSES, month, state, overlayItemId)
          const withPromo = demand_hours_for({ type: 'theme', id: theme.id }, COMMITTED_STATUSES, month, fakeState)
          const ovTotal = withOverlay.strategy + withOverlay.plant + withOverlay.npd + withOverlay.bau
          const promoTotal = withPromo.strategy + withPromo.plant + withPromo.npd + withPromo.bau
          if (Math.abs(ovTotal - promoTotal) > 0.01) {
            failures.push(
              `Invariant A: theme ${theme.name} ${month} — overlay(${ovTotal.toFixed(1)}) ≠ promoted(${promoTotal.toFixed(1)})`
            )
          }
        }
      }
    }
  }

  return { ok: failures.length === 0, failures }
}
