import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppFunction, Team, DemandTeamAssignment,
  Domain, Skill, Person, DemandItem, AppState, DemandStatus,
  Programme, Project, Provider, ExternalResourceRequirement,
} from '../types'
import { generateId } from '../utils/ids'
import seedRaw from '../../DEMOSEED.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSeed(raw: any): AppState {
  const items: any[] = raw.demand_items || []
  const activeFns: AppFunction[] = (raw.functions || []).filter((f: any) => f.active)
  activeFns.sort((a, b) => a.name.localeCompare(b.name))
  return {
    activeFunctionId: activeFns[0]?.id ?? null,
    functions: (raw.functions || []) as AppFunction[],
    teams: (raw.teams || []) as Team[],
    demandTeamAssignments: (raw.demand_team_assignments || []) as DemandTeamAssignment[],
    domains: raw.domains || [],
    skills: raw.skills || [],
    people: (raw.people || []).map((p: any) => ({
      ...p,
      teamId: p.teamId ?? '',
    })) as Person[],
    programmes: raw.programmes || [],
    projects: raw.projects || [],
    providers: raw.providers || [],
    externalResourceRequirements: (raw.external_resource_requirements || []).map((e: any) => ({
      ...e,
      notes: e.notes ?? null,
      hours_by_month: e.hours_by_month ?? {},
      steady_state_hours: e.steady_state_hours ?? null,
    })) as ExternalResourceRequirement[],
    demandItems: items.map((d: any): DemandItem => ({
      ...d,
      status: (d.status === 'Accepted' ? 'Approved' : d.status) as DemandStatus,
      previous_status: (d.previous_status ?? null) as DemandStatus | null,
      closed_at: d.closed_at ?? null,
      project_id: d.project_id ?? null,
      createdUnderFunctionId: d.createdUnderFunctionId ?? null,
      phases: (d.phases || []).map((p: any) => ({
        ...p,
        end_month: p.end_month ?? null,
        requirements: (p.requirements || []).map((r: any) => ({
          ...r,
          shape: 'skill' as const,
          notes: r.notes ?? null,
          steady_state_hours: r.steady_state_hours ?? null,
          owningTeamId: r.owningTeamId ?? null,
          allocations: (r.allocations ?? []).map((a: any) => ({
            ...a,
            steady_state_hours: a.steady_state_hours ?? null,
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

  addDemandTeamAssignment: (a: Omit<DemandTeamAssignment, 'id'>) => void
  updateDemandTeamAssignment: (id: string, a: Partial<DemandTeamAssignment>) => void
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
  duplicateDemandItem: (id: string) => string

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
    (set, get) => ({
      ...SEED,

      setActiveFunctionId: (id) => set({ activeFunctionId: id }),

      addFunction: f => set(s => ({ functions: [...s.functions, { ...f, id: generateId('fnc') }] })),
      updateFunction: (id, f) => set(s => ({ functions: s.functions.map(x => x.id === id ? { ...x, ...f } : x) })),
      deleteFunction: id => set(s => ({ functions: s.functions.filter(x => x.id !== id) })),

      addTeam: t => set(s => ({ teams: [...s.teams, { ...t, id: generateId('tem') }] })),
      updateTeam: (id, t) => set(s => ({ teams: s.teams.map(x => x.id === id ? { ...x, ...t } : x) })),
      deleteTeam: id => set(s => ({ teams: s.teams.filter(x => x.id !== id) })),

      addDemandTeamAssignment: a => set(s => ({ demandTeamAssignments: [...s.demandTeamAssignments, { ...a, id: generateId('dta') }] })),
      updateDemandTeamAssignment: (id, a) => set(s => ({
        demandTeamAssignments: s.demandTeamAssignments.map(x => x.id === id ? { ...x, ...a } : x),
      })),
      deleteDemandTeamAssignment: id => set(s => ({ demandTeamAssignments: s.demandTeamAssignments.filter(x => x.id !== id) })),

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

      duplicateDemandItem: id => {
        const item = get().demandItems.find(x => x.id === id)
        if (!item) return ''
        const newId = generateId('dmd')
        const copy: DemandItem = {
          ...item,
          id: newId,
          name: item.name + ' (copy)',
          status: 'Draft',
          parked_reason: null,
          previous_status: null,
          closed_at: null,
          phases: item.phases.map(p => ({
            ...p,
            id: generateId('phs'),
            requirements: p.requirements.map(r => ({
              ...r,
              id: generateId('req'),
              allocations: [],
            })),
          })),
        }
        set(s => ({ demandItems: [...s.demandItems, copy] }))
        return newId
      },

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
      version: 10,
      migrate: (_state, version) => {
        if (version < 9) return SEED
        if (version < 10) {
          // v9 → v10: add activeFunctionId derived from persisted functions
          const s = _state as Omit<Store, 'activeFunctionId'>
          const activeFns = (s.functions || []).filter((f: AppFunction) => f.active)
            .sort((a: AppFunction, b: AppFunction) => a.name.localeCompare(b.name))
          return { ...s, activeFunctionId: activeFns[0]?.id ?? null } as Store
        }
        return _state as Store
      },
    }
  )
)
