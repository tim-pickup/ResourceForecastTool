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
  programme_demand_by_funding,
  project_demand_by_funding,
  type DemandByFundingResult,
} from '../../lib/capacity'
import { generateMonths, getCurrentMonth, formatMonthLabel } from '../../utils/capacity'
import { DemandDrawer } from '../../components/DemandEditor/DemandEditor'
import type { DemandStatus, FundingSource, Programme, Project } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Shared toolbar ───────────────────────────────────────────────────────────

interface ToolbarProps {
  horizon: HorizonMonths
  onHorizonChange: (h: HorizonMonths) => void
  includeSubmitted: boolean
  onIncludeSubmittedChange: (v: boolean) => void
  programmes?: Programme[]
  filterProgrammeId?: string | null
  onFilterProgrammeChange?: (id: string | null) => void
}

function Toolbar({
  horizon, onHorizonChange,
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

// ─── Stacked area chart for a Programme or Project (By Funding Source only) ───

interface DemandChartProps {
  months: string[]
  includeSubmitted: boolean
  getFundingData: (month: string, statusSet: ReadonlySet<DemandStatus>) => DemandByFundingResult
  height?: number
  onMonthClick?: (month: string) => void
}

function DemandChart({
  months, includeSubmitted,
  getFundingData,
  height = 200, onMonthClick,
}: DemandChartProps) {
  const chartData = useMemo(() => months.map(month => {
    const label = formatMonthLabel(month)
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
  }), [months, includeSubmitted, getFundingData])

  const hasData = chartData.some(d =>
    Object.entries(d).some(([k, v]) => k !== 'label' && k !== 'month' && (v as number) > 0)
  )

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
      if (panelState.projectId && item.parent_project_id !== panelState.projectId) return false
      if (panelState.programmeId && !panelState.projectId) {
        const project = projects.find(p => p.id === item.parent_project_id)
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
              const project = projects.find(p => p.id === item.parent_project_id)
              const programme = project?.programme_id ? programmes.find(pr => pr.id === project.programme_id) : null
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
  months, includeSubmitted,
}: {
  months: string[]
  includeSubmitted: boolean
}) {
  const demandItems = useAppStore(s => s.demandItems)
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET
  const hasUnaligned = useMemo(() =>
    demandItems.some(d => d.parent_project_id === null),
    [demandItems]
  )
  if (!hasUnaligned) return null

  const getUnalignedFunding = (month: string, ss: ReadonlySet<DemandStatus>): DemandByFundingResult => {
    const result: DemandByFundingResult = { 'Investment Scheme': 0, 'Plant/Sector Allocation': 0, 'Mixed': 0 }
    for (const item of demandItems) {
      if (item.parent_project_id !== null) continue
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
        includeSubmitted={includeSubmitted}
        getFundingData={getUnalignedFunding}
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
  months, includeSubmitted, filterProgrammeId,
  onNavigateToDrillDown, onMonthClick,
}: {
  months: string[]
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
          const project = store.projects.find(p => p.id === d.parent_project_id)
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
              includeSubmitted={includeSubmitted}
              getFundingData={(m, ss) => programme_demand_by_funding(programme.id, m, { status_set: ss }, store)}
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
        includeSubmitted={includeSubmitted}
      />
    </div>
  )
}

// ─── Drill-down page ──────────────────────────────────────────────────────────

function ProgrammeDrillDown({
  programmeId, months, includeSubmitted, onBack, onMonthClick,
}: {
  programmeId: string
  months: string[]
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
    const project = store.projects.find(p => p.id === d.parent_project_id)
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
          includeSubmitted={includeSubmitted}
          getFundingData={(m, ss) => programme_demand_by_funding(programmeId, m, { status_set: ss }, store)}
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
          const projectDemandCount = store.demandItems.filter(d => d.parent_project_id === project.id).length

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
                includeSubmitted={includeSubmitted}
                getFundingData={(m, ss) => project_demand_by_funding(project.id, m, { status_set: ss }, store)}
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
          includeSubmitted={includeSubmitted}
          onBack={() => navigate('/demand')}
          onMonthClick={handleDrillDownMonthClick}
        />
      ) : (
        <ProgrammeLanding
          months={months}
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
