import { useState, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { parseISO, isAfter, differenceInMonths, addMonths, format } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import type { AppFunction, DemandStatus, Activity, Requirement, FundingSource, Level, SkillRequirement, ExternalResourceRequirement } from '../../types'
import { Input, Select } from '../../components/ui/FormFields'
import { MonthYearPicker } from '../../components/MonthYearPicker'
import { DomainSkillSelector } from '../../components/DomainSkillSelector'
import { generateId } from '../../utils/ids'
import { generateMonths, formatMonthLabel, getCurrentMonth } from '../../utils/capacity'

const FUNDING_SOURCES: FundingSource[] = ['Investment Scheme', 'Plant/Sector Allocation', 'Mixed']
const LEVELS: Level[] = ['Basic', 'Advanced', 'Specialist']

// Funding source colour palette — documented in DESIGN.md §10
export const FUNDING_SOURCE_COLORS: Record<FundingSource, string> = {
  'Investment Scheme':      '#0891b2',  // cyan-600
  'Plant/Sector Allocation': '#d97706', // amber-600
  'Mixed':                  '#7c3aed',  // violet-600
}

// Per-Function colour palette for team indicators (deterministic by Function alphabetical order)
const FN_PALETTE = ['#0891b2', '#7c3aed', '#16a34a', '#d97706', '#dc2626', '#0369a1', '#b45309', '#0f766e']

function getFnColor(fnId: string | undefined, functions: Array<{ id: string; active: boolean; name: string }>): string {
  if (!fnId) return '#6b7280'
  const sorted = [...functions].filter(f => f.active).sort((a, b) => a.name.localeCompare(b.name))
  const idx = sorted.findIndex(f => f.id === fnId)
  return FN_PALETTE[Math.max(0, idx) % FN_PALETTE.length]
}

// ─── Activity Gantt ───────────────────────────────────────────────────────────

interface GanttProps {
  activities: Activity[]
  onClickActivity: (activityId: string) => void
  readOnly?: boolean
}

export function ActivityGantt({ activities, onClickActivity, readOnly = false }: GanttProps) {
  const validActivities = activities.filter(p => p.start_month)
  if (validActivities.length === 0) return null

  const starts = validActivities.map(p => p.start_month).sort()
  const finiteEnds = validActivities.filter(p => p.end_month).map(p => p.end_month!).sort()
  const hasIndefinite = validActivities.some(p => !p.end_month)

  const tlStart = starts[0]
  let tlEndDate: Date
  if (finiteEnds.length > 0) {
    const latestFiniteDate = parseISO(finiteEnds[finiteEnds.length - 1] + '-01')
    tlEndDate = hasIndefinite ? addMonths(latestFiniteDate, 8) : latestFiniteDate
  } else {
    tlEndDate = addMonths(parseISO(tlStart + '-01'), 18)
  }

  const totalMonths = differenceInMonths(tlEndDate, parseISO(tlStart + '-01')) + 1
  if (totalMonths <= 1) return null

  const sortedActivities = [...validActivities].sort((a, b) => a.start_month.localeCompare(b.start_month))

  function monthOff(month: string): number {
    return Math.max(0, differenceInMonths(parseISO(month + '-01'), parseISO(tlStart + '-01')))
  }

  const tickInterval = totalMonths > 36 ? 6 : totalMonths > 18 ? 3 : totalMonths > 9 ? 2 : 1
  const ticks: { label: string; pct: number }[] = []
  for (let i = 0; i < totalMonths; i += tickInterval) {
    const d = addMonths(parseISO(tlStart + '-01'), i)
    ticks.push({ label: format(d, 'MMM yy'), pct: (i / (totalMonths - 1)) * 100 })
  }

  // Determine which funding sources are actually used (for compact legend)
  const usedSources = Array.from(new Set(validActivities.map(p => p.funding_source)))

  return (
    <div className="bg-gray-50 border border-border rounded p-3 mb-3">
      {/* Header with legend */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Activity Timeline{readOnly && <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-400">(read only)</span>}
        </span>
        <div className="flex items-center gap-3">
          {(usedSources as FundingSource[]).map(src => (
            <span key={src} className="flex items-center gap-1 text-[9px] text-gray-500">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: FUNDING_SOURCE_COLORS[src] }}
              />
              {src}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: 360 }}>
          {/* Tick axis */}
          <div className="relative h-5 mb-1">
            {ticks.map(({ label, pct }) => (
              <span
                key={label}
                className="absolute text-[9px] text-gray-400 whitespace-nowrap"
                style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
              >
                {label}
              </span>
            ))}
          </div>
          {/* Activity bars — with vertical padding above first bar and below last bar */}
          <div className="flex flex-col gap-1" style={{ paddingTop: 7, paddingBottom: 10 }}>
            {sortedActivities.map((activity) => {
              const origIdx = activities.indexOf(activity)
              const startOff = monthOff(activity.start_month)
              const isIndefinite = !activity.end_month
              const endOff = isIndefinite
                ? totalMonths - 1
                : Math.min(monthOff(activity.end_month!), totalMonths - 1)
              const leftPct = (startOff / (totalMonths - 1)) * 100
              const widthPct = Math.max(((endOff - startOff) / (totalMonths - 1)) * 100, 3)
              const color = FUNDING_SOURCE_COLORS[activity.funding_source] ?? '#6b7280'
              const label = activity.name || `Activity ${origIdx + 1}`
              const dateLabel = isIndefinite
                ? `${activity.start_month} → ongoing`
                : `${activity.start_month} → ${activity.end_month}`

              return (
                <div key={activity.id} className="relative h-7">
                  <button
                    type="button"
                    onClick={() => onClickActivity(activity.id)}
                    title={`${label} · ${dateLabel} · ${activity.funding_source}`}
                    className={`absolute top-0 h-full rounded flex items-center px-2 overflow-hidden text-[10px] font-medium ${readOnly ? 'cursor-default' : 'hover:opacity-80 transition-opacity'}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      ...(isIndefinite ? {
                        backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.2) 4px, rgba(255,255,255,0.2) 8px)`,
                      } : {}),
                    }}
                  >
                    {/* Semi-transparent backing for label legibility regardless of bar colour */}
                    <span
                      className="truncate px-1 rounded-sm"
                      style={{ backgroundColor: 'rgba(0,0,0,0.28)', color: '#ffffff' }}
                    >
                      {label}
                    </span>
                    {isIndefinite && (
                      <span className="ml-1 shrink-0" style={{ color: '#ffffff' }}>→</span>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export function getMonths(start: string, end: string | null): string[] {
  if (!start || !end) return []
  try {
    const s = parseISO(start + '-01')
    const e = parseISO(end + '-01')
    if (isAfter(s, e)) return []
    return generateMonths(start, differenceInMonths(e, s) + 1)
  } catch { return [] }
}

function adjustRequirements(reqs: Requirement[], newMonths: string[]): Requirement[] {
  return reqs.map(req => {
    const hbm: Record<string, number> = {}
    newMonths.forEach(m => { hbm[m] = req.hours_by_month[m] ?? 0 })
    return { ...req, hours_by_month: hbm, steady_state_hours: null }
  })
}

function requirementsToIndefinite(reqs: Requirement[]): Requirement[] {
  return reqs.map(req => {
    const vals = Object.values(req.hours_by_month)
    const avg = vals.length > 0 ? Math.round(vals.reduce((s, h) => s + h, 0) / vals.length) : 0
    return { ...req, hours_by_month: {}, steady_state_hours: avg }
  })
}

function requirementsToFinite(reqs: Requirement[], months: string[], defaultHrs: number): Requirement[] {
  return reqs.map(req => {
    const hbm: Record<string, number> = {}
    const fillVal = req.steady_state_hours ?? defaultHrs
    months.forEach(m => { hbm[m] = fillVal })
    return { ...req, hours_by_month: hbm, steady_state_hours: null }
  })
}

export function blankSkillReq(skillId: string, months: string[]): SkillRequirement {
  const hours_by_month: Record<string, number> = {}
  months.forEach(m => { hours_by_month[m] = 0 })
  return { id: generateId('req'), shape: 'skill', skill_id: skillId, level: 'Basic', hours_by_month, steady_state_hours: null, notes: null, allocations: [] }
}

export function blankSkillReqIndefinite(skillId: string): SkillRequirement {
  return { id: generateId('req'), shape: 'skill', skill_id: skillId, level: 'Basic', hours_by_month: {}, steady_state_hours: 0, notes: null, allocations: [] }
}

export function blankActivity(): Activity {
  return { id: generateId('phs'), name: '', start_month: '', end_month: '', funding_source: 'Investment Scheme', funding_notes: '', requirements: [] }
}

// ─── Requirement row (finite) ─────────────────────────────────────────────────

interface ReqRowProps {
  req: SkillRequirement
  months: string[]
  onChange: (r: SkillRequirement) => void
  onDelete: () => void
  scopedDomains: import('../../types').Domain[]
  scopedSkills: import('../../types').Skill[]
  crossFunctionMode?: boolean
  activeFunctions?: AppFunction[]
}

function RequirementRow({ req, months, onChange, onDelete, scopedDomains, scopedSkills, crossFunctionMode, activeFunctions }: ReqRowProps) {
  const [fillVal, setFillVal] = useState(0)

  const totalHrs = months.reduce((s, m) => s + (req.hours_by_month[m] ?? 0), 0)

  const handleFillAll = () => {
    const hbm: Record<string, number> = {}
    months.forEach(m => { hbm[m] = fillVal })
    onChange({ ...req, hours_by_month: hbm })
  }

  const setMonth = (m: string, val: number) =>
    onChange({ ...req, hours_by_month: { ...req.hours_by_month, [m]: val } })

  return (
    <div className="border border-border rounded p-2.5 bg-gray-50/50 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <DomainSkillSelector
            value={req.skill_id}
            onChange={id => onChange({ ...req, skill_id: id })}
            domains={scopedDomains}
            skills={scopedSkills}
            crossFunctionMode={crossFunctionMode}
            functions={activeFunctions}
          />
        </div>
        <select
          value={req.level}
          onChange={e => onChange({ ...req, level: e.target.value as Level })}
          className="text-xs border border-border rounded px-1.5 py-1 bg-white"
        >
          {LEVELS.map(l => <option key={l}>{l}</option>)}
        </select>
        <input
          type="text"
          value={req.notes ?? ''}
          onChange={e => onChange({ ...req, notes: e.target.value || null })}
          placeholder="Notes (optional)"
          className="text-xs border border-border rounded px-1.5 py-1 bg-white w-36"
        />
        <button onClick={onDelete} className="text-gray-300 hover:text-accent-red transition-colors shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      {months.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1 min-w-max">
              {months.map(m => (
                <div key={m} className="flex flex-col items-center">
                  <span className="text-[10px] text-gray-400 mb-0.5 whitespace-nowrap">{formatMonthLabel(m)}</span>
                  <input
                    type="number"
                    value={req.hours_by_month[m] ?? 0}
                    onChange={e => setMonth(m, Math.max(0, Number(e.target.value)))}
                    className="w-14 text-xs border border-border rounded px-1 py-1 text-right bg-white"
                    min={0}
                  />
                </div>
              ))}
              <div className="flex flex-col items-center ml-1">
                <span className="text-[10px] text-gray-400 mb-0.5">Total</span>
                <span className="text-xs font-medium text-near-black px-1 py-1">{Math.round(totalHrs)}h</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Fill all:</span>
            <input
              type="number"
              value={fillVal}
              onChange={e => setFillVal(Math.max(0, Number(e.target.value)))}
              className="w-16 text-xs border border-border rounded px-1.5 py-1 text-right bg-white"
              min={0}
            />
            <span className="text-xs text-gray-400">h/mo</span>
            <button onClick={handleFillAll} className="text-xs text-brand hover:text-brand-hover font-medium">
              Fill all
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-gray-400 italic">Set phase start/end months to enter hours.</p>
      )}
    </div>
  )
}

// ─── Requirement row (indefinite) ─────────────────────────────────────────────

function IndefiniteRequirementRow({ req, onChange, onDelete, scopedDomains, scopedSkills, crossFunctionMode, activeFunctions }: {
  req: SkillRequirement
  onChange: (r: SkillRequirement) => void
  onDelete: () => void
  scopedDomains: import('../../types').Domain[]
  scopedSkills: import('../../types').Skill[]
  crossFunctionMode?: boolean
  activeFunctions?: AppFunction[]
}) {
  return (
    <div className="border border-border rounded p-2.5 bg-gray-50/50 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <DomainSkillSelector
            value={req.skill_id}
            onChange={id => onChange({ ...req, skill_id: id })}
            domains={scopedDomains}
            skills={scopedSkills}
            crossFunctionMode={crossFunctionMode}
            functions={activeFunctions}
          />
        </div>
        <select
          value={req.level}
          onChange={e => onChange({ ...req, level: e.target.value as Level })}
          className="text-xs border border-border rounded px-1.5 py-1 bg-white"
        >
          {LEVELS.map(l => <option key={l}>{l}</option>)}
        </select>
        <input
          type="text"
          value={req.notes ?? ''}
          onChange={e => onChange({ ...req, notes: e.target.value || null })}
          placeholder="Notes (optional)"
          className="text-xs border border-border rounded px-1.5 py-1 bg-white w-36"
        />
        <button onClick={onDelete} className="text-gray-300 hover:text-accent-red transition-colors shrink-0">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Hours per month (indefinite):</label>
        <input
          type="number"
          value={req.steady_state_hours ?? 0}
          onChange={e => onChange({ ...req, steady_state_hours: Math.max(0, Number(e.target.value)) })}
          className="w-20 text-xs border border-border rounded px-1.5 py-1 text-right bg-white"
          min={0}
        />
        <span className="text-xs text-gray-400">h/mo</span>
      </div>
    </div>
  )
}

// ─── External resource requirement helpers ────────────────────────────────────

export function blankExtReq(activity_id: string, function_tag: string | null = null): ExternalResourceRequirement {
  return {
    id: generateId('ext'),
    activity_id,
    provider_id: '',
    role: '',
    notes: null,
    hours_by_month: {},
    steady_state_hours: null,
    function_tag,
  }
}

// External requirement row — finite phase (per-month hours grid)
interface ExtReqRowProps {
  ext: ExternalResourceRequirement
  months: string[]
  onChange: (e: ExternalResourceRequirement) => void
  onDelete: () => void
  showFunctionTagPicker?: boolean  // true for Project Scoping only
}

function ExtRequirementRow({ ext, months, onChange, onDelete, showFunctionTagPicker }: ExtReqRowProps) {
  const { providers, functions } = useAppStore()
  const [fillVal, setFillVal] = useState(0)
  const totalHrs = months.reduce((s, m) => s + (ext.hours_by_month[m] ?? 0), 0)

  const handleFillAll = () => {
    const hbm: Record<string, number> = {}
    months.forEach(m => { hbm[m] = fillVal })
    onChange({ ...ext, hours_by_month: hbm })
  }

  return (
    <div className="border border-amber-200 rounded p-2.5 bg-amber-50/40 flex flex-col gap-2">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">External</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={ext.provider_id}
          onChange={e => onChange({ ...ext, provider_id: e.target.value })}
          className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white min-w-[120px]"
        >
          <option value="">— Provider —</option>
          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input
          type="text"
          value={ext.role}
          onChange={e => onChange({ ...ext, role: e.target.value })}
          placeholder="Role (required)"
          className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white flex-1 min-w-[100px]"
        />
        <input
          type="text"
          value={ext.notes ?? ''}
          onChange={e => onChange({ ...ext, notes: e.target.value || null })}
          placeholder="Notes (optional)"
          className="text-xs border border-border rounded px-1.5 py-1 bg-white w-32"
        />
        {showFunctionTagPicker && (
          <select
            value={ext.function_tag ?? ''}
            onChange={e => onChange({ ...ext, function_tag: e.target.value || null })}
            className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white min-w-[110px]"
            title="Function tag — determines which spawned Demand this external requirement routes to"
          >
            <option value="">— Function tag —</option>
            {functions.filter(f => f.active).sort((a, b) => a.name.localeCompare(b.name)).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        <button onClick={onDelete} className="text-amber-400 hover:text-accent-red transition-colors shrink-0">
          <Trash2 size={13} />
        </button>
      </div>
      {months.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1 min-w-max">
              {months.map(m => (
                <div key={m} className="flex flex-col items-center">
                  <span className="text-[10px] text-amber-500 mb-0.5 whitespace-nowrap">{formatMonthLabel(m)}</span>
                  <input
                    type="number"
                    value={ext.hours_by_month[m] ?? 0}
                    onChange={e => onChange({ ...ext, hours_by_month: { ...ext.hours_by_month, [m]: Math.max(0, Number(e.target.value)) } })}
                    className="w-14 text-xs border border-amber-300 rounded px-1 py-1 text-right bg-white"
                    min={0}
                  />
                </div>
              ))}
              <div className="flex flex-col items-center ml-1">
                <span className="text-[10px] text-amber-400 mb-0.5">Total</span>
                <span className="text-xs font-medium text-amber-700 px-1 py-1">{Math.round(totalHrs)}h</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-500">Fill all:</span>
            <input
              type="number"
              value={fillVal}
              onChange={e => setFillVal(Math.max(0, Number(e.target.value)))}
              className="w-16 text-xs border border-amber-300 rounded px-1.5 py-1 text-right bg-white"
              min={0}
            />
            <span className="text-xs text-amber-500">h/mo</span>
            <button onClick={handleFillAll} className="text-xs text-amber-600 hover:text-amber-700 font-medium">
              Fill all
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-amber-500 italic">Set phase start/end months to enter hours.</p>
      )}
    </div>
  )
}

// External requirement row — indefinite phase (steady-state)
function IndefiniteExtRequirementRow({ ext, onChange, onDelete, showFunctionTagPicker }: {
  ext: ExternalResourceRequirement
  onChange: (e: ExternalResourceRequirement) => void
  onDelete: () => void
  showFunctionTagPicker?: boolean
}) {
  const { providers, functions } = useAppStore()

  return (
    <div className="border border-amber-200 rounded p-2.5 bg-amber-50/40 flex flex-col gap-2">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">External</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={ext.provider_id}
          onChange={e => onChange({ ...ext, provider_id: e.target.value })}
          className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white min-w-[120px]"
        >
          <option value="">— Provider —</option>
          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input
          type="text"
          value={ext.role}
          onChange={e => onChange({ ...ext, role: e.target.value })}
          placeholder="Role (required)"
          className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white flex-1 min-w-[100px]"
        />
        <input
          type="text"
          value={ext.notes ?? ''}
          onChange={e => onChange({ ...ext, notes: e.target.value || null })}
          placeholder="Notes (optional)"
          className="text-xs border border-border rounded px-1.5 py-1 bg-white w-32"
        />
        {showFunctionTagPicker && (
          <select
            value={ext.function_tag ?? ''}
            onChange={e => onChange({ ...ext, function_tag: e.target.value || null })}
            className="text-xs border border-amber-300 rounded px-1.5 py-1 bg-white min-w-[110px]"
            title="Function tag — determines which spawned Demand this external requirement routes to"
          >
            <option value="">— Function tag —</option>
            {functions.filter(f => f.active).sort((a, b) => a.name.localeCompare(b.name)).map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}
        <button onClick={onDelete} className="text-amber-400 hover:text-accent-red transition-colors shrink-0">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-amber-600">Hours per month (steady):</label>
        <input
          type="number"
          value={ext.steady_state_hours ?? 0}
          onChange={e => onChange({ ...ext, steady_state_hours: Math.max(0, Number(e.target.value)) })}
          className="w-20 text-xs border border-amber-300 rounded px-1.5 py-1 text-right bg-white"
          min={0}
        />
        <span className="text-xs text-amber-500">h/mo</span>
      </div>
    </div>
  )
}

// ─── Activity editor ──────────────────────────────────────────────────────────

interface ActivityEditorProps {
  activity: Activity
  index: number
  onChange: (p: Activity) => void
  onDelete: () => void
  extReqs: ExternalResourceRequirement[]
  onExtReqsChange: (reqs: ExternalResourceRequirement[]) => void
  demandId?: string
  demandStatus?: DemandStatus
  showRequirements?: boolean        // default true; false for Project Draft (§4.5.2)
  readOnlyActivityHeader?: boolean  // true for Project-spawned Demand Submitted (§4.5.2)
  functionScopeId?: string | null   // null=full catalogue (Project Scoping); string=scoped to that Function
  showFunctionTagPicker?: boolean   // true for Project Scoping ext reqs (§4.5.2)
}

export function ActivityEditor({
  activity, index, onChange, onDelete, extReqs, onExtReqsChange,
  showRequirements = true, readOnlyActivityHeader = false,
  functionScopeId, showFunctionTagPicker = false,
}: ActivityEditorProps) {
  const [open, setOpen] = useState(true)
  const store = useAppStore()

  // Cross-Function mode: functionScopeId === null means Project Scoping (full catalogue, two-step picker)
  const crossFunctionMode = functionScopeId === null
  const activeFunctions = useMemo(() => store.functions.filter(f => f.active), [store.functions])

  // Compute skill catalogue scope: null = full catalogue (Project Scoping); string = one Function
  const scopedDomains = useMemo(() => {
    if (functionScopeId === null || functionScopeId === undefined) return store.domains
    return store.domains.filter(d => d.functionId === functionScopeId)
  }, [functionScopeId, store.domains])
  const scopedDomainIds = useMemo(() => new Set(scopedDomains.map(d => d.id)), [scopedDomains])
  const scopedSkills = useMemo(() => store.skills.filter(s => scopedDomainIds.has(s.domain_id)), [scopedDomainIds, store.skills])

  const isIndefinite = activity.end_month === null
  const months = useMemo(() => getMonths(activity.start_month, activity.end_month), [activity.start_month, activity.end_month])

  const handleStartChange = (value: string) => {
    const newMonths = getMonths(value, activity.end_month)
    const updatedReqs = !isIndefinite && newMonths.length > 0 ? adjustRequirements(activity.requirements, newMonths) : activity.requirements
    onChange({ ...activity, start_month: value, requirements: updatedReqs })
  }

  const handleEndChange = (value: string) => {
    const newMonths = getMonths(activity.start_month, value)
    const updatedReqs = newMonths.length > 0 ? adjustRequirements(activity.requirements, newMonths) : activity.requirements
    onChange({ ...activity, end_month: value, requirements: updatedReqs })
  }

  const handleIndefiniteToggle = (checked: boolean) => {
    if (checked) {
      const updatedReqs = requirementsToIndefinite(activity.requirements)
      onChange({ ...activity, end_month: null, requirements: updatedReqs })
    } else {
      const newEnd = window.prompt('End month (YYYY-MM):', '') ?? ''
      if (!newEnd) return
      const newMonths = getMonths(activity.start_month, newEnd)
      if (newMonths.length === 0) return
      const updatedReqs = requirementsToFinite(activity.requirements, newMonths, 0)
      onChange({ ...activity, end_month: newEnd, requirements: updatedReqs })
    }
  }

  const updateReq = (reqId: string, r: SkillRequirement) =>
    onChange({ ...activity, requirements: activity.requirements.map(x => x.id === reqId ? r : x) })
  const deleteReq = (reqId: string) =>
    onChange({ ...activity, requirements: activity.requirements.filter(x => x.id !== reqId) })
  const addReq = () => {
    const skillId = store.skills[0]?.id ?? ''
    const newReq = isIndefinite ? blankSkillReqIndefinite(skillId) : blankSkillReq(skillId, months)
    onChange({ ...activity, requirements: [...activity.requirements, newReq] })
  }

  const activityLabel = activity.name
    ? `Activity ${index + 1} · ${activity.name}`
    : `Activity ${index + 1}`
  const dateLabel = isIndefinite
    ? `${activity.start_month || '?'} → ongoing`
    : `${activity.start_month || '?'} → ${activity.end_month || '?'}`

  return (
    <div className="border border-border rounded overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="text-xs font-medium flex-1">{activityLabel}</span>
        <span className="text-xs text-gray-400">{dateLabel}</span>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-gray-300 hover:text-accent-red transition-colors ml-1"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <div className="px-3 py-3 flex flex-col gap-3">
          {readOnlyActivityHeader ? (
            /* Read-only activity header — Project-spawned Demand Submitted (§4.5.2) */
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
              <div><span className="font-medium text-gray-700">{activity.name || `Activity ${index + 1}`}</span></div>
              <div className="text-gray-400 italic">{activity.funding_source}{activity.funding_notes ? ` · ${activity.funding_notes}` : ''}</div>
              <div>{activity.start_month || '—'}</div>
              <div>{activity.end_month ?? 'ongoing (indefinite)'}</div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input label="Activity Name" value={activity.name} onChange={e => onChange({ ...activity, name: e.target.value })} placeholder="e.g. Design" />
                <Select label="Funding Source" value={activity.funding_source} onChange={e => onChange({ ...activity, funding_source: e.target.value as FundingSource })}>
                  {FUNDING_SOURCES.map(f => <option key={f}>{f}</option>)}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MonthYearPicker
                  label="Start Month"
                  value={activity.start_month}
                  onChange={handleStartChange}
                  placeholder="pick a month"
                />
                <div className="flex flex-col gap-1">
                  {!isIndefinite && (
                    <MonthYearPicker
                      label="End Month"
                      value={activity.end_month ?? ''}
                      onChange={handleEndChange}
                      minValue={activity.start_month || undefined}
                      placeholder="pick a month"
                    />
                  )}
                  {isIndefinite && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-gray-700">End Month</span>
                      <span className="text-xs text-gray-400 italic px-2 py-1.5">ongoing (indefinite)</span>
                    </div>
                  )}
                  {/* §2.2.2 date invalid — end before start */}
                  {!isIndefinite && activity.start_month && activity.end_month && activity.end_month < activity.start_month && (
                    <p className="text-[11px] text-accent-red">
                      End month must be the same as or later than the start month ({format(parseISO(activity.start_month + '-01'), 'MMM yyyy')}).
                    </p>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none mt-0.5">
                    <input
                      type="checkbox"
                      checked={isIndefinite}
                      onChange={e => handleIndefiniteToggle(e.target.checked)}
                      className="accent-brand"
                    />
                    No end date (indefinite)
                  </label>
                </div>
              </div>
              <Input label="Funding Notes" value={activity.funding_notes} onChange={e => onChange({ ...activity, funding_notes: e.target.value })} placeholder="e.g. IS-2026-04" />
            </>
          )}

          {/* Internal requirements */}
          {showRequirements && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Internal Requirements</span>
                <button onClick={addReq} className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover">
                  <Plus size={12} /> Add
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {activity.requirements.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No requirements yet.</p>
                )}
                {activity.requirements.map(req => (
                  isIndefinite ? (
                    <IndefiniteRequirementRow
                      key={req.id}
                      req={req}
                      onChange={r => updateReq(req.id, r)}
                      onDelete={() => deleteReq(req.id)}
                      scopedDomains={scopedDomains}
                      scopedSkills={scopedSkills}
                      crossFunctionMode={crossFunctionMode}
                      activeFunctions={activeFunctions}
                    />
                  ) : (
                    <RequirementRow
                      key={req.id}
                      req={req}
                      months={months}
                      onChange={r => updateReq(req.id, r)}
                      onDelete={() => deleteReq(req.id)}
                      scopedDomains={scopedDomains}
                      scopedSkills={scopedSkills}
                      crossFunctionMode={crossFunctionMode}
                      activeFunctions={activeFunctions}
                    />
                  )
                ))}
              </div>
            </div>
          )}

          {/* External Resource Requirements */}
          {showRequirements && (
            <div className="border-t border-dashed border-amber-200 pt-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-amber-600 uppercase tracking-wide">External Resource Requirements</span>
                <button
                  onClick={() => {
                    if (store.providers.length === 0) {
                      alert('No Providers configured. Add at least one Provider in Admin → Providers before adding external requirements.')
                      return
                    }
                    const newExt = blankExtReq(activity.id)
                    if (isIndefinite) {
                      newExt.steady_state_hours = 0
                    } else {
                      months.forEach(m => { newExt.hours_by_month[m] = 0 })
                    }
                    onExtReqsChange([...extReqs, newExt])
                  }}
                  className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                >
                  <Plus size={12} /> Add external requirement
                </button>
              </div>
              {extReqs.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {extReqs.map(ext =>
                    isIndefinite ? (
                      <IndefiniteExtRequirementRow
                        key={ext.id}
                        ext={ext}
                        onChange={updated => onExtReqsChange(extReqs.map(r => r.id === ext.id ? updated : r))}
                        onDelete={() => {
                          const totalHrs = isIndefinite ? (ext.steady_state_hours ?? 0) : Object.values(ext.hours_by_month).reduce((s, h) => s + h, 0)
                          if (totalHrs > 0 && !window.confirm(`Delete external requirement for ${store.providers.find(p => p.id === ext.provider_id)?.name ?? ext.provider_id} — ${ext.role}? This will remove ${totalHrs}h total.`)) return
                          onExtReqsChange(extReqs.filter(r => r.id !== ext.id))
                        }}
                        showFunctionTagPicker={showFunctionTagPicker}
                      />
                    ) : (
                      <ExtRequirementRow
                        key={ext.id}
                        ext={ext}
                        months={months}
                        onChange={updated => onExtReqsChange(extReqs.map(r => r.id === ext.id ? updated : r))}
                        onDelete={() => {
                          const totalHrs = Object.values(ext.hours_by_month).reduce((s, h) => s + h, 0)
                          if (totalHrs > 0 && !window.confirm(`Delete external requirement for ${store.providers.find(p => p.id === ext.provider_id)?.name ?? ext.provider_id} — ${ext.role}? This will remove ${totalHrs}h total.`)) return
                          onExtReqsChange(extReqs.filter(r => r.id !== ext.id))
                        }}
                        showFunctionTagPicker={showFunctionTagPicker}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
