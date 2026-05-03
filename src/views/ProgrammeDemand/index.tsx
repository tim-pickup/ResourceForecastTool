/**
 * §4.10 Demand view — Programme-level demand shape.
 * v1.18: Function lens now applies (reversing v1.17 exception).
 * Toolbar: By Funding Source only (By Team removed). Two new toggles.
 * Include Submitted: merged bucket, no visual differentiation.
 * Virtual cards: Direct Demands + Unaligned Projects.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer,
} from 'recharts'
import { ArrowLeft, ChevronRight, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import {
  programme_demand_by_funding,
  project_demand_by_funding,
  direct_demand_by_funding,
  type DemandByFundingResult,
  type DemandByFundingOpts,
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

// ─── Toolbar ──────────────────────────────────────────────────────────────────

interface ToolbarProps {
  horizon: HorizonMonths
  onHorizonChange: (h: HorizonMonths) => void
  includeSubmitted: boolean
  onIncludeSubmittedChange: (v: boolean) => void
  showExternal: boolean
  onShowExternalChange: (v: boolean) => void
  showOtherFunctions: boolean
  onShowOtherFunctionsChange: (v: boolean) => void
  programmes?: Programme[]
  filterProgrammeId?: string | null
  onFilterProgrammeChange?: (id: string | null) => void
}

function Toolbar({
  horizon, onHorizonChange,
  includeSubmitted, onIncludeSubmittedChange,
  showExternal, onShowExternalChange,
  showOtherFunctions, onShowOtherFunctionsChange,
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
              horizon === h ? 'bg-brand text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {h}mo
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Include Submitted — v1.18: no visual differentiation, just expands status_set */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input type="checkbox" checked={includeSubmitted} onChange={e => onIncludeSubmittedChange(e.target.checked)} className="accent-brand" />
        <span className="text-xs text-gray-600">Include Submitted</span>
      </label>

      {/* Show external resource toggle (§4.10.4) */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input type="checkbox" checked={showExternal} onChange={e => onShowExternalChange(e.target.checked)} className="accent-brand" />
        <span className="text-xs text-gray-600">Show external resource</span>
      </label>

      {/* Show demand on other Functions toggle (§4.10.4) */}
      <label className="flex items-center gap-1.5 cursor-pointer select-none">
        <input type="checkbox" checked={showOtherFunctions} onChange={e => onShowOtherFunctionsChange(e.target.checked)} className="accent-brand" />
        <span className="text-xs text-gray-600">Show demand on other Functions</span>
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
            {programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}
    </div>
  )
}

// ─── Stacked area chart ────────────────────────────────────────────────────────
// v1.18: single getData() — Include Submitted merged into buckets, no differentiation.

interface DemandChartProps {
  months: string[]
  getData: (month: string) => DemandByFundingResult
  height?: number
  onMonthClick?: (month: string) => void
}

function DemandChart({ months, getData, height = 200, onMonthClick }: DemandChartProps) {
  const chartData = useMemo(() => months.map(month => {
    const label = formatMonthLabel(month)
    const data = getData(month)
    const point: Record<string, number | string> = { label, month }
    for (const k of FUNDING_KEYS) point[k] = data[k]
    return point
  }), [months, getData])

  const hasData = chartData.some(d =>
    FUNDING_KEYS.some(k => (d[k] as number) > 0)
  )

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-16 text-xs text-gray-400 italic">
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
            formatter={(value: number, name: string) => [`${value}h`, name]}
            labelStyle={{ fontWeight: 600, fontSize: 11 }}
            contentStyle={{ fontSize: 11 }}
          />
          {FUNDING_KEYS.map(k => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              name={k}
              stackId="main"
              fill={FUNDING_COLORS[k]}
              stroke="none"
              fillOpacity={0.8}
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

// ─── Roll-up summary ──────────────────────────────────────────────────────────

function rollupSummary(
  months: string[],
  computeFn: (month: string) => number
): { peak: number; peakMonth: string; total: number } {
  let peak = 0, peakMonth = months[0] ?? '', total = 0
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
  isDirect?: boolean  // for Direct Demands virtual card
}

function SidePanel({
  state: panelState, statusSet, activeFunctionId, onClose, onOpenDrawer,
}: {
  state: SidePanelState
  statusSet: ReadonlySet<DemandStatus>
  activeFunctionId: string | null
  onClose: () => void
  onOpenDrawer: (id: string) => void
}) {
  const store = useAppStore()

  const qualifying = useMemo(() => {
    return store.demandItems.filter(item => {
      if (!statusSet.has(item.status)) return false
      // Function lens: only active-Function demands
      if (activeFunctionId && item.function_id !== activeFunctionId) return false
      if (panelState.isDirect) return item.parent_project_id === null
      if (panelState.projectId) return item.parent_project_id === panelState.projectId
      if (panelState.programmeId) {
        if (item.parent_project_id === null) return false
        const project = store.projects.find(p => p.id === item.parent_project_id)
        return project?.programme_id === panelState.programmeId
      }
      return false
    }).filter(item =>
      item.activities.some(ac => {
        const m = panelState.month
        return m >= ac.start_month && (ac.end_month === null || m <= ac.end_month)
      })
    )
  }, [panelState, statusSet, activeFunctionId, store.demandItems, store.projects])

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white border-l border-border shadow-lg z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-xs font-semibold text-near-black">{formatMonthLabel(panelState.month)}</div>
          <div className="text-[10px] text-gray-400">{panelState.scopeLabel}</div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-near-black"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {qualifying.length === 0 ? (
          <p className="text-xs text-gray-400 p-4">No qualifying demand items for this month.</p>
        ) : (
          <ul className="divide-y divide-border">
            {qualifying.map(item => {
              const project = item.parent_project_id ? store.projects.find(p => p.id === item.parent_project_id) : null
              const programme = project?.programme_id ? store.programmes.find(pr => pr.id === project.programme_id) : null
              const fn = store.functions.find(f => f.id === item.function_id)
              const isProjectSpawned = item.parent_project_id !== null
              return (
                <li key={item.id}>
                  <button
                    onClick={() => onOpenDrawer(item.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-xs font-medium text-near-black">{item.name}</div>
                    {/* §4.10.3 segment-click: origin + Function chip */}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${isProjectSpawned ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                        {isProjectSpawned ? 'Project-spawned' : 'Direct'}
                      </span>
                      {fn && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">
                          {fn.name}
                        </span>
                      )}
                    </div>
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

// ─── Direct Demands virtual card (§4.10.1) ────────────────────────────────────

function DirectDemandsCard({
  months, opts, onMonthClick,
}: {
  months: string[]
  opts: DemandByFundingOpts
  onMonthClick: (month: string) => void
}) {
  const store = useAppStore()
  // Check if there are any active-Function direct demands
  const hasDirectDemands = useMemo(() =>
    store.demandItems.some(d =>
      d.parent_project_id === null && d.function_id === opts.function_id
    ),
    [store.demandItems, opts.function_id]
  )
  if (!hasDirectDemands) return null

  const summary = rollupSummary(months, (m) => {
    const r = direct_demand_by_funding(m, opts, store)
    return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
  })

  return (
    <div className="bg-gray-50/80 border border-dashed border-gray-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-gray-500 italic">Direct Demands</span>
          <span className="text-xs text-gray-400 ml-2">Not attached to any Project</span>
        </div>
      </div>
      <DemandChart
        months={months}
        getData={(m) => direct_demand_by_funding(m, opts, store)}
        height={140}
        onMonthClick={onMonthClick}
      />
      <p className="text-[10px] text-gray-400 mt-2">
        Peak demand: {summary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(summary.peakMonth)}) · Total: {summary.total.toLocaleString()} hrs
      </p>
    </div>
  )
}

// ─── Unaligned Projects virtual card (§4.10.1) ───────────────────────────────

function UnalignedProjectsCard({
  months, opts, onMonthClick,
}: {
  months: string[]
  opts: DemandByFundingOpts
  onMonthClick: (month: string) => void
}) {
  const store = useAppStore()

  // Find Projects with no Programme that have at least one active-Function Demand
  const unalignedProjects = useMemo(() =>
    store.projects.filter(p =>
      p.active &&
      p.programme_id === null &&
      store.demandItems.some(d => d.parent_project_id === p.id && d.function_id === opts.function_id)
    ),
    [store.projects, store.demandItems, opts.function_id]
  )

  if (unalignedProjects.length === 0) return null

  const getData = (month: string): DemandByFundingResult => {
    const result: DemandByFundingResult = { 'Investment Scheme': 0, 'Plant/Sector Allocation': 0, 'Mixed': 0 }
    for (const project of unalignedProjects) {
      const r = project_demand_by_funding(project.id, month, opts, store)
      for (const k of FUNDING_KEYS) result[k] += r[k]
    }
    return result
  }

  const summary = rollupSummary(months, (m) => {
    const r = getData(m)
    return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
  })

  return (
    <div className="bg-gray-50/80 border border-dashed border-gray-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-gray-500 italic">Unaligned Projects</span>
          <span className="text-xs text-gray-400 ml-2">{unalignedProjects.length} project{unalignedProjects.length !== 1 ? 's' : ''} with no Programme</span>
        </div>
      </div>
      <DemandChart
        months={months}
        getData={getData}
        height={140}
        onMonthClick={onMonthClick}
      />
      <p className="text-[10px] text-gray-400 mt-2">
        Peak demand: {summary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(summary.peakMonth)}) · Total: {summary.total.toLocaleString()} hrs
      </p>
    </div>
  )
}

// ─── Landing page ─────────────────────────────────────────────────────────────

function ProgrammeLanding({
  months, opts, filterProgrammeId,
  onNavigateToDrillDown, onMonthClick, onDirectMonthClick, onUnalignedMonthClick,
}: {
  months: string[]
  opts: DemandByFundingOpts
  filterProgrammeId: string | null
  onNavigateToDrillDown: (programmeId: string) => void
  onMonthClick: (programmeId: string, month: string) => void
  onDirectMonthClick: (month: string) => void
  onUnalignedMonthClick: (month: string) => void
}) {
  const store = useAppStore()

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
        // Active-Function scoped counts
        const fnDemands = store.demandItems.filter(d => {
          if (d.function_id !== opts.function_id) return false
          if (d.parent_project_id === null) return false
          const project = store.projects.find(p => p.id === d.parent_project_id)
          return project?.programme_id === programme.id
        })
        const fnProjectIds = new Set(fnDemands.map(d => d.parent_project_id).filter(Boolean))

        const summary = rollupSummary(months, (m) => {
          const r = programme_demand_by_funding(programme.id, m, opts, store)
          return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
        })

        return (
          <div key={programme.id} className="bg-white border border-border rounded-lg p-4 hover:border-brand/40 transition-colors">
            <button className="w-full text-left" onClick={() => onNavigateToDrillDown(programme.id)}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-semibold text-near-black">{programme.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {fnProjectIds.size} Project{fnProjectIds.size !== 1 ? 's' : ''} · {fnDemands.length} Demand{fnDemands.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <ChevronRight size={14} className="text-gray-400 shrink-0" />
              </div>
            </button>

            <DemandChart
              months={months}
              getData={(m) => programme_demand_by_funding(programme.id, m, opts, store)}
              height={180}
              onMonthClick={(m) => onMonthClick(programme.id, m)}
            />

            <p className="text-[10px] text-gray-400 mt-2">
              Peak demand: {summary.peak.toLocaleString()} hrs/mo ({formatMonthLabel(summary.peakMonth)}) · Total: {summary.total.toLocaleString()} hrs
            </p>
          </div>
        )
      })}

      {/* Unaligned Projects virtual card (§4.10.1) */}
      <UnalignedProjectsCard months={months} opts={opts} onMonthClick={onUnalignedMonthClick} />

      {/* Direct Demands virtual card (§4.10.1) */}
      <DirectDemandsCard months={months} opts={opts} onMonthClick={onDirectMonthClick} />
    </div>
  )
}

// ─── Drill-down page ──────────────────────────────────────────────────────────

function ProgrammeDrillDown({
  programmeId, months, opts, onBack, onMonthClick,
}: {
  programmeId: string
  months: string[]
  opts: DemandByFundingOpts
  onBack: () => void
  onMonthClick: (projectId: string, month: string) => void
}) {
  const store = useAppStore()
  const programme = store.programmes.find(p => p.id === programmeId)
  if (!programme) return <div className="p-5 text-sm text-gray-400">Programme not found.</div>

  const projects = useMemo(
    () => store.projects.filter(p => p.programme_id === programmeId && p.active)
      .slice().sort((a, b) => a.name.localeCompare(b.name)),
    [store.projects, programmeId]
  )

  // Active-Function scoped demand count
  const fnDemandCount = store.demandItems.filter(d => {
    if (d.function_id !== opts.function_id) return false
    const project = store.projects.find(p => p.id === d.parent_project_id)
    return project?.programme_id === programme.id
  }).length

  const programmeSummary = rollupSummary(months, (m) => {
    const r = programme_demand_by_funding(programmeId, m, opts, store)
    return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
  })

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onBack} className="text-gray-400 hover:text-near-black transition-colors">
          <ArrowLeft size={15} />
        </button>
        <div>
          <h2 className="text-sm font-semibold text-near-black">{programme.name}</h2>
          <p className="text-xs text-gray-400">
            {projects.length} Project{projects.length !== 1 ? 's' : ''} · {fnDemandCount} Demand{fnDemandCount !== 1 ? 's' : ''}
            {programme.description ? ` · ${programme.description}` : ''}
          </p>
        </div>
      </div>

      {/* Programme-total chart */}
      <div className="bg-white border border-border rounded-lg p-4 mb-4">
        <h3 className="text-xs font-semibold text-gray-600 mb-3">Programme Total — {programme.name}</h3>
        <DemandChart
          months={months}
          getData={(m) => programme_demand_by_funding(programmeId, m, opts, store)}
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
          const projectFnDemandCount = store.demandItems.filter(
            d => d.parent_project_id === project.id && d.function_id === opts.function_id
          ).length

          const projectSummary = rollupSummary(months, (m) => {
            const r = project_demand_by_funding(project.id, m, opts, store)
            return r['Investment Scheme'] + r['Plant/Sector Allocation'] + r['Mixed']
          })

          return (
            <div key={project.id} className="bg-white border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-medium text-near-black">{project.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{projectFnDemandCount} Demand{projectFnDemandCount !== 1 ? 's' : ''}</span>
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
                getData={(m) => project_demand_by_funding(project.id, m, opts, store)}
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
  const [showExternal, setShowExternal] = useState(false)
  const [showOtherFunctions, setShowOtherFunctions] = useState(false)
  const [filterProgrammeId, setFilterProgrammeId] = useState<string | null>(null)
  const [sidePanel, setSidePanel] = useState<SidePanelState | null>(null)
  const [drawerDemandId, setDrawerDemandId] = useState<string | null>(null)

  const store = useAppStore()
  const activeFunctionId = store.activeFunctionId

  // §11.17: reset filter state on Function switch
  const prevFnRef = useRef<string | null>(activeFunctionId)
  useEffect(() => {
    if (prevFnRef.current === activeFunctionId) return
    prevFnRef.current = activeFunctionId
    setSidePanel(null)
    setFilterProgrammeId(null)
  }, [activeFunctionId])

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])
  const statusSet = includeSubmitted ? WITH_SUBMITTED_SET : BASE_STATUS_SET

  // §4.10.6 opts object passed to every aggregation call
  const opts = useMemo((): DemandByFundingOpts => ({
    status_set: statusSet,
    function_id: activeFunctionId ?? undefined,
    include_external: showExternal,
    include_other_functions: showOtherFunctions,
  }), [statusSet, activeFunctionId, showExternal, showOtherFunctions])

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
      </div>

      {/* Toolbar */}
      <Toolbar
        horizon={horizon} onHorizonChange={setHorizon}
        includeSubmitted={includeSubmitted} onIncludeSubmittedChange={setIncludeSubmitted}
        showExternal={showExternal} onShowExternalChange={setShowExternal}
        showOtherFunctions={showOtherFunctions} onShowOtherFunctionsChange={setShowOtherFunctions}
        programmes={programmeId ? undefined : activeProgammes}
        filterProgrammeId={programmeId ? undefined : filterProgrammeId}
        onFilterProgrammeChange={programmeId ? undefined : setFilterProgrammeId}
      />

      {/* Main content */}
      {programmeId ? (
        <ProgrammeDrillDown
          programmeId={programmeId}
          months={months}
          opts={opts}
          onBack={() => navigate('/demand')}
          onMonthClick={handleDrillDownMonthClick}
        />
      ) : (
        <ProgrammeLanding
          months={months}
          opts={opts}
          filterProgrammeId={filterProgrammeId}
          onNavigateToDrillDown={(id) => navigate(`/demand/programme/${id}`)}
          onMonthClick={handleLandingMonthClick}
          onDirectMonthClick={(month) => setSidePanel({ month, scopeLabel: 'Direct Demands', isDirect: true })}
          onUnalignedMonthClick={(month) => setSidePanel({ month, scopeLabel: 'Unaligned Projects' })}
        />
      )}

      {/* Side panel */}
      {sidePanel && (
        <SidePanel
          state={sidePanel}
          statusSet={statusSet}
          activeFunctionId={activeFunctionId}
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
