import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, ArrowLeft } from 'lucide-react'
import { parseISO, isAfter, differenceInMonths } from 'date-fns'
import { useAppStore } from '../../store/useAppStore'
import type { DemandItem, Phase, Requirement, DemandStatus, FundingSource, DemandType, Level, SkillRequirement } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { StatusBadge } from '../../components/ui/Badge'
import { generateId } from '../../utils/ids'
import { generateMonths, formatMonthLabel } from '../../utils/capacity'

const TYPES: DemandType[] = ['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU']
const FUNDING_SOURCES: FundingSource[] = ['Investment Scheme', 'Plant/Sector Allocation', 'Mixed']
const LEVELS: Level[] = ['Basic', 'Advanced', 'Specialist']

function statusTransitions(status: DemandStatus): Array<{ label: string; next: DemandStatus }> {
  switch (status) {
    case 'Draft':     return [{ label: 'Submit', next: 'Submitted' }, { label: 'Park', next: 'Parked' }]
    case 'Submitted': return [{ label: 'Accept', next: 'Accepted' }, { label: 'Back to Draft', next: 'Draft' }, { label: 'Park', next: 'Parked' }]
    case 'Accepted':  return [{ label: 'Move to Allocated', next: 'Allocated' }, { label: 'Back to Submitted', next: 'Submitted' }, { label: 'Park', next: 'Parked' }]
    case 'Allocated': return [{ label: 'Back to Accepted', next: 'Accepted' }, { label: 'Park', next: 'Parked' }]
    case 'Parked':    return [{ label: 'Revive to Submitted', next: 'Submitted' }]
  }
}

function blankDemand(themeId: string): Omit<DemandItem, 'id'> {
  return { name: '', type: 'Plant Project', status: 'Draft', owner: '', primary_theme_id: themeId, description: '', parked_reason: null, phases: [] }
}

function blankPhase(): Phase {
  return { id: generateId('phs'), name: '', start_month: '', end_month: '', funding_source: 'Investment Scheme', funding_notes: '', requirements: [] }
}

function blankSkillReq(skillId: string, months: string[]): SkillRequirement {
  const hours_by_month: Record<string, number> = {}
  months.forEach(m => { hours_by_month[m] = 0 })
  return { id: generateId('req'), shape: 'skill', skill_id: skillId, level: 'Basic', hours_by_month, notes: null }
}

function getMonths(start: string, end: string): string[] {
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
    return { ...req, hours_by_month: hbm }
  })
}

// ─── Requirement row ────────────────────────────────────────────────────────

interface ReqRowProps {
  req: Requirement
  months: string[]
  onChange: (r: Requirement) => void
  onDelete: () => void
}

function RequirementRow({ req, months, onChange, onDelete }: ReqRowProps) {
  const { skills, people } = useAppStore()
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
      {/* Selectors row */}
      <div className="flex items-center gap-2 flex-wrap">
        {req.shape === 'skill' ? (
          <>
            <select
              value={req.skill_id}
              onChange={e => onChange({ ...req, skill_id: e.target.value } as SkillRequirement)}
              className="flex-1 min-w-[140px] text-xs border border-border rounded px-1.5 py-1 bg-white"
            >
              {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select
              value={req.level}
              onChange={e => onChange({ ...req, level: e.target.value as Level } as SkillRequirement)}
              className="text-xs border border-border rounded px-1.5 py-1 bg-white"
            >
              {LEVELS.map(l => <option key={l}>{l}</option>)}
            </select>
          </>
        ) : (
          <span className="text-xs text-gray-500 italic flex-1">
            Named: {people.find(p => p.id === req.person_id)?.name ?? req.person_id}
          </span>
        )}
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

      {/* Per-month grid */}
      {months.length > 0 && (
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
      )}
      {months.length === 0 && (
        <p className="text-xs text-gray-400 italic">Set phase start/end months to enter hours.</p>
      )}

      {/* Fill all */}
      {months.length > 0 && (
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
      )}
    </div>
  )
}

// ─── Phase editor ────────────────────────────────────────────────────────────

interface PhaseEditorProps {
  phase: Phase
  onChange: (p: Phase) => void
  onDelete: () => void
}

function PhaseEditor({ phase, onChange, onDelete }: PhaseEditorProps) {
  const [open, setOpen] = useState(true)
  const store = useAppStore()

  const months = useMemo(() => getMonths(phase.start_month, phase.end_month), [phase.start_month, phase.end_month])

  const handleMonthBoundaryChange = (field: 'start_month' | 'end_month', value: string) => {
    const newStart = field === 'start_month' ? value : phase.start_month
    const newEnd   = field === 'end_month'   ? value : phase.end_month
    const newMonths = getMonths(newStart, newEnd)
    const updatedReqs = newMonths.length > 0 ? adjustRequirements(phase.requirements, newMonths) : phase.requirements
    onChange({ ...phase, [field]: value, requirements: updatedReqs })
  }

  const updateReq = (reqId: string, r: Requirement) =>
    onChange({ ...phase, requirements: phase.requirements.map(x => x.id === reqId ? r : x) })
  const deleteReq = (reqId: string) =>
    onChange({ ...phase, requirements: phase.requirements.filter(x => x.id !== reqId) })
  const addReq = () =>
    onChange({ ...phase, requirements: [...phase.requirements, blankSkillReq(store.skills[0]?.id ?? '', months)] })

  return (
    <div className="border border-border rounded overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="text-xs font-medium flex-1">{phase.name || 'Unnamed Phase'}</span>
        <span className="text-xs text-gray-400">{phase.start_month} → {phase.end_month}</span>
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
              onChange={e => handleMonthBoundaryChange('start_month', e.target.value)}
              placeholder="2026-05"
            />
            <Input
              label="End Month (YYYY-MM)"
              value={phase.end_month}
              onChange={e => handleMonthBoundaryChange('end_month', e.target.value)}
              placeholder="2026-08"
            />
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
                <RequirementRow
                  key={req.id}
                  req={req}
                  months={months}
                  onChange={r => updateReq(req.id, r)}
                  onDelete={() => deleteReq(req.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main edit page ──────────────────────────────────────────────────────────

export default function DemandEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useAppStore()

  const isNew = !id
  const existing = id ? store.demandItems.find(d => d.id === id) : null

  const [draft, setDraft] = useState<Omit<DemandItem, 'id'>>(() =>
    existing ? { ...existing } : blankDemand(store.themes[0]?.id ?? '')
  )
  const [isDirty, setIsDirty] = useState(false)
  const [showParkReason, setShowParkReason] = useState(false)

  const update = (fn: (d: Omit<DemandItem, 'id'>) => Omit<DemandItem, 'id'>) => {
    setDraft(fn)
    setIsDirty(true)
  }

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const hasUnresolvedSkillReqs = draft.status === 'Allocated' &&
    draft.phases.some(p => p.requirements.some(r => r.shape === 'skill'))

  const handleSave = () => {
    if (isNew) {
      store.addDemandItem(draft as Omit<DemandItem, 'id'>)
    } else if (id) {
      store.updateDemandItem(id, draft)
    }
    setIsDirty(false)
    navigate('/demand')
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    navigate('/demand')
  }

  const handleStatusChange = (next: DemandStatus) => {
    if (next === 'Parked') setShowParkReason(true)
    update(d => ({ ...d, status: next, parked_reason: next === 'Parked' ? d.parked_reason : null }))
    if (!isNew && id) {
      store.updateDemandItem(id, { status: next, parked_reason: next === 'Parked' ? draft.parked_reason : null })
    }
  }

  const updatePhase = (phaseId: string, p: Phase) =>
    update(d => ({ ...d, phases: d.phases.map(x => x.id === phaseId ? p : x) }))
  const deletePhase = (phaseId: string) =>
    update(d => ({ ...d, phases: d.phases.filter(x => x.id !== phaseId) }))
  const addPhase = () =>
    update(d => ({ ...d, phases: [...d.phases, blankPhase()] }))

  const trans = statusTransitions(draft.status as DemandStatus)

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={handleCancel} className="text-gray-400 hover:text-near-black transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <StatusBadge status={draft.status as DemandStatus} />
            <span className="text-sm font-semibold text-near-black">
              {isNew ? 'New Demand Item' : (draft.name || 'Unnamed')}
            </span>
            {isDirty && <span className="text-xs text-amber-600 font-medium">Unsaved</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleSave}>Save</Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-5 flex flex-col gap-5">

          {hasUnresolvedSkillReqs && (
            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded p-2.5 text-xs text-yellow-700">
              <AlertTriangle size={14} />
              Allocated status has unresolved skill-shaped requirements.
            </div>
          )}

          {/* Core fields */}
          <div className="flex flex-col gap-3">
            <Input
              label="Name"
              value={draft.name}
              onChange={e => update(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Plant B MES Phase 2 Rollout"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Type" value={draft.type} onChange={e => update(d => ({ ...d, type: e.target.value as DemandType }))}>
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </Select>
              <Select label="Primary Theme" value={draft.primary_theme_id} onChange={e => update(d => ({ ...d, primary_theme_id: e.target.value }))}>
                {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <Input label="Owner" value={draft.owner} onChange={e => update(d => ({ ...d, owner: e.target.value }))} placeholder="Name or role" />
            <Textarea label="Description" value={draft.description} onChange={e => update(d => ({ ...d, description: e.target.value }))} placeholder="Brief description" />
            {(draft.status === 'Parked' || showParkReason) && (
              <Textarea
                label="Parked Reason"
                value={draft.parked_reason ?? ''}
                onChange={e => update(d => ({ ...d, parked_reason: e.target.value || null }))}
                placeholder="Why is this parked? When might it be revived?"
              />
            )}
          </div>

          {/* Status transitions */}
          {!isNew && (
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 block mb-2">Status</span>
              <div className="flex flex-wrap gap-2">
                {trans.map(t => (
                  <Button key={t.label} size="sm" variant="secondary" onClick={() => handleStatusChange(t.next)}>
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Phases */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">Phases</span>
              <button onClick={addPhase} className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                <Plus size={12} /> Add Phase
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {draft.phases.length === 0 && (
                <p className="text-xs text-gray-400 italic">No phases yet. Add a phase to define resource requirements.</p>
              )}
              {draft.phases.map(phase => (
                <PhaseEditor
                  key={phase.id}
                  phase={phase}
                  onChange={p => updatePhase(phase.id, p)}
                  onDelete={() => deletePhase(phase.id)}
                />
              ))}
            </div>
          </div>

          {/* Save/Cancel footer repeat for long forms */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={handleSave}>Save</Button>
          </div>

        </div>
      </div>
    </div>
  )
}
