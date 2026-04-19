import { useState, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { parseISO, differenceInMonths, addMonths, format } from 'date-fns'
import { clsx } from 'clsx'
import { useAppStore } from '../../store/useAppStore'
import {
  generateMonths, getCurrentMonth, formatMonthLabel, monthInRange,
} from '../../utils/capacity'
import {
  real_committed_hours, skill_capacity, demand_hours_for, computeProjection, projection_shortfalls,
} from '../../lib/capacity'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import type { DemandItem, DemandStatus, DemandType, Level } from '../../types'
import { DEMAND_COLORS } from '../../components/CapacityChart'

const HORIZONS = [6, 12, 24, 60] as const
const COMMITTED_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])

const LEVEL_ORDER: Record<Level, number> = { Basic: 0, Advanced: 1, Specialist: 2 }

// ─── Utilisation heatmap cell ─────────────────────────────────────────────────

function HeatCell({
  personId,
  month,
  contracted,
  onNavigateTeam,
}: {
  personId: string
  month: string
  contracted: number
  onNavigateTeam: (personId: string, month: string) => void
}) {
  const store = useAppStore()
  const person = store.people.find(p => p.id === personId)

  if (!person || contracted === 0) {
    // Outside availability window — diagonal stripe
    return (
      <div
        title="Outside availability window"
        className="w-7 h-5 rounded-sm flex-shrink-0"
        style={{
          background: 'repeating-linear-gradient(-45deg, #e5e7eb, #e5e7eb 2px, #f3f4f6 2px, #f3f4f6 6px)',
        }}
      />
    )
  }

  const committed = real_committed_hours(personId, month, store)
  const pct = contracted > 0 ? committed / contracted : 0
  const colorClass = pct > 1
    ? 'bg-red-800'
    : pct > 0.9
    ? 'bg-red-500'
    : pct > 0.7
    ? 'bg-amber-400'
    : 'bg-green-400'

  const byType = (() => {
    let bau = 0, plant = 0, npd = 0, strategy = 0
    for (const item of store.demandItems) {
      if (!COMMITTED_STATUSES.has(item.status)) continue
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          for (const alloc of req.allocations) {
            if (alloc.person_id !== personId) continue
            const h = phase.end_month === null ? (alloc.steady_state_hours ?? 0) : (alloc.hours_by_month[month] ?? 0)
            if (item.type === 'BAU') bau += h
            else if (item.type === 'Plant Project') plant += h
            else if (item.type === 'NPD Demand') npd += h
            else if (item.type === 'Group Strategy Project') strategy += h
          }
        }
      }
    }
    return { bau, plant, npd, strategy }
  })()

  const tip = [
    `${person.name}, ${formatMonthLabel(month)}`,
    `${contracted}h contracted`,
    byType.bau > 0 ? `${Math.round(byType.bau)}h BAU` : null,
    byType.plant > 0 ? `${Math.round(byType.plant)}h Plant Project` : null,
    byType.npd > 0 ? `${Math.round(byType.npd)}h NPD` : null,
    byType.strategy > 0 ? `${Math.round(byType.strategy)}h Group Strategy` : null,
    `${Math.round(Math.max(0, contracted - committed))}h available`,
  ].filter(Boolean).join(' · ')

  return (
    <div
      title={tip}
      onClick={() => onNavigateTeam(personId, month)}
      className={clsx('w-7 h-5 rounded-sm flex-shrink-0 cursor-pointer hover:opacity-75 transition-opacity', colorClass)}
    />
  )
}

// ─── People list ──────────────────────────────────────────────────────────────

type SortKey = 'level' | 'name' | 'avg' | 'worst'

function PeopleList({
  skillId,
  months,
  onNavigateTeam,
}: {
  skillId: string
  months: string[]
  onNavigateTeam: (personId: string, month: string) => void
}) {
  const store = useAppStore()
  const [sortKey, setSortKey] = useState<SortKey>('level')
  const [sortAsc, setSortAsc] = useState(false)

  const rows = useMemo(() => {
    const people = store.people.filter(p =>
      p.active && p.skills.some(ps => ps.skill_id === skillId)
    )

    return people.map(person => {
      const skillEntry = person.skills.find(ps => ps.skill_id === skillId)!
      const theme = store.themes.find(t => t.id === person.primary_theme_id)

      const monthHeadrooms = months.map(month => {
        const contracted = monthInRange(month, person.available_from, person.available_to)
          ? person.contracted_hours_per_month : 0
        const committed = contracted > 0 ? real_committed_hours(person.id, month, store) : 0
        return Math.max(0, contracted - committed)
      })

      const avgHeadroom = monthHeadrooms.length > 0
        ? monthHeadrooms.reduce((s, h) => s + h, 0) / monthHeadrooms.length
        : 0

      const worstHeadroom = monthHeadrooms.length > 0
        ? Math.min(...monthHeadrooms)
        : 0

      const worstMonth = months[monthHeadrooms.indexOf(worstHeadroom)] ?? months[0]

      return {
        person,
        level: skillEntry.level,
        theme,
        avgHeadroom,
        worstHeadroom,
        worstMonth,
      }
    })
  }, [store, skillId, months])

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'level') {
        cmp = LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]
        if (cmp === 0) cmp = b.avgHeadroom - a.avgHeadroom
      } else if (sortKey === 'name') {
        cmp = a.person.name.localeCompare(b.person.name)
      } else if (sortKey === 'avg') {
        cmp = b.avgHeadroom - a.avgHeadroom
      } else if (sortKey === 'worst') {
        cmp = b.worstHeadroom - a.worstHeadroom
      }
      return sortAsc ? -cmp : cmp
    })
    return copy
  }, [rows, sortKey, sortAsc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAsc(v => !v)
    else { setSortKey(key); setSortAsc(false) }
  }
  function setAsc(fn: (v: boolean) => boolean) { setSortAsc(fn) }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortAsc ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : null

  const levelBg: Record<Level, string> = {
    Specialist: 'bg-purple-100 text-purple-700',
    Advanced: 'bg-blue-100 text-blue-700',
    Basic: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-50">
        <button onClick={() => toggleSort('name')} className="flex items-center gap-0.5 w-32 hover:text-near-black">
          Name <SortIcon k="name" />
        </button>
        <span className="w-24">Skill</span>
        <div className="flex gap-0.5">
          {months.map(m => (
            <span key={m} className="w-7 text-center text-[8px] whitespace-nowrap overflow-hidden">
              {formatMonthLabel(m).replace(' ', '')}
            </span>
          ))}
        </div>
        <button onClick={() => toggleSort('avg')} className="flex items-center gap-0.5 w-16 hover:text-near-black ml-2">
          Avg <SortIcon k="avg" />
        </button>
        <button onClick={() => toggleSort('worst')} className="flex items-center gap-0.5 w-24 hover:text-near-black">
          Worst <SortIcon k="worst" />
        </button>
      </div>

      {sorted.length === 0 && (
        <p className="text-xs text-gray-400 italic p-4">No active people hold this skill.</p>
      )}

      {sorted.map(({ person, level, theme, avgHeadroom, worstHeadroom, worstMonth }) => (
        <div key={person.id} className="px-4 py-2 flex items-center gap-4 border-b border-border/50 hover:bg-gray-50/50">
          <span className="text-xs font-medium text-near-black w-32 truncate">{person.name}</span>
          <div className="w-24 flex items-center gap-1">
            <span className={clsx('text-[10px] px-1.5 py-0.5 rounded font-medium', levelBg[level])}>{level}</span>
            {theme && <span className="text-[9px] text-gray-400 truncate">{theme.name}</span>}
          </div>
          <div className="flex gap-0.5">
            {months.map(month => {
              const contracted = monthInRange(month, person.available_from, person.available_to)
                ? person.contracted_hours_per_month : 0
              return (
                <HeatCell
                  key={month}
                  personId={person.id}
                  month={month}
                  contracted={contracted}
                  onNavigateTeam={onNavigateTeam}
                />
              )
            })}
          </div>
          <span className="text-[10px] text-gray-600 w-16 ml-2 tabular-nums text-right">
            {Math.round(avgHeadroom)}h avg
          </span>
          <span className="text-[10px] text-gray-500 w-24 tabular-nums text-right">
            {Math.round(worstHeadroom)}h ({formatMonthLabel(worstMonth)})
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Demand Gantt ─────────────────────────────────────────────────────────────

const DEMAND_TYPE_COLOR: Record<DemandType, string> = {
  'BAU':                    DEMAND_COLORS.bau,
  'Plant Project':           DEMAND_COLORS.plant,
  'NPD Demand':              DEMAND_COLORS.npd,
  'Group Strategy Project':  DEMAND_COLORS.strategy,
}

const STATUS_ORDER: Record<DemandStatus, number> = {
  Allocated: 0, PartiallyAllocated: 1, Approved: 2, Submitted: 3, Draft: 4, Parked: 5, Closed: 6,
}

const STATUS_LABEL: Partial<Record<DemandStatus, string>> = {
  Allocated: 'Alloc',
  PartiallyAllocated: 'Part',
  Approved: 'Appr',
  Submitted: 'Sub',
  Draft: 'Draft',
  Parked: 'Parked',
  Closed: 'Closed',
}

function getSkillMonthRuns(
  item: DemandItem,
  skillId: string,
  requiredLevel: Level | null,
  months: string[]
): Array<{ startLabel: string; endLabel: string; startIdx: number; endIdx: number }> {
  const activeMonths = new Set<number>()

  for (const phase of item.phases) {
    for (const req of phase.requirements) {
      if (req.skill_id !== skillId) continue
      if (requiredLevel !== null && LEVEL_ORDER[req.level] < LEVEL_ORDER[requiredLevel]) continue
      for (let i = 0; i < months.length; i++) {
        if (monthInRange(months[i], phase.start_month, phase.end_month)) {
          activeMonths.add(i)
        }
      }
    }
  }

  if (activeMonths.size === 0) return []

  const sorted = Array.from(activeMonths).sort((a, b) => a - b)
  const runs: Array<{ startLabel: string; endLabel: string; startIdx: number; endIdx: number }> = []
  let runStart = sorted[0]
  let prev = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i]
    } else {
      runs.push({ startLabel: months[runStart], endLabel: months[prev], startIdx: runStart, endIdx: prev })
      runStart = sorted[i]
      prev = sorted[i]
    }
  }
  runs.push({ startLabel: months[runStart], endLabel: months[prev], startIdx: runStart, endIdx: prev })
  return runs
}

function DemandSkillGantt({
  skillId,
  months,
  onOpenDemand,
}: {
  skillId: string
  months: string[]
  onOpenDemand: (id: string) => void
}) {
  const store = useAppStore()

  const [statusFilter, setStatusFilter] = useState<Set<DemandStatus>>(
    new Set(['Approved', 'PartiallyAllocated', 'Allocated'])
  )
  const [typeFilter, setTypeFilter] = useState<Set<DemandType>>(
    new Set(['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU'])
  )
  const [levelFilter, setLevelFilter] = useState<Level | null>(null)

  const ALL_STATUSES: DemandStatus[] = ['Approved', 'PartiallyAllocated', 'Allocated', 'Submitted', 'Draft', 'Parked']
  const ALL_TYPES: DemandType[] = ['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU']
  const ALL_LEVELS: Array<Level | null> = [null, 'Basic', 'Advanced', 'Specialist']

  const rows = useMemo(() => {
    const result: Array<{
      item: DemandItem
      runs: ReturnType<typeof getSkillMonthRuns>
    }> = []

    for (const item of store.demandItems) {
      if (!statusFilter.has(item.status)) continue
      if (!typeFilter.has(item.type)) continue
      const runs = getSkillMonthRuns(item, skillId, levelFilter, months)
      if (runs.length === 0) continue
      result.push({ item, runs })
    }

    result.sort((a, b) => {
      const aStart = Math.min(...a.runs.map(r => r.startIdx))
      const bStart = Math.min(...b.runs.map(r => r.startIdx))
      if (aStart !== bStart) return aStart - bStart
      return STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status]
    })

    return result
  }, [store.demandItems, skillId, statusFilter, typeFilter, levelFilter, months])

  if (months.length === 0) return null

  const cellW = 28  // px per month cell
  const totalW = months.length * cellW

  function toggleStatus(s: DemandStatus) {
    setStatusFilter(prev => {
      const next = new Set(prev)
      next.has(s) ? next.delete(s) : next.add(s)
      return next
    })
  }

  function toggleType(t: DemandType) {
    setTypeFilter(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      {/* Filters */}
      <div className="px-4 py-2.5 border-b border-border bg-gray-50 flex flex-wrap items-center gap-3 text-[10px]">
        <span className="text-gray-500 font-semibold uppercase tracking-wider">Status:</span>
        {ALL_STATUSES.map(s => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={clsx(
              'px-2 py-0.5 rounded border font-medium transition-colors',
              statusFilter.has(s)
                ? 'bg-near-black text-white border-near-black'
                : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'
            )}
          >
            {STATUS_LABEL[s] ?? s}
          </button>
        ))}
        <span className="text-gray-400">|</span>
        <span className="text-gray-500 font-semibold uppercase tracking-wider">Type:</span>
        {ALL_TYPES.map(t => (
          <button
            key={t}
            onClick={() => toggleType(t)}
            className={clsx(
              'px-2 py-0.5 rounded border font-medium transition-colors',
              typeFilter.has(t)
                ? 'border-transparent text-white'
                : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'
            )}
            style={typeFilter.has(t) ? { backgroundColor: DEMAND_TYPE_COLOR[t] } : {}}
          >
            {t === 'Group Strategy Project' ? 'Strategy' : t === 'Plant Project' ? 'Plant' : t === 'NPD Demand' ? 'NPD' : t}
          </button>
        ))}
        <span className="text-gray-400">|</span>
        <span className="text-gray-500 font-semibold uppercase tracking-wider">Level:</span>
        {ALL_LEVELS.map(l => (
          <button
            key={l ?? 'all'}
            onClick={() => setLevelFilter(l)}
            className={clsx(
              'px-2 py-0.5 rounded border font-medium transition-colors',
              levelFilter === l
                ? 'bg-near-black text-white border-near-black'
                : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'
            )}
          >
            {l ?? 'All'}
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="text-xs text-gray-400 italic p-4">No demand items match the current filters.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <div style={{ minWidth: Math.max(totalW + 220, 480) }}>
            {/* Month header */}
            <div className="flex border-b border-border bg-gray-50 sticky top-0 z-10">
              <div className="w-52 shrink-0 px-3 py-1.5 text-[9px] text-gray-400 uppercase tracking-wider font-semibold">
                Demand
              </div>
              <div className="flex" style={{ width: totalW }}>
                {months.map(m => (
                  <div
                    key={m}
                    className="text-[9px] text-gray-400 text-center border-l border-gray-100"
                    style={{ width: cellW }}
                  >
                    {formatMonthLabel(m).replace(' ', '')}
                  </div>
                ))}
              </div>
            </div>

            {/* Rows — with vertical padding above and below bars */}
            <div style={{ paddingTop: 6, paddingBottom: 10 }}>
              {rows.map(({ item, runs }) => {
                const barColor = DEMAND_TYPE_COLOR[item.type]
                const statusLabel = STATUS_LABEL[item.status] ?? item.status

                return (
                  <div key={item.id} className="flex items-center border-b border-border/40 hover:bg-gray-50/50">
                    <div className="w-52 shrink-0 px-3 py-1.5 text-[10px]">
                      <div className="font-medium text-near-black truncate">{item.name}</div>
                      <div className="text-gray-400">{item.type}</div>
                    </div>
                    <div className="relative" style={{ width: totalW, height: 28 }}>
                      {runs.map((run, ri) => {
                        const leftPx = run.startIdx * cellW
                        const widthPx = (run.endIdx - run.startIdx + 1) * cellW
                        return (
                          <button
                            key={ri}
                            type="button"
                            title={`${item.name} · ${item.status} · ${formatMonthLabel(run.startLabel)}–${formatMonthLabel(run.endLabel)}`}
                            onClick={() => onOpenDemand(item.id)}
                            className="absolute top-1 bottom-1 rounded flex items-center overflow-hidden px-1.5 hover:opacity-80 transition-opacity"
                            style={{ left: leftPx, width: widthPx, backgroundColor: barColor }}
                          >
                            {/* Status pill */}
                            <span className="shrink-0 text-[8px] font-semibold px-1 py-0.5 rounded mr-1"
                              style={{ backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff' }}>
                              {statusLabel}
                            </span>
                            {/* Label */}
                            <span className="truncate text-[9px] font-medium"
                              style={{ color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                              {item.name}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main skill detail view ───────────────────────────────────────────────────

export default function SkillDetail() {
  const { skillId } = useParams<{ skillId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const store = useAppStore()

  const horizonParam = parseInt(searchParams.get('horizon') ?? '12', 10)
  const horizon: 6 | 12 | 24 | 60 = ([6, 12, 24, 60] as const).includes(horizonParam as never)
    ? (horizonParam as 6 | 12 | 24 | 60)
    : 12

  const [editorId, setEditorId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const skill = skillId ? store.skills.find(s => s.id === skillId) : null
  const theme = skill ? store.themes.find(t => t.id === skill.theme_id) : null

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])

  const projResult = useMemo(
    () => computeProjection(store, months, null),
    [store, months]
  )
  const shortfalls = useMemo(
    () => projection_shortfalls(projResult).filter(sf => sf.skill_id === skillId && months.includes(sf.month)),
    [projResult, skillId, months]
  )

  // People who hold this skill
  const skillHolders = useMemo(() => {
    if (!skillId) return []
    return store.people.filter(p => p.active && p.skills.some(ps => ps.skill_id === skillId))
  }, [store.people, skillId])

  // Level breakdown
  const levelCounts = useMemo(() => {
    const counts: Record<Level, number> = { Basic: 0, Advanced: 0, Specialist: 0 }
    for (const p of skillHolders) {
      const entry = p.skills.find(ps => ps.skill_id === skillId)
      if (entry) counts[entry.level]++
    }
    return counts
  }, [skillHolders, skillId])

  // Peak demand and utilisation across visible horizon
  const { peakDemand, peakDemandMonth, peakUtil, peakUtilMonth } = useMemo(() => {
    if (!skillId || months.length === 0) return { peakDemand: 0, peakDemandMonth: '', peakUtil: 0, peakUtilMonth: '' }
    let pd = 0, pdm = months[0], pu = 0, pum = months[0]
    for (const month of months) {
      const committed = demand_hours_for({ type: 'skill', id: skillId }, COMMITTED_STATUSES, month, store)
      const total = committed.bau + committed.plant + committed.npd + committed.strategy
      if (total > pd) { pd = total; pdm = month }
      const cap = skill_capacity(skillId, month, store)
      const util = cap > 0 ? total / cap : 0
      if (util > pu) { pu = util; pum = month }
    }
    return { peakDemand: pd, peakDemandMonth: pdm, peakUtil: pu, peakUtilMonth: pum }
  }, [skillId, months, store])

  function setHorizon(h: 6 | 12 | 24 | 60) {
    setSearchParams({ horizon: String(h) })
  }

  function handleNavigateTeam(personId: string, month: string) {
    navigate(`/team?person=${personId}&month=${month}`)
  }

  function openDemand(id: string) { setEditorId(id); setEditorOpen(true) }
  function closeDemand() { setEditorOpen(false); setEditorId(null) }

  if (!skill) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Skill not found.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto bg-gray-50">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-near-black transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm font-semibold text-near-black">
          {theme?.name} › {skill.name}
        </span>
        <div className="flex-1" />
        {/* Horizon */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide mr-1">Horizon:</span>
          {([6, 12, 24, 60] as const).map(h => (
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
      </div>

      <div className="flex-1 px-5 py-5 max-w-[1400px] mx-auto w-full flex flex-col gap-6">

        {/* Section 1 — Skill header */}
        <div className="bg-white border border-border rounded-lg p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold text-near-black">{skill.name}</h1>
              <p className="text-xs text-gray-500 mt-0.5">{theme?.name}</p>
            </div>
            <div className="flex gap-6 flex-wrap">
              {/* Level breakdown */}
              <div className="flex flex-col gap-0.5">
                <span className="text-xl font-semibold font-mono text-near-black">{skillHolders.length}</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">People</span>
                <div className="flex gap-2 mt-0.5">
                  {(['Specialist', 'Advanced', 'Basic'] as Level[]).map(l =>
                    levelCounts[l] > 0 ? (
                      <span key={l} className="text-[9px] text-gray-500">
                        {levelCounts[l]} {l}
                      </span>
                    ) : null
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xl font-semibold font-mono text-near-black">{Math.round(peakDemand)}h</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Peak demand</span>
                <span className="text-[9px] text-gray-400">{peakDemandMonth ? formatMonthLabel(peakDemandMonth) : '—'}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className={clsx('text-xl font-semibold font-mono', peakUtil > 1 ? 'text-red-600' : peakUtil > 0.9 ? 'text-amber-600' : 'text-near-black')}>
                  {Math.round(peakUtil * 100)}%
                </span>
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Peak utilisation</span>
                <span className="text-[9px] text-gray-400">{peakUtilMonth ? formatMonthLabel(peakUtilMonth) : '—'}</span>
              </div>
              {shortfalls.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xl font-semibold font-mono text-amber-600">
                    ⚠ {Math.round(Math.max(...shortfalls.map(s => s.shortfall_hours)))}h
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">Projection shortfall</span>
                  <span className="text-[9px] text-amber-600">peak in {formatMonthLabel(shortfalls.sort((a, b) => b.shortfall_hours - a.shortfall_hours)[0].month)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 2 — People heatmap */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            People · {skillHolders.length} holder{skillHolders.length !== 1 ? 's' : ''}
          </h2>
          <PeopleList
            skillId={skill.id}
            months={months}
            onNavigateTeam={handleNavigateTeam}
          />
        </div>

        {/* Section 3 — Demand Gantt */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            Demand consuming this skill
          </h2>
          <DemandSkillGantt
            skillId={skill.id}
            months={months}
            onOpenDemand={openDemand}
          />
        </div>
      </div>

      {editorOpen && (
        <DemandEditor demandId={editorId} onClose={closeDemand} />
      )}
    </div>
  )
}
