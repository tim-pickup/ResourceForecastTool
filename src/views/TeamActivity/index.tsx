import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import {
  generateMonths, getCurrentMonth, monthInRange, formatMonthLabel,
} from '../../utils/capacity'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { clsx } from 'clsx'
import type { DemandType } from '../../types'

const HORIZONS = [6, 12, 24, 60]

// Colours consistent with CapacityChart
const SEG_COLORS = {
  bau:       '#94a3b8',
  npd:       '#34d399',
  plant:     '#60a5fa',
  strategy:  '#a78bfa',
  available: '#e5e7eb',
  over:      '#fca5a5',
}

type SegKey = 'bau' | 'npd' | 'plant' | 'strategy'

// Fixed segment order: BAU → NPD Demand → Plant Project → Group Strategy → Available
const SEGMENTS: { key: SegKey; label: string; type?: DemandType }[] = [
  { key: 'bau',      label: 'BAU',                    type: 'BAU' },
  { key: 'npd',      label: 'NPD Demand',              type: 'NPD Demand' },
  { key: 'plant',    label: 'Plant Project',           type: 'Plant Project' },
  { key: 'strategy', label: 'Group Strategy Project',  type: 'Group Strategy Project' },
]

interface HoursByType { bau: number; npd: number; plant: number; strategy: number }

interface ContributingItem {
  demandId: string
  name: string
  type: DemandType
  hours: number
  phase: string
}

interface DrillCell {
  personId: string
  personName: string
  month: string
  filterKey?: SegKey
}

export default function TeamActivity() {
  const store = useAppStore()
  const [horizon, setHorizon] = useState(6)
  const [filterTheme, setFilterTheme] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [editorId, setEditorId] = useState<string | null>(null)
  const [drillCell, setDrillCell] = useState<DrillCell | null>(null)

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])
  const now = getCurrentMonth()

  const activeDemand = useMemo(
    () => store.demandItems.filter(d =>
      d.status === 'Approved' || d.status === 'PartiallyAllocated' || d.status === 'Allocated'
    ),
    [store.demandItems]
  )

  const people = useMemo(() =>
    store.people.filter(p =>
      p.active &&
      (!filterTheme || p.primary_theme_id === filterTheme) &&
      (!filterPerson || p.id === filterPerson)
    ),
    [store.people, filterTheme, filterPerson]
  )

  const themes = useMemo(() => store.themes, [store.themes])

  function getHoursByType(personId: string, month: string): HoursByType {
    const r: HoursByType = { bau: 0, npd: 0, plant: 0, strategy: 0 }
    for (const item of activeDemand) {
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          for (const alloc of req.allocations) {
            if (alloc.person_id !== personId) continue
            const hours = phase.end_month === null
              ? (alloc.steady_state_hours ?? 0)
              : (alloc.hours_by_month[month] ?? 0)
            if (hours <= 0) continue
            if (item.type === 'BAU')                      r.bau      += hours
            else if (item.type === 'NPD Demand')          r.npd      += hours
            else if (item.type === 'Plant Project')       r.plant    += hours
            else if (item.type === 'Group Strategy Project') r.strategy += hours
          }
        }
      }
    }
    return r
  }

  function getContributing(personId: string, month: string, filterKey?: SegKey): ContributingItem[] {
    const items: ContributingItem[] = []
    for (const item of activeDemand) {
      const seg = SEGMENTS.find(s => s.type === item.type)
      if (filterKey && seg?.key !== filterKey) continue
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          for (const alloc of req.allocations) {
            if (alloc.person_id !== personId) continue
            const hours = phase.end_month === null
              ? (alloc.steady_state_hours ?? 0)
              : (alloc.hours_by_month[month] ?? 0)
            if (hours > 0) {
              items.push({ demandId: item.id, name: item.name, type: item.type, hours, phase: phase.name || 'Phase' })
            }
          }
        }
      }
    }
    return items
  }

  const groupedPeople = useMemo(() =>
    themes.map(t => ({
      theme: t,
      rows: people.filter(p => p.primary_theme_id === t.id),
    })).filter(g => g.rows.length > 0),
    [people, themes]
  )

  // Drill-down panel data
  const drillItems = useMemo(() => {
    if (!drillCell) return []
    return getContributing(drillCell.personId, drillCell.month, drillCell.filterKey)
  }, [drillCell, activeDemand])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Team Activity</span>
        <div className="h-4 w-px bg-border" />

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

        <select
          value={filterTheme}
          onChange={e => { setFilterTheme(e.target.value); setFilterPerson('') }}
          className="text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="">All Themes</option>
          {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={filterPerson}
          onChange={e => setFilterPerson(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="">All People</option>
          {store.people.filter(p => !filterTheme || p.primary_theme_id === filterTheme).map(p =>
            <option key={p.id} value={p.id}>{p.name}</option>
          )}
        </select>
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
                <th key={m} className={clsx(
                  'px-2 py-2 text-center font-medium border-r border-border/50 min-w-[140px]',
                  m === now ? 'text-brand bg-blue-50/50' : 'text-gray-500'
                )}>
                  {formatMonthLabel(m)}
                  {m === now && <div className="text-[9px] text-brand font-semibold">NOW</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedPeople.map(group => (
              <>
                <tr key={group.theme.id + '-header'} className="bg-gray-50/80">
                  <td colSpan={months.length + 1} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-border">
                    {group.theme.name}
                  </td>
                </tr>
                {group.rows.map(person => (
                  <tr key={person.id} className="border-b border-border/50 hover:bg-gray-50/20">
                    <td className="sticky left-0 bg-white border-r border-border px-4 py-2 z-10">
                      <div className="font-medium text-near-black">{person.name}</div>
                      <div className="text-gray-400">{person.contracted_hours_per_month}h/mo</div>
                      {person.available_from && person.available_from > now && (
                        <div className="text-[10px] text-yellow-600">Joins {person.available_from}</div>
                      )}
                      {person.available_to && person.available_to < months[months.length - 1] && (
                        <div className="text-[10px] text-orange-600">Leaves {person.available_to}</div>
                      )}
                    </td>
                    {months.map(month => {
                      const notAvailable = !monthInRange(month, person.available_from, person.available_to)
                      const contracted = person.contracted_hours_per_month

                      if (notAvailable) {
                        return (
                          <td key={month} className="px-2 py-2 border-r border-border/50">
                            <div
                              className="h-7 rounded bg-gray-100"
                              style={{ backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)' }}
                            />
                            <div className="text-[9px] text-gray-300 text-center mt-0.5">n/a</div>
                          </td>
                        )
                      }

                      const hrs = getHoursByType(person.id, month)
                      const committed = hrs.bau + hrs.npd + hrs.plant + hrs.strategy
                      const available = Math.max(0, contracted - committed)
                      const isOver = committed > contracted

                      // Build segment widths as % of contracted
                      const toW = (h: number) => contracted > 0 ? (h / contracted) * 100 : 0

                      return (
                        <td
                          key={month}
                          className={clsx(
                            'px-1.5 py-1.5 border-r border-border/50 cursor-pointer',
                            isOver ? 'bg-red-50' : 'hover:bg-gray-50/60'
                          )}
                          onClick={() => setDrillCell({ personId: person.id, personName: person.name, month })}
                        >
                          {/* Tooltip on the bar container */}
                          <div
                            className="relative h-7 bg-gray-100 rounded overflow-hidden"
                            title={`${person.name} · ${formatMonthLabel(month)}\nBAU ${hrs.bau}h · NPD ${hrs.npd}h · Plant ${hrs.plant}h · Strategy ${hrs.strategy}h · Available ${available}h / ${contracted}h`}
                          >
                            <div className="absolute inset-0 flex">
                              {SEGMENTS.map(seg => {
                                const h = hrs[seg.key]
                                if (h <= 0) return null
                                return (
                                  <div
                                    key={seg.key}
                                    style={{ width: `${Math.min(toW(h), 100)}%`, backgroundColor: SEG_COLORS[seg.key], flexShrink: 0 }}
                                    title={`${seg.label}: ${h}h`}
                                    onClick={e => { e.stopPropagation(); setDrillCell({ personId: person.id, personName: person.name, month, filterKey: seg.key }) }}
                                  />
                                )
                              })}
                              {!isOver && available > 0 && (
                                <div
                                  style={{ backgroundColor: SEG_COLORS.available, flex: 1 }}
                                  title={`Available: ${available}h`}
                                  onClick={e => { e.stopPropagation(); setDrillCell({ personId: person.id, personName: person.name, month }) }}
                                />
                              )}
                              {isOver && (
                                <div
                                  style={{ width: `${toW(committed - contracted)}%`, backgroundColor: SEG_COLORS.over, flexShrink: 0 }}
                                  title={`Over by ${Math.round(committed - contracted)}h`}
                                />
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between text-[9px] mt-0.5 px-0.5">
                            <span className={isOver ? 'text-red-600 font-medium' : 'text-gray-500'}>
                              {Math.round(committed)}h
                            </span>
                            {isOver
                              ? <span className="text-red-500">+{Math.round(committed - contracted)}h</span>
                              : <span className="text-gray-400">{Math.round(available)}h free</span>
                            }
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
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-5 py-2 border-t border-border bg-gray-50 text-xs text-gray-500 flex-wrap">
        {SEGMENTS.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SEG_COLORS[s.key] }} />
            {s.label}
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SEG_COLORS.available }} />
          Available Capacity
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: SEG_COLORS.over }} />
          Over-allocated
        </div>
      </div>

      {/* Drill-down panel */}
      {drillCell && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setDrillCell(null)} />
          <div className="relative bg-white border border-border rounded-t-xl sm:rounded-xl shadow-panel w-full sm:w-[420px] max-h-[80vh] flex flex-col">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
              <div className="flex-1">
                <span className="text-sm font-semibold text-near-black">{drillCell.personName}</span>
                <span className="text-xs text-gray-500 ml-2">{formatMonthLabel(drillCell.month)}</span>
                {drillCell.filterKey && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: SEG_COLORS[drillCell.filterKey] + '33', color: '#374151' }}
                  >
                    {SEGMENTS.find(s => s.key === drillCell.filterKey)?.label}
                    <button onClick={() => setDrillCell(c => c ? { ...c, filterKey: undefined } : null)} className="opacity-60 hover:opacity-100">
                      <X size={10} />
                    </button>
                  </span>
                )}
              </div>
              <button onClick={() => setDrillCell(null)} className="text-gray-400 hover:text-near-black">
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {drillItems.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-4 text-center">
                  {drillCell.filterKey ? 'No demand in this work type.' : 'No active demand this month — person is fully available.'}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {drillItems.map((item, i) => {
                    const seg = SEGMENTS.find(s => s.type === item.type)
                    return (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded border border-border bg-gray-50">
                        {seg && (
                          <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: SEG_COLORS[seg.key] }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => { setEditorId(item.demandId); setDrillCell(null) }}
                            className="text-xs font-medium text-brand hover:underline text-left truncate block"
                          >
                            {item.name}
                          </button>
                          <div className="text-[10px] text-gray-400">{item.phase} · {item.type}</div>
                        </div>
                        <span className="text-xs font-medium text-near-black whitespace-nowrap">{item.hours}h</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editorId && <DemandEditor demandId={editorId} onClose={() => setEditorId(null)} />}
    </div>
  )
}
