export type Level = 'Basic' | 'Advanced' | 'Specialist'
export type DemandStatus = 'Draft' | 'Submitted' | 'Approved' | 'PartiallyAllocated' | 'Allocated' | 'Parked' | 'Closed'
export type DemandType = 'Group Strategy Project' | 'Plant Project' | 'NPD Demand' | 'BAU'
export type FundingSource = 'Investment Scheme' | 'Plant/Sector Allocation' | 'Mixed'

export interface Theme {
  id: string
  name: string
  description: string
}

export interface Skill {
  id: string
  theme_id: string
  name: string
}

export interface PersonSkill {
  skill_id: string
  level: Level
}

export interface Person {
  id: string
  name: string
  primary_theme_id: string
  contracted_hours_per_month: number
  available_from: string | null
  available_to: string | null
  active: boolean
  skills: PersonSkill[]
}

export interface NamedAllocation {
  id: string
  person_id: string
  hours_by_month: Record<string, number>
  steady_state_hours?: number | null
  notes: string | null
}

export interface SkillRequirement {
  id: string
  shape: 'skill'
  skill_id: string
  level: Level
  hours_by_month: Record<string, number>
  steady_state_hours?: number | null
  notes: string | null
  allocations: NamedAllocation[]
}

export type Requirement = SkillRequirement

export interface Phase {
  id: string
  name: string
  start_month: string
  end_month: string | null  // null = indefinite phase
  funding_source: FundingSource
  funding_notes: string
  requirements: Requirement[]
}

export interface DemandItem {
  id: string
  name: string
  type: DemandType
  status: DemandStatus
  owner: string
  primary_theme_id: string
  description: string
  parked_reason: string | null
  previous_status: DemandStatus | null
  closed_at: string | null
  phases: Phase[]
}

export interface AppState {
  themes: Theme[]
  skills: Skill[]
  people: Person[]
  demandItems: DemandItem[]
}

// State machine — valid user-driven transitions (not including system auto-transitions)
export const VALID_TRANSITIONS: Partial<Record<DemandStatus, DemandStatus[]>> = {
  Draft: ['Submitted'],
  Submitted: ['Draft', 'Approved', 'Parked'],
  Approved: ['Parked', 'Closed'],
  PartiallyAllocated: ['Parked', 'Closed'],
  Allocated: ['Parked', 'Closed'],
  Parked: ['Submitted'],
  Closed: [],
}

export function isValidTransition(from: DemandStatus, to: DemandStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}
