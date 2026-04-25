import { useState, useMemo, useEffect, useRef } from 'react'
import { X, ChevronLeft, AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAppStore } from '../../store/useAppStore'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  generateMonths, getCurrentMonth, formatMonthLabel, getPeopleForSkill,
  getPersonLoad, monthInRange,
} from '../../utils/capacity'
import {
  domain_capacity, skill_capacity, team_capacity,
  demand_hours_for, grey_band, computeProjection, projection_shortfalls,
  checkInvariants, crossFunctionDemandHours,
  type DemandTarget, type ProjectionResult,
} from '../../lib/capacity'
import { CapacityChart } from '../../components/CapacityChart'
import type { ChartPoint } from '../../components/CapacityChart'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { Button } from '../../components/ui/Button'
import { clsx } from 'clsx'
import type { DemandStatus, Level, DemandItem } from '../../types'

const HORIZONS = [6, 12, 24, 60] as const
const COMMITTED_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])

// Section C: provider palette
const EXT_COLORS = ['#7a3dff', '#ed52cb', '#ff6b00', '#00d722', '#ffae13', '#ee1d36', '#0891b2', '#146ef5']
// Section D: distinct-hue palette for receiving Functions
const D_COLORS = ['#7c3aed', '#0891b2', '#16a34a', '#ea580c', '#db2777', '#ca8a04', '#64748b', '#9333ea']
// Same active-status set as capacity.ts: excludes only Parked and Closed
const EXT_ACTIVE_STATUSES = new Set<DemandStatus>(['Draft', 'Submitted', 'Approved', 'PartiallyAllocated', 'Allocated'])

// ─── Model Capacity banner ────────────────────────────────────────────────────

function ModelCapacityBanner({
  demandName,
  onBack,
  onDismiss,
}: {
  demandName: string
  onBack: () => void
  onDismiss: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-2 bg-indigo-50 border-b border-indigo-200 text-xs text-indigo-800">
      <AlertCircle size={13} className="shrink-0" />
      <span className="flex-1">
        Modelling impact of <strong>{demandName}</strong>.{' '}
        <button onClick={onBack} className="font-semibold underline hover:no-underline">
          Back to demand
        </button>
      </span>
      <button onClick={onDismiss} className="hover:opacity-70">
        <X size={13} />
      </button>
    </div>
  )
}

// ─── Person drill-down panel ─────────────────────────────────────────────────

function PersonPanel({
  skillId,
  months,
  onClose,
  onOpenEditor,
}: {
  skillId: string
  months: string[]
  onClose: () => void
  onOpenEditor: (id: string) => void
}) {
  const store = useAppStore()
  const skill = store.skills.find(s => s.id === skillId)
  const people = useMemo(() => getPeopleForSkill(skillId, store), [skillId, store])

  const activeReqs = useMemo(() => {
    const out: Array<{ itemName: string; itemId: string; phase: string; hours: number }> = []
    for (const item of store.demandItems) {
      if (item.status !== 'Approved' && item.status !== 'PartiallyAllocated' && item.status !== 'Allocated') continue
      for (const phase of item.phases) {
        for (const req of phase.requirements) {
          if (req.shape === 'skill' && req.skill_id === skillId) {
            const hrs = phase.end_month === null
              ? (req.steady_state_hours ?? 0)
              : Object.values(req.hours_by_month).reduce((s, h) => s + h, 0)
            out.push({ itemName: item.name, itemId: item.id, phase: phase.name, hours: hrs })
          }
        }
      }
    }
    return out
  }, [skillId, store])

  return (
    <div className="bg-white border-t border-border">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <button onClick={onClose} className="flex items-center gap-1 text-xs text-gray-500 hover:text-near-black">
          <ChevronLeft size={14} /> Back
        </button>
        <span className="text-sm font-semibold text-near-black">{skill?.name ?? 'Skill'} — People</span>
      </div>
      <div className="p-5 overflow-auto">
        {people.length === 0 ? (
          <p className="text-sm text-gray-400">No active people hold this skill.</p>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-gray-500 uppercase tracking-wide">
                <th className="text-left py-2 pr-4 font-medium">Name</th>
                <th className="text-left py-2 pr-4 font-medium">Level</th>
                <th className="text-right py-2 pr-4 font-medium">Contracted</th>
                <th className="text-right py-2 pr-4 font-medium">BAU</th>
                <th className="text-right py-2 pr-4 font-medium">Projects</th>
                <th className="text-right py-2 font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {people.map(({ person, level }) => {
                const load = getPersonLoad(person, months[0] ?? getCurrentMonth(), store)
                return (
                  <tr key={person.id} className="border-b border-border/50 hover:bg-gray-50">
                    <td className="py-2 pr-4 font-medium text-near-black">{person.name}</td>
                    <td className="py-2 pr-4">
                      <LevelBadge level={level} />
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{person.contracted_hours_per_month}h</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-500">{load.bau}h</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{load.project}h</td>
                    <td className={clsx('py-2 text-right tabular-nums font-medium', load.overAllocated ? 'text-red-600' : 'text-green-600')}>
                      {load.overAllocated ? `−${Math.abs(load.available)}h` : `${load.available}h`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {activeReqs.length > 0 && (
          <div className="mt-6">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Active demand consuming this skill</h4>
            <div className="space-y-2">
              {activeReqs.map((r, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-50 border border-border">
                  <div className="flex-1">
                    <button
                      onClick={() => onOpenEditor(r.itemId)}
                      className="text-xs font-medium text-brand hover:underline text-left"
                    >
                      {r.itemName}
                    </button>
                    <span className="text-xs text-gray-400 ml-2">/ {r.phase}</span>
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums">{r.hours}h</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LevelBadge({ level }: { level: Level }) {
  const cls = level === 'Specialist' ? 'bg-purple-100 text-purple-700' :
    level === 'Advanced' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
  return <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', cls)}>{level}</span>
}

// ─── Meta stats strip ────────────────────────────────────────────────────────

function MetaStat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={clsx('text-xl font-semibold font-mono', warn ? 'text-red-600' : 'text-near-black')}>{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
    </div>
  )
}

// ─── Overlay selector combobox ────────────────────────────────────────────────

function OverlaySelector({
  overlayId,
  onSelect,
  onClear,
  submittedItems,
}: {
  overlayId: string | null
  onSelect: (id: string) => void
  onClear: () => void
  submittedItems: Array<{ id: string; name: string }>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const overlayItem = overlayId ? submittedItems.find(d => d.id === overlayId) : null

  const filtered = useMemo(() =>
    submittedItems.filter(d => d.id !== overlayId && d.name.toLowerCase().includes(search.toLowerCase())),
    [submittedItems, overlayId, search]
  )

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.closest('[data-overlay-selector]')?.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="relative flex items-center gap-2" data-overlay-selector="">
      <span className="text-xs text-gray-500 uppercase tracking-wide">Overlay:</span>
      {overlayItem ? (
        <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5 text-xs font-medium text-amber-800">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          {overlayItem.name}
          <button onClick={onClear} className="hover:opacity-70 ml-0.5">
            <X size={11} />
          </button>
        </div>
      ) : null}
      <button
        ref={btnRef}
        onClick={() => { setOpen(o => !o); setSearch('') }}
        className="flex items-center gap-1 border border-dashed border-gray-400 rounded-full px-3 py-1 text-xs text-gray-500 hover:border-gray-600 hover:text-gray-700"
      >
        {overlayItem ? 'Change' : 'Set overlay'}
        <ChevronDown size={11} className={clsx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-border rounded shadow-card z-30">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Submitted items…"
            className="w-full px-3 py-2 text-xs border-b border-border focus:outline-none"
          />
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-3 italic">
                {search ? 'No matching Submitted items.' : 'No Submitted items available.'}
              </p>
            )}
            {filtered.map(d => (
              <button
                key={d.id}
                onClick={() => { onSelect(d.id); setOpen(false); setSearch('') }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
              >
                {d.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-full text-center py-1.5 text-xs text-gray-400 border-t border-border hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Over-capacity summary strip ─────────────────────────────────────────────

interface OverCapacityEntry {
  type: 'over' | 'over-overlay' | 'shortfall'
  id: string
  name: string
  monthRange: string
  peak: number
  overlayName?: string
  shortfallDriving?: string
}

function SummaryStrip({
  entries,
  onScrollTo,
}: {
  entries: OverCapacityEntry[]
  onScrollTo: (id: string) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="mb-3 px-3 py-2 rounded bg-green-50 border border-green-200 text-xs text-green-700 flex items-center gap-2">
        <CheckCircle2 size={13} className="shrink-0" />
        All domains within capacity across the visible horizon — no projection shortfalls
      </div>
    )
  }

  // Sort: over-capacity and shortfalls first, then overlay-induced
  const sorted = [...entries].sort((a, b) => {
    const rank = (e: OverCapacityEntry) => e.type === 'over' ? 0 : e.type === 'shortfall' ? 1 : 2
    return rank(a) - rank(b) || b.peak - a.peak
  })

  return (
    <div className="mb-3 px-3 py-2.5 rounded border bg-red-50 border-red-200">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-red-600 block mb-1.5">Capacity signals</span>
      <div className="flex flex-wrap gap-2">
        {sorted.map((entry, i) => {
          const isShortfall = entry.type === 'shortfall'
          const isOverlay = entry.type === 'over-overlay'
          return (
            <button
              key={i}
              onClick={() => onScrollTo(entry.id)}
              className={clsx(
                'flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border transition-colors',
                isShortfall
                  ? 'text-amber-700 bg-white border-amber-200 hover:bg-amber-50'
                  : isOverlay
                  ? 'text-orange-700 bg-white border-orange-200 hover:bg-orange-50'
                  : 'text-red-700 bg-white border-red-200 hover:bg-red-100'
              )}
            >
              {isShortfall && <AlertTriangle size={10} />}
              <span className="font-medium">{entry.name}</span>
              <span className="opacity-50">·</span>
              <span>{entry.monthRange}</span>
              {isShortfall ? (
                <><span className="opacity-50">·</span><span className="font-semibold">shortfall {Math.round(entry.peak)}h</span></>
              ) : isOverlay ? (
                <><span className="opacity-50">·</span><span className="font-semibold">+{Math.round(entry.peak)}h with overlay</span></>
              ) : (
                <><span className="opacity-50">·</span><span className="font-semibold">+{Math.round(entry.peak)}h over</span></>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Section C tooltips ───────────────────────────────────────────────────────

function ExtC1Tooltip({ active, payload, providers }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: { label: string } }>
  providers: Array<{ id: string; name: string }>
}) {
  if (!active || !payload?.length) return null
  const label = payload[0]?.payload?.label
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  if (total === 0) return null
  return (
    <div className="bg-white border border-amber-200 rounded shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold mb-2 text-near-black">{label}</p>
      <div className="space-y-1">
        {[...payload].reverse().filter(p => (p.value || 0) > 0).map(p => {
          const prov = providers.find(pr => pr.id === p.dataKey)
          return (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span className="text-gray-600">{prov?.name ?? p.dataKey}</span>
              <span>{Math.round(p.value)}h</span>
            </div>
          )
        })}
        <div className="pt-1 border-t border-gray-100 flex justify-between gap-4 font-medium">
          <span>Total</span><span>{Math.round(total)}h</span>
        </div>
      </div>
    </div>
  )
}

function ExtC2Tooltip({ active, payload, providerName, demandItems }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: { label: string } }>
  providerName: string
  demandItems: DemandItem[]
}) {
  if (!active || !payload?.length) return null
  const label = payload[0]?.payload?.label
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  if (total === 0) return null
  return (
    <div className="bg-white border border-amber-200 rounded shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold mb-1 text-near-black">{label}</p>
      <p className="text-amber-600 mb-2">{providerName}</p>
      <div className="space-y-1">
        {[...payload].reverse().filter(p => (p.value || 0) > 0).map(p => {
          const item = demandItems.find(d => d.id === p.dataKey)
          return (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span className="text-gray-600 truncate max-w-[130px]">{item?.name ?? p.dataKey}</span>
              <span>{Math.round(p.value)}h</span>
            </div>
          )
        })}
        <div className="pt-1 border-t border-gray-100 flex justify-between gap-4 font-medium">
          <span>Total</span><span>{Math.round(total)}h</span>
        </div>
      </div>
    </div>
  )
}

// ─── Section D tooltips ──────────────────────────────────────────────────────

function D1Tooltip({ active, payload, functions }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: { label: string } }>
  functions: Array<{ id: string; name: string }>
}) {
  if (!active || !payload?.length) return null
  const label = payload[0]?.payload?.label
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  if (total === 0) return null
  return (
    <div className="bg-white border border-purple-200 rounded shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold mb-2 text-near-black">{label}</p>
      <div className="space-y-1">
        {[...payload].reverse().filter(p => (p.value || 0) > 0).map(p => {
          const fn = functions.find(f => f.id === p.dataKey)
          return (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span className="text-gray-600">{fn?.name ?? p.dataKey}</span>
              <span>{Math.round(p.value)}h</span>
            </div>
          )
        })}
        <div className="pt-1 border-t border-gray-100 flex justify-between gap-4 font-medium">
          <span>Total outgoing</span><span>{Math.round(total)}h</span>
        </div>
      </div>
    </div>
  )
}

function D2Tooltip({ active, payload, demandItems }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: { label: string } }>
  demandItems: DemandItem[]
}) {
  if (!active || !payload?.length) return null
  const label = payload[0]?.payload?.label
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  if (total === 0) return null
  return (
    <div className="bg-white border border-purple-200 rounded shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold mb-2 text-near-black">{label}</p>
      <div className="space-y-1">
        {[...payload].reverse().filter(p => (p.value || 0) > 0).map(p => {
          const item = demandItems.find(d => d.id === p.dataKey)
          return (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span className="text-gray-600 truncate max-w-[130px]">{item?.name ?? p.dataKey}</span>
              <span>{Math.round(p.value)}h</span>
            </div>
          )
        })}
        <div className="pt-1 border-t border-gray-100 flex justify-between gap-4 font-medium">
          <span>Total</span><span>{Math.round(total)}h</span>
        </div>
      </div>
    </div>
  )
}

function D2TeamTooltip({ active, payload, teams }: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; payload: { label: string } }>
  teams: Array<{ id: string; name: string }>
}) {
  if (!active || !payload?.length) return null
  const label = payload[0]?.payload?.label
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  if (total === 0) return null
  return (
    <div className="bg-white border border-purple-200 rounded shadow-md p-3 text-xs min-w-[160px]">
      <p className="font-semibold mb-2 text-near-black">{label}</p>
      <div className="space-y-1">
        {[...payload].reverse().filter(p => (p.value || 0) > 0).map(p => {
          const team = teams.find(t => t.id === p.dataKey)
          const label = p.dataKey === '__unassigned__' ? 'Unassigned team' : (team?.name ?? p.dataKey)
          return (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span className={clsx('truncate max-w-[130px]', p.dataKey === '__unassigned__' ? 'text-gray-400 italic' : 'text-gray-600')}>{label}</span>
              <span>{Math.round(p.value)}h</span>
            </div>
          )
        })}
        <div className="pt-1 border-t border-gray-100 flex justify-between gap-4 font-medium">
          <span>Total</span><span>{Math.round(total)}h</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export default function CapacityValidation() {
  const store = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()

  const [horizon, setHorizon] = useState<6 | 12 | 24 | 60>(12)
  const [sectionBMode, setSectionBMode] = useState<'domain' | 'skill'>('domain')
  const [drillDomainId, setDrillDomainId] = useState<string | null>(null)
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [editorId, setEditorId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [modelImpactId, setModelImpactId] = useState<string | null>(null)
  const [bannerVisible, setBannerVisible] = useState(false)
  // Programme/Project filter — affects demand stacks only, not capacity or grey band
  const [filterProgramme, setFilterProgramme] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [showExternal, setShowExternal] = useState(false)
  const [showSectionD, setShowSectionD] = useState(false)
  // Section D: track which receiving Function's D2 chart is in team drill-down view
  const [d2TeamViewFnId, setD2TeamViewFnId] = useState<string | null>(null)

  // Read URL query params for Model Capacity deep-link
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const overlayParam = params.get('overlay')
    const fromParam = params.get('from')
    if (overlayParam && fromParam === 'demand') {
      setOverlayId(overlayParam)
      setModelImpactId(overlayParam)
      setBannerVisible(true)
    }
  }, [location.search])

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])

  // Demand-stack filtered state: when Programme/Project active, restrict demand items
  // for demand_hours_for only. Capacity lines and grey band use full store.
  const demandFilteredState = useMemo(() => {
    if (!filterProgramme && !filterProject) return store
    let scopeProjectIds: Set<string>
    if (filterProject) {
      scopeProjectIds = new Set([filterProject])
    } else {
      scopeProjectIds = new Set(store.projects.filter(p => p.programme_id === filterProgramme).map(p => p.id))
    }
    return {
      ...store,
      demandItems: store.demandItems.filter(d => d.project_id && scopeProjectIds.has(d.project_id)),
    }
  }, [store, filterProgramme, filterProject])

  // Available projects for the dependent dropdown
  const availableProjectsForCV = useMemo(() =>
    filterProgramme ? store.projects.filter(p => p.programme_id === filterProgramme) : store.projects,
    [filterProgramme, store.projects]
  )

  // Overlay picker: when filter active, only show Submitted items in scope
  const submittedItems = useMemo(() => {
    const base = store.demandItems.filter(d => d.status === 'Submitted')
    if (!filterProgramme && !filterProject) return base.map(d => ({ id: d.id, name: d.name }))
    const filtered = demandFilteredState.demandItems.filter(d => d.status === 'Submitted')
    return filtered.map(d => ({ id: d.id, name: d.name }))
  }, [store.demandItems, demandFilteredState, filterProgramme, filterProject])

  const modelImpactItem = modelImpactId ? store.demandItems.find(d => d.id === modelImpactId) : null
  const overlayItem = overlayId ? store.demandItems.find(d => d.id === overlayId) : null

  // Active Function scope — used for Section B, C, and D scoping
  const activeFunctionId = store.activeFunctionId
  const activeFnDomainIds = useMemo(() =>
    new Set(store.domains.filter(d => d.functionId === activeFunctionId).map(d => d.id)),
    [store.domains, activeFunctionId]
  )
  const activeFnSkillIds = useMemo(() =>
    new Set(store.skills.filter(s => activeFnDomainIds.has(s.domain_id)).map(s => s.id)),
    [store.skills, activeFnDomainIds]
  )
  // Active Function's domains/skills for Section B
  const activeFnDomains = useMemo(() =>
    store.domains.filter(d => d.functionId === activeFunctionId),
    [store.domains, activeFunctionId]
  )

  const handleBackToDemand = () => {
    navigate('/manage-demand', { state: { openDrawer: modelImpactId } })
  }

  // ── Projection (single pass for all charts) ──────────────────────────
  const projResult: ProjectionResult = useMemo(
    () => computeProjection(store, months, overlayId),
    [store, months, overlayId]
  )

  // ── Section A: overall team chart ─────────────────────────────────────
  const EMPTY_STATUSES = useMemo(() => new Set<DemandStatus>(), [])
  const teamData: ChartPoint[] = useMemo(() => months.map(month => {
    // demand_hours_for uses demandFilteredState; capacity uses full store
    const committed = demand_hours_for({ type: 'overall' }, COMMITTED_STATUSES, month, demandFilteredState)
    const overlayDemand = overlayId
      ? demand_hours_for({ type: 'overall' }, EMPTY_STATUSES, month, demandFilteredState, overlayId)
      : { strategy: 0, plant: 0, npd: 0, bau: 0 }
    return {
      month,
      label: formatMonthLabel(month),
      capacity: team_capacity(month, store),  // full store
      bau: committed.bau,
      plant: committed.plant,
      npd: committed.npd,
      strategy: committed.strategy,
      overlay: overlayDemand.bau + overlayDemand.plant + overlayDemand.npd + overlayDemand.strategy,
      grey: 0,
    }
  }), [months, store, demandFilteredState, overlayId, EMPTY_STATUSES])

  const totalCapacity = teamData.reduce((s, d) => s + d.capacity, 0)
  const totalDemand = teamData.reduce((s, d) => s + d.bau + d.plant + d.npd + d.strategy, 0)
  const overMonths = teamData.filter(d => d.bau + d.plant + d.npd + d.strategy + d.overlay > d.capacity).length

  // ── Section B: domain/skill charts — scoped to active Function ─────────────
  const domainCharts = useMemo(() => activeFnDomains.map(domain => {
    const target: DemandTarget = { type: 'domain', id: domain.id }
    const data: ChartPoint[] = months.map(month => {
      const committed = demand_hours_for(target, COMMITTED_STATUSES, month, demandFilteredState)
      const overlayDemand = overlayId
        ? demand_hours_for(target, EMPTY_STATUSES, month, demandFilteredState, overlayId)
        : { strategy: 0, plant: 0, npd: 0, bau: 0 }
      return {
        month,
        label: formatMonthLabel(month),
        capacity: domain_capacity(domain.id, month, store),
        bau: committed.bau,
        plant: committed.plant,
        npd: committed.npd,
        strategy: committed.strategy,
        overlay: overlayDemand.bau + overlayDemand.plant + overlayDemand.npd + overlayDemand.strategy,
        grey: grey_band(target, month, store, projResult),
      }
    })
    return { domain, data }
  }), [months, store, activeFnDomains, demandFilteredState, overlayId, EMPTY_STATUSES, projResult])

  const skillsForSectionB = useMemo(() => {
    const activeFnSkills = store.skills.filter(s => activeFnDomainIds.has(s.domain_id))
    return drillDomainId ? activeFnSkills.filter(s => s.domain_id === drillDomainId) : activeFnSkills
  }, [store.skills, drillDomainId, activeFnDomainIds])

  const skillCharts = useMemo(() => skillsForSectionB.map(skill => {
    const target: DemandTarget = { type: 'skill', id: skill.id }
    const data: ChartPoint[] = months.map(month => {
      const committed = demand_hours_for(target, COMMITTED_STATUSES, month, demandFilteredState)
      const overlayDemand = overlayId
        ? demand_hours_for(target, EMPTY_STATUSES, month, demandFilteredState, overlayId)
        : { strategy: 0, plant: 0, npd: 0, bau: 0 }
      return {
        month,
        label: formatMonthLabel(month),
        capacity: skill_capacity(skill.id, month, store),
        bau: committed.bau,
        plant: committed.plant,
        npd: committed.npd,
        strategy: committed.strategy,
        overlay: overlayDemand.bau + overlayDemand.plant + overlayDemand.npd + overlayDemand.strategy,
        grey: grey_band(target, month, store, projResult),
      }
    })
    return { skill, domain: store.domains.find(t => t.id === skill.domain_id), data }
  }), [months, store, demandFilteredState, skillsForSectionB, overlayId, EMPTY_STATUSES, projResult])

  const skillsByDomain = useMemo(() => {
    const groups = new Map<string, typeof skillCharts>()
    for (const sc of skillCharts) {
      const tid = sc.skill.domain_id
      if (!groups.has(tid)) groups.set(tid, [])
      groups.get(tid)!.push(sc)
    }
    return store.domains.map(t => ({ domain: t, skills: groups.get(t.id) ?? [] })).filter(g => g.skills.length > 0)
  }, [skillCharts, store.domains])

  // ── Section D: cross-Function demand data ─────────────────────────────
  const sectionDData = useMemo(() => {
    if (!activeFunctionId) return null

    // Skill → owning Function mapping
    const skillFnMap = new Map<string, string>()
    for (const s of store.skills) {
      const fnId = store.domains.find(d => d.id === s.domain_id)?.functionId ?? ''
      skillFnMap.set(s.id, fnId)
    }

    // Qualifying demands: touch active Function in committed statuses, scoped to prog/proj filter
    const qualifying = demandFilteredState.demandItems.filter(item =>
      COMMITTED_STATUSES.has(item.status) &&
      item.phases.some(ph => ph.requirements.some(r => activeFnSkillIds.has(r.skill_id)))
    )

    // Collect receiving Function IDs and demand IDs per Function
    const receivingFnIds = new Set<string>()
    const demandIdsPerFn = new Map<string, Set<string>>()

    for (const item of qualifying) {
      for (const phase of item.phases) {
        for (const req of phase.requirements) {
          const fnId = skillFnMap.get(req.skill_id)
          if (!fnId || fnId === activeFunctionId) continue
          receivingFnIds.add(fnId)
          if (!demandIdsPerFn.has(fnId)) demandIdsPerFn.set(fnId, new Set())
          demandIdsPerFn.get(fnId)!.add(item.id)
        }
      }
    }

    // D1 chart data: per month × receiving Function
    const d1Data: any[] = months.map(month => {
      const raw = crossFunctionDemandHours(activeFunctionId, month, { by: 'function' }, { ...store, demandItems: demandFilteredState.demandItems })
      const entry: Record<string, number | string> = { label: formatMonthLabel(month) }
      for (const fnId of receivingFnIds) entry[fnId] = raw[fnId] ?? 0
      return entry
    })

    // D2 data: per receiving Function — use any[] for chart data (Recharts loosely typed)
    const d2ByFn = new Map<string, {
      demandIds: string[]
      byDemand: any[]
      byTeam: any[]
      visibleTeamIds: string[]
    }>()

    for (const fnId of receivingFnIds) {
      const demandIds = [...(demandIdsPerFn.get(fnId) ?? [])]
      const teamIdsSet = new Set<string>()

      // Initialise per-month entries
      const byDemand: any[] = months.map(month => {
        const entry: Record<string, number | string> = { label: formatMonthLabel(month) }
        demandIds.forEach(did => { entry[did] = 0 })
        return entry
      })
      const byTeam: any[] = months.map(month => ({ label: formatMonthLabel(month) }))

      months.forEach((month, mi) => {
        for (const item of qualifying) {
          if (!demandIds.includes(item.id)) continue
          for (const phase of item.phases) {
            if (!monthInRange(month, phase.start_month, phase.end_month)) continue
            for (const req of phase.requirements) {
              if (skillFnMap.get(req.skill_id) !== fnId) continue
              const hrs = phase.end_month === null
                ? (req.steady_state_hours ?? 0)
                : (req.hours_by_month[month] ?? 0)
              if (hrs <= 0) continue
              byDemand[mi][item.id] = ((byDemand[mi][item.id] as number) ?? 0) + hrs
              const teamKey = req.owningTeamId ?? '__unassigned__'
              if (req.owningTeamId) teamIdsSet.add(req.owningTeamId)
              byTeam[mi][teamKey] = ((byTeam[mi][teamKey] as number) ?? 0) + hrs
            }
          }
        }
      })

      const visibleTeamIds = [
        ...[...teamIdsSet].filter(tid => byTeam.some(m => ((m[tid] as number) ?? 0) > 0)),
        ...(byTeam.some(m => ((m['__unassigned__'] as number) ?? 0) > 0) ? ['__unassigned__'] : []),
      ]

      d2ByFn.set(fnId, { demandIds, byDemand, byTeam, visibleTeamIds })
    }

    const receivingFunctions = [...receivingFnIds]
      .map(fnId => store.functions.find(f => f.id === fnId))
      .filter((f): f is typeof store.functions[0] => !!f)

    return { d1Data, d2ByFn, receivingFunctions, receivingFnIds }
  }, [months, store, demandFilteredState.demandItems, activeFunctionId, activeFnSkillIds, COMMITTED_STATUSES])

  // ── Section C: external demand data — scoped to active Function ────────
  const extDataByMonth = useMemo(() => {
    const phaseToItem = new Map<string, DemandItem>()
    for (const item of demandFilteredState.demandItems) {
      if (!EXT_ACTIVE_STATUSES.has(item.status)) continue
      // §4 View 1 Section C scope: only demands touching the active Function (§4.9)
      if (activeFunctionId) {
        const touchesActiveFn = item.phases.some(ph => ph.requirements.some(r => activeFnSkillIds.has(r.skill_id)))
        if (!touchesActiveFn) continue
      }
      for (const phase of item.phases) {
        phaseToItem.set(phase.id, item)
      }
    }
    return months.map(month => {
      const byProvider: Record<string, number> = {}
      const byProviderByDemand: Record<string, Record<string, number>> = {}
      for (const ext of store.externalResourceRequirements) {
        const item = phaseToItem.get(ext.phase_id)
        if (!item) continue
        const phase = item.phases.find(p => p.id === ext.phase_id)
        if (!phase) continue
        if (month < phase.start_month) continue
        if (phase.end_month !== null && month > phase.end_month) continue
        const hrs = phase.end_month === null
          ? (ext.steady_state_hours ?? 0)
          : (ext.hours_by_month[month] ?? 0)
        if (hrs <= 0) continue
        const pid = ext.provider_id
        byProvider[pid] = (byProvider[pid] ?? 0) + hrs
        if (!byProviderByDemand[pid]) byProviderByDemand[pid] = {}
        byProviderByDemand[pid][item.id] = (byProviderByDemand[pid][item.id] ?? 0) + hrs
      }
      return { month, label: formatMonthLabel(month), byProvider, byProviderByDemand }
    })
  }, [months, demandFilteredState.demandItems, store.externalResourceRequirements, activeFunctionId, activeFnSkillIds])

  const extActiveProviders = useMemo(() => {
    const seen = new Set<string>()
    for (const d of extDataByMonth) {
      for (const pid of Object.keys(d.byProvider)) seen.add(pid)
    }
    return store.providers.filter(p => seen.has(p.id))
  }, [extDataByMonth, store.providers])

  const extDemandsByProvider = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const d of extDataByMonth) {
      for (const [pid, demandHrs] of Object.entries(d.byProviderByDemand)) {
        const existing = map.get(pid) ?? []
        const existing2 = new Set(existing)
        for (const did of Object.keys(demandHrs)) existing2.add(did)
        map.set(pid, Array.from(existing2))
      }
    }
    return map
  }, [extDataByMonth])

  // ── Over-capacity summary strip ────────────────────────────────────────
  const summaryEntries = useMemo((): OverCapacityEntry[] => {
    const entries: OverCapacityEntry[] = []
    const overlayName = overlayItem?.name

    function buildEntries(data: ChartPoint[], chartId: string, chartName: string) {
      // Over capacity (committed only)
      const overMonths = data.filter(d => d.bau + d.plant + d.npd + d.strategy > d.capacity)
      if (overMonths.length > 0) {
        const peak = Math.max(...overMonths.map(d => d.bau + d.plant + d.npd + d.strategy - d.capacity))
        const first = overMonths[0].label
        const last = overMonths[overMonths.length - 1].label
        entries.push({
          type: 'over', id: chartId, name: chartName,
          monthRange: first === last ? first : `${first}–${last}`, peak,
        })
      }

      // Over capacity with overlay (overlay tips it over, but committed alone is OK)
      if (overlayId) {
        const overlayOverMonths = data.filter(d =>
          d.bau + d.plant + d.npd + d.strategy <= d.capacity &&
          d.bau + d.plant + d.npd + d.strategy + d.overlay > d.capacity
        )
        if (overlayOverMonths.length > 0) {
          const peak = Math.max(...overlayOverMonths.map(d =>
            d.bau + d.plant + d.npd + d.strategy + d.overlay - d.capacity
          ))
          const first = overlayOverMonths[0].label
          const last = overlayOverMonths[overlayOverMonths.length - 1].label
          entries.push({
            type: 'over-overlay', id: chartId, name: chartName,
            monthRange: first === last ? first : `${first}–${last}`, peak,
            overlayName,
          })
        }
      }
    }

    for (const { domain, data } of domainCharts) buildEntries(data, domain.id, domain.name)
    if (sectionBMode === 'skill') {
      for (const { skill, data } of skillCharts) buildEntries(data, skill.id, skill.name)
    }

    // Projection shortfalls — surface against skill charts
    const shortfalls = projection_shortfalls(projResult)
    for (const sf of shortfalls) {
      if (!months.includes(sf.month)) continue
      const skill = store.skills.find(s => s.id === sf.skill_id)
      if (!skill) continue
      const existing = entries.find(e => e.type === 'shortfall' && e.id === skill.id)
      if (existing) {
        existing.peak = Math.max(existing.peak, sf.shortfall_hours)
      } else {
        entries.push({
          type: 'shortfall',
          id: skill.id,
          name: skill.name,
          monthRange: formatMonthLabel(sf.month),
          peak: sf.shortfall_hours,
          shortfallDriving: sf.driving_items.map(d => `${d.demand_name} (${d.shortfall_hours.toFixed(0)}h)`).join(', '),
        })
      }
    }

    return entries
  }, [domainCharts, skillCharts, sectionBMode, projResult, store.skills, months, overlayId, overlayItem])

  function handleDomainClick(domainId: string) {
    setDrillDomainId(domainId)
    setSectionBMode('skill')
  }

  function handleSkillClick(skillId: string) {
    navigate(`/capacity/skill/${skillId}?horizon=${horizon}`)
  }

  function handleBackToDomain() {
    setSectionBMode('domain')
    setDrillDomainId(null)
  }

  function scrollToChart(id: string) {
    document.getElementById(`chart-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function openEditor(id: string) { setEditorId(id); setEditorOpen(true) }
  function closeEditor() { setEditorOpen(false); setEditorId(null) }

  const drillDomainName = drillDomainId ? store.domains.find(t => t.id === drillDomainId)?.name : null

  // Dev-mode: log invariant check on mount / overlay change
  useEffect(() => {
    if (months.length > 0) {
      const result = checkInvariants(store, months, overlayId)
      if (!result.ok) {
        console.warn('[Capacity invariants FAILED]', result.failures)
      }
    }
  }, [store, months, overlayId])

  return (
    <div className="flex flex-col h-full overflow-auto bg-gray-50">

      {/* Model Capacity banner */}
      {bannerVisible && modelImpactItem && (
        <ModelCapacityBanner
          demandName={modelImpactItem.name}
          onBack={handleBackToDemand}
          onDismiss={() => setBannerVisible(false)}
        />
      )}

      {/* Toolbar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Capacity Validation</span>
        <div className="h-4 w-px bg-border" />

        {/* Horizon */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide mr-1">Horizon:</span>
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

        {/* Programme/Project filter — affects demand stacks only */}
        <div className="flex items-center gap-2">
          <select
            value={filterProgramme}
            onChange={e => { setFilterProgramme(e.target.value); setFilterProject('') }}
            className="text-xs border border-border rounded px-2 py-1 bg-white"
          >
            <option value="">All Programmes</option>
            {store.programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="text-xs border border-border rounded px-2 py-1 bg-white"
          >
            <option value="">All Projects</option>
            {availableProjectsForCV.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {(filterProgramme || filterProject) && (
            <span
              className="text-[10px] text-gray-400 italic cursor-help border-b border-dotted border-gray-300"
              title="Filters demand stacks only. Capacity lines and grey bands reflect the full team."
            >
              Demand stacks filtered
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Show external resource toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showExternal}
            onChange={e => setShowExternal(e.target.checked)}
            className="accent-brand"
          />
          Show external resource
        </label>

        {/* Show demand on other Functions toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSectionD}
            onChange={e => setShowSectionD(e.target.checked)}
            className="accent-brand"
          />
          Show demand on other Functions
        </label>

        {/* Single-item overlay selector */}
        <OverlaySelector
          overlayId={overlayId}
          onSelect={id => { setOverlayId(id); setModelImpactId(null); setBannerVisible(false) }}
          onClear={() => setOverlayId(null)}
          submittedItems={submittedItems}
        />
      </div>

      {/* Page body */}
      <div className="flex-1 px-5 py-5 max-w-[1400px] mx-auto w-full">

        {/* Section A */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Overall Function Capacity</h2>
          </div>
          <div className="bg-white border border-border rounded-lg p-5">
            <div className="flex gap-8 mb-4">
              <MetaStat label={`Total capacity (${horizon}m)`} value={`${Math.round(totalCapacity)}h`} />
              <MetaStat label="Committed demand" value={`${Math.round(totalDemand)}h`} />
              <MetaStat label="Over-capacity months" value={overMonths} warn={overMonths > 0} />
            </div>
            <CapacityChart title="" data={teamData} compact={false} />
          </div>
        </div>

        {/* Section B */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {sectionBMode === 'skill' && drillDomainName ? `Skills — ${drillDomainName}` : 'Breakdown'}
            </h2>
            <div className="flex items-center bg-gray-100 border border-border rounded p-0.5">
              {(['domain', 'skill'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setSectionBMode(m); if (m === 'domain') { setDrillDomainId(null) } }}
                  className={clsx('px-3 py-1 text-xs rounded capitalize font-medium transition-colors',
                    sectionBMode === m ? 'bg-white text-near-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            {sectionBMode === 'skill' && drillDomainId && (
              <button onClick={handleBackToDomain} className="flex items-center gap-1 text-xs text-gray-500 hover:text-near-black">
                <X size={12} /> Clear filter
              </button>
            )}
          </div>

          {/* Over-capacity summary strip */}
          <SummaryStrip entries={summaryEntries} onScrollTo={scrollToChart} />

          {sectionBMode === 'domain' ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
              {domainCharts.map(({ domain, data }) => (
                <div key={domain.id} id={`chart-${domain.id}`}>
                  <CapacityChart
                    title={domain.name}
                    subtitle="Click to drill into skills"
                    data={data}
                    compact
                    onClick={() => handleDomainClick(domain.id)}
                  />
                </div>
              ))}
              {domainCharts.length === 0 && (
                <p className="text-sm text-gray-400 py-8">Add domains in Admin to see breakdown.</p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {skillsByDomain.map(({ domain, skills }) => (
                <div key={domain.id}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{domain.name}</p>
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
                    {skills.map(({ skill, data }) => (
                      <div key={skill.id} id={`chart-${skill.id}`}>
                        <CapacityChart
                          title={skill.name}
                          subtitle="Click for skill detail"
                          data={data}
                          compact
                          onClick={() => handleSkillClick(skill.id)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {skillsByDomain.length === 0 && (
                <p className="text-sm text-gray-400 py-8">No skills found. Add skills in Admin.</p>
              )}
            </div>
          )}
        </div>

        {/* Section C: External Resource Demand */}
        {showExternal && (
          <div className="mt-8 bg-amber-50/60 border border-amber-200 rounded-lg p-5">
            <div className="flex items-start gap-2 mb-5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">
                  External Resource Demand
                </h2>
                <p className="flex items-center gap-1.5 text-xs text-amber-600 italic">
                  <Info size={11} className="shrink-0" />
                  External hours are shown for planning visibility only — they do not affect team capacity calculations.
                </p>
              </div>
            </div>

            {/* C1: Overview — stacked area chart by Provider */}
            <div className="mb-6 bg-white border border-amber-200 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-amber-700 mb-3">Overview — All Providers</h3>
              {extActiveProviders.length === 0 ? (
                <p className="text-xs text-amber-500 italic py-6 text-center">
                  No external resource hours in the visible horizon.
                </p>
              ) : (() => {
                const c1Data = extDataByMonth.map(d => ({
                  label: d.label,
                  ...Object.fromEntries(extActiveProviders.map(p => [p.id, d.byProvider[p.id] ?? 0])),
                }))
                return (
                  <>
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={c1Data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#fef3c7" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
                        <Tooltip content={<ExtC1Tooltip providers={extActiveProviders} />} />
                        {extActiveProviders.map((p, i) => (
                          <Area
                            key={p.id}
                            type="monotone"
                            dataKey={p.id}
                            name={p.name}
                            stackId="ext"
                            fill={EXT_COLORS[i % EXT_COLORS.length]}
                            stroke="none"
                            fillOpacity={0.75}
                            isAnimationActive={false}
                          />
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-3 mt-3 justify-end">
                      {extActiveProviders.map((p, i) => (
                        <span key={p.id} className="flex items-center gap-1 text-[10px] text-gray-500">
                          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: EXT_COLORS[i % EXT_COLORS.length], opacity: 0.75 }} />
                          {p.name}
                        </span>
                      ))}
                    </div>
                  </>
                )
              })()}
            </div>

            {/* C2: Per-Provider breakdown — one chart per Provider */}
            {extActiveProviders.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-amber-700 mb-3">Per-Provider Breakdown</h3>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
                  {extActiveProviders.map((provider, pi) => {
                    const activeDemandIds = extDemandsByProvider.get(provider.id) ?? []
                    const c2Data = extDataByMonth.map(d => ({
                      label: d.label,
                      ...Object.fromEntries(activeDemandIds.map(did => [did, d.byProviderByDemand[provider.id]?.[did] ?? 0])),
                    }))
                    const activeItems = activeDemandIds
                      .map(did => store.demandItems.find(d => d.id === did))
                      .filter((d): d is DemandItem => !!d)
                    return (
                      <div key={provider.id} className="bg-white border border-amber-200 rounded-lg p-4">
                        <h4 className="text-xs font-semibold text-amber-700 mb-3">{provider.name}</h4>
                        <ResponsiveContainer width="100%" height={180}>
                          <ComposedChart data={c2Data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#fef3c7" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
                            <Tooltip content={<ExtC2Tooltip providerName={provider.name} demandItems={activeItems} />} />
                            {activeDemandIds.map((did, i) => (
                              <Area
                                key={did}
                                type="monotone"
                                dataKey={did}
                                stackId="extd"
                                fill={EXT_COLORS[(pi + i) % EXT_COLORS.length]}
                                stroke="none"
                                fillOpacity={0.75}
                                isAnimationActive={false}
                              />
                            ))}
                          </ComposedChart>
                        </ResponsiveContainer>
                        {activeItems.length > 1 && (
                          <div className="flex flex-wrap gap-2 mt-2 justify-end">
                            {activeItems.map((item, i) => (
                              <span key={item.id} className="flex items-center gap-1 text-[10px] text-gray-500">
                                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: EXT_COLORS[(pi + i) % EXT_COLORS.length], opacity: 0.75 }} />
                                {item.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section D: Demand on Other Functions */}
        {showSectionD && sectionDData && (
          <div className="mt-8 bg-purple-50/40 border border-purple-200 rounded-lg p-5">
            <div className="flex items-start gap-2 mb-5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-purple-700 mb-1">
                  Demand on Other Functions
                </h2>
                <p className="flex items-center gap-1.5 text-xs text-purple-600 italic">
                  <Info size={11} className="shrink-0" />
                  Internal skill demand placed on other Functions by Demands my Function is involved in. These hours consume other Functions' capacity — not this page's.
                </p>
              </div>
            </div>

            {sectionDData.receivingFunctions.length === 0 ? (
              <p className="text-xs text-purple-500 italic py-6 text-center">
                No cross-Function demand in the visible horizon for the active Function.
              </p>
            ) : (
              <>
                {/* D1: Overview chart — stacked by receiving Function */}
                <div className="mb-6 bg-white border border-purple-200 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-purple-700 mb-3">Overview — All Functions</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={sectionDData.d1Data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3e8ff" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
                      <Tooltip content={<D1Tooltip functions={sectionDData.receivingFunctions} />} />
                      {sectionDData.receivingFunctions.map((fn, i) => (
                        <Area
                          key={fn.id}
                          type="monotone"
                          dataKey={fn.id}
                          name={fn.name}
                          stackId="d1"
                          fill={D_COLORS[i % D_COLORS.length]}
                          stroke="none"
                          fillOpacity={0.75}
                          isAnimationActive={false}
                          onClick={() => setD2TeamViewFnId(null)}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-3 mt-3 justify-end">
                    {sectionDData.receivingFunctions.map((fn, i) => (
                      <span key={fn.id} className="flex items-center gap-1 text-[10px] text-gray-500">
                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: D_COLORS[i % D_COLORS.length], opacity: 0.75 }} />
                        {fn.name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* D2: Per-Function breakdown with team drill-down */}
                <div>
                  <h3 className="text-xs font-semibold text-purple-700 mb-3">Per-Function Breakdown</h3>
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
                    {sectionDData.receivingFunctions.map((fn, fi) => {
                      const d2 = sectionDData.d2ByFn.get(fn.id)
                      if (!d2) return null
                      const isTeamView = d2TeamViewFnId === fn.id
                      const activeDemandItems = d2.demandIds
                        .map(did => store.demandItems.find(d => d.id === did))
                        .filter((d): d is DemandItem => !!d)
                      const fnTeams = store.teams.filter(t => t.functionId === fn.id)

                      return (
                        <div key={fn.id} className="bg-white border border-purple-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold text-purple-700">{fn.name}</h4>
                            {isTeamView ? (
                              <button
                                onClick={() => setD2TeamViewFnId(null)}
                                className="flex items-center gap-1 text-[10px] text-purple-500 hover:text-purple-700"
                              >
                                <X size={10} /> Back to Demands
                              </button>
                            ) : (
                              <span className="text-[10px] text-purple-400 italic">Click to drill into teams</span>
                            )}
                          </div>
                          {isTeamView ? (
                            <>
                              <ResponsiveContainer width="100%" height={180}>
                                <ComposedChart data={d2.byTeam} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f3e8ff" vertical={false} />
                                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
                                  <Tooltip content={<D2TeamTooltip teams={fnTeams} />} />
                                  {d2.visibleTeamIds.map((tid, i) => (
                                    <Area
                                      key={tid}
                                      type="monotone"
                                      dataKey={tid}
                                      stackId="d2t"
                                      fill={tid === '__unassigned__' ? '#d1d5db' : D_COLORS[(fi + i) % D_COLORS.length]}
                                      stroke="none"
                                      fillOpacity={0.75}
                                      isAnimationActive={false}
                                    />
                                  ))}
                                </ComposedChart>
                              </ResponsiveContainer>
                              {d2.visibleTeamIds.length > 1 && (
                                <div className="flex flex-wrap gap-2 mt-2 justify-end">
                                  {d2.visibleTeamIds.map((tid, i) => {
                                    const team = fnTeams.find(t => t.id === tid)
                                    const label = tid === '__unassigned__' ? 'Unassigned' : (team?.name ?? tid)
                                    return (
                                      <span key={tid} className="flex items-center gap-1 text-[10px] text-gray-500">
                                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: tid === '__unassigned__' ? '#d1d5db' : D_COLORS[(fi + i) % D_COLORS.length], opacity: 0.75 }} />
                                        {label}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <ResponsiveContainer width="100%" height={180}>
                                <ComposedChart data={d2.byDemand} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#f3e8ff" vertical={false} />
                                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
                                  <Tooltip content={<D2Tooltip demandItems={activeDemandItems} />} />
                                  {d2.demandIds.map((did, i) => (
                                    <Area
                                      key={did}
                                      type="monotone"
                                      dataKey={did}
                                      stackId="d2d"
                                      fill={D_COLORS[(fi + i) % D_COLORS.length]}
                                      stroke="none"
                                      fillOpacity={0.75}
                                      isAnimationActive={false}
                                      onClick={() => setD2TeamViewFnId(fn.id)}
                                    />
                                  ))}
                                </ComposedChart>
                              </ResponsiveContainer>
                              {activeDemandItems.length > 1 && (
                                <div className="flex flex-wrap gap-2 mt-2 justify-end">
                                  {activeDemandItems.map((item, i) => (
                                    <span key={item.id} className="flex items-center gap-1 text-[10px] text-gray-500">
                                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: D_COLORS[(fi + i) % D_COLORS.length], opacity: 0.75 }} />
                                      {item.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => setD2TeamViewFnId(fn.id)}
                                className="mt-2 text-[10px] text-purple-500 hover:text-purple-700 w-full text-right"
                              >
                                Drill into teams →
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {!overlayId && (
          <p className="text-center text-xs text-gray-400 mt-8">
            Set a Submitted demand item as overlay to model its capacity impact
          </p>
        )}
      </div>

      {editorOpen && (
        <DemandEditor demandId={editorId} onClose={closeEditor} />
      )}
    </div>
  )
}
