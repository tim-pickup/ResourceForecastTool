import { useState, useMemo, useEffect } from 'react'
import { Plus, X, ChevronLeft, AlertCircle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  generateMonths, getCurrentMonth, formatMonthLabel,
  getTeamCapacity, getTeamDemand,
  getThemeCapacity, getThemeDemand,
  getSkillCapacity, getSkillDemand,
  getOverlayDemand, getPersonLoad, getPeopleForSkill,
} from '../../utils/capacity'
import { CapacityChart } from '../../components/CapacityChart'
import type { ChartPoint } from '../../components/CapacityChart'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { Button } from '../../components/ui/Button'
import { clsx } from 'clsx'
import type { Level } from '../../types'

const HORIZONS = [6, 12, 24, 60] as const

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
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">skill-shaped</span>
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

// ─── Main view ───────────────────────────────────────────────────────────────

export default function CapacityValidation() {
  const store = useAppStore()
  const location = useLocation()
  const navigate = useNavigate()

  const [horizon, setHorizon] = useState<6 | 12 | 24 | 60>(12)
  const [sectionBMode, setSectionBMode] = useState<'theme' | 'skill'>('theme')
  const [drillThemeId, setDrillThemeId] = useState<string | null>(null)
  const [drillSkillId, setDrillSkillId] = useState<string | null>(null)
  const [overlayIds, setOverlayIds] = useState<string[]>([])
  const [overlayPickerOpen, setOverlayPickerOpen] = useState(false)
  const [overlaySearch, setOverlaySearch] = useState('')
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
      setOverlayIds([overlayParam])
      setModelImpactId(overlayParam)
      setBannerVisible(true)
    }
  }, [location.search])

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])

  const submittedItems = useMemo(
    () => store.demandItems.filter(d => d.status === 'Submitted'),
    [store.demandItems]
  )

  const overlayItems = useMemo(
    () => store.demandItems.filter(d => overlayIds.includes(d.id)),
    [store.demandItems, overlayIds]
  )

  const availableOverlays = useMemo(
    () => store.demandItems.filter(d =>
      d.status === 'Submitted' &&
      !overlayIds.includes(d.id) &&
      d.name.toLowerCase().includes(overlaySearch.toLowerCase())
    ),
    [store.demandItems, overlayIds, overlaySearch]
  )

  const modelImpactItem = modelImpactId ? store.demandItems.find(d => d.id === modelImpactId) : null

  const handleSelectAllSubmitted = () => {
    const allSubmittedIds = submittedItems.map(d => d.id)
    setOverlayIds(allSubmittedIds)
  }

  const handleClearAll = () => {
    setOverlayIds([])
  }

  const handleBackToDemand = () => {
    navigate('/demand', { state: { openDrawer: modelImpactId } })
  }

  // ── Section A: overall team chart ──────────────────────────────────────────
  const teamData: ChartPoint[] = useMemo(() => months.map(month => ({
    month,
    label: formatMonthLabel(month),
    capacity: getTeamCapacity(month, store),
    overlay: getOverlayDemand(month, overlayItems),
    ...getTeamDemand(month, store),
  })), [months, store, overlayItems])

  const totalCapacity = teamData.reduce((s, d) => s + d.capacity, 0)
  const totalDemand = teamData.reduce((s, d) => s + d.bau + d.plant + d.npd + d.strategy, 0)
  const overMonths = teamData.filter(d => d.bau + d.plant + d.npd + d.strategy + d.overlay > d.capacity).length

  // ── Section B: theme charts ────────────────────────────────────────────────
  const themeCharts = useMemo(() => store.themes.map(theme => ({
    theme,
    data: months.map(month => ({
      month,
      label: formatMonthLabel(month),
      capacity: getThemeCapacity(theme.id, month, store),
      overlay: getOverlayDemand(month, overlayItems),
      ...getThemeDemand(theme.id, month, store),
    } as ChartPoint)),
  })), [months, store, overlayItems])

  const skillsForSectionB = useMemo(() =>
    drillThemeId
      ? store.skills.filter(s => s.theme_id === drillThemeId)
      : store.skills,
    [store.skills, drillThemeId]
  )

  const skillCharts = useMemo(() => skillsForSectionB.map(skill => ({
    skill,
    theme: store.themes.find(t => t.id === skill.theme_id),
    data: months.map(month => ({
      month,
      label: formatMonthLabel(month),
      capacity: getSkillCapacity(skill.id, month, store),
      subCapacity: getSkillCapacity(skill.id, month, store, 'Specialist'),
      overlay: getOverlayDemand(month, overlayItems),
      ...getSkillDemand(skill.id, month, store),
    } as ChartPoint)),
  })), [months, store, skillsForSectionB, overlayItems])

  const skillsByTheme = useMemo(() => {
    const groups = new Map<string, typeof skillCharts>()
    for (const sc of skillCharts) {
      const tid = sc.skill.theme_id
      if (!groups.has(tid)) groups.set(tid, [])
      groups.get(tid)!.push(sc)
    }
    return store.themes.map(t => ({ theme: t, skills: groups.get(t.id) ?? [] })).filter(g => g.skills.length > 0)
  }, [skillCharts, store.themes])

  function handleThemeClick(themeId: string) {
    setDrillThemeId(themeId)
    setSectionBMode('skill')
    setDrillSkillId(null)
  }

  function handleSkillClick(skillId: string) {
    setDrillSkillId(skillId)
  }

  function handleBackToTheme() {
    setSectionBMode('theme')
    setDrillThemeId(null)
    setDrillSkillId(null)
  }

  function openEditor(id: string) { setEditorId(id); setEditorOpen(true) }
  function closeEditor() { setEditorOpen(false); setEditorId(null) }

  const drillThemeName = drillThemeId ? store.themes.find(t => t.id === drillThemeId)?.name : null

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

        {/* Overlay bulk actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSelectAllSubmitted}
            disabled={submittedItems.length === 0}
            className="text-xs text-brand hover:text-brand-hover font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Select all Submitted
          </button>
          {overlayIds.length > 0 && (
            <button onClick={handleClearAll} className="text-xs text-gray-500 hover:text-near-black font-medium">
              Clear all
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Overlay chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {overlayIds.map(id => {
            const item = store.demandItems.find(d => d.id === id)
            if (!item) return null
            return (
              <div key={id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5 text-xs font-medium text-amber-800">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                {item.name}
                <button onClick={() => setOverlayIds(ids => ids.filter(x => x !== id))} className="hover:opacity-70 ml-0.5">
                  <X size={11} />
                </button>
              </div>
            )
          })}
          <div className="relative">
            <button
              onClick={() => setOverlayPickerOpen(o => !o)}
              className="border border-dashed border-gray-400 rounded-full px-3 py-1 text-xs text-gray-500 hover:border-gray-600 hover:text-gray-700 flex items-center gap-1"
            >
              <Plus size={11} /> Add overlay
            </button>
            {overlayPickerOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-border rounded shadow-card z-30">
                <input
                  autoFocus
                  value={overlaySearch}
                  onChange={e => setOverlaySearch(e.target.value)}
                  placeholder="Search Submitted items…"
                  className="w-full px-3 py-2 text-xs border-b border-border focus:outline-none"
                />
                <div className="max-h-48 overflow-y-auto">
                  {availableOverlays.length === 0 && (
                    <p className="text-xs text-gray-400 px-3 py-3">
                      {overlaySearch ? 'No matching Submitted items.' : 'No Submitted items available.'}
                    </p>
                  )}
                  {availableOverlays.map(d => (
                    <button
                      key={d.id}
                      onClick={() => { setOverlayIds(ids => [...ids, d.id]); setOverlayPickerOpen(false); setOverlaySearch('') }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50"
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
                <button onClick={() => setOverlayPickerOpen(false)} className="w-full text-center py-1.5 text-xs text-gray-400 border-t border-border hover:bg-gray-50">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
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
                  onClick={() => { setSectionBMode(m); if (m === 'theme') { setDrillThemeId(null); setDrillSkillId(null) } }}
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

          {sectionBMode === 'theme' ? (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
              {themeCharts.map(({ theme, data }) => (
                <CapacityChart
                  key={theme.id}
                  title={theme.name}
                  subtitle="Click to drill into skills"
                  data={data}
                  compact
                  onClick={() => handleThemeClick(theme.id)}
                />
              ))}
              {themeCharts.length === 0 && (
                <p className="text-sm text-gray-400 py-8">Add themes in Admin to see breakdown.</p>
              )}
            </div>
          ) : (
            drillSkillId ? (
              <PersonPanel
                skillId={drillSkillId}
                months={months}
                onClose={() => setDrillSkillId(null)}
                onOpenEditor={openEditor}
              />
            ) : (
              <div className="space-y-6">
                {skillsByTheme.map(({ theme, skills }) => (
                  <div key={theme.id}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{theme.name}</p>
                    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' }}>
                      {skills.map(({ skill, data }) => (
                        <CapacityChart
                          key={skill.id}
                          title={skill.name}
                          subtitle="Click to see people"
                          data={data}
                          subCapacityLabel="Specialist capacity"
                          compact
                          onClick={() => handleSkillClick(skill.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {skillsByTheme.length === 0 && (
                  <p className="text-sm text-gray-400 py-8">No skills found. Add skills in Admin.</p>
                )}
              </div>
            )
          )}
        </div>

        {overlayIds.length === 0 && (
          <p className="text-center text-xs text-gray-400 mt-8">
            Select a Submitted demand item above to overlay its proposed capacity impact
          </p>
        )}
      </div>

      {editorOpen && (
        <DemandEditor demandId={editorId} onClose={closeEditor} />
      )}
    </div>
  )
}
