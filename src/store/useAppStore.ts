import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, Skill, Person, DemandItem, AppState, DemandStatus } from '../types'
import { generateId } from '../utils/ids'
import seedRaw from '../../DEMOSEED.json'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSeed(raw: any): AppState {
  const items: any[] = raw.demand_items || []
  return {
    themes: raw.themes || [],
    skills: raw.skills || [],
    people: raw.people || [],
    demandItems: items.map((d: any): DemandItem => ({
      ...d,
      status: (d.status === 'Accepted' ? 'Approved' : d.status) as DemandStatus,
      previous_status: (d.previous_status ?? null) as DemandStatus | null,
      closed_at: d.closed_at ?? null,
      phases: (d.phases || []).map((p: any) => ({
        ...p,
        end_month: p.end_month ?? null,
        requirements: (p.requirements || []).map((r: any) => ({
          ...r,
          shape: 'skill' as const,
          notes: r.notes ?? null,
          steady_state_hours: r.steady_state_hours ?? null,
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
  addTheme: (t: Omit<Theme, 'id'>) => void
  updateTheme: (id: string, t: Partial<Theme>) => void
  deleteTheme: (id: string) => void

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

  resetToSeed: () => void
}

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      ...SEED,

      addTheme: t => set(s => ({ themes: [...s.themes, { ...t, id: generateId('thm') }] })),
      updateTheme: (id, t) => set(s => ({ themes: s.themes.map(x => x.id === id ? { ...x, ...t } : x) })),
      deleteTheme: id => set(s => ({ themes: s.themes.filter(x => x.id !== id) })),

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

      resetToSeed: () => set({ ...SEED }),
    }),
    {
      name: 'resource-forecast-v1',
      version: 4,
    }
  )
)
