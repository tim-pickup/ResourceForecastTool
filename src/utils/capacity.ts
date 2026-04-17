import { addMonths, format, parseISO, isAfter, isBefore } from 'date-fns'
import type { Person, BauAllocation, DemandItem, AppState } from '../types'

export function monthInRange(month: string, from: string | null, to: string | null): boolean {
  const d = parseISO(month + '-01')
  if (from && isBefore(d, parseISO(from + '-01'))) return false
  if (to && isAfter(d, parseISO(to + '-01'))) return false
  return true
}

export function getPersonBauHours(personId: string, month: string, bauAllocations: BauAllocation[]): number {
  return bauAllocations
    .filter(a => a.person_id === personId && monthInRange(month, a.effective_from, a.effective_to))
    .reduce((sum, a) => sum + a.hours_per_month, 0)
}

export function getPersonNamedProjectHours(
  personId: string,
  month: string,
  demandItems: DemandItem[],
  includeSubmitted = false
): number {
  let total = 0
  for (const item of demandItems) {
    const counted = item.status === 'Accepted' || item.status === 'Allocated' ||
      (includeSubmitted && item.status === 'Submitted')
    if (!counted) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        if (req.shape === 'named' && req.person_id === personId) {
          total += req.hours_per_month
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
  const bau = getPersonBauHours(person.id, month, state.bauAllocations)
  const project = getPersonNamedProjectHours(person.id, month, state.demandItems, includeSubmitted)
  const contracted = person.contracted_hours_per_month
  const total = bau + project
  return { bau, project, contracted, total, available: contracted - total, overAllocated: total > contracted }
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
        if (req.shape === 'named' && req.person_id === personId) {
          total += req.hours_per_month
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

export function getThemeSkillDemand(
  themeId: string,
  month: string,
  state: AppState,
  statuses: string[] = ['Accepted', 'Allocated']
): number {
  let total = 0
  for (const item of state.demandItems) {
    if (!statuses.includes(item.status)) continue
    for (const phase of item.phases) {
      if (!monthInRange(month, phase.start_month, phase.end_month)) continue
      for (const req of phase.requirements) {
        if (req.shape === 'skill') {
          const skill = state.skills.find(s => s.id === req.skill_id)
          if (skill?.theme_id === themeId) total += req.hours_per_month
        } else {
          const person = state.people.find(p => p.id === req.person_id)
          if (person?.primary_theme_id === themeId) total += req.hours_per_month
        }
      }
    }
  }
  return total
}
