import { useState, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { parseISO, isAfter, differenceInMonths } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import type { Phase, Requirement, FundingSource, Level, SkillRequirement } from '../../types'
import { Input, Select } from '../../components/ui/FormFields'
import { ThemeSkillSelector } from '../../components/ThemeSkillSelector'
import { generateId } from '../../utils/ids'
import { generateMonths, formatMonthLabel } from '../../utils/capacity'

const FUNDING_SOURCES: FundingSource[] = ['Investment Scheme', 'Plant/Sector Allocation', 'Mixed']
const LEVELS: Level[] = ['Basic', 'Advanced', 'Specialist']

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

export function blankPhase(): Phase {
  return { id: generateId('phs'), name: '', start_month: '', end_month: '', funding_source: 'Investment Scheme', funding_notes: '', requirements: [] }
}

// ─── Requirement row (finite) ─────────────────────────────────────────────────

interface ReqRowProps {
  req: SkillRequirement
  months: string[]
  onChange: (r: SkillRequirement) => void
  onDelete: () => void
}

function RequirementRow({ req, months, onChange, onDelete }: ReqRowProps) {
  const { skills, themes } = useAppStore()
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
          <ThemeSkillSelector
            value={req.skill_id}
            onChange={id => onChange({ ...req, skill_id: id })}
            themes={themes}
            skills={skills}
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

function IndefiniteRequirementRow({ req, onChange, onDelete }: { req: SkillRequirement; onChange: (r: SkillRequirement) => void; onDelete: () => void }) {
  const { skills, themes } = useAppStore()

  return (
    <div className="border border-border rounded p-2.5 bg-gray-50/50 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <ThemeSkillSelector
            value={req.skill_id}
            onChange={id => onChange({ ...req, skill_id: id })}
            themes={themes}
            skills={skills}
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

// ─── Phase editor ─────────────────────────────────────────────────────────────

interface PhaseEditorProps {
  phase: Phase
  index: number
  onChange: (p: Phase) => void
  onDelete: () => void
}

export function PhaseEditor({ phase, index, onChange, onDelete }: PhaseEditorProps) {
  const [open, setOpen] = useState(true)
  const store = useAppStore()

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
      // Going finite → indefinite: convert hours_by_month to steady_state_hours
      const updatedReqs = requirementsToIndefinite(phase.requirements)
      onChange({ ...phase, end_month: null, requirements: updatedReqs })
    } else {
      // Going indefinite → finite: prompt for end month, pre-fill per-month
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

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Requirements</span>
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
                  />
                ) : (
                  <RequirementRow
                    key={req.id}
                    req={req}
                    months={months}
                    onChange={r => updateReq(req.id, r)}
                    onDelete={() => deleteReq(req.id)}
                  />
                )
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
