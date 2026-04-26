export type Level = 'Basic' | 'Advanced' | 'Specialist'
export type DemandStatus = 'Draft' | 'Submitted' | 'Approved' | 'PartiallyAllocated' | 'Allocated'
export type ProjectStatus = 'Draft' | 'Scoping' | 'Submitted' | 'Approved' | 'Allocated'
export type DemandType = 'Group Strategy Project' | 'Plant Project' | 'NPD Demand' | 'BAU'
export type FundingSource = 'Investment Scheme' | 'Plant/Sector Allocation' | 'Mixed'

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

// Renamed from DemandTeamAssignment in v1.18 — FK now points at Project, not Demand
export interface ProjectTeamAssignment {
  id: string
  projectId: string    // was demandId
  phaseId: string
  teamId: string
  confirmed: boolean
  confirmedBy: string | null
  confirmedAt: string | null
}

// Keep old name as alias so existing imports don't all break at once
export type DemandTeamAssignment = ProjectTeamAssignment

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
  owningTeamId: string | null
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
  description: string
  function_id: string          // required — single Function this Demand belongs to
  parent_project_id: string | null  // null for direct Demands
  phases: Phase[]              // direct Demands own their phases; Project-spawned present Project's phases
}

// ─── v1.14 entities ───────────────────────────────────────────────────────────

export interface Programme {
  id: string
  name: string       // globally unique, case-insensitive
  description: string
  active: boolean
}

// Upgraded in v1.18: Project is now the planning vehicle (holds phases + requirements)
export interface Project {
  id: string
  name: string
  owner: string
  type: DemandType
  programme_id: string | null  // nullable — a Project may be unaligned (no Programme)
  description: string
  status: ProjectStatus
  phases: Phase[]    // phases and requirements live on the Project for spawned Demands
  active: boolean
}

export interface Provider {
  id: string
  name: string       // globally unique, case-insensitive
}

// Hours representation mirrors SkillRequirement: exactly one of
// hours_by_month (finite phase) or steady_state_hours (indefinite phase)
// is populated per requirement.
export interface ExternalResourceRequirement {
  id: string
  phase_id: string
  provider_id: string
  role: string       // free text, required
  notes: string | null
  hours_by_month: Record<string, number>
  steady_state_hours: number | null
}

// ─── App state ────────────────────────────────────────────────────────────────

export interface AppState {
  activeFunctionId: string | null
  functions: AppFunction[]
  teams: Team[]
  projectTeamAssignments: ProjectTeamAssignment[]  // renamed from demandTeamAssignments
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

export function getExternalRequirementsForPhase(
  phase_id: string,
  state: Pick<AppState, 'externalResourceRequirements'>
): ExternalResourceRequirement[] {
  return state.externalResourceRequirements.filter(r => r.phase_id === phase_id)
}

export function derivedPrimaryDomain(item: Pick<DemandItem, 'phases'>, domains: Domain[], skills: Skill[]): Domain | null {
  const totals = new Map<string, number>()
  for (const phase of item.phases) {
    for (const req of phase.requirements) {
      const skill = skills.find(s => s.id === req.skill_id)
      if (!skill) continue
      const hours = phase.end_month === null
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
// v1.18: Draft → Submitted (direct Demands), Submitted → Approved
export const VALID_DEMAND_TRANSITIONS: Partial<Record<DemandStatus, DemandStatus[]>> = {
  Draft: ['Submitted'],
  Submitted: ['Approved'],
}

// Alias for backward compatibility with existing callers
export const VALID_TRANSITIONS = VALID_DEMAND_TRANSITIONS

export function isValidTransition(from: DemandStatus, to: DemandStatus): boolean {
  return VALID_DEMAND_TRANSITIONS[from]?.includes(to) ?? false
}
