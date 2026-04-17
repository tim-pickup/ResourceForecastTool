import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, Skill, Person, BauStream, BauAllocation, DemandItem, AppState } from '../types'
import { generateId } from '../utils/ids'
import seedRaw from '../../DEMOSEED.json'

function normalizeSeed(raw: Record<string, unknown>): AppState {
  const items = (raw.demand_items as DemandItem[]) || []
  return {
    themes: (raw.themes as Theme[]) || [],
    skills: (raw.skills as Skill[]) || [],
    people: (raw.people as Person[]) || [],
    bauStreams: (raw.bau_streams as BauStream[]) || [],
    bauAllocations: (raw.bau_allocations as BauAllocation[]) || [],
    demandItems: items.map(d => ({
      ...d,
      phases: d.phases.map(p => ({
        ...p,
        requirements: p.requirements.map(r => ({ ...r, notes: r.notes ?? null })),
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

  addBauStream: (s: Omit<BauStream, 'id'>) => void
  updateBauStream: (id: string, s: Partial<BauStream>) => void
  deleteBauStream: (id: string) => void

  addBauAllocation: (a: Omit<BauAllocation, 'id'>) => void
  updateBauAllocation: (id: string, a: Partial<BauAllocation>) => void
  deleteBauAllocation: (id: string) => void

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

      addBauStream: b => set(s => ({ bauStreams: [...s.bauStreams, { ...b, id: generateId('bau') }] })),
      updateBauStream: (id, b) => set(s => ({ bauStreams: s.bauStreams.map(x => x.id === id ? { ...x, ...b } : x) })),
      deleteBauStream: id => set(s => ({ bauStreams: s.bauStreams.filter(x => x.id !== id) })),

      addBauAllocation: a => set(s => ({ bauAllocations: [...s.bauAllocations, { ...a, id: generateId('ba') }] })),
      updateBauAllocation: (id, a) => set(s => ({ bauAllocations: s.bauAllocations.map(x => x.id === id ? { ...x, ...a } : x) })),
      deleteBauAllocation: id => set(s => ({ bauAllocations: s.bauAllocations.filter(x => x.id !== id) })),

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
          phases: item.phases.map(p => ({
            ...p,
            id: generateId('phs'),
            requirements: p.requirements.map(r => {
              if (r.shape === 'named') {
                return {
                  id: generateId('req'),
                  shape: 'skill' as const,
                  skill_id: get().skills[0]?.id ?? '',
                  level: 'Basic' as const,
                  hours_by_month: { ...r.hours_by_month },
                  notes: r.notes,
                }
              }
              return { ...r, id: generateId('req') }
            }),
          })),
        }
        set(s => ({ demandItems: [...s.demandItems, copy] }))
        return newId
      },

      resetToSeed: () => set({ ...SEED }),
    }),
    {
      name: 'resource-forecast-v1',
      version: 2,
    }
  )
)
