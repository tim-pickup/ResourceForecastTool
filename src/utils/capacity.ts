import { addMonths, format, parseISO, isAfter, isBefore, differenceInMonths } from 'date-fns'
import type { Person, DemandItem, AppState, Level, Requirement, Phase, NamedAllocation } from '../types'

export function monthInRange(month: string, from: string | null, to: string | null): boolean {
  const d = parseISO(month + '-01')
  if (from && isBefore(d, parseISO(from + '-01'))) return false
  if (to && isAfter(d, parseISO(to + '-01'))) return false
  return true
}

function getReqHoursForMonth(req: Requirement, month: string, phase: Phase): number {
  if (phase.end_month === null) return req.steady_state_hours ?? 0
  return req.hours_by_month[month] ?? 0
}

function getAllocHoursForMonth(alloc: NamedAllocation, month: string, phase: Phase): number {
  if (phase.end_month === null) return alloc.steady_state_hours ?? 0
  return alloc.hours_by_month[month] ?? 0
}

export function getPersonBauHoursFromDemand(personId: string, month: string, demandItems: DemandItem[]): number {
  let total = 0
  for (const item of demandItems) {
    if (item.type !== 'BAU') continue
    if (item.status !== 'Approved' && item.status !== 'PartiallyAllocated' && item.status !== 'Allocated') continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        for (const alloc of req.allocations) {
          if (alloc.person_id === personId) {
            total += getAllocHoursForMonth(alloc, month, phase)
          }
        }
      }
    }
  }
  return total
}

export function getPersonNamedProjectHours(
  personId: string,
  month: string,
  demandItems: DemandItem[],
  includeSubmitted = false
): number {
  let total = 0
  for (const item of demandItems) {
    const counted = item.status === 'Approved' || item.status === 'PartiallyAllocated' || item.status === 'Allocated' ||
      (includeSubmitted && item.status === 'Submitted')
    if (!counted) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        for (const alloc of req.allocations) {
          if (alloc.person_id === personId) {
            total += getAllocHoursForMonth(alloc, month, phase)
          }
        }
      }
    }
  }
  return total
}

export function getPersonLoad(
  person: Person,
  month: string,
  state: AppState,
  includeSubmitted = false
): { bau: number; project: number; contracted: number; total: number; available: number; overAllocated: boolean } {
  if (!monthInRange(month, person.available_from, person.available_to)) {
    return { bau: 0, project: 0, contracted: 0, total: 0, available: 0, overAllocated: false }
  }
  const bau = getPersonBauHoursFromDemand(person.id, month, state.demandItems)
  const allNamed = getPersonNamedProjectHours(person.id, month, state.demandItems, includeSubmitted)
  const project = allNamed - bau
  const contracted = person.contracted_hours_per_month
  return { bau, project, contracted, total: allNamed, available: contracted - allNamed, overAllocated: allNamed > contracted }
}

export function getPersonAvailableHoursExcluding(
  personId: string,
  month: string,
  state: AppState,
  excludeAllocId: string | null
): number {
  const person = state.people.find(p => p.id === personId)
  if (!person) return 0
  if (!monthInRange(month, person.available_from, person.available_to)) return 0

  let committed = 0
  for (const item of state.demandItems) {
    if (item.status !== 'Approved' && item.status !== 'PartiallyAllocated' && item.status !== 'Allocated') continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        for (const alloc of req.allocations) {
          if (alloc.person_id === personId && alloc.id !== excludeAllocId) {
            committed += getAllocHoursForMonth(alloc, month, phase)
          }
        }
      }
    }
  }
  return person.contracted_hours_per_month - committed
}

export function getPersonAvgAvailableForPhase(
  personId: string,
  phaseStartMonth: string,
  phaseEndMonth: string | null,
  state: AppState
): number {
  const person = state.people.find(p => p.id === personId)
  if (!person) return 0
  let months: string[]
  if (phaseEndMonth === null) {
    months = generateMonths(phaseStartMonth, 3)
  } else {
    try {
      const s = parseISO(phaseStartMonth + '-01')
      const e = parseISO(phaseEndMonth + '-01')
      const count = differenceInMonths(e, s) + 1
      months = count > 0 ? generateMonths(phaseStartMonth, count) : []
    } catch { months = [] }
  }
  if (months.length === 0) return 0
  const total = months.reduce((s, m) => s + Math.max(0, getPersonAvailableHoursExcluding(personId, m, state, null)), 0)
  return Math.round(total / months.length)
}

export function getOverlayHoursForPerson(
  personId: string,
  month: string,
  overlayItems: DemandItem[]
): number {
  let total = 0
  for (const item of overlayItems) {
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        for (const alloc of req.allocations) {
          if (alloc.person_id === personId) {
            total += getAllocHoursForMonth(alloc, month, phase)
          }
        }
      }
    }
  }
  return total
}

export function generateMonths(startMonth: string, count: number): string[] {
  const months: string[] = []
  let current = parseISO(startMonth + '-01')
  for (let i = 0; i < count; i++) {
    months.push(format(current, 'yyyy-MM'))
    current = addMonths(current, 1)
  }
  return months
}

export function getCurrentMonth(): string {
  return format(new Date(), 'yyyy-MM')
}

export function formatMonthLabel(month: string): string {
  return format(parseISO(month + '-01'), 'MMM yy')
}

export function utilPct(load: number, contracted: number): number {
  if (contracted === 0) return 0
  return Math.round((load / contracted) * 100)
}

export function utilColor(pct: number): string {
  if (pct > 100) return 'bg-red-100 text-red-700 border-red-200'
  if (pct > 85) return 'bg-amber-50 text-amber-700 border-amber-200'
  if (pct > 0) return 'bg-blue-50 text-blue-700 border-blue-100'
  return 'bg-gray-50 text-gray-400 border-gray-100'
}

// ─── Aggregate capacity & demand (chart-level) ───────────────────────────────

export interface DemandBreakdown {
  strategy: number // Group Strategy Project
  plant: number    // Plant Project
  npd: number      // NPD Demand
  bau: number      // BAU-type demand items
}

const LEVEL_ORDER: Record<Level, number> = { Basic: 0, Advanced: 1, Specialist: 2 }

function meetsLevel(held: Level, required: Level): boolean {
  return LEVEL_ORDER[held] >= LEVEL_ORDER[required]
}

function activePeopleInMonth(month: string, state: AppState): Person[] {
  return state.people.filter(p => p.active && monthInRange(month, p.available_from, p.available_to))
}

function personIdsWithDomainSkills(domainId: string, state: AppState): Set<string> {
  const ids = new Set(state.skills.filter(s => s.domain_id === domainId).map(s => s.id))
  return new Set(state.people.filter(p => p.active && p.skills.some(ps => ids.has(ps.skill_id))).map(p => p.id))
}

function personIdsWithSkill(skillId: string, state: AppState, minLevel?: Level): Set<string> {
  return new Set(
    state.people.filter(p => p.active && p.skills.some(ps =>
      ps.skill_id === skillId && (!minLevel || meetsLevel(ps.level, minLevel))
    )).map(p => p.id)
  )
}

function demandFromItems(
  items: DemandItem[],
  month: string,
  reqFilter: (r: Requirement) => boolean,
  statuses: Set<string>
): DemandBreakdown {
  const out: DemandBreakdown = { strategy: 0, plant: 0, npd: 0, bau: 0 }
  for (const item of items) {
    if (!statuses.has(item.status)) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      const hrs = phase.requirements.filter(reqFilter).reduce((s, r) => {
        return s + getReqHoursForMonth(r, month, phase)
      }, 0)
      if (hrs === 0) continue
      if (item.type === 'Group Strategy Project') out.strategy += hrs
      else if (item.type === 'Plant Project') out.plant += hrs
      else if (item.type === 'NPD Demand') out.npd += hrs
      else if (item.type === 'BAU') out.bau += hrs
    }
  }
  return out
}

const COMMITTED = new Set(['Approved', 'PartiallyAllocated', 'Allocated'])
void COMMITTED

export function getTeamCapacity(month: string, state: AppState): number {
  return activePeopleInMonth(month, state).reduce((s, p) => s + p.contracted_hours_per_month, 0)
}

export function getTeamDemand(
  month: string,
  state: AppState,
  statuses: string[] = ['Approved', 'PartiallyAllocated', 'Allocated']
): DemandBreakdown {
  return demandFromItems(state.demandItems, month, () => true, new Set(statuses))
}

export function getDomainCapacity(domainId: string, month: string, state: AppState): number {
  const inDomain = personIdsWithDomainSkills(domainId, state)
  return activePeopleInMonth(month, state)
    .filter(p => inDomain.has(p.id))
    .reduce((s, p) => s + Math.max(0, p.contracted_hours_per_month - getPersonBauHoursFromDemand(p.id, month, state.demandItems)), 0)
}

export function getDomainDemand(
  domainId: string,
  month: string,
  state: AppState,
  statuses: string[] = ['Approved', 'PartiallyAllocated', 'Allocated']
): DemandBreakdown {
  const domainSkillIds = new Set(state.skills.filter(s => s.domain_id === domainId).map(s => s.id))
  const reqFilter = (r: Requirement) => domainSkillIds.has(r.skill_id)
  return demandFromItems(state.demandItems, month, reqFilter, new Set(statuses))
}

export function getSkillCapacity(skillId: string, month: string, state: AppState, minLevel?: Level): number {
  const withSkill = personIdsWithSkill(skillId, state, minLevel)
  return activePeopleInMonth(month, state)
    .filter(p => withSkill.has(p.id))
    .reduce((s, p) => s + Math.max(0, p.contracted_hours_per_month - getPersonBauHoursFromDemand(p.id, month, state.demandItems)), 0)
}

export function getSkillDemand(
  skillId: string,
  month: string,
  state: AppState,
  statuses: string[] = ['Approved', 'PartiallyAllocated', 'Allocated']
): DemandBreakdown {
  const reqFilter = (r: Requirement) => r.skill_id === skillId
  return demandFromItems(state.demandItems, month, reqFilter, new Set(statuses))
}

export function getOverlayDemand(month: string, overlayItems: DemandItem[]): number {
  let total = 0
  for (const item of overlayItems) {
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      total += phase.requirements.reduce((s, r) => s + getReqHoursForMonth(r, month, phase), 0)
    }
  }
  return total
}

export function getPeopleForSkill(skillId: string, state: AppState): Array<{ person: Person; level: Level }> {
  return state.people
    .filter(p => p.active)
    .flatMap(p => {
      const ps = p.skills.find(s => s.skill_id === skillId)
      return ps ? [{ person: p, level: ps.level }] : []
    })
}

export function getDomainSkillDemand(
  domainId: string,
  month: string,
  state: AppState,
  statuses: string[] = ['Approved', 'PartiallyAllocated', 'Allocated']
): number {
  let total = 0
  for (const item of state.demandItems) {
    if (!statuses.includes(item.status)) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        const skill = state.skills.find(s => s.id === req.skill_id)
        if (skill?.domain_id === domainId) total += getReqHoursForMonth(req, month, phase)
      }
    }
  }
  return total
}
