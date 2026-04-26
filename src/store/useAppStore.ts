import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppFunction, Team, ProjectTeamAssignment,
  Domain, Skill, Person, DemandItem, AppState, DemandStatus,
  Programme, Project, ProjectStatus, Provider, ExternalResourceRequirement,
} from '../types'
import { generateId } from '../utils/ids'
import seedRaw from '../../DEMOSEED.json'

// Status conversions for old statuses that no longer exist in v1.18
function migrateDemandStatus(s: string): DemandStatus {
  if (s === 'Parked' || s === 'Closed' || s === 'Scoping') return 'Draft'
  if (s === 'Accepted') return 'Approved'
  return s as DemandStatus
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSeed(raw: any): AppState {
  const items: any[] = raw.demand_items || []
  const activeFns: AppFunction[] = (raw.functions || []).filter((f: any) => f.active)
  activeFns.sort((a, b) => a.name.localeCompare(b.name))

  // Support both old seed format (demand_team_assignments with demandId)
  // and new format (project_team_assignments with projectId)
  const rawPtas: any[] = raw.project_team_assignments || raw.demand_team_assignments || []
  const projectTeamAssignments: ProjectTeamAssignment[] = rawPtas.map((a: any) => ({
    id: a.id,
    projectId: a.projectId ?? a.demandId ?? '',  // migrate old demandId field
    phaseId: a.phaseId,
    teamId: a.teamId,
    confirmed: a.confirmed ?? false,
    confirmedBy: a.confirmedBy ?? null,
    confirmedAt: a.confirmedAt ?? null,
  }))

  // Upgrade old Project format (no status/phases/owner/type) to v1.18 Project
  const projects: Project[] = (raw.projects || []).map((p: any): Project => ({
    id: p.id,
    name: p.name,
    owner: p.owner ?? '',
    type: p.type ?? 'Group Strategy Project',
    programme_id: p.programme_id ?? null,
    description: p.description ?? '',
    status: (p.status ?? 'Draft') as ProjectStatus,
    phases: (p.phases || []).map((ph: any) => ({
      id: ph.id,
      name: ph.name,
      start_month: ph.start_month,
      end_month: ph.end_month ?? null,
      funding_source: ph.funding_source,
      funding_notes: ph.funding_notes ?? '',
      requirements: (ph.requirements || []).map((r: any) => ({
        id: r.id,
        shape: 'skill' as const,
        skill_id: r.skill_id,
        level: r.level,
        hours_by_month: r.hours_by_month ?? {},
        steady_state_hours: r.steady_state_hours ?? null,
        notes: r.notes ?? null,
        owningTeamId: r.owningTeamId ?? null,
        allocations: (r.allocations ?? []).map((a: any) => ({
          id: a.id,
          person_id: a.person_id,
          hours_by_month: a.hours_by_month ?? {},
          steady_state_hours: a.steady_state_hours ?? null,
          notes: a.notes ?? null,
        })),
      })),
    })),
    active: p.active ?? true,
  }))

  const defaultFunctionId = activeFns[0]?.id ?? null

  return {
    activeFunctionId: defaultFunctionId,
    functions: (raw.functions || []) as AppFunction[],
    teams: (raw.teams || []) as Team[],
    projectTeamAssignments,
    domains: raw.domains || [],
    skills: raw.skills || [],
    people: (raw.people || []).map((p: any) => ({
      ...p,
      teamId: p.teamId ?? '',
    })) as Person[],
    programmes: raw.programmes || [],
    projects,
    providers: raw.providers || [],
    externalResourceRequirements: (raw.external_resource_requirements || []).map((e: any) => ({
      ...e,
      notes: e.notes ?? null,
      hours_by_month: e.hours_by_month ?? {},
      steady_state_hours: e.steady_state_hours ?? null,
    })) as ExternalResourceRequirement[],
    demandItems: items.map((d: any): DemandItem => ({
      id: d.id,
      name: d.name,
      type: d.type,
      status: migrateDemandStatus(d.status),
      owner: d.owner ?? '',
      description: d.description ?? '',
      // v1.18: function_id (was createdUnderFunctionId); fallback to first function
      function_id: d.function_id ?? d.createdUnderFunctionId ?? defaultFunctionId ?? '',
      // v1.18: parent_project_id (was project_id)
      parent_project_id: d.parent_project_id ?? d.project_id ?? null,
      phases: (d.phases || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        start_month: p.start_month,
        end_month: p.end_month ?? null,
        funding_source: p.funding_source,
        funding_notes: p.funding_notes ?? '',
        requirements: (p.requirements || []).map((r: any) => ({
          id: r.id,
          shape: 'skill' as const,
          skill_id: r.skill_id,
          level: r.level,
          hours_by_month: r.hours_by_month ?? {},
          steady_state_hours: r.steady_state_hours ?? null,
          notes: r.notes ?? null,
          owningTeamId: r.owningTeamId ?? null,
          allocations: (r.allocations ?? []).map((a: any) => ({
            id: a.id,
            person_id: a.person_id,
            hours_by_month: a.hours_by_month ?? {},
            steady_state_hours: a.steady_state_hours ?? null,
            notes: a.notes ?? null,
          })) as import('../types').NamedAllocation[],
        })),
      })),
    })),
  }
}

const SEED: AppState = normalizeSeed(seedRaw as Record<string, unknown>)

interface Store extends AppState {
  setActiveFunctionId: (id: string) => void

  addFunction: (f: Omit<AppFunction, 'id'>) => void
  updateFunction: (id: string, f: Partial<AppFunction>) => void
  deleteFunction: (id: string) => void

  addTeam: (t: Omit<Team, 'id'>) => void
  updateTeam: (id: string, t: Partial<Team>) => void
  deleteTeam: (id: string) => void

  addProjectTeamAssignment: (a: Omit<ProjectTeamAssignment, 'id'>) => void
  updateProjectTeamAssignment: (id: string, a: Partial<ProjectTeamAssignment>) => void
  deleteProjectTeamAssignment: (id: string) => void
  // Alias for any remaining callers that haven't been updated yet
  addDemandTeamAssignment: (a: Omit<ProjectTeamAssignment, 'id'>) => void
  updateDemandTeamAssignment: (id: string, a: Partial<ProjectTeamAssignment>) => void
  deleteDemandTeamAssignment: (id: string) => void

  addDomain: (t: Omit<Domain, 'id'>) => void
  updateDomain: (id: string, t: Partial<Domain>) => void
  deleteDomain: (id: string) => void

  addSkill: (s: Omit<Skill, 'id'>) => void
  updateSkill: (id: string, s: Partial<Skill>) => void
  deleteSkill: (id: string) => void

  addPerson: (p: Omit<Person, 'id'>) => void
  updatePerson: (id: string, p: Partial<Person>) => void
  deletePerson: (id: string) => void

  addDemandItem: (d: Omit<DemandItem, 'id'>) => void
  updateDemandItem: (id: string, d: Partial<DemandItem>) => void
  deleteDemandItem: (id: string) => void

  addProgramme: (p: Omit<Programme, 'id'>) => void
  updateProgramme: (id: string, p: Partial<Programme>) => void
  deleteProgramme: (id: string) => void

  addProject: (p: Omit<Project, 'id'>) => void
  updateProject: (id: string, p: Partial<Project>) => void
  deleteProject: (id: string) => void

  addProvider: (p: Omit<Provider, 'id'>) => void
  updateProvider: (id: string, p: Partial<Provider>) => void
  deleteProvider: (id: string) => void

  addExternalRequirement: (e: Omit<ExternalResourceRequirement, 'id'>) => void
  updateExternalRequirement: (id: string, e: Partial<ExternalResourceRequirement>) => void
  deleteExternalRequirement: (id: string) => void

  resetToSeed: () => void
}

export const useAppStore = create<Store>()(
  persist(
    (set) => ({
      ...SEED,

      setActiveFunctionId: (id) => set({ activeFunctionId: id }),

      addFunction: f => set(s => ({ functions: [...s.functions, { ...f, id: generateId('fnc') }] })),
      updateFunction: (id, f) => set(s => ({ functions: s.functions.map(x => x.id === id ? { ...x, ...f } : x) })),
      deleteFunction: id => set(s => ({ functions: s.functions.filter(x => x.id !== id) })),

      addTeam: t => set(s => ({ teams: [...s.teams, { ...t, id: generateId('tem') }] })),
      updateTeam: (id, t) => set(s => ({ teams: s.teams.map(x => x.id === id ? { ...x, ...t } : x) })),
      deleteTeam: id => set(s => ({ teams: s.teams.filter(x => x.id !== id) })),

      addProjectTeamAssignment: a => set(s => ({ projectTeamAssignments: [...s.projectTeamAssignments, { ...a, id: generateId('pta') }] })),
      updateProjectTeamAssignment: (id, a) => set(s => ({
        projectTeamAssignments: s.projectTeamAssignments.map(x => x.id === id ? { ...x, ...a } : x),
      })),
      deleteProjectTeamAssignment: id => set(s => ({ projectTeamAssignments: s.projectTeamAssignments.filter(x => x.id !== id) })),
      // Aliases (callers will be migrated in later Changes)
      addDemandTeamAssignment: a => set(s => ({ projectTeamAssignments: [...s.projectTeamAssignments, { ...a, id: generateId('pta') }] })),
      updateDemandTeamAssignment: (id, a) => set(s => ({
        projectTeamAssignments: s.projectTeamAssignments.map(x => x.id === id ? { ...x, ...a } : x),
      })),
      deleteDemandTeamAssignment: id => set(s => ({ projectTeamAssignments: s.projectTeamAssignments.filter(x => x.id !== id) })),

      addDomain: t => set(s => ({ domains: [...s.domains, { ...t, id: generateId('thm') }] })),
      updateDomain: (id, t) => set(s => ({ domains: s.domains.map(x => x.id === id ? { ...x, ...t } : x) })),
      deleteDomain: id => set(s => ({ domains: s.domains.filter(x => x.id !== id) })),

      addSkill: s_ => set(s => ({ skills: [...s.skills, { ...s_, id: generateId('skl') }] })),
      updateSkill: (id, s_) => set(s => ({ skills: s.skills.map(x => x.id === id ? { ...x, ...s_ } : x) })),
      deleteSkill: id => set(s => ({ skills: s.skills.filter(x => x.id !== id) })),

      addPerson: p => set(s => ({ people: [...s.people, { ...p, id: generateId('per') }] })),
      updatePerson: (id, p) => set(s => ({ people: s.people.map(x => x.id === id ? { ...x, ...p } : x) })),
      deletePerson: id => set(s => ({ people: s.people.filter(x => x.id !== id) })),

      addDemandItem: d => set(s => ({ demandItems: [...s.demandItems, { ...d, id: generateId('dmd') }] })),
      updateDemandItem: (id, d) => set(s => ({ demandItems: s.demandItems.map(x => x.id === id ? { ...x, ...d } : x) })),
      deleteDemandItem: id => set(s => ({ demandItems: s.demandItems.filter(x => x.id !== id) })),

      addProgramme: p => set(s => ({ programmes: [...s.programmes, { ...p, id: generateId('prg') }] })),
      updateProgramme: (id, p) => set(s => ({ programmes: s.programmes.map(x => x.id === id ? { ...x, ...p } : x) })),
      deleteProgramme: id => set(s => ({ programmes: s.programmes.filter(x => x.id !== id) })),

      addProject: p => set(s => ({ projects: [...s.projects, { ...p, id: generateId('prj') }] })),
      updateProject: (id, p) => set(s => ({ projects: s.projects.map(x => x.id === id ? { ...x, ...p } : x) })),
      deleteProject: id => set(s => ({ projects: s.projects.filter(x => x.id !== id) })),

      addProvider: p => set(s => ({ providers: [...s.providers, { ...p, id: generateId('prv') }] })),
      updateProvider: (id, p) => set(s => ({ providers: s.providers.map(x => x.id === id ? { ...x, ...p } : x) })),
      deleteProvider: id => set(s => ({ providers: s.providers.filter(x => x.id !== id) })),

      addExternalRequirement: e => set(s => ({ externalResourceRequirements: [...s.externalResourceRequirements, { ...e, id: generateId('ext') }] })),
      updateExternalRequirement: (id, e) => set(s => ({ externalResourceRequirements: s.externalResourceRequirements.map(x => x.id === id ? { ...x, ...e } : x) })),
      deleteExternalRequirement: id => set(s => ({ externalResourceRequirements: s.externalResourceRequirements.filter(x => x.id !== id) })),

      resetToSeed: () => set({ ...SEED }),
    }),
    {
      name: 'resource-forecast-v1',
      version: 11,
      migrate: (_state, version) => {
        if (version < 9) return SEED
        if (version < 10) {
          const s = _state as Omit<Store, 'activeFunctionId'>
          const activeFns = (s.functions || []).filter((f: AppFunction) => f.active)
            .sort((a: AppFunction, b: AppFunction) => a.name.localeCompare(b.name))
          return { ...s, activeFunctionId: activeFns[0]?.id ?? null } as Store
        }
        if (version < 11) {
          // v10 → v11: data model migration (v1.18)
          // - demandTeamAssignments → projectTeamAssignments (demandId → projectId)
          // - DemandItem: add function_id, parent_project_id; remove project_id etc.
          // - Project: add status, phases, owner, type; make programme_id nullable
          // - DemandStatus: Parked/Closed/Scoping → Draft
          const s = _state as any
          const activeFns = (s.functions || []).filter((f: any) => f.active)
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
          const defaultFunctionId = activeFns[0]?.id ?? null

          const rawDtas: any[] = s.demandTeamAssignments || s.projectTeamAssignments || []
          const projectTeamAssignments: ProjectTeamAssignment[] = rawDtas.map((a: any) => ({
            id: a.id,
            projectId: a.projectId ?? a.demandId ?? '',
            phaseId: a.phaseId,
            teamId: a.teamId,
            confirmed: a.confirmed ?? false,
            confirmedBy: a.confirmedBy ?? null,
            confirmedAt: a.confirmedAt ?? null,
          }))

          const projects: Project[] = (s.projects || []).map((p: any): Project => ({
            id: p.id,
            name: p.name,
            owner: p.owner ?? '',
            type: p.type ?? 'Group Strategy Project',
            programme_id: p.programme_id ?? null,
            description: p.description ?? '',
            status: (p.status ?? 'Draft') as ProjectStatus,
            phases: p.phases ?? [],
            active: p.active ?? true,
          }))

          const demandItems: DemandItem[] = (s.demandItems || []).map((d: any): DemandItem => ({
            id: d.id,
            name: d.name,
            type: d.type,
            status: migrateDemandStatus(d.status),
            owner: d.owner ?? '',
            description: d.description ?? '',
            function_id: d.function_id ?? d.createdUnderFunctionId ?? defaultFunctionId ?? '',
            parent_project_id: d.parent_project_id ?? d.project_id ?? null,
            phases: d.phases ?? [],
          }))

          return {
            ...s,
            projectTeamAssignments,
            demandTeamAssignments: undefined,
            projects,
            demandItems,
          } as Store
        }
        return _state as Store
      },
    }
  )
)
