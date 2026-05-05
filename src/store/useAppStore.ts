import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppFunction, Team,
  Domain, Skill, Person, DemandItem, AppState, DemandStatus,
  Programme, Project, ProjectStatus, Provider, ExternalResourceRequirement,
  ProjectType,
} from '../types'
import { generateId, slugifyProjectTypeId } from '../utils/ids'
import seedRaw from '../seed/seed.json'

function migrateDemandStatus(s: string): DemandStatus {
  if (s === 'Parked' || s === 'Closed' || s === 'Scoping') return 'Draft'
  if (s === 'Accepted') return 'Approved'
  return s as DemandStatus
}

// §11.20 resolveFunctionTag — returns the Function that should own an external requirement.
// If the requirement already has a function_tag, that tag is authoritative.
// For null-tagged externals (legacy or user-omitted), fall back to the
// alphabetically-first Function in the spawn set, with a dev-mode warning.
function resolveFunctionTag(
  ext: Pick<ExternalResourceRequirement, 'function_tag'>,
  functionsInvolved: ReadonlySet<string>,
  fnNames: ReadonlyMap<string, string>
): string {
  if (ext.function_tag) return ext.function_tag
  const sorted = [...functionsInvolved].sort((a, b) =>
    (fnNames.get(a) ?? a).localeCompare(fnNames.get(b) ?? b)
  )
  console.warn(
    '[spawn] External requirement has no function_tag — defaulting to alphabetically-first Function:',
    fnNames.get(sorted[0] ?? '') ?? sorted[0]
  )
  return sorted[0] ?? ''
}

function computeProjectAutoStatusFromDemands(childDemands: DemandItem[]): ProjectStatus {
  if (childDemands.length === 0) return 'Submitted'
  if (childDemands.every(d => d.status === 'Allocated')) return 'Allocated'
  if (childDemands.every(d => (['Approved', 'PartiallyAllocated', 'Allocated'] as DemandStatus[]).includes(d.status))) return 'Approved'
  return 'Submitted'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSeed(raw: any): AppState {
  const items: any[] = raw.demand_items || []
  const activeFns: AppFunction[] = (raw.functions || []).filter((f: any) => f.active)
  activeFns.sort((a, b) => a.name.localeCompare(b.name))

  const projects: Project[] = (raw.projects || []).map((p: any): Project => ({
    id: p.id,
    name: p.name,
    owner: p.owner ?? '',
    type: p.type ?? 'pt_group_strategy_project',
    programme_id: p.programme_id ?? null,
    description: p.description ?? '',
    status: (p.status ?? 'Draft') as ProjectStatus,
    activities: (p.activities || []).map((ac: any) => ({
      id: ac.id,
      name: ac.name,
      start_month: ac.start_month,
      end_month: ac.end_month ?? null,
      funding_source: ac.funding_source,
      funding_notes: ac.funding_notes ?? '',
      requirements: (ac.requirements || []).map((r: any) => ({
        id: r.id,
        shape: 'skill' as const,
        skill_id: r.skill_id,
        level: r.level,
        hours_by_month: r.hours_by_month ?? {},
        steady_state_hours: r.steady_state_hours ?? null,
        notes: r.notes ?? null,
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
    functions_required: p.functions_required ?? [],
    functions_actually_involved: p.functions_actually_involved ?? [],
    created_under_function_id: p.created_under_function_id ?? null,
  }))

  const defaultFunctionId = activeFns[0]?.id ?? null

  return {
    activeFunctionId: defaultFunctionId,
    functions: (raw.functions || []) as AppFunction[],
    teams: (raw.teams || []) as Team[],
    projectTypes: (raw.project_types || []) as ProjectType[],
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
      function_tag: e.function_tag ?? null,
    })) as ExternalResourceRequirement[],
    demandItems: items.map((d: any): DemandItem => ({
      id: d.id,
      name: d.name,
      type: d.type,
      status: migrateDemandStatus(d.status),
      owner: d.owner ?? '',
      description: d.description ?? '',
      function_id: d.function_id ?? d.createdUnderFunctionId ?? defaultFunctionId ?? '',
      parent_project_id: d.parent_project_id ?? d.project_id ?? null,
      activities: (d.activities || []).map((ac: any) => ({
        id: ac.id,
        name: ac.name,
        start_month: ac.start_month,
        end_month: ac.end_month ?? null,
        funding_source: ac.funding_source,
        funding_notes: ac.funding_notes ?? '',
        requirements: (ac.requirements || []).map((r: any) => ({
          id: r.id,
          shape: 'skill' as const,
          skill_id: r.skill_id,
          level: r.level,
          hours_by_month: r.hours_by_month ?? {},
          steady_state_hours: r.steady_state_hours ?? null,
          notes: r.notes ?? null,
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

  addProjectType: (pt: Omit<ProjectType, 'id'>) => string | null
  updateProjectType: (id: string, pt: Partial<ProjectType>) => void
  deleteProjectType: (id: string) => void

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
  submitProjectForScoping: (projectId: string) => string | null
  submitProject: (projectId: string) => string | null

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

      addProjectType: pt => {
        let error: string | null = null
        set(s => {
          const derivedId = slugifyProjectTypeId(pt.name)
          const nameDupe = s.projectTypes.some(p => p.active && p.name.toLowerCase() === pt.name.trim().toLowerCase())
          if (nameDupe) { error = 'An active Project Type with that name already exists.'; return {} }
          const idDupe = s.projectTypes.find(p => p.id === derivedId)
          if (idDupe) { error = `A Project Type with this system key already exists ('${idDupe.name}'). Choose a different name.`; return {} }
          return { projectTypes: [...s.projectTypes, { ...pt, id: derivedId }] }
        })
        return error
      },
      updateProjectType: (id, pt) => set(s => ({ projectTypes: s.projectTypes.map(x => x.id === id ? { ...x, ...pt } : x) })),
      deleteProjectType: id => set(s => ({ projectTypes: s.projectTypes.filter(x => x.id !== id) })),

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
      updateDemandItem: (id, d) => set(s => {
        const newItems = s.demandItems.map(x => x.id === id ? { ...x, ...d } : x)
        if ('status' in d) {
          const updatedItem = newItems.find(x => x.id === id)
          const projectId = updatedItem?.parent_project_id
          if (projectId) {
            const project = s.projects.find(p => p.id === projectId)
            if (project && (['Submitted', 'Approved', 'Allocated'] as ProjectStatus[]).includes(project.status)) {
              const childDemands = newItems.filter(x => x.parent_project_id === projectId)
              const newProjectStatus = computeProjectAutoStatusFromDemands(childDemands)
              if (project.status !== newProjectStatus) {
                return {
                  demandItems: newItems,
                  projects: s.projects.map(p => p.id === projectId ? { ...p, status: newProjectStatus } : p),
                }
              }
            }
          }
        }
        return { demandItems: newItems }
      }),
      deleteDemandItem: (id) => set(s => {
        const demand = s.demandItems.find(d => d.id === id)
        if (!demand) return {}
        const activityIds = new Set(demand.activities.map(ac => ac.id))
        return {
          demandItems: s.demandItems.filter(d => d.id !== id),
          externalResourceRequirements: activityIds.size > 0
            ? s.externalResourceRequirements.filter(e => !activityIds.has(e.activity_id))
            : s.externalResourceRequirements,
        }
      }),

      addProgramme: p => set(s => ({ programmes: [...s.programmes, { ...p, id: generateId('prg') }] })),
      updateProgramme: (id, p) => set(s => ({ programmes: s.programmes.map(x => x.id === id ? { ...x, ...p } : x) })),
      deleteProgramme: id => set(s => ({ programmes: s.programmes.filter(x => x.id !== id) })),

      addProject: p => set(s => ({ projects: [...s.projects, { ...p, id: generateId('prj'), created_under_function_id: s.activeFunctionId }] })),
      updateProject: (id, p) => set(s => ({ projects: s.projects.map(x => x.id === id ? { ...x, ...p } : x) })),
      deleteProject: (id) => set(s => {
        const project = s.projects.find(p => p.id === id)
        const projectActivityIds = new Set((project?.activities ?? []).map(ac => ac.id))
        // Also collect child demand activity IDs for external req cleanup
        const childDemands = s.demandItems.filter(d => d.parent_project_id === id)
        const childActivityIds = new Set(childDemands.flatMap(d => d.activities.map(ac => ac.id)))
        const allActivityIds = new Set([...projectActivityIds, ...childActivityIds])
        return {
          projects: s.projects.filter(p => p.id !== id),
          demandItems: s.demandItems.filter(d => d.parent_project_id !== id),
          externalResourceRequirements: allActivityIds.size > 0
            ? s.externalResourceRequirements.filter(e => !allActivityIds.has(e.activity_id))
            : s.externalResourceRequirements,
        }
      }),
      // §3 Project state machine — Submit for Scoping (Draft → Scoping)
      // v1.19: gate requires ≥1 activity AND ≥1 entry in functions_required
      submitProjectForScoping: (projectId) => {
        let error: string | null = null
        set(s => {
          const project = s.projects.find(p => p.id === projectId)
          if (!project) { error = 'Project not found.'; return {} }
          if (project.status !== 'Draft') { error = 'Project must be in Draft status.'; return {} }
          if (project.activities.length === 0) { error = 'Add at least one activity before submitting for scoping.'; return {} }
          if (project.functions_required.length === 0) { error = 'Add at least one Function to Functions Required before submitting for scoping.'; return {} }
          return { projects: s.projects.map(p => p.id === projectId ? { ...p, status: 'Scoping' as ProjectStatus } : p) }
        })
        return error
      },
      // §3 Project state machine — Submit Project (Scoping → Submitted) + spawn Demands
      // v1.19: materialises a deep copy of Function-scoped activities/requirements onto each spawned Demand
      submitProject: (projectId) => {
        let error: string | null = null
        set(s => {
          const project = s.projects.find(p => p.id === projectId)
          if (!project) { error = 'Project not found.'; return {} }
          if (project.status !== 'Scoping') { error = 'Project must be in Scoping status.'; return {} }
          const domFn = new Map(s.domains.map(d => [d.id, d.functionId]))
          const sklFn = new Map(s.skills.map(sk => [sk.id, domFn.get(sk.domain_id) ?? '']))
          const functionsInvolved = new Set<string>()
          for (const activity of project.activities) {
            for (const req of activity.requirements) {
              const fnId = sklFn.get(req.skill_id)
              if (fnId) functionsInvolved.add(fnId)
            }
          }
          if (functionsInvolved.size === 0) { error = 'Project has no requirements — cannot spawn Demands.'; return {} }

          // Get external requirements for all project activities
          const projectActivityIds = new Set(project.activities.map(ac => ac.id))
          const projectExternals = s.externalResourceRequirements.filter(e => projectActivityIds.has(e.activity_id))

          // Build a name map for resolveFunctionTag alphabetical fallback
          const fnNameMap = new Map(s.functions.map(f => [f.id, f.name]))

          const newDemands: DemandItem[] = []
          const newExternals: ExternalResourceRequirement[] = []

          for (const fnId of functionsInvolved) {
            const fn = s.functions.find(f => f.id === fnId)

            // Collect project activities relevant to this Function (has ≥1 internal OR external for this Function)
            const relevantOrigActivities = project.activities.filter(ac =>
              ac.requirements.some(r => sklFn.get(r.skill_id) === fnId) ||
              projectExternals.some(e =>
                e.activity_id === ac.id && resolveFunctionTag(e, functionsInvolved, fnNameMap) === fnId
              )
            )

            if (relevantOrigActivities.length === 0) continue

            // Build a map from original activity ID → new cloned activity
            const origToClone = new Map<string, typeof relevantOrigActivities[0] & { id: string }>()
            const fnActivities = relevantOrigActivities.map(origAc => {
              const cloned = {
                ...origAc,
                id: generateId('phs'),
                requirements: origAc.requirements
                  .filter(r => sklFn.get(r.skill_id) === fnId)
                  .map(r => ({ ...r, id: generateId('req'), allocations: [] })),
              }
              origToClone.set(origAc.id, cloned)
              return cloned
            })

            newDemands.push({
              id: generateId('dmd'),
              function_id: fnId,
              parent_project_id: project.id,
              name: project.name,  // v1.20: no Function suffix; Function chip disambiguates siblings
              type: project.type,
              owner: project.owner,
              description: project.description,
              status: 'Submitted' as DemandStatus,
              activities: fnActivities,
            })

            // Route external requirements onto cloned Demand activities via resolveFunctionTag
            for (const [origAcId, clonedAc] of origToClone.entries()) {
              const acExternals = projectExternals.filter(e =>
                e.activity_id === origAcId &&
                resolveFunctionTag(e, functionsInvolved, fnNameMap) === fnId
              )
              for (const ext of acExternals) {
                newExternals.push({ ...ext, id: generateId('ext'), activity_id: clonedAc.id, function_tag: fnId })
              }
            }
          }

          // Freeze the Project: set functions_actually_involved
          const functionsActuallyInvolved = [...functionsInvolved]

          return {
            demandItems: [...s.demandItems, ...newDemands],
            externalResourceRequirements: [...s.externalResourceRequirements, ...newExternals],
            projects: s.projects.map(p => p.id === projectId ? {
              ...p,
              status: 'Submitted' as ProjectStatus,
              functions_actually_involved: functionsActuallyInvolved,
            } : p),
          }
        })
        return error
      },

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
      version: 13,
      migrate: (_state, version) => {
        if (version < 9) return SEED
        if (version < 10) {
          const s = _state as Omit<Store, 'activeFunctionId'>
          const activeFns = (s.functions || []).filter((f: AppFunction) => f.active)
            .sort((a: AppFunction, b: AppFunction) => a.name.localeCompare(b.name))
          return { ...s, activeFunctionId: activeFns[0]?.id ?? null } as Store
        }
        if (version < 11) {
          const s = _state as any
          const activeFns = (s.functions || []).filter((f: any) => f.active)
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
          const defaultFunctionId = activeFns[0]?.id ?? null
          const demandItems = (s.demandItems || []).map((d: any): DemandItem => ({
            id: d.id, name: d.name, type: d.type,
            status: migrateDemandStatus(d.status),
            owner: d.owner ?? '', description: d.description ?? '',
            function_id: d.function_id ?? d.createdUnderFunctionId ?? defaultFunctionId ?? '',
            parent_project_id: d.parent_project_id ?? d.project_id ?? null,
            activities: d.activities ?? [],
          }))
          const projects = (s.projects || []).map((p: any): Project => ({
            id: p.id, name: p.name, owner: p.owner ?? '',
            type: p.type ?? 'pt_group_strategy_project',
            programme_id: p.programme_id ?? null, description: p.description ?? '',
            status: (p.status ?? 'Draft') as ProjectStatus,
            activities: p.activities ?? [], active: p.active ?? true,
            functions_required: [], functions_actually_involved: [],
            created_under_function_id: null,
          }))
          return { ...s, projects, demandItems } as Store
        }
        if (version < 12) {
          // v11 → v12: v1.19 data model migration
          // - drop projectTeamAssignments (remove from state)
          // - add projectTypes (seed with defaults)
          // - add functions_required / functions_actually_involved to Projects
          // - migrate type string enum → ProjectType id (using v1.20 canonical ids)
          // - add function_tag to ExternalResourceRequirements
          const s = _state as any
          const typeMap: Record<string, string> = {
            'BAU': 'pt_bau',
            'NPD Demand': 'pt_npd_demand',
            'Plant Project': 'pt_plant_project',
            'Group Strategy Project': 'pt_group_strategy_project',
          }
          const activeFns = (s.functions || []).filter((f: any) => f.active)
          const defaultFunctionId = activeFns[0]?.id ?? null
          const projects = (s.projects || []).map((p: any): Project => ({
            ...p,
            type: typeMap[p.type] ?? p.type,
            activities: p.activities ?? [],
            functions_required: p.functions_required ?? [],
            functions_actually_involved: p.functions_actually_involved ?? [],
            created_under_function_id: p.created_under_function_id ?? (p.functions_required?.[0] ?? defaultFunctionId),
          }))
          const demandItems = (s.demandItems || []).map((d: any): DemandItem => ({
            ...d,
            type: typeMap[d.type] ?? d.type,
            activities: d.activities ?? [],
          }))
          const externalResourceRequirements = (s.externalResourceRequirements || []).map((e: any) => ({
            ...e,
            function_tag: e.function_tag ?? null,
          }))
          const projectTypes: ProjectType[] = s.projectTypes?.length > 0 ? s.projectTypes : SEED.projectTypes
          return {
            ...s,
            projects,
            demandItems,
            externalResourceRequirements,
            projectTypes,
            projectTeamAssignments: undefined,
          } as Store
        }
        if (version < 13) {
          // v12 → v13: v1.20 data model migration
          // - rename Project Type ids to canonical pt_<slug> form per §2.1.2
          // - update Project.type and DemandItem.type references accordingly
          // - add created_under_function_id to Projects (first in functions_required, else first active Function)
          const s = _state as any
          const idMap: Record<string, string> = {
            'pt_npd': 'pt_npd_demand',
            'pt_plant': 'pt_plant_project',
            'pt_group_strat': 'pt_group_strategy_project',
          }
          const activeFns = (s.functions || []).filter((f: any) => f.active)
          const defaultFunctionId = activeFns[0]?.id ?? null
          const projectTypes = (s.projectTypes || []).map((pt: any) => ({
            ...pt,
            id: idMap[pt.id] ?? pt.id,
          }))
          const projects = (s.projects || []).map((p: any): Project => ({
            ...p,
            type: idMap[p.type] ?? p.type,
            created_under_function_id: p.created_under_function_id ?? (p.functions_required?.[0] ?? defaultFunctionId),
          }))
          const demandItems = (s.demandItems || []).map((d: any): DemandItem => ({
            ...d,
            type: idMap[d.type] ?? d.type,
          }))
          return { ...s, projectTypes, projects, demandItems } as Store
        }
        return _state as Store
      },
    }
  )
)
