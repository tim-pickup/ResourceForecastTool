export type Level = 'Basic' | 'Advanced' | 'Specialist'
export type DemandStatus = 'Draft' | 'Submitted' | 'Accepted' | 'Allocated' | 'Parked'
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

export interface BauStream {
  id: string
  name: string
  description: string
  owning_theme_id: string
}

export interface BauAllocation {
  id: string
  person_id: string
  stream_id: string
  hours_per_month: number
  effective_from: string
  effective_to: string | null
}

export interface SkillRequirement {
  id: string
  shape: 'skill'
  skill_id: string
  level: Level
  hours_per_month: number
  notes: string | null
  promoted_from?: string
}

export interface NamedRequirement {
  id: string
  shape: 'named'
  person_id: string
  hours_per_month: number
  notes: string | null
  promoted_from?: string
}

export type Requirement = SkillRequirement | NamedRequirement

export interface Phase {
  id: string
  name: string
  start_month: string
  end_month: string
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
  phases: Phase[]
}

export interface AppState {
  themes: Theme[]
  skills: Skill[]
  people: Person[]
  bauStreams: BauStream[]
  bauAllocations: BauAllocation[]
  demandItems: DemandItem[]
}
