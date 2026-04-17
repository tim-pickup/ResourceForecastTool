import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Trash2, Copy, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { DemandItem, Phase, Requirement, DemandStatus, FundingSource, DemandType, Level, SkillRequirement, NamedRequirement } from '../../types'
import { Button } from '../ui/Button'
import { Input, Select, Textarea } from '../ui/FormFields'
import { StatusBadge } from '../ui/Badge'
import { generateId } from '../../utils/ids'
import { clsx } from 'clsx'

interface DemandEditorProps {
  demandId: string | null
  onClose: () => void
  onCreated?: (id: string) => void
}

const STATUSES: DemandStatus[] = ['Draft', 'Submitted', 'Accepted', 'Allocated', 'Parked']
const TYPES: DemandType[] = ['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU']
const FUNDING_SOURCES: FundingSource[] = ['Investment Scheme', 'Plant/Sector Allocation', 'Mixed']
const LEVELS: Level[] = ['Basic', 'Advanced', 'Specialist']

function statusTransitions(status: DemandStatus): Array<{ label: string; next: DemandStatus | 'delete' | 'duplicate' }> {
  switch (status) {
    case 'Draft': return [
      { label: 'Submit', next: 'Submitted' },
      { label: 'Park', next: 'Parked' },
    ]
    case 'Submitted': return [
      { label: 'Accept', next: 'Accepted' },
      { label: 'Back to Draft', next: 'Draft' },
      { label: 'Park', next: 'Parked' },
    ]
    case 'Accepted': return [
      { label: 'Move to Allocated', next: 'Allocated' },
      { label: 'Back to Submitted', next: 'Submitted' },
      { label: 'Park', next: 'Parked' },
    ]
    case 'Allocated': return [
      { label: 'Back to Accepted', next: 'Accepted' },
      { label: 'Park', next: 'Parked' },
    ]
    case 'Parked': return [
      { label: 'Revive to Submitted', next: 'Submitted' },
    ]
  }
}

function blankDemand(themes: { id: string }[]): Omit<DemandItem, 'id'> {
  return {
    name: '',
    type: 'Plant Project',
    status: 'Draft',
    owner: '',
    primary_theme_id: themes[0]?.id ?? '',
    description: '',
    parked_reason: null,
    phases: [],
  }
}

function blankPhase(): Phase {
  return {
    id: generateId('phs'),
    name: '',
    start_month: '',
    end_month: '',
    funding_source: 'Investment Scheme',
    funding_notes: '',
    requirements: [],
  }
}

function blankSkillReq(skillId: string): SkillRequirement {
  return { id: generateId('req'), shape: 'skill', skill_id: skillId, level: 'Basic', hours_per_month: 0, notes: null }
}

function blankNamedReq(personId: string): NamedRequirement {
  return { id: generateId('req'), shape: 'named', person_id: personId, hours_per_month: 0, notes: null }
}

interface ReqEditorProps {
  req: Requirement
  onChange: (r: Requirement) => void
  onDelete: () => void
}

function RequirementRow({ req, onChange, onDelete }: ReqEditorProps) {
  const { skills, people } = useAppStore()

  return (
    <div className="border border-border rounded p-2.5 flex flex-col gap-2 bg-gray-50/50">
      <div className="flex items-center gap-2">
        <select
          value={req.shape}
          onChange={e => {
            const shape = e.target.value as 'skill' | 'named'
            if (shape === 'skill') {
              onChange({ id: req.id, shape: 'skill', skill_id: skills[0]?.id ?? '', level: 'Basic', hours_per_month: req.hours_per_month, notes: req.notes })
            } else {
              onChange({ id: req.id, shape: 'named', person_id: people[0]?.id ?? '', hours_per_month: req.hours_per_month, notes: req.notes })
            }
          }}
          className="text-xs border border-border rounded px-1.5 py-1 bg-white"
        >
          <option value="skill">Skill</option>
          <option value="named">Named</option>
        </select>

        {req.shape === 'skill' ? (
          <>
            <select
              value={req.skill_id}
              onChange={e => onChange({ ...req, skill_id: e.target.value } as SkillRequirement)}
              className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-white"
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
          <select
            value={req.person_id}
            onChange={e => onChange({ ...req, person_id: e.target.value } as NamedRequirement)}
            className="flex-1 text-xs border border-border rounded px-1.5 py-1 bg-white"
          >
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <input
          type="number"
          value={req.hours_per_month}
          onChange={e => onChange({ ...req, hours_per_month: Number(e.target.value) })}
          className="w-16 text-xs border border-border rounded px-1.5 py-1 text-right"
          placeholder="hrs"
          min={0}
        />
        <span className="text-xs text-gray-400">h/mo</span>
        <button onClick={onDelete} className="text-gray-300 hover:text-accent-red transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
      <input
        type="text"
        value={req.notes ?? ''}
        onChange={e => onChange({ ...req, notes: e.target.value || null })}
        placeholder="Notes (optional)"
        className="text-xs border border-border rounded px-1.5 py-1 bg-white"
      />
    </div>
  )
}

interface PhaseEditorProps {
  phase: Phase
  onChange: (p: Phase) => void
  onDelete: () => void
  skills: { id: string }[]
  people: { id: string }[]
}

function PhaseEditor({ phase, onChange, onDelete, skills, people }: PhaseEditorProps) {
  const [open, setOpen] = useState(true)

  const updateReq = (reqId: string, r: Requirement) =>
    onChange({ ...phase, requirements: phase.requirements.map(x => x.id === reqId ? r : x) })
  const deleteReq = (reqId: string) =>
    onChange({ ...phase, requirements: phase.requirements.filter(x => x.id !== reqId) })
  const addReq = () =>
    onChange({ ...phase, requirements: [...phase.requirements, blankSkillReq(skills[0]?.id ?? '')] })

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
            <Input
              label="Phase Name"
              value={phase.name}
              onChange={e => onChange({ ...phase, name: e.target.value })}
              placeholder="e.g. Design"
            />
            <Select
              label="Funding Source"
              value={phase.funding_source}
              onChange={e => onChange({ ...phase, funding_source: e.target.value as FundingSource })}
            >
              {FUNDING_SOURCES.map(f => <option key={f}>{f}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Start Month (YYYY-MM)"
              value={phase.start_month}
              onChange={e => onChange({ ...phase, start_month: e.target.value })}
              placeholder="2026-05"
            />
            <Input
              label="End Month (YYYY-MM)"
              value={phase.end_month}
              onChange={e => onChange({ ...phase, end_month: e.target.value })}
              placeholder="2026-08"
            />
          </div>
          <Input
            label="Funding Notes"
            value={phase.funding_notes}
            onChange={e => onChange({ ...phase, funding_notes: e.target.value })}
            placeholder="e.g. IS-2026-04"
          />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Requirements</span>
              <button
                onClick={addReq}
                className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
              >
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

export function DemandEditor({ demandId, onClose, onCreated }: DemandEditorProps) {
  const store = useAppStore()
  const isNew = demandId === null
  const existing = demandId ? store.demandItems.find(d => d.id === demandId) : null

  const [draft, setDraft] = useState<Omit<DemandItem, 'id'>>(() =>
    existing ? { ...existing } : blankDemand(store.themes)
  )
  const [showParkReason, setShowParkReason] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (existing) setDraft({ ...existing })
  }, [demandId])

  const hasUnresolvedSkillReqs = draft.status === 'Allocated' &&
    draft.phases.some(p => p.requirements.some(r => r.shape === 'skill'))

  const save = useCallback(() => {
    if (isNew) {
      store.addDemandItem(draft as Omit<DemandItem, 'id'>)
    } else if (demandId) {
      store.updateDemandItem(demandId, draft)
    }
  }, [isNew, demandId, draft, store])

  useEffect(() => {
    const timer = setTimeout(save, 500)
    return () => clearTimeout(timer)
  }, [draft])

  const handleStatusChange = (next: DemandStatus) => {
    if (next === 'Parked') setShowParkReason(true)
    setDraft(d => ({ ...d, status: next, parked_reason: next === 'Parked' ? d.parked_reason : null }))
  }

  const handleDelete = () => {
    if (demandId) store.deleteDemandItem(demandId)
    onClose()
  }

  const handleDuplicate = () => {
    if (demandId) {
      store.duplicateDemandItem(demandId)
      onClose()
    }
  }

  const updatePhase = (phaseId: string, p: Phase) =>
    setDraft(d => ({ ...d, phases: d.phases.map(x => x.id === phaseId ? p : x) }))
  const deletePhase = (phaseId: string) =>
    setDraft(d => ({ ...d, phases: d.phases.filter(x => x.id !== phaseId) }))
  const addPhase = () =>
    setDraft(d => ({ ...d, phases: [...d.phases, blankPhase()] }))

  const transitions = statusTransitions(draft.status as DemandStatus)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="w-[480px] bg-white border-l border-border flex flex-col shadow-panel overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <StatusBadge status={draft.status as DemandStatus} />
            <span className="text-sm font-semibold text-near-black truncate max-w-[280px]">
              {draft.name || (isNew ? 'New Demand Item' : 'Unnamed')}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-near-black transition-colors p-0.5 rounded">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
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
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Plant B MES Phase 2 Rollout"
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Type"
                value={draft.type}
                onChange={e => setDraft(d => ({ ...d, type: e.target.value as DemandType }))}
              >
                {TYPES.map(t => <option key={t}>{t}</option>)}
              </Select>
              <Select
                label="Primary Theme"
                value={draft.primary_theme_id}
                onChange={e => setDraft(d => ({ ...d, primary_theme_id: e.target.value }))}
              >
                {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <Input
              label="Owner"
              value={draft.owner}
              onChange={e => setDraft(d => ({ ...d, owner: e.target.value }))}
              placeholder="Name or role"
            />
            <Textarea
              label="Description"
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              placeholder="Brief description of this demand item"
            />
            {(draft.status === 'Parked' || showParkReason) && (
              <Textarea
                label="Parked Reason"
                value={draft.parked_reason ?? ''}
                onChange={e => setDraft(d => ({ ...d, parked_reason: e.target.value || null }))}
                placeholder="Why is this parked? When might it be revived?"
              />
            )}
          </div>

          {/* Phases */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">Phases</span>
              <button
                onClick={addPhase}
                className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium"
              >
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
                  skills={store.skills}
                  people={store.people}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer — status transitions */}
        <div className="border-t border-border px-5 py-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {transitions.map(t => (
              <Button
                key={t.label}
                size="sm"
                variant={t.next === 'Allocated' ? 'primary' : t.next === 'Parked' ? 'secondary' : 'secondary'}
                onClick={() => handleStatusChange(t.next as DemandStatus)}
              >
                {t.label}
              </Button>
            ))}
            {!isNew && (
              <Button size="sm" variant="ghost" onClick={handleDuplicate}>
                <Copy size={12} /> Duplicate
              </Button>
            )}
          </div>
          <div className="flex gap-2 justify-between items-center">
            {isNew ? (
              <Button size="sm" variant="primary" onClick={() => { save(); onClose() }}>
                Create
              </Button>
            ) : (
              <span className="text-xs text-gray-400">Changes saved automatically</span>
            )}
            {!isNew && !confirmDelete && (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={12} /> Delete
              </Button>
            )}
            {confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-accent-red font-medium">Confirm delete?</span>
                <Button size="sm" variant="danger" onClick={handleDelete}>Yes, delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
