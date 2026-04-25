/**
 * §4.10 Demand view — Programme-level demand shape.
 * Deliberately ignores the active Function lens (§11.17).
 */
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer,
} from 'recharts'
import { ArrowLeft, ChevronRight, Info, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import {
  programme_demand_by_funding, programme_demand_by_team,
  project_demand_by_funding, project_demand_by_team,
  type DemandByFundingResult, type DemandByTeamEntry,
} from '../../lib/capacity'
import { generateMonths, getCurrentMonth, formatMonthLabel } from '../../utils/capacity'
import { DemandDrawer } from '../../components/DemandEditor/DemandEditor'
import type { DemandStatus, FundingSource, Programme, Project } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type StackingMode = 'funding' | 'team'
type HorizonMonths = 6 | 12 | 24 | 60

const HORIZONS: HorizonMonths[] = [6, 12, 24, 60]
const BASE_STATUS_SET = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])
const WITH_SUBMITTED_SET = new Set<DemandStatus>(['Submitted', 'Approved', 'PartiallyAllocated', 'Allocated'])

const FUNDING_KEYS: FundingSource[] = ['Investment Scheme', 'Plant/Sector Allocation', 'Mixed']
const FUNDING_COLORS: Record<FundingSource, string> = {
  'Investment Scheme': '#3b82f6',
  'Plant/Sector Allocation': '#10b981',
  'Mixed': '#f59e0b',
}

const FUNCTION_PALETTE = ['#6366f1', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#ca8a04', '#9333ea', '#64748b']
const EXTERNAL_COLOR = '#94a3b8'
const UNASSIGNED_COLOR = '#cbd5e1'

function fnColorFor(parentFunctionLabel: string, orderedLabels: string[]): string {
  if (parentFunctionLabel === 'External') return EXTERNAL_COLOR
  if (parentFunctionLabel === 'Unassigned') return UNASSIGNED_COLOR
  const idx = orderedLabels.indexOf(parentFunctionLabel)
  return FUNCTION_PALETTE[(idx >= 0 ? idx : 0) % FUNCTION_PALETTE.length]
}

// ─── Shared toolbar ───────────────────────────────────────────────────────────

interface ToolbarProps {
  horizon: HorizonMonths
  onHorizonChange: (h: HorizonMonths) => void
  stacking: StackingMode
  onStackingChange: (m: StackingMode) => void
  includeSubmitted: boolean
  onIncludeSubmittedChange: (v: boolean) => void
  programmes?: Programme[]
  filterProgrammeId?: string | null
  onFilterProgrammeChange?: (id: string | null) => void
}

function Toolbar({
  horizon, onHorizonChange,
  stacking, onStackingChange,
  includeSubmitted, onIncludeSubmittedChange,
  programmes, filterProgrammeId, onFilterProgrammeChange,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
      {/* Horizon */}
      <div className="flex items-center gap-0.5 border border-border rounded overflow-hidden">
        {HORIZONS.map(h => (
          <button
            key={h}
            onClick={() => onHorizonChange(h)}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              horizon === h
                ? 'bg-brand text-white'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {h}mo
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Stacking mode */}
      <div className="flex items-center gap-0.5 border border-border rounded overflow-hidden">
        {([['funding', 'By Funding Source'], ['team', 'By Team']] as [StackingMode, string][]).map(([m, label]) => (
          <button
            key={m}
            onClick={() => onStackingChange(m)}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              stacking === m ? 'bg-brand text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Include Submitted toggle */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeSubmitted}
          onChange={e => onIncludeSubmittedChange(e.target.checked)}
          className="accent-brand"
        />
        <span className="text-xs text-gray-600">Include Submitted</span>
      </label>

      {/* Programme filter (landing only) */}
      {programmes && onFilterProgrammeChange && (
        <>
          <div className="h-4 w-px bg-border" />
          <select
            value={filterProgrammeId ?? ''}
            onChange={e => onFilterProgrammeChange(e.target.value || null)}
            className="text-xs border border-border rounded px-2 py-1 text-gray-600 bg-white"
          >
            <option value="">All Programmes</option>
            {programmes.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

// ─── Stacked area chart for a Programme or Project ────────────────────────────

interface DemandChartProps {
  months: string[]
  stacking: StackingMode
  includeSubmitted: boolean
  getFundingData: (month: string, statusSet: ReadonlySet<DemandStatus>) => DemandByFundingResult
  getTeamData: (month: string, statusSet: ReadonlySet<DemandStatus>) => DemandByTeamEntry[]
  height?: number
  onMonthClick?: (month: string) => void
}

function DemandChart({
  months, stacking, includeSubmitted,
  getFundingData, getTeamData,
  height = 200, onMonthClick,
}: DemandChartProps) {
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET

  // Pre-compute team key ordering (stable across months)
  const teamKeys = useMemo(() => {
    const seen = new Map<string, DemandByTeamEntry>()
    for (const month of months) {
      for (const entry of getTeamData(month, WITH_SUBMITTED_SET)) {
        if (!seen.has(entry.key)) seen.set(entry.key, entry)
      }
    }
    const sortOrder = (e: DemandByTeamEntry) =>
      e.parent_function_label === 'External' ? 2 : e.parent_function_label === 'Unassigned' ? 1 : 0
    return [...seen.values()].sort((a, b) => {
      const ao = sortOrder(a), bo = sortOrder(b)
      if (ao !== bo) return ao - bo
      const pfCmp = a.parent_function_label.localeCompare(b.parent_function_label)
      if (pfCmp !== 0) return pfCmp
      return a.label.localeCompare(b.label)
    })
  }, [months, getTeamData])

  const orderedFnLabels = useMemo(() => {
    const labels = new Set<string>()
    for (const e of teamKeys) {
      if (e.parent_function_label !== 'External' && e.parent_function_label !== 'Unassigned') {
        labels.add(e.parent_function_label)
      }
    }
    return [...labels].sort()
  }, [teamKeys])

  const chartData = useMemo(() => months.map(month => {
    const label = formatMonthLabel(month)
    if (stacking === 'funding') {
      const base = getFundingData(month, BASE_STATUS_SET)
      if (includeSubmitted) {
        const total = getFundingData(month, WITH_SUBMITTED_SET)
        const point: Record<string, number | string> = { label, month }
        for (const k of FUNDING_KEYS) {
          point[`${k}_c`] = base[k]
          point[`${k}_s`] = Math.max(0, total[k] - base[k])
        }
        return point
      }
      const point: Record<string, number | string> = { label, month }
      for (const k of FUNDING_KEYS) point[k] = base[k]
      return point
    } else {
      // By Team
      const baseMap = new Map(getTeamData(month, BASE_STATUS_SET).map(e => [e.key, e.hours]))
      const totalMap = includeSubmitted
        ? new Map(getTeamData(month, WITH_SUBMITTED_SET).map(e => [e.key, e.hours]))
        : baseMap
      const point: Record<string, number | string> = { label, month }
      for (const e of teamKeys) {
        const base = baseMap.get(e.key) ?? 0
        const total = totalMap.get(e.key) ?? 0
        point[`${e.key}_c`] = base
        point[`${e.key}_s`] = Math.max(0, total - base)
      }
      return point
    }
  }), [months, stacking, includeSubmitted, getFundingData, getTeamData, teamKeys])

  const hasData = chartData.some(d => {
    return Object.entries(d).some(([k, v]) => k !== 'label' && k !== 'month' && (v as number) > 0)
  })

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-20 text-xs text-gray-400 italic">
        No demand in the visible horizon
      </div>
    )
  }

  const handleClick = (data: { activePayload?: { payload: { month: string } }[] }) => {
    if (onMonthClick && data?.activePayload?.[0]?.payload?.month) {
      onMonthClick(data.activePayload[0].payload.month)
    }
  }

  if (stacking === 'funding') {
    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }} onClick={handleClick as never}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
            <RechartTooltip
              formatter={(value: number, name: string) => {
                const clean = name.replace(/_c$/, '').replace(/_s$/, ' (Submitted)')
                return [`${value}h`, clean]
              }}
              labelStyle={{ fontWeight: 600, fontSize: 11 }}
              contentStyle={{ fontSize: 11 }}
            />
            {/* Committed series */}
            {FUNDING_KEYS.map(k => (
              <Area
                key={`${k}_c`}
                type="monotone"
                dataKey={includeSubmitted ? `${k}_c` : k}
                name={k}
                stackId="main"
                fill={FUNDING_COLORS[k]}
                stroke="none"
                fillOpacity={0.8}
                isAnimationActive={false}
              />
            ))}
            {/* Submitted overlay */}
            {includeSubmitted && FUNDING_KEYS.map(k => (
              <Area
                key={`${k}_s`}
                type="monotone"
                dataKey={`${k}_s`}
                name={`${k} (Submitted)`}
                stackId="main"
                fill={FUNDING_COLORS[k]}
                stroke="none"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap gap-3 mt-2 justify-end">
          {FUNDING_KEYS.map(k => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: FUNDING_COLORS[k], opacity: 0.8 }} />
              {k}
            </span>
          ))}
        </div>
      </div>
    )
  }

  // By Team mode
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }} onClick={handleClick as never}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
          <RechartTooltip
            formatter={(value: number, name: string) => {
              const clean = name.replace(/_c$/, '').replace(/_s$/, ' (Submitted)')
              return [`${value}h`, clean]
            }}
            labelStyle={{ fontWeight: 600, fontSize: 11 }}
            contentStyle={{ fontSize: 11 }}
          />
          {teamKeys.map(e => {
            const color = fnColorFor(e.parent_function_label, orderedFnLabels)
            return (
              <Area
                key={`${e.key}_c`}
                type="monotone"
                dataKey={`${e.key}_c`}
                name={`${e.label} (${e.parent_function_label})`}
                stackId="main"
                fill={color}
                stroke="none"
                fillOpacity={0.75}
                isAnimationActive={false}
              />
            )
          })}
          {includeSubmitted && teamKeys.map(e => {
            const color = fnColorFor(e.parent_function_label, orderedFnLabels)
            return (
              <Area
                key={`${e.key}_s`}
                type="monotone"
                dataKey={`${e.key}_s`}
                name={`${e.label} (${e.parent_function_label}) — Submitted`}
                stackId="main"
                fill={color}
                stroke="none"
                fillOpacity={0.3}
                isAnimationActive={false}
              />
            )
          })}
        </AreaChart>
      </ResponsiveContainer>
      {teamKeys.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-2 justify-end">
          {teamKeys.map(e => (
            <span key={e.key} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: fnColorFor(e.parent_function_label, orderedFnLabels), opacity: 0.75 }} />
              {e.label}
              <span className="text-gray-400">({e.parent_function_label})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Roll-up summary line ─────────────────────────────────────────────────────

function rollupSummary(
  months: string[],
  computeFn: (month: string) => number
): { peak: number; peakMonth: string; total: number } {
  let peak = 0
  let peakMonth = months[0] ?? ''
  let total = 0
  for (const m of months) {
    const v = computeFn(m)
    total += v
    if (v > peak) { peak = v; peakMonth = m }
  }
  return { peak, peakMonth, total }
}

// ─── Side panel ───────────────────────────────────────────────────────────────

interface SidePanelState {
  month: string
  scopeLabel: string
  programmeId?: string
  projectId?: string
}

function SidePanel({
  state: panelState,
  statusSet,
  onClose,
  onOpenDrawer,
}: {
  state: SidePanelState
  statusSet: ReadonlySet<DemandStatus>
  onClose: () => void
  onOpenDrawer: (id: string) => void
}) {
  const demandItems = useAppStore(s => s.demandItems)
  const projects = useAppStore(s => s.projects)
  const programmes = useAppStore(s => s.programmes)

  const qualifying = useMemo(() => {
    return demandItems.filter(item => {
      if (!statusSet.has(item.status) && item.status !== 'Submitted') return false
      if (panelState.projectId && item.project_id !== panelState.projectId) return false
      if (panelState.programmeId && !panelState.projectId) {
        const project = projects.find(p => p.id === item.project_id)
        if (!project || project.programme_id !== panelState.programmeId) return false
      }
      return item.phases.some(ph => {
        const m = panelState.month
        return m >= ph.start_month && (ph.end_month === null || m <= ph.end_month)
      })
    })
  }, [panelState, statusSet, demandItems, projects])

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-border shadow-lg z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-xs font-semibold text-near-black">{formatMonthLabel(panelState.month)}</div>
          <div className="text-[10px] text-gray-400">{panelState.scopeLabel}</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-near-black">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {qualifying.length === 0 ? (
          <p className="text-xs text-gray-400 p-4">No qualifying demand items for this month.</p>
        ) : (
          <ul className="divide-y divide-border">
            {qualifying.map(item => {
              const project = projects.find(p => p.id === item.project_id)
              const programme = project ? programmes.find(pr => pr.id === project.programme_id) : null
              return (
                <li key={item.id}>
                  <button
                    onClick={() => onOpenDrawer(item.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-xs font-medium text-near-black">{item.name}</div>
                    {programme && project && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{programme.name} › {project.name}</div>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item.status}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Unaligned card (virtual) ─────────────────────────────────────────────────

function UnalignedCard({
  months, stacking, includeSubmitted,
}: {
  months: string[]
  stacking: StackingMode
  includeSubmitted: boolean
}) {
  const demandItems = useAppStore(s => s.demandItems)
  const teams = useAppStore(s => s.teams)
  const functions = useAppStore(s => s.functions)
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET
  const hasUnaligned = useMemo(() =>
    demandItems.some(d => d.project_id === null && d.status !== 'Parked' && d.status !== 'Closed'),
    [demandItems]
  )
  if (!hasUnaligned) return null

  const getUnalignedFunding = (month: string, ss: ReadonlySet<DemandStatus>): DemandByFundingResult => {
    const result: DemandByFundingResult = { 'Investment Scheme': 0, 'Plant/Sector Allocation': 0, 'Mixed': 0 }
    for (const item of demandItems) {
      if (item.project_id !== null) continue
      if (!ss.has(item.status)) continue
      for (const phase of item.phases) {
        if (!(month >= phase.start_month && (phase.end_month === null || month <= phase.end_month))) continue
        for (const req of phase.requirements) {
          const h = phase.end_month === null ? (req.steady_state_hours ?? 0) : (req.hours_by_month[month] ?? 0)
          result[phase.funding_source] += h
        }
      }
    }
    return result
  }

  const getUnalignedTeam = (month: string, ss: ReadonlySet<DemandStatus>): DemandByTeamEntry[] => {
    const acc = new Map<string, DemandByTeamEntry>()
    const teamMap = new Map(teams.map(t => [t.id, t]))
    const fnMap = new Map(functions.map(f => [f.id, f]))

    for (const item of demandItems) {
      if (item.project_id !== null) continue
      if (!ss.has(item.status)) continue
      for (const phase of item.phases) {
        if (!(month >= phase.start_month && (phase.end_month === null || month <= phase.end_month))) continue
        for (const req of phase.requirements) {
          const h = phase.end_month === null ? (req.steady_state_hours ?? 0) : (req.hours_by_month[month] ?? 0)
          if (h <= 0) continue
          const teamId = req.owningTeamId
          const k = teamId ? `team:${teamId}` : 'team:unassigned'
          if (!acc.has(k)) {
            const team = teamId ? teamMap.get(teamId) : undefined
            const fn = team ? fnMap.get(team.functionId) : undefined
            acc.set(k, { key: k, hours: 0, label: team?.name ?? 'Unassigned', parent_function_label: fn?.name ?? 'Unassigned', source: 'internal' })
          }
          acc.get(k)!.hours += h
        }
      }
    }
    return [...acc.values()].filter(e => e.hours > 0)
  }

  const summary = rollupSummary(months, (m) => {
    const r = getUnalignedFunding(m, statusSet)
    return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
  })

  return (
    <div className="bg-gray-50/80 border border-dashed border-gray-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-gray-500 italic">Unaligned Demand</span>
          <span className="text-xs text-gray-400 ml-2">Not associated to any Project</span>
        </div>
      </div>
      <DemandChart
        months={months}
        stacking={stacking}
        includeSubmitted={includeSubmitted}
        getFundingData={getUnalignedFunding}
        getTeamData={getUnalignedTeam}
        height={140}
      />
      <p className="text-[10px] text-gray-400 mt-2">
        Peak demand: {summary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(summary.peakMonth)}) · 12-month total: {summary.total.toLocaleString()} hrs
      </p>
    </div>
  )
}

// ─── Landing page ─────────────────────────────────────────────────────────────

function ProgrammeLanding({
  months, stacking, includeSubmitted, filterProgrammeId,
  onNavigateToDrillDown, onMonthClick,
}: {
  months: string[]
  stacking: StackingMode
  includeSubmitted: boolean
  filterProgrammeId: string | null
  onNavigateToDrillDown: (programmeId: string) => void
  onMonthClick: (programmeId: string, month: string) => void
}) {
  const store = useAppStore()
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET

  const programmes = useMemo(
    () => store.programmes.filter(p => p.active && (!filterProgrammeId || p.id === filterProgrammeId)),
    [store.programmes, filterProgrammeId]
  )

  if (store.programmes.filter(p => p.active).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-gray-400 gap-3 py-20">
        <p className="text-sm">No Programmes yet.</p>
        <a href="#/admin/programmes" className="text-xs text-brand underline hover:no-underline">
          Create one in Admin → Programmes
        </a>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {programmes.map(programme => {
        const projectCount = store.projects.filter(p => p.programme_id === programme.id && p.active).length
        const demandCount = store.demandItems.filter(d => {
          if (d.status === 'Parked' || d.status === 'Closed') return false
          const project = store.projects.find(p => p.id === d.project_id)
          return project?.programme_id === programme.id
        }).length

        const summary = rollupSummary(months, (m) => {
          const r = programme_demand_by_funding(programme.id, m, { status_set: statusSet }, store)
          return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
        })

        return (
          <div
            key={programme.id}
            className="bg-white border border-border rounded-lg p-4 hover:border-brand/40 transition-colors"
          >
            <button
              className="w-full text-left"
              onClick={() => onNavigateToDrillDown(programme.id)}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-semibold text-near-black">{programme.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {projectCount} Project{projectCount !== 1 ? 's' : ''} · {demandCount} Demand{demandCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <ChevronRight size={14} className="text-gray-400 shrink-0" />
              </div>
            </button>

            <DemandChart
              months={months}
              stacking={stacking}
              includeSubmitted={includeSubmitted}
              getFundingData={(m, ss) => programme_demand_by_funding(programme.id, m, { status_set: ss }, store)}
              getTeamData={(m, ss) => programme_demand_by_team(programme.id, m, { status_set: ss }, store)}
              height={180}
              onMonthClick={(m) => onMonthClick(programme.id, m)}
            />

            <p className="text-[10px] text-gray-400 mt-2">
              Peak demand: {summary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(summary.peakMonth)}) · Total: {summary.total.toLocaleString()} hrs
            </p>
          </div>
        )
      })}

      <UnalignedCard
        months={months}
        stacking={stacking}
        includeSubmitted={includeSubmitted}
      />
    </div>
  )
}

// ─── Drill-down page ──────────────────────────────────────────────────────────

function ProgrammeDrillDown({
  programmeId, months, stacking, includeSubmitted, onBack, onMonthClick,
}: {
  programmeId: string
  months: string[]
  stacking: StackingMode
  includeSubmitted: boolean
  onBack: () => void
  onMonthClick: (projectId: string, month: string) => void
}) {
  const store = useAppStore()
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET
  const programme = store.programmes.find(p => p.id === programmeId)
  if (!programme) return <div className="p-5 text-sm text-gray-400">Programme not found.</div>

  const projects = useMemo(
    () => store.projects.filter(p => p.programme_id === programmeId && p.active)
      .slice().sort((a, b) => a.name.localeCompare(b.name)),
    [store.projects, programmeId]
  )

  const demandCount = store.demandItems.filter(d => {
    if (d.status === 'Parked' || d.status === 'Closed') return false
    const project = store.projects.find(p => p.id === d.project_id)
    return project?.programme_id === programme.id
  }).length

  const programmeSummary = rollupSummary(months, (m) => {
    const r = programme_demand_by_funding(programmeId, m, { status_set: statusSet }, store)
    return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
  })

  return (
    <div className="flex-1 overflow-y-auto p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-near-black transition-colors">
          <ArrowLeft size={15} />
        </button>
        <div>
          <h2 className="text-sm font-semibold text-near-black">{programme.name}</h2>
          <p className="text-xs text-gray-400">
            {projects.length} Project{projects.length !== 1 ? 's' : ''} · {demandCount} Demand{demandCount !== 1 ? 's' : ''}
            {programme.description ? ` · ${programme.description}` : ''}
          </p>
        </div>
      </div>

      {/* Programme-total chart */}
      <div className="bg-white border border-border rounded-lg p-4 mb-4">
        <h3 className="text-xs font-semibold text-gray-600 mb-3">Programme Total — {programme.name}</h3>
        <DemandChart
          months={months}
          stacking={stacking}
          includeSubmitted={includeSubmitted}
          getFundingData={(m, ss) => programme_demand_by_funding(programmeId, m, { status_set: ss }, store)}
          getTeamData={(m, ss) => programme_demand_by_team(programmeId, m, { status_set: ss }, store)}
          height={200}
          onMonthClick={(m) => onMonthClick('', m)}
        />
        <p className="text-[10px] text-gray-400 mt-2">
          Peak demand: {programmeSummary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(programmeSummary.peakMonth)}) · Total: {programmeSummary.total.toLocaleString()} hrs
        </p>
      </div>

      {/* Per-Project cards */}
      <div className="space-y-3">
        {projects.map(project => {
          const projectDemandCount = store.demandItems.filter(d => d.project_id === project.id && d.status !== 'Parked' && d.status !== 'Closed').length

          const projectSummary = rollupSummary(months, (m) => {
            const r = project_demand_by_funding(project.id, m, { status_set: statusSet }, store)
            return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
          })

          return (
            <div key={project.id} className="bg-white border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-medium text-near-black">{project.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{projectDemandCount} Demand{projectDemandCount !== 1 ? 's' : ''}</span>
                </div>
                <a
                  href={`#/manage-demand?project=${project.id}`}
                  className="text-xs text-brand hover:underline"
                  onClick={e => e.stopPropagation()}
                >
                  View Demands →
                </a>
              </div>
              <DemandChart
                months={months}
                stacking={stacking}
                includeSubmitted={includeSubmitted}
                getFundingData={(m, ss) => project_demand_by_funding(project.id, m, { status_set: ss }, store)}
                getTeamData={(m, ss) => project_demand_by_team(project.id, m, { status_set: ss }, store)}
                height={160}
                onMonthClick={(m) => onMonthClick(project.id, m)}
              />
              <p className="text-[10px] text-gray-400 mt-2">
                Peak demand: {projectSummary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(projectSummary.peakMonth)}) · Total: {projectSummary.total.toLocaleString()} hrs
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function ProgrammeDemand() {
  const { programmeId } = useParams<{ programmeId?: string }>()
  const navigate = useNavigate()

  const [horizon, setHorizon] = useState<HorizonMonths>(12)
  const [stacking, setStacking] = useState<StackingMode>('funding')
  const [includeSubmitted, setIncludeSubmitted] = useState(false)
  const [filterProgrammeId, setFilterProgrammeId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanelState | null>(null)
  const [drawerDemandId, setDrawerDemandId] = useState<string | null>(null)

  const store = useAppStore()
  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET

  const activeProgammes = useMemo(
    () => store.programmes.filter(p => p.active),
    [store.programmes]
  )

  function handleLandingMonthClick(pid: string, month: string) {
    const programme = store.programmes.find(p => p.id === pid)
    setSidePanel({ month, scopeLabel: programme?.name ?? 'Programme', programmeId: pid })
  }

  function handleDrillDownMonthClick(projectId: string, month: string) {
    if (projectId) {
      const project = store.projects.find(p => p.id === projectId)
      setSidePanel({ month, scopeLabel: project?.name ?? 'Project', projectId })
    } else {
      const programme = store.programmes.find(p => p.id === programmeId)
      setSidePanel({ month, scopeLabel: programme?.name ?? 'Programme', programmeId: programmeId! })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page heading */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white">
        <span className="text-sm font-semibold text-near-black">Demand</span>
        <span className="flex items-center gap-1 text-xs text-gray-400 italic">
          <Info size={11} />
          Function lens does not apply on this view.
        </span>
      </div>

      {/* Toolbar */}
      <Toolbar
        horizon={horizon} onHorizonChange={setHorizon}
        stacking={stacking} onStackingChange={setStacking}
        includeSubmitted={includeSubmitted} onIncludeSubmittedChange={setIncludeSubmitted}
        programmes={programmeId ? undefined : activeProgammes}
        filterProgrammeId={programmeId ? undefined : filterProgrammeId}
        onFilterProgrammeChange={programmeId ? undefined : setFilterProgrammeId}
      />

      {/* Main content */}
      {programmeId ? (
        <ProgrammeDrillDown
          programmeId={programmeId}
          months={months}
          stacking={stacking}
          includeSubmitted={includeSubmitted}
          onBack={() => navigate('/demand')}
          onMonthClick={handleDrillDownMonthClick}
        />
      ) : (
        <ProgrammeLanding
          months={months}
          stacking={stacking}
          includeSubmitted={includeSubmitted}
          filterProgrammeId={filterProgrammeId}
          onNavigateToDrillDown={(id) => navigate(`/demand/programme/${id}`)}
          onMonthClick={handleLandingMonthClick}
        />
      )}

      {/* Side panel */}
      {sidePanel && (
        <SidePanel
          state={sidePanel}
          statusSet={statusSet}
          onClose={() => setSidePanel(null)}
          onOpenDrawer={(id) => { setDrawerDemandId(id); setSidePanel(null) }}
        />
      )}

      {/* Demand drawer */}
      {drawerDemandId && (
        <DemandDrawer
          demandId={drawerDemandId}
          onClose={() => setDrawerDemandId(null)}
        />
      )}
    </div>
  )
}
