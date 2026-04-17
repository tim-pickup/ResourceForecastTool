import { useState, useMemo } from 'react'
import { Plus, X, ChevronDown } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { generateMonths, getCurrentMonth, getPersonLoad, getOverlayHoursForPerson, formatMonthLabel, utilPct } from '../../utils/capacity'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { StatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { clsx } from 'clsx'
import type { DemandStatus } from '../../types'

const HORIZONS = [6, 12, 24, 60]

function UtilBar({ pct, overlay = 0, contracted = 0 }: { pct: number; overlay?: number; contracted?: number }) {
  const base = Math.min(pct, 100)
  const overlayPct = contracted > 0 ? Math.min((overlay / contracted) * 100, 100 - base) : 0
  const overBase = pct > 100 ? pct - 100 : 0
  return (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden flex mt-0.5">
      <div className={clsx('h-full rounded-l-full transition-all', pct > 100 ? 'bg-accent-red' : pct > 85 ? 'bg-yellow-400' : 'bg-brand')} style={{ width: `${base}%` }} />
      {overlayPct > 0 && <div className="h-full bg-accent-purple/50" style={{ width: `${overlayPct}%` }} />}
    </div>
  )
}

export default function CapacityValidation() {
  const store = useAppStore()
  const [horizon, setHorizon] = useState(12)
  const [groupBy, setGroupBy] = useState<'person' | 'theme'>('person')
  const [filterTheme, setFilterTheme] = useState('')
  const [overlayIds, setOverlayIds] = useState<string[]>([])
  const [showOverlayPicker, setShowOverlayPicker] = useState(false)
  const [overlaySearch, setOverlaySearch] = useState('')
  const [editorId, setEditorId] = useState<string | null | 'new'>(undefined as unknown as null)
  const [editorOpen, setEditorOpen] = useState(false)

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])

  const people = useMemo(() =>
    store.people.filter(p => p.active && (!filterTheme || p.primary_theme_id === filterTheme)),
    [store.people, filterTheme]
  )

  const themes = useMemo(() => store.themes, [store.themes])

  const overlayItems = useMemo(() =>
    store.demandItems.filter(d => overlayIds.includes(d.id)),
    [store.demandItems, overlayIds]
  )

  const availableOverlays = useMemo(() =>
    store.demandItems.filter(d =>
      !overlayIds.includes(d.id) &&
      ['Draft', 'Submitted', 'Accepted', 'Allocated'].includes(d.status) &&
      d.name.toLowerCase().includes(overlaySearch.toLowerCase())
    ),
    [store.demandItems, overlayIds, overlaySearch]
  )

  const groupedPeople = useMemo(() => {
    if (groupBy === 'theme') {
      return themes.map(t => ({
        label: t.name,
        rows: people.filter(p => p.primary_theme_id === t.id),
      })).filter(g => g.rows.length > 0)
    }
    const themeMap = new Map(themes.map(t => [t.id, t.name]))
    return themes.map(t => ({
      label: t.name,
      rows: people.filter(p => p.primary_theme_id === t.id),
    })).filter(g => g.rows.length > 0)
  }, [groupBy, people, themes])

  const openEditor = (id: string) => { setEditorId(id); setEditorOpen(true) }
  const closeEditor = () => { setEditorOpen(false); setEditorId(null) }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Capacity Validation</span>
        <div className="h-4 w-px bg-border" />

        {/* Grouping */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Group:</span>
          {(['person', 'theme'] as const).map(g => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={clsx('px-2 py-0.5 text-xs rounded font-medium capitalize transition-colors',
                groupBy === g ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {g}
            </button>
          ))}
        </div>

        {/* Horizon */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Horizon:</span>
          {HORIZONS.map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={clsx('px-2 py-0.5 text-xs rounded font-medium transition-colors',
                horizon === h ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {h}m
            </button>
          ))}
        </div>

        {/* Theme filter */}
        <select
          value={filterTheme}
          onChange={e => setFilterTheme(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="">All Themes</option>
          {themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div className="flex-1" />

        {/* Overlay chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {overlayIds.map(id => {
            const item = store.demandItems.find(d => d.id === id)
            if (!item) return null
            return (
              <div key={id} className="flex items-center gap-1 bg-accent-purple/10 text-accent-purple border border-accent-purple/20 rounded px-2 py-0.5 text-xs font-medium">
                {item.name}
                <button onClick={() => setOverlayIds(ids => ids.filter(x => x !== id))} className="hover:opacity-70">
                  <X size={11} />
                </button>
              </div>
            )
          })}
          <div className="relative">
            <Button size="sm" variant="secondary" onClick={() => setShowOverlayPicker(o => !o)}>
              <Plus size={12} /> Add overlay
            </Button>
            {showOverlayPicker && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-border rounded shadow-card z-30">
                <input
                  autoFocus
                  value={overlaySearch}
                  onChange={e => setOverlaySearch(e.target.value)}
                  placeholder="Search demand items..."
                  className="w-full px-3 py-2 text-xs border-b border-border focus:outline-none"
                />
                <div className="max-h-48 overflow-y-auto">
                  {availableOverlays.length === 0 && (
                    <p className="text-xs text-gray-400 px-3 py-2">No items found.</p>
                  )}
                  {availableOverlays.map(d => (
                    <button
                      key={d.id}
                      onClick={() => { setOverlayIds(ids => [...ids, d.id]); setShowOverlayPicker(false); setOverlaySearch('') }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2"
                    >
                      <StatusBadge status={d.status as DemandStatus} />
                      {d.name}
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowOverlayPicker(false)} className="w-full text-center py-1.5 text-xs text-gray-400 border-t border-border hover:bg-gray-50">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 border-b border-border">
              <th className="sticky left-0 bg-gray-50 z-20 text-left px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-r border-border min-w-[180px]">
                Person
              </th>
              {months.map(m => (
                <th key={m} className="px-2 py-2 text-center font-medium text-gray-500 border-r border-border/50 min-w-[80px]">
                  {formatMonthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={months.length + 1} className="text-center py-12 text-gray-400 text-sm">
                  No people found. Add people in Admin to start assessing capacity.
                </td>
              </tr>
            )}
            {groupedPeople.map(group => (
              <>
                <tr key={group.label + '-header'} className="bg-gray-50/80">
                  <td colSpan={months.length + 1} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-border">
                    {group.label}
                  </td>
                </tr>
                {group.rows.map(person => (
                  <tr key={person.id} className="border-b border-border/50 hover:bg-gray-50/50">
                    <td className="sticky left-0 bg-white border-r border-border px-4 py-2 font-medium text-near-black z-10">
                      <div className="flex flex-col">
                        <span>{person.name}</span>
                        <span className="text-gray-400 font-normal">{person.contracted_hours_per_month}h/mo</span>
                      </div>
                    </td>
                    {months.map(month => {
                      const load = getPersonLoad(person, month, store)
                      const overlay = getOverlayHoursForPerson(person.id, month, overlayItems)
                      const totalWithOverlay = load.total + overlay
                      const pct = utilPct(load.total, load.contracted)
                      const pctWithOverlay = utilPct(totalWithOverlay, load.contracted)
                      const isOver = load.overAllocated || (overlay > 0 && totalWithOverlay > load.contracted)

                      if (load.contracted === 0) {
                        return (
                          <td key={month} className="px-2 py-2 text-center border-r border-border/50">
                            <span className="text-gray-300 text-xs">—</span>
                          </td>
                        )
                      }

                      return (
                        <td
                          key={month}
                          className={clsx(
                            'px-2 py-2 border-r border-border/50 cursor-pointer transition-colors',
                            isOver ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-blue-50'
                          )}
                          onClick={() => {
                            const topItem = store.demandItems.find(d =>
                              (d.status === 'Accepted' || d.status === 'Allocated') &&
                              d.phases.some(p =>
                                p.requirements.some(r => r.shape === 'named' && r.person_id === person.id)
                              )
                            )
                            if (topItem) openEditor(topItem.id)
                          }}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={clsx('font-medium tabular-nums', isOver ? 'text-accent-red' : 'text-near-black')}>
                              {pct}%
                            </span>
                            <span className="text-gray-400 tabular-nums">{load.total}h</span>
                            <UtilBar pct={pct} overlay={overlay} contracted={load.contracted} />
                            {overlay > 0 && (
                              <span className="text-accent-purple text-xs tabular-nums">+{overlay}h</span>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>

        {overlayIds.length === 0 && (
          <div className="text-center py-4 text-xs text-gray-400 border-t border-border">
            Select a demand item above to overlay its capacity impact
          </div>
        )}
      </div>

      {/* Demand Editor Panel */}
      {editorOpen && (
        <DemandEditor
          demandId={editorId === 'new' ? null : (editorId ?? null)}
          onClose={closeEditor}
        />
      )}
    </div>
  )
}
