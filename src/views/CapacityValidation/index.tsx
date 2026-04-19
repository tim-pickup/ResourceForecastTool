import { useState, useMemo, useEffect, useRef } from 'react'
import { X, ChevronLeft, AlertCircle, AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  generateMonths, getCurrentMonth, formatMonthLabel, getPeopleForSkill,
  getPersonLoad,
} from '../../utils/capacity'
import {
  theme_capacity, skill_capacity, team_capacity,
  demand_hours_for, grey_band, computeProjection, projection_shortfalls,
  checkInvariants,
  type DemandTarget, type ProjectionResult,
} from '../../lib/capacity'
import { CapacityChart } from '../../components/CapacityChart'
import type { ChartPoint } from '../../components/CapacityChart'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { Button } from '../../components/ui/Button'
import { clsx } from 'clsx'
import type { DemandStatus, Level } from '../../types'

const HORIZONS = [6, 12, 24, 60] as const
const COMMITTED_STATUSES = new Set<DemandStatus>(['Approved', 'PartiallyAllocated', 'Allocated'])

// ─── Model Impact banner ──────────────────────────────────────────────────────

function ModelImpactBanner({
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
        All themes within capacity across the visible horizon — no projection shortfalls
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

// ─── Main view ───────────────────────────────────────────────────────────────

export default function CapacityValidation() {
  const store = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()

  const [horizon, setHorizon] = useState<6 | 12 | 24 | 60>(12)
  const [sectionBMode, setSectionBMode] = useState<'theme' | 'skill'>('theme')
  const [drillThemeId, setDrillThemeId] = useState<string | null>(null)
  const [overlayId, setOverlayId] = useState<string | null>(null)
  const [editorId, setEditorId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [modelImpactId, setModelImpactId] = useState<string | null>(null)
  const [bannerVisible, setBannerVisible] = useState(false)

  // Read URL query params for Model Impact deep-link
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

  const submittedItems = useMemo(
    () => store.demandItems.filter(d => d.status === 'Submitted').map(d => ({ id: d.id, name: d.name })),
    [store.demandItems]
  )

  const modelImpactItem = modelImpactId ? store.demandItems.find(d => d.id === modelImpactId) : null
  const overlayItem = overlayId ? store.demandItems.find(d => d.id === overlayId) : null

  const handleBackToDemand = () => {
    navigate('/demand', { state: { openDrawer: modelImpactId } })
  }

  // ── Projection (single pass for all charts) ──────────────────────────────
  const projResult: ProjectionResult = useMemo(
    () => computeProjection(store, months, overlayId),
    [store, months, overlayId]
  )

  // ── Section A: overall team chart ─────────────────────────────────────────
  const EMPTY_STATUSES = useMemo(() => new Set<DemandStatus>(), [])
  const teamData: ChartPoint[] = useMemo(() => months.map(month => {
    const committed = demand_hours_for({ type: 'overall' }, COMMITTED_STATUSES, month, store)
    const overlayDemand = overlayId
      ? demand_hours_for({ type: 'overall' }, EMPTY_STATUSES, month, store, overlayId)
      : { strategy: 0, plant: 0, npd: 0, bau: 0 }
    return {
      month,
      label: formatMonthLabel(month),
      capacity: team_capacity(month, store),
      bau: committed.bau,
      plant: committed.plant,
      npd: committed.npd,
      strategy: committed.strategy,
      overlay: overlayDemand.bau + overlayDemand.plant + overlayDemand.npd + overlayDemand.strategy,
      grey: 0,
    }
  }), [months, store, overlayId, EMPTY_STATUSES])

  const totalCapacity = teamData.reduce((s, d) => s + d.capacity, 0)
  const totalDemand = teamData.reduce((s, d) => s + d.bau + d.plant + d.npd + d.strategy, 0)
  const overMonths = teamData.filter(d => d.bau + d.plant + d.npd + d.strategy + d.overlay > d.capacity).length

  // ── Section B: theme/skill charts ─────────────────────────────────────────
  const themeCharts = useMemo(() => store.themes.map(theme => {
    const target: DemandTarget = { type: 'theme', id: theme.id }
    const data: ChartPoint[] = months.map(month => {
      const committed = demand_hours_for(target, COMMITTED_STATUSES, month, store)
      const overlayDemand = overlayId
        ? demand_hours_for(target, EMPTY_STATUSES, month, store, overlayId)
        : { strategy: 0, plant: 0, npd: 0, bau: 0 }
      return {
        month,
        label: formatMonthLabel(month),
        capacity: theme_capacity(theme.id, month, store),
        bau: committed.bau,
        plant: committed.plant,
        npd: committed.npd,
        strategy: committed.strategy,
        overlay: overlayDemand.bau + overlayDemand.plant + overlayDemand.npd + overlayDemand.strategy,
        grey: grey_band(target, month, store, projResult),
      }
    })
    return { theme, data }
  }), [months, store, overlayId, EMPTY_STATUSES, projResult])

  const skillsForSectionB = useMemo(() =>
    drillThemeId ? store.skills.filter(s => s.theme_id === drillThemeId) : store.skills,
    [store.skills, drillThemeId]
  )

  const skillCharts = useMemo(() => skillsForSectionB.map(skill => {
    const target: DemandTarget = { type: 'skill', id: skill.id }
    const data: ChartPoint[] = months.map(month => {
      const committed = demand_hours_for(target, COMMITTED_STATUSES, month, store)
      const overlayDemand = overlayId
        ? demand_hours_for(target, EMPTY_STATUSES, month, store, overlayId)
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
    return { skill, theme: store.themes.find(t => t.id === skill.theme_id), data }
  }), [months, store, skillsForSectionB, overlayId, EMPTY_STATUSES, projResult])

  const skillsByTheme = useMemo(() => {
    const groups = new Map<string, typeof skillCharts>()
    for (const sc of skillCharts) {
      const tid = sc.skill.theme_id
      if (!groups.has(tid)) groups.set(tid, [])
      groups.get(tid)!.push(sc)
    }
    return store.themes.map(t => ({ theme: t, skills: groups.get(t.id) ?? [] })).filter(g => g.skills.length > 0)
  }, [skillCharts, store.themes])

  // ── Over-capacity summary strip ────────────────────────────────────────────
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

    for (const { theme, data } of themeCharts) buildEntries(data, theme.id, theme.name)
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
  }, [themeCharts, skillCharts, sectionBMode, projResult, store.skills, months, overlayId, overlayItem])

  function handleThemeClick(themeId: string) {
    setDrillThemeId(themeId)
    setSectionBMode('skill')
  }

  function handleSkillClick(skillId: string) {
    navigate(`/capacity/skill/${skillId}?horizon=${horizon}`)
  }

  function handleBackToTheme() {
    setSectionBMode('theme')
    setDrillThemeId(null)
  }

  function scrollToChart(id: string) {
    document.getElementById(`chart-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function openEditor(id: string) { setEditorId(id); setEditorOpen(true) }
  function closeEditor() { setEditorOpen(false); setEditorId(null) }

  const drillThemeName = drillThemeId ? store.themes.find(t => t.id === drillThemeId)?.name : null

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

      {/* Model Impact banner */}
      {bannerVisible && modelImpactItem && (
        <ModelImpactBanner
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

        <div className="flex-1" />

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
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Overall Team Capacity</h2>
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
              {sectionBMode === 'skill' && drillThemeName ? `Skills — ${drillThemeName}` : 'Breakdown'}
            </h2>
            <div className="flex items-center bg-gray-100 border border-border rounded p-0.5">
              {(['theme', 'skill'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setSectionBMode(m); if (m === 'theme') { setDrillThemeId(null) } }}
                  className={clsx('px-3 py-1 text-xs rounded capitalize font-medium transition-colors',
                    sectionBMode === m ? 'bg-white text-near-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            {sectionBMode === 'skill' && drillThemeId && (
              <button onClick={handleBackToTheme} className="flex items-center gap-1 text-xs text-gray-500 hover:text-near-black">
                <X size={12} /> Clear filter
              </button>
            )}
          </div>

          {/* Over-capacity summary strip */}
          <SummaryStrip entries={summaryEntries} onScrollTo={scrollToChart} />

          {sectionBMode === 'theme' ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
              {themeCharts.map(({ theme, data }) => (
                <div key={theme.id} id={`chart-${theme.id}`}>
                  <CapacityChart
                    title={theme.name}
                    subtitle="Click to drill into skills"
                    data={data}
                    compact
                    onClick={() => handleThemeClick(theme.id)}
                  />
                </div>
              ))}
              {themeCharts.length === 0 && (
                <p className="text-sm text-gray-400 py-8">Add themes in Admin to see breakdown.</p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {skillsByTheme.map(({ theme, skills }) => (
                <div key={theme.id}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{theme.name}</p>
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
              {skillsByTheme.length === 0 && (
                <p className="text-sm text-gray-400 py-8">No skills found. Add skills in Admin.</p>
              )}
            </div>
          )}
        </div>

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
