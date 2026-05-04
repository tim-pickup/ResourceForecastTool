export type Level = 'Basic' | 'Advanced' | 'Specialist'
export type DemandStatus = 'Draft' | 'Submitted' | 'Approved' | 'PartiallyAllocated' | 'Allocated'
export type ProjectStatus = 'Draft' | 'Scoping' | 'Submitted' | 'Approved' | 'Allocated'
// v1.19: DemandType is now a string (FK to ProjectType.id). No longer a hardcoded union.
export type DemandType = string
export type FundingSource = 'Investment Scheme' | 'Plant/Sector Allocation' | 'Mixed'

// ─── v1.19 — Project Type entity (§2.1.2) ────────────────────────────────────

export interface ProjectType {
  id: string
  name: string
  display_order: number   // drives picker order and capacity-stack order (bottom-to-top)
  colour_token: string    // named token from design-system palette
  is_bau: boolean         // exactly one record has this set; system-managed
  active: boolean
}

export interface AppFunction {
  id: string
  name: string
  description: string
  active: boolean
}

export interface Team {
  id: string
  name: string
  description: string
  functionId: string
  type: 'Plant' | 'Central' | 'Specialist' | 'Other'
  active: boolean
}

export interface Domain {
  id: string
  name: string
  description: string
  functionId: string
}

export interface Skill {
  id: string
  domain_id: string
  name: string
}

export interface PersonSkill {
  skill_id: string
  level: Level
}

export interface Person {
  id: string
  name: string
  primary_domain_id: string
  contracted_hours_per_month: number
  available_from: string | null
  available_to: string | null
  active: boolean
  skills: PersonSkill[]
  teamId: string
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

export interface Activity {
  id: string
  name: string
  start_month: string
  end_month: string | null  // null = indefinite activity
  funding_source: FundingSource
  funding_notes: string
  requirements: Requirement[]
}

export interface DemandItem {
  id: string
  name: string
  type: string             // FK to ProjectType.id (v1.19)
  status: DemandStatus
  owner: string
  description: string
  function_id: string      // required — single Function this Demand belongs to
  parent_project_id: string | null  // null for direct Demands
  activities: Activity[]   // Demands own their activities (materialised at spawn for Project-spawned)
}

// ─── v1.14 entities ───────────────────────────────────────────────────────────

export interface Programme {
  id: string
  name: string       // globally unique, case-insensitive
  description: string
  active: boolean
}

export interface Project {
  id: string
  name: string
  owner: string
  type: string             // FK to ProjectType.id (v1.19)
  programme_id: string | null
  description: string
  status: ProjectStatus
  activities: Activity[]
  active: boolean
  functions_required: string[]          // originator's declared Functions; frozen at Submit
  functions_actually_involved: string[] // derived from requirements; frozen at Submit
  created_under_function_id: string | null  // active Function at creation time; tiebreaker for Draft/Scoping visibility (v1.20)
}

export interface Provider {
  id: string
  name: string       // globally unique, case-insensitive
}

export interface ExternalResourceRequirement {
  id: string
  activity_id: string
  provider_id: string
  role: string
  notes: string | null
  hours_by_month: Record<string, number>
  steady_state_hours: number | null
  function_tag: string | null  // Function that owns coordinating this external req (v1.19)
}

// ─── App state ────────────────────────────────────────────────────────────────

export interface AppState {
  activeFunctionId: string | null
  functions: AppFunction[]
  teams: Team[]
  projectTypes: ProjectType[]
  domains: Domain[]
  skills: Skill[]
  people: Person[]
  demandItems: DemandItem[]
  programmes: Programme[]
  projects: Project[]
  providers: Provider[]
  externalResourceRequirements: ExternalResourceRequirement[]
}

// ─── Selector helpers ─────────────────────────────────────────────────────────

export function getExternalRequirementsForActivity(
  activity_id: string,
  state: Pick<AppState, 'externalResourceRequirements'>
): ExternalResourceRequirement[] {
  return state.externalResourceRequirements.filter(r => r.activity_id === activity_id)
}

export function derivedPrimaryDomain(item: Pick<DemandItem, 'activities'>, domains: Domain[], skills: Skill[]): Domain | null {
  const totals = new Map<string, number>()
  for (const activity of item.activities) {
    for (const req of activity.requirements) {
      const skill = skills.find(s => s.id === req.skill_id)
      if (!skill) continue
      const hours = activity.end_month === null
        ? (req.steady_state_hours ?? 0)
        : Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
      totals.set(skill.domain_id, (totals.get(skill.domain_id) ?? 0) + hours)
    }
  }
  if (totals.size === 0) return null
  const [topDomainId] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]
  return domains.find(d => d.id === topDomainId) ?? null
}

// User-driven Demand state machine transitions (system auto-transitions excluded)
export const VALID_DEMAND_TRANSITIONS: Partial<Record<DemandStatus, DemandStatus[]>> = {
  Draft: ['Submitted'],
  Submitted: ['Approved'],
}

export const VALID_TRANSITIONS = VALID_DEMAND_TRANSITIONS

export function isValidTransition(from: DemandStatus, to: DemandStatus): boolean {
  return VALID_DEMAND_TRANSITIONS[from]?.includes(to) ?? false
}
