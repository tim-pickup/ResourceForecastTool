import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2, X } from 'lucide-react'
import { parseISO, isAfter, differenceInMonths, addMonths, format } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import type { DemandStatus, Phase, Requirement, FundingSource, Level, SkillRequirement, ExternalResourceRequirement } from '../../types'
import { Input, Select } from '../../components/ui/FormFields'
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

// ─── Phase Gantt ─────────────────────────────────────────────────────────────

interface GanttProps {
  phases: Phase[]
  onClickPhase: (phaseId: string) => void
  readOnly?: boolean
}

export function PhaseGantt({ phases, onClickPhase, readOnly = false }: GanttProps) {
  const validPhases = phases.filter(p => p.start_month)
  if (validPhases.length === 0) return null

  const starts = validPhases.map(p => p.start_month).sort()
  const finiteEnds = validPhases.filter(p => p.end_month).map(p => p.end_month!).sort()
  const hasIndefinite = validPhases.some(p => !p.end_month)

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

  const sortedPhases = [...validPhases].sort((a, b) => a.start_month.localeCompare(b.start_month))

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
  const usedSources = Array.from(new Set(validPhases.map(p => p.funding_source)))

  return (
    <div className="bg-gray-50 border border-border rounded p-3 mb-3">
      {/* Header with legend */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Phase Timeline{readOnly && <span className="ml-1.5 font-normal normal-case tracking-normal text-gray-400">(read only)</span>}
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
          {/* Phase bars — with vertical padding above first bar and below last bar */}
          <div className="flex flex-col gap-1" style={{ paddingTop: 7, paddingBottom: 10 }}>
            {sortedPhases.map((phase) => {
              const origIdx = phases.indexOf(phase)
              const startOff = monthOff(phase.start_month)
              const isIndefinite = !phase.end_month
              const endOff = isIndefinite
                ? totalMonths - 1
                : Math.min(monthOff(phase.end_month!), totalMonths - 1)
              const leftPct = (startOff / (totalMonths - 1)) * 100
              const widthPct = Math.max(((endOff - startOff) / (totalMonths - 1)) * 100, 3)
              const color = FUNDING_SOURCE_COLORS[phase.funding_source] ?? '#6b7280'
              const label = phase.name || `Phase ${origIdx + 1}`
              const dateLabel = isIndefinite
                ? `${phase.start_month} → ongoing`
                : `${phase.start_month} → ${phase.end_month}`

              return (
                <div key={phase.id} className="relative h-7">
                  <button
                    type="button"
                    onClick={() => onClickPhase(phase.id)}
                    title={`${label} · ${dateLabel} · ${phase.funding_source}`}
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
  return { id: generateId('req'), shape: 'skill', skill_id: skillId, level: 'Basic', hours_by_month, steady_state_hours: null, notes: null, allocations: [], owningTeamId: null }
}

export function blankSkillReqIndefinite(skillId: string): SkillRequirement {
  return { id: generateId('req'), shape: 'skill', skill_id: skillId, level: 'Basic', hours_by_month: {}, steady_state_hours: 0, notes: null, allocations: [], owningTeamId: null }
}

export function blankPhase(): Phase {
  return { id: generateId('phs'), name: '', start_month: '', end_month: '', funding_source: 'Investment Scheme', funding_notes: '', requirements: [] }
}

// ─── Requirement row (finite) ─────────────────────────────────────────────────

type AssignedTeam = { id: string; name: string; functionId: string }

interface ReqRowProps {
  req: SkillRequirement
  months: string[]
  onChange: (r: SkillRequirement) => void
  onDelete: () => void
  assignedTeams?: AssignedTeam[]
}

function RequirementRow({ req, months, onChange, onDelete, assignedTeams = [] }: ReqRowProps) {
  const { skills, domains, activeFunctionId } = useAppStore()
  const [fillVal, setFillVal] = useState(0)

  const totalHrs = months.reduce((s, m) => s + (req.hours_by_month[m] ?? 0), 0)

  // Scope DomainSkillSelector to owning team's Function, or active Function if no owning team (§4.5.2)
  const owningTeam = req.owningTeamId ? assignedTeams.find(t => t.id === req.owningTeamId) : null
  const scopingFnId = owningTeam?.functionId ?? activeFunctionId
  const scopedDomains = scopingFnId ? domains.filter(d => d.functionId === scopingFnId) : domains
  const scopedDomainIds = new Set(scopedDomains.map(d => d.id))
  const scopedSkills = skills.filter(s => scopedDomainIds.has(s.domain_id))

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
        {assignedTeams.length > 0 && (
          <select
            value={req.owningTeamId ?? ''}
            onChange={e => onChange({ ...req, owningTeamId: e.target.value || null })}
            className="text-xs border border-border rounded px-1.5 py-1 bg-white"
            title="Owning team"
          >
            <option value="">— Owning Team —</option>
            {assignedTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <div className="flex-1 min-w-[160px]">
          <DomainSkillSelector
            value={req.skill_id}
            onChange={id => onChange({ ...req, skill_id: id })}
            domains={scopedDomains}
            skills={scopedSkills}
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

function IndefiniteRequirementRow({ req, onChange, onDelete, assignedTeams = [] }: { req: SkillRequirement; onChange: (r: SkillRequirement) => void; onDelete: () => void; assignedTeams?: AssignedTeam[] }) {
  const { skills, domains, activeFunctionId } = useAppStore()

  const owningTeam = req.owningTeamId ? assignedTeams.find(t => t.id === req.owningTeamId) : null
  const scopingFnId = owningTeam?.functionId ?? activeFunctionId
  const scopedDomains = scopingFnId ? domains.filter(d => d.functionId === scopingFnId) : domains
  const scopedDomainIds = new Set(scopedDomains.map(d => d.id))
  const scopedSkills = skills.filter(s => scopedDomainIds.has(s.domain_id))

  return (
    <div className="border border-border rounded p-2.5 bg-gray-50/50 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {assignedTeams.length > 0 && (
          <select
            value={req.owningTeamId ?? ''}
            onChange={e => onChange({ ...req, owningTeamId: e.target.value || null })}
            className="text-xs border border-border rounded px-1.5 py-1 bg-white"
            title="Owning team"
          >
            <option value="">— Owning Team —</option>
            {assignedTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <div className="flex-1 min-w-[160px]">
          <DomainSkillSelector
            value={req.skill_id}
            onChange={id => onChange({ ...req, skill_id: id })}
            domains={scopedDomains}
            skills={scopedSkills}
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

export function blankExtReq(phase_id: string): ExternalResourceRequirement {
  return {
    id: generateId('ext'),
    phase_id,
    provider_id: '',
    role: '',
    notes: null,
    hours_by_month: {},
    steady_state_hours: null,
  }
}

// External requirement row — finite phase (per-month hours grid)
interface ExtReqRowProps {
  ext: ExternalResourceRequirement
  months: string[]
  onChange: (e: ExternalResourceRequirement) => void
  onDelete: () => void
}

function ExtRequirementRow({ ext, months, onChange, onDelete }: ExtReqRowProps) {
  const { providers } = useAppStore()
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
function IndefiniteExtRequirementRow({ ext, onChange, onDelete }: { ext: ExternalResourceRequirement; onChange: (e: ExternalResourceRequirement) => void; onDelete: () => void }) {
  const { providers } = useAppStore()

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

// ─── Phase editor ─────────────────────────────────────────────────────────────

interface PhaseEditorProps {
  phase: Phase
  index: number
  onChange: (p: Phase) => void
  onDelete: () => void
  extReqs: ExternalResourceRequirement[]
  onExtReqsChange: (reqs: ExternalResourceRequirement[]) => void
  demandId?: string
  demandStatus?: DemandStatus
}

export function PhaseEditor({ phase, index, onChange, onDelete, extReqs, onExtReqsChange, demandId, demandStatus }: PhaseEditorProps) {
  const [open, setOpen] = useState(true)
  const [teamSearch, setTeamSearch] = useState('')
  const [teamPickerOpen, setTeamPickerOpen] = useState(false)
  const teamInputRef = useRef<HTMLInputElement>(null)
  const teamDropdownRef = useRef<HTMLDivElement>(null)
  const [teamDropdownStyle, setTeamDropdownStyle] = useState<React.CSSProperties>({})
  const store = useAppStore()

  // Teams visible from Draft onwards (§4.5.2 v1.17 — changed from Scoping onwards)
  const showTeamsSection = (
    demandStatus === 'Draft' || demandStatus === 'Scoping' ||
    demandStatus === 'Submitted' || demandStatus === 'Parked'
  ) && !!demandId
  // Editable in Draft and Scoping; read-only in Submitted and Parked
  const isTeamsEditable = (demandStatus === 'Draft' || demandStatus === 'Scoping') && !!demandId
  const isScoping = demandStatus === 'Scoping' && !!demandId
  // Requirements visible from Scoping onwards (hidden in Draft per §4.5.2 v1.17)
  const showRequirements = demandStatus !== 'Draft'

  const phaseAssignments = showTeamsSection
    ? store.demandTeamAssignments.filter(a => a.demandId === demandId && a.phaseId === phase.id)
    : []
  const assignedTeamIds = new Set(phaseAssignments.map(a => a.teamId))
  const assignedTeams = store.teams.filter(t => assignedTeamIds.has(t.id))

  // Sorted assigned teams by Function name then team name
  const sortedAssignedTeams = useMemo(() =>
    [...assignedTeams].sort((a, b) => {
      const fnA = store.functions.find(f => f.id === a.functionId)?.name ?? ''
      const fnB = store.functions.find(f => f.id === b.functionId)?.name ?? ''
      return fnA !== fnB ? fnA.localeCompare(fnB) : a.name.localeCompare(b.name)
    }),
    [assignedTeams, store.functions]
  )

  // Picker dropdown: groups unassigned active teams by Function, filtered by search
  const pickerGroups = useMemo(() => {
    if (!isTeamsEditable) return []
    const searchLower = teamSearch.toLowerCase()
    const unassigned = store.teams.filter(t => t.active && !assignedTeamIds.has(t.id))
    const filtered = unassigned.filter(t => {
      if (!searchLower) return true
      const fn = store.functions.find(f => f.id === t.functionId)
      return t.name.toLowerCase().includes(searchLower) || (fn?.name.toLowerCase().includes(searchLower) ?? false)
    })
    const groups = new Map<string, { fnName: string; fnId: string; teams: typeof filtered }>()
    for (const team of filtered) {
      const fn = store.functions.find(f => f.id === team.functionId)
      const key = team.functionId
      if (!groups.has(key)) groups.set(key, { fnName: fn?.name ?? 'Unknown Function', fnId: key, teams: [] })
      groups.get(key)!.teams.push(team)
    }
    return [...groups.values()].sort((a, b) => a.fnName.localeCompare(b.fnName))
  }, [teamSearch, store.teams, store.functions, assignedTeamIds, isTeamsEditable])

  // Portal positioning for team picker dropdown
  useEffect(() => {
    if (!teamPickerOpen) return
    function updatePos() {
      if (!teamInputRef.current) return
      const rect = teamInputRef.current.getBoundingClientRect()
      setTeamDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
      })
    }
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [teamPickerOpen])

  // Close picker on outside click
  useEffect(() => {
    if (!teamPickerOpen) return
    function handler(e: MouseEvent) {
      const target = e.target as Node
      if (teamInputRef.current?.contains(target) || teamDropdownRef.current?.contains(target)) return
      setTeamPickerOpen(false)
      setTeamSearch('')
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [teamPickerOpen])

  function handleTeamSelect(teamId: string) {
    if (!demandId) return
    store.addDemandTeamAssignment({ demandId, phaseId: phase.id, teamId, confirmed: false, confirmedBy: null, confirmedAt: null })
    setTeamSearch('')
    setTeamPickerOpen(false)
  }

  function handleTeamRemove(teamId: string) {
    if (!demandId) return
    const existing = phaseAssignments.find(a => a.teamId === teamId)
    if (!existing) return
    const reqCount = phase.requirements.filter(r => r.owningTeamId === teamId).length
    if (
      reqCount > 0 &&
      !window.confirm(`This team has ${reqCount} requirement${reqCount !== 1 ? 's' : ''} on this phase. Removing the team will unlink those requirements but not delete them. Continue?`)
    ) return
    store.deleteDemandTeamAssignment(existing.id)
    if (reqCount > 0) {
      onChange({ ...phase, requirements: phase.requirements.map(r => r.owningTeamId === teamId ? { ...r, owningTeamId: null } : r) })
    }
  }

  function handleConfirm(teamId: string) {
    if (!demandId) return
    const assignment = phaseAssignments.find(a => a.teamId === teamId)
    if (!assignment) return
    store.updateDemandTeamAssignment(assignment.id, {
      confirmed: true,
      confirmedBy: 'Team Lead',
      confirmedAt: new Date().toISOString(),
    })
  }

  const isIndefinite = phase.end_month === null
  const months = useMemo(() => getMonths(phase.start_month, phase.end_month), [phase.start_month, phase.end_month])

  const handleStartChange = (value: string) => {
    const newMonths = getMonths(value, phase.end_month)
    const updatedReqs = !isIndefinite && newMonths.length > 0 ? adjustRequirements(phase.requirements, newMonths) : phase.requirements
    onChange({ ...phase, start_month: value, requirements: updatedReqs })
  }

  const handleEndChange = (value: string) => {
    const newMonths = getMonths(phase.start_month, value)
    const updatedReqs = newMonths.length > 0 ? adjustRequirements(phase.requirements, newMonths) : phase.requirements
    onChange({ ...phase, end_month: value, requirements: updatedReqs })
  }

  const handleIndefiniteToggle = (checked: boolean) => {
    if (checked) {
      const updatedReqs = requirementsToIndefinite(phase.requirements)
      onChange({ ...phase, end_month: null, requirements: updatedReqs })
    } else {
      const newEnd = window.prompt('End month (YYYY-MM):', '') ?? ''
      if (!newEnd) return
      const newMonths = getMonths(phase.start_month, newEnd)
      if (newMonths.length === 0) return
      const updatedReqs = requirementsToFinite(phase.requirements, newMonths, 0)
      onChange({ ...phase, end_month: newEnd, requirements: updatedReqs })
    }
  }

  const updateReq = (reqId: string, r: SkillRequirement) =>
    onChange({ ...phase, requirements: phase.requirements.map(x => x.id === reqId ? r : x) })
  const deleteReq = (reqId: string) =>
    onChange({ ...phase, requirements: phase.requirements.filter(x => x.id !== reqId) })
  const addReq = () => {
    const skillId = store.skills[0]?.id ?? ''
    const newReq = isIndefinite ? blankSkillReqIndefinite(skillId) : blankSkillReq(skillId, months)
    onChange({ ...phase, requirements: [...phase.requirements, newReq] })
  }

  const phaseLabel = phase.name
    ? `Phase ${index + 1} · ${phase.name}`
    : `Phase ${index + 1}`
  const dateLabel = isIndefinite
    ? `${phase.start_month || '?'} → ongoing`
    : `${phase.start_month || '?'} → ${phase.end_month || '?'}`

  const showPickerDropdown = teamPickerOpen && (pickerGroups.length > 0 || (teamSearch.length > 0 && pickerGroups.length === 0))

  return (
    <div className="border border-border rounded overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="text-xs font-medium flex-1">{phaseLabel}</span>
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
          <div className="grid grid-cols-2 gap-2">
            <Input label="Phase Name" value={phase.name} onChange={e => onChange({ ...phase, name: e.target.value })} placeholder="e.g. Design" />
            <Select label="Funding Source" value={phase.funding_source} onChange={e => onChange({ ...phase, funding_source: e.target.value as FundingSource })}>
              {FUNDING_SOURCES.map(f => <option key={f}>{f}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Start Month (YYYY-MM)"
              value={phase.start_month}
              onChange={e => handleStartChange(e.target.value)}
              placeholder="2026-05"
            />
            <div className="flex flex-col gap-1">
              <Input
                label="End Month (YYYY-MM)"
                value={phase.end_month ?? ''}
                onChange={e => handleEndChange(e.target.value)}
                placeholder="2026-08"
                disabled={isIndefinite}
              />
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
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
          <Input label="Funding Notes" value={phase.funding_notes} onChange={e => onChange({ ...phase, funding_notes: e.target.value })} placeholder="e.g. IS-2026-04" />

          {/* Teams Assigned — visible from Draft onwards (§4.5.2 v1.17) */}
          {showTeamsSection && (
            <div className="border border-purple-200 rounded p-2.5 bg-purple-50/40">
              <span className="text-xs font-medium text-purple-700 uppercase tracking-wide block mb-2">Teams Assigned</span>

              {/* Searchable combobox — editable in Draft and Scoping only */}
              {isTeamsEditable && (
                <div className="relative mb-2">
                  <input
                    ref={teamInputRef}
                    type="text"
                    value={teamSearch}
                    onChange={e => { setTeamSearch(e.target.value); setTeamPickerOpen(true) }}
                    onFocus={() => setTeamPickerOpen(true)}
                    placeholder="Add a team to this phase…"
                    className="w-full text-xs border border-border rounded px-2 py-1.5 bg-white placeholder:text-gray-400"
                  />
                  {showPickerDropdown && createPortal(
                    <div
                      ref={teamDropdownRef}
                      style={{ ...teamDropdownStyle, maxHeight: 200, overflowY: 'auto' }}
                      className="bg-white border border-border rounded shadow-lg"
                    >
                      {pickerGroups.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400 italic">No teams match "{teamSearch}"</div>
                      )}
                      {pickerGroups.map(group => (
                        <div key={group.fnId}>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 sticky top-0">
                            {group.fnName}
                          </div>
                          {group.teams.map(team => (
                            <button
                              key={team.id}
                              type="button"
                              onMouseDown={e => { e.preventDefault(); handleTeamSelect(team.id) }}
                              className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-purple-50 text-left"
                            >
                              <span className="font-medium text-near-black">{team.name}</span>
                              <span className="text-gray-400 text-[10px] ml-2">{group.fnName}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>,
                    document.body
                  )}
                </div>
              )}

              {/* Assigned list */}
              {sortedAssignedTeams.length === 0 ? (
                <p className="text-xs text-gray-400 italic">
                  {isTeamsEditable
                    ? 'No teams assigned. Add at least one team before submitting for scoping.'
                    : 'No teams assigned.'}
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-purple-100">
                  {sortedAssignedTeams.map(team => {
                    const fn = store.functions.find(f => f.id === team.functionId)
                    const fnColor = getFnColor(team.functionId, store.functions)
                    return (
                      <div key={team.id} className="flex items-center gap-2 py-1.5 text-xs first:pt-0 last:pb-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: fnColor }} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-near-black truncate">{team.name}</div>
                          {fn && <div className="text-[10px] text-gray-400 leading-tight">{fn.name}</div>}
                        </div>
                        {isTeamsEditable && (
                          <button
                            type="button"
                            onClick={() => handleTeamRemove(team.id)}
                            className="text-gray-300 hover:text-accent-red transition-colors shrink-0"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Confirm strip — Scoping only, below the assigned list */}
              {isScoping && phaseAssignments.filter(a => !a.confirmed).length > 0 && (
                <div className="mt-2 pt-2 border-t border-purple-200 flex flex-col gap-1.5">
                  {phaseAssignments.filter(a => !a.confirmed).map(a => {
                    const team = store.teams.find(t => t.id === a.teamId)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => handleConfirm(a.teamId)}
                        className="flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900 border border-purple-300 rounded px-2 py-1 bg-white hover:bg-purple-50 transition-colors self-start"
                      >
                        <CheckCircle2 size={11} />
                        Confirm requirements for {team?.name ?? a.teamId}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Internal requirements — hidden in Draft (§4.5.2 v1.17) */}
          {showRequirements && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Internal Requirements</span>
                <button onClick={addReq} className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover">
                  <Plus size={12} /> Add
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {phase.requirements.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No requirements yet.</p>
                )}
                {phase.requirements.map(req => (
                  isIndefinite ? (
                    <IndefiniteRequirementRow
                      key={req.id}
                      req={req}
                      onChange={r => updateReq(req.id, r)}
                      onDelete={() => deleteReq(req.id)}
                      assignedTeams={assignedTeams}
                    />
                  ) : (
                    <RequirementRow
                      key={req.id}
                      req={req}
                      months={months}
                      onChange={r => updateReq(req.id, r)}
                      onDelete={() => deleteReq(req.id)}
                      assignedTeams={assignedTeams}
                    />
                  )
                ))}
              </div>
            </div>
          )}

          {/* External Resource Requirements — hidden in Draft (§4.5.2 v1.17) */}
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
                    const newExt = blankExtReq(phase.id)
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
