import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import {
  generateMonths, getCurrentMonth, monthInRange, formatMonthLabel,
} from '../../utils/capacity'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { clsx } from 'clsx'
import type { Person } from '../../types'
import { typeToBreakdownKey } from '../../utils/capacity'

const HORIZONS = [6, 12, 24, 60]

const SEG_COLORS = {
  bau:       '#94a3b8',
  npd:       '#34d399',
  plant:     '#60a5fa',
  strategy:  '#a78bfa',
  available: '#e5e7eb',
  over:      '#fca5a5',
}

type SegKey = 'bau' | 'npd' | 'plant' | 'strategy'

interface HoursByType { bau: number; npd: number; plant: number; strategy: number }

interface ContributingItem {
  demandId: string
  name: string
  type: string
  hours: number
  activity: string
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
  const [filterDomain, setFilterDomain] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [groupBy, setGroupBy] = useState<'domain' | 'team'>('domain')

  // §11.17: reset Function-scoped filters on Function switch
  const activeFunctionId = store.activeFunctionId
  const prevFnRef = useRef<string | null>(activeFunctionId)
  useEffect(() => {
    if (prevFnRef.current === activeFunctionId) return
    prevFnRef.current = activeFunctionId
    setFilterDomain('')
    setFilterPerson('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFunctionId])
  const [editorId, setEditorId] = useState<string | null>(null)
  const [drillCell, setDrillCell] = useState<DrillCell | null>(null)

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])
  const now = getCurrentMonth()

  // Derive segments from ProjectType records (using typeToBreakdownKey mapping)
  const segments = useMemo(() => {
    const nonBau = store.projectTypes.filter(pt => pt.active && !pt.is_bau).sort((a, b) => a.display_order - b.display_order)
    const bauType = store.projectTypes.find(pt => pt.active && pt.is_bau)
    const result: Array<{ key: SegKey; label: string; typeId: string }> = []
    if (bauType) result.push({ key: 'bau', label: bauType.name, typeId: bauType.id })
    if (nonBau[0]) result.push({ key: 'npd',      label: nonBau[0].name, typeId: nonBau[0].id })
    if (nonBau[1]) result.push({ key: 'plant',    label: nonBau[1].name, typeId: nonBau[1].id })
    if (nonBau[2]) result.push({ key: 'strategy', label: nonBau[2].name, typeId: nonBau[2].id })
    return result
  }, [store.projectTypes])

  const activeDemand = useMemo(
    () => store.demandItems.filter(d =>
      d.status === 'Approved' || d.status === 'PartiallyAllocated' || d.status === 'Allocated'
    ),
    [store.demandItems]
  )

  // Active Function's team IDs (for scoping people and team grouping)
  const activeFnTeamIds = useMemo(() =>
    new Set(store.teams.filter(t => t.functionId === activeFunctionId && t.active).map(t => t.id)),
    [store.teams, activeFunctionId]
  )

  // §4 View 2: Rows are the active Function's People
  const people = useMemo(() =>
    store.people.filter(p =>
      p.active &&
      activeFnTeamIds.has(p.teamId) &&
      (!filterDomain || p.primary_domain_id === filterDomain) &&
      (!filterPerson || p.id === filterPerson)
    ),
    [store.people, filterDomain, filterPerson, activeFnTeamIds]
  )

  // §4 View 2: Group-by-Domain uses active Function's Domains
  const domains = useMemo(() =>
    store.domains.filter(d => d.functionId === activeFunctionId),
    [store.domains, activeFunctionId]
  )

  function getHoursByType(personId: string, month: string): HoursByType {
    const r: HoursByType = { bau: 0, npd: 0, plant: 0, strategy: 0 }
    for (const item of activeDemand) {
      const key = typeToBreakdownKey(item.type, store.projectTypes) as keyof HoursByType | null
      if (!key) continue
      for (const activity of item.activities) {
        if (!monthInRange(month, activity.start_month, activity.end_month)) continue
        for (const req of activity.requirements) {
          for (const alloc of req.allocations) {
            if (alloc.person_id !== personId) continue
            const hours = activity.end_month === null
              ? (alloc.steady_state_hours ?? 0)
              : (alloc.hours_by_month[month] ?? 0)
            if (hours <= 0) continue
            r[key] += hours
          }
        }
      }
    }
    return r
  }

  // Returns segment hours for a single person cell
  function getPersonCellData(personId: string, _personTeamId: string, month: string): {
    hrs: HoursByType
  } {
    const hrs: HoursByType = { bau: 0, npd: 0, plant: 0, strategy: 0 }
    for (const item of activeDemand) {
      const key = typeToBreakdownKey(item.type, store.projectTypes) as keyof HoursByType | null
      if (!key) continue
      for (const activity of item.activities) {
        if (!monthInRange(month, activity.start_month, activity.end_month)) continue
        for (const req of activity.requirements) {
          for (const alloc of req.allocations) {
            if (alloc.person_id !== personId) continue
            const hours = activity.end_month === null
              ? (alloc.steady_state_hours ?? 0)
              : (alloc.hours_by_month[month] ?? 0)
            if (hours <= 0) continue
            hrs[key] += hours
          }
        }
      }
    }
    return { hrs }
  }

  // Aggregate hours across all visible people in a team for the team summary bar
  function getTeamSummary(teamId: string, month: string): HoursByType & { contracted: number } {
    const teamPeople = people.filter(p => p.teamId === teamId)
    const contracted = teamPeople.reduce((sum, p) =>
      sum + (monthInRange(month, p.available_from, p.available_to) ? p.contracted_hours_per_month : 0), 0)
    const r: HoursByType = { bau: 0, npd: 0, plant: 0, strategy: 0 }
    for (const p of teamPeople) {
      const hrs = getHoursByType(p.id, month)
      r.bau += hrs.bau; r.npd += hrs.npd; r.plant += hrs.plant; r.strategy += hrs.strategy
    }
    return { ...r, contracted }
  }

  function getContributing(personId: string, month: string, filterKey?: SegKey): ContributingItem[] {
    const items: ContributingItem[] = []
    for (const item of activeDemand) {
      const key = typeToBreakdownKey(item.type, store.projectTypes) as SegKey | null
      if (filterKey && key !== filterKey) continue
      for (const activity of item.activities) {
        if (!monthInRange(month, activity.start_month, activity.end_month)) continue
        for (const req of activity.requirements) {
          for (const alloc of req.allocations) {
            if (alloc.person_id !== personId) continue
            const hours = activity.end_month === null
              ? (alloc.steady_state_hours ?? 0)
              : (alloc.hours_by_month[month] ?? 0)
            if (hours > 0) items.push({ demandId: item.id, name: item.name, type: item.type, hours, activity: activity.name || 'Activity' })
          }
        }
      }
    }
    return items
  }

  const groupedPeople = useMemo(() =>
    domains.map(t => ({ domain: t, rows: people.filter(p => p.primary_domain_id === t.id) }))
      .filter(g => g.rows.length > 0),
    [people, domains]
  )

  // §4 View 2: Group-by-Team uses active Function's Teams
  const groupedByTeam = useMemo(() =>
    store.teams
      .filter(t => t.active && t.functionId === activeFunctionId)
      .map(team => ({ team, rows: people.filter(p => p.teamId === team.id) }))
      .filter(g => g.rows.length > 0),
    [people, store.teams, activeFunctionId]
  )

  const drillItems = useMemo(() => {
    if (!drillCell) return []
    return getContributing(drillCell.personId, drillCell.month, drillCell.filterKey)
  }, [drillCell, activeDemand])

  function renderPersonRow(person: Person) {
    return (
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
                <div className="h-7 rounded bg-gray-100" style={{ backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.04) 4px, rgba(0,0,0,0.04) 8px)' }} />
                <div className="text-[9px] text-gray-300 text-center mt-0.5">n/a</div>
              </td>
            )
          }

          const { hrs } = getPersonCellData(person.id, person.teamId, month)
          const committed = hrs.bau + hrs.npd + hrs.plant + hrs.strategy
          const available = Math.max(0, contracted - committed)
          const isOver = committed > contracted
          const toW = (h: number) => contracted > 0 ? (h / contracted) * 100 : 0

          return (
            <td
              key={month}
              className={clsx('px-1.5 py-1.5 border-r border-border/50 cursor-pointer', isOver ? 'bg-red-50' : 'hover:bg-gray-50/60')}
              onClick={() => setDrillCell({ personId: person.id, personName: person.name, month })}
            >
              <div
                className="relative h-7 bg-gray-100 rounded overflow-hidden"
                title={`${person.name} · ${formatMonthLabel(month)}\nBAU ${hrs.bau}h · NPD ${hrs.npd}h · Plant ${hrs.plant}h · Strategy ${hrs.strategy}h · Available ${available}h / ${contracted}h`}
              >
                <div className="absolute inset-0 flex">
                  {segments.map(seg => {
                    const h = hrs[seg.key]
                    if (h <= 0) return null
                    return (
                      <div
                        key={seg.key}
                        style={{
                          width: `${Math.min(toW(h), 100)}%`,
                          backgroundColor: SEG_COLORS[seg.key],
                          flexShrink: 0,
                          boxSizing: 'border-box',
                        }}
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
                <span className={isOver ? 'text-red-600 font-medium' : 'text-gray-500'}>{Math.round(committed)}h</span>
                {isOver
                  ? <span className="text-red-500">+{Math.round(committed - contracted)}h</span>
                  : <span className="text-gray-400">{Math.round(available)}h free</span>
                }
              </div>
            </td>
          )
        })}
      </tr>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Team Activity</span>
        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Horizon:</span>
          {HORIZONS.map(h => (
            <button key={h} onClick={() => setHorizon(h)}
              className={clsx('px-2 py-0.5 text-xs rounded font-medium transition-colors',
                horizon === h ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100'
              )}>
              {h}m
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Group by:</span>
          {(['domain', 'team'] as const).map(g => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={clsx('px-2 py-0.5 text-xs rounded font-medium transition-colors capitalize',
                groupBy === g ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100'
              )}>
              {g === 'domain' ? 'Domain' : 'Team'}
            </button>
          ))}
        </div>

        <select value={filterDomain} onChange={e => { setFilterDomain(e.target.value); setFilterPerson('') }}
          className="text-xs border border-border rounded px-2 py-1 bg-white">
          <option value="">All Domains</option>
          {domains.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-white">
          <option value="">All People</option>
          {store.people.filter(p =>
            p.active && activeFnTeamIds.has(p.teamId) &&
            (!filterDomain || p.primary_domain_id === filterDomain)
          ).map(p =>
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
                <th key={m} className={clsx('px-2 py-2 text-center font-medium border-r border-border/50 min-w-[140px]',
                  m === now ? 'text-brand bg-blue-50/50' : 'text-gray-500')}>
                  {formatMonthLabel(m)}
                  {m === now && <div className="text-[9px] text-brand font-semibold">NOW</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupBy === 'team' ? (
              groupedByTeam.map(group => (
                <Fragment key={group.team.id}>
                  {/* Team header row with aggregate summary bar per month */}
                  <tr className="bg-slate-100/60 border-b border-border">
                    <td className="sticky left-0 bg-slate-100/60 border-r border-border px-4 py-2 z-10">
                      <div className="font-semibold text-near-black text-xs">{group.team.name}</div>
                      <div className="text-[10px] text-gray-400 uppercase tracking-wide">{group.team.type}</div>
                    </td>
                    {months.map(month => {
                      const s = getTeamSummary(group.team.id, month)
                      const committed = s.bau + s.npd + s.plant + s.strategy
                      const available = Math.max(0, s.contracted - committed)
                      const isOver = committed > s.contracted
                      const toW = (h: number) => s.contracted > 0 ? (h / s.contracted) * 100 : 0
                      return (
                        <td key={month} className={clsx('px-1.5 py-1.5 border-r border-border/50', isOver ? 'bg-red-50' : '')}>
                          <div className="relative h-7 bg-gray-100 rounded overflow-hidden"
                            title={`${group.team.name} · ${formatMonthLabel(month)}\n${Math.round(committed)}h committed / ${Math.round(s.contracted)}h contracted`}>
                            <div className="absolute inset-0 flex">
                              {segments.map(seg => {
                                const h = s[seg.key]
                                if (h <= 0) return null
                                return <div key={seg.key} style={{ width: `${Math.min(toW(h), 100)}%`, backgroundColor: SEG_COLORS[seg.key], flexShrink: 0 }} />
                              })}
                              {!isOver && available > 0 && <div style={{ backgroundColor: SEG_COLORS.available, flex: 1 }} />}
                              {isOver && <div style={{ width: `${toW(committed - s.contracted)}%`, backgroundColor: SEG_COLORS.over, flexShrink: 0 }} />}
                            </div>
                          </div>
                          <div className="flex justify-between text-[9px] mt-0.5 px-0.5">
                            <span className={isOver ? 'text-red-600 font-medium' : 'text-gray-500'}>{Math.round(committed)}h</span>
                            {isOver
                              ? <span className="text-red-500">+{Math.round(committed - s.contracted)}h</span>
                              : <span className="text-gray-400">{Math.round(available)}h free</span>
                            }
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                  {group.rows.map(person => renderPersonRow(person))}
                </Fragment>
              ))
            ) : (
              groupedPeople.map(group => (
                <Fragment key={group.domain.id}>
                  <tr className="bg-gray-50/80">
                    <td colSpan={months.length + 1} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-border">
                      {group.domain.name}
                    </td>
                  </tr>
                  {group.rows.map(person => renderPersonRow(person))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-5 py-2 border-t border-border bg-gray-50 text-xs text-gray-500 flex-wrap">
        {segments.map(s => (
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
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: SEG_COLORS[drillCell.filterKey] + '33', color: '#374151' }}>
                    {segments.find(s => s.key === drillCell.filterKey)?.label}
                    <button onClick={() => setDrillCell(c => c ? { ...c, filterKey: undefined } : null)} className="opacity-60 hover:opacity-100">
                      <X size={10} />
                    </button>
                  </span>
                )}
              </div>
              <button onClick={() => setDrillCell(null)} className="text-gray-400 hover:text-near-black"><X size={15} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {drillItems.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-4 text-center">
                  {drillCell.filterKey ? 'No demand in this work type.' : 'No active demand this month — person is fully available.'}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {drillItems.map((item, i) => {
                    const seg = segments.find(s => s.typeId === item.type)
                    const typeLabel = store.projectTypes.find(pt => pt.id === item.type)?.name ?? item.type
                    return (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded border border-border bg-gray-50">
                        {seg && <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: SEG_COLORS[seg.key] }} />}
                        <div className="flex-1 min-w-0">
                          <button onClick={() => { setEditorId(item.demandId); setDrillCell(null) }}
                            className="text-xs font-medium text-brand hover:underline text-left truncate block">
                            {item.name}
                          </button>
                          <div className="text-[10px] text-gray-400">{item.activity} · {typeLabel}</div>
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
