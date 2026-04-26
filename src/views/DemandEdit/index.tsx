import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { DemandItem, DemandStatus, DemandType, ExternalResourceRequirement } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { StatusBadge } from '../../components/ui/Badge'
import { PhaseEditor, blankPhase, PhaseGantt } from './ModeAEditor'
import { AllocationWorkspace, computeAutoStatus } from './AllocationWorkspace'

const TYPES: DemandType[] = ['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU']
// v1.18: Mode A = pre-Approved statuses; Mode B = allocation workspace
const MODE_A: DemandStatus[] = ['Draft', 'Submitted']
const MODE_B: DemandStatus[] = ['Approved', 'PartiallyAllocated', 'Allocated']

interface Transition { label: string; next: DemandStatus; variant?: 'danger' | 'secondary' }

function pageTransitions(status: DemandStatus, isNew: boolean): Transition[] {
  if (isNew) return []
  switch (status) {
    case 'Draft':     return [{ label: 'Submit Demand', next: 'Submitted' }]
    case 'Submitted': return [{ label: 'Approve', next: 'Approved' }]
    // PartiallyAllocated / Allocated: system auto-transitions only, no user actions here
    case 'Approved':
    case 'PartiallyAllocated':
    case 'Allocated': return []
  }
}

function blankDemand(activeFunctionId: string | null): Omit<DemandItem, 'id'> {
  return {
    name: '', type: 'Plant Project', status: 'Draft', owner: '',
    description: '',
    function_id: activeFunctionId ?? '',
    parent_project_id: null,
    phases: [],
  }
}

export default function DemandEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useAppStore()
  const activeFunctionId = store.activeFunctionId

  const isNew = !id
  const existing = id ? store.demandItems.find(d => d.id === id) : null

  const [draft, setDraft] = useState<Omit<DemandItem, 'id'>>(() =>
    existing ? { ...existing } : blankDemand(activeFunctionId)
  )
  const [isDirty, setIsDirty] = useState(false)

  // External resource requirements — keyed by phase_id, tracked separately from draft
  const [extReqsByPhase, setExtReqsByPhase] = useState<Record<string, ExternalResourceRequirement[]>>(() => {
    if (!existing) return {}
    const result: Record<string, ExternalResourceRequirement[]> = {}
    for (const phase of existing.phases) {
      result[phase.id] = store.externalResourceRequirements.filter(r => r.phase_id === phase.id)
    }
    return result
  })

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

  const mode: 'A' | 'B' = MODE_B.includes(draft.status as DemandStatus) ? 'B' : 'A'

  const handleSave = () => {
    let toSave = { ...draft }
    if (mode === 'B') {
      // Requirement-level over-allocation check (hard block)
      for (const phase of toSave.phases) {
        for (const req of phase.requirements) {
          if (phase.end_month === null) {
            const target = req.steady_state_hours ?? 0
            const allocated = req.allocations.reduce((s, a) => s + (a.steady_state_hours ?? 0), 0)
            if (allocated > target) {
              window.alert(`Allocation error: a requirement in "${phase.name || 'a phase'}" has more allocated hours than its target (${allocated}h vs ${target}h/mo). Reduce allocations before saving.`)
              return
            }
          } else {
            for (const [m, target] of Object.entries(req.hours_by_month)) {
              const allocated = req.allocations.reduce((s, a) => s + (a.hours_by_month[m] ?? 0), 0)
              if (allocated > target) {
                window.alert(`Allocation error: ${m} on a requirement in "${phase.name || 'a phase'}" exceeds its target (${allocated}h vs ${target}h). Reduce allocations before saving.`)
                return
              }
            }
          }
        }
      }
      toSave = { ...toSave, status: computeAutoStatus(toSave) }
    }
    if (isNew) {
      store.addDemandItem(toSave)
    } else if (id) {
      store.updateDemandItem(id, toSave)
    }

    // Sync external requirements: delete all for this demand's phases, then re-add from draft
    const phaseIds = new Set(toSave.phases.map(p => p.id))
    for (const ext of store.externalResourceRequirements) {
      if (phaseIds.has(ext.phase_id)) store.deleteExternalRequirement(ext.id)
    }
    for (const [, reqs] of Object.entries(extReqsByPhase)) {
      for (const req of reqs) {
        if (phaseIds.has(req.phase_id)) {
          store.addExternalRequirement({ ...req })
        }
      }
    }

    setIsDirty(false)
    navigate('/manage-demand')
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    navigate('/manage-demand')
  }

  const handleStatusChange = (next: DemandStatus) => {
    update(d => ({ ...d, status: next }))
    if (!isNew && id) {
      store.updateDemandItem(id, { status: next })
    }
    setIsDirty(false)
  }

  const trans = pageTransitions(draft.status as DemandStatus, isNew)

  // Submit Demand gating: must have at least one phase with at least one requirement
  const submitHint = draft.status === 'Draft' && !isNew ? (() => {
    if (draft.phases.length === 0) return 'Add at least one phase first.'
    if (!draft.phases.some(ph => ph.requirements.length > 0)) return 'Add at least one requirement to a phase.'
    return null
  })() : null

  const updatePhase = (phaseId: string, p: typeof draft.phases[0]) =>
    update(d => ({ ...d, phases: d.phases.map(x => x.id === phaseId ? p : x) }))
  const deletePhase = (phaseId: string) =>
    update(d => ({ ...d, phases: d.phases.filter(x => x.id !== phaseId) }))
  const addPhase = () =>
    update(d => ({ ...d, phases: [...d.phases, blankPhase()] }))

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white sticky top-0 z-10 gap-3 flex-wrap">
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
        <div className="flex items-center gap-2 flex-wrap">
          {submitHint && (
            <span className="text-xs text-amber-600">{submitHint}</span>
          )}
          {!isNew && trans.map(t => (
            <Button
              key={t.label}
              size="sm"
              variant={t.variant ?? 'secondary'}
              disabled={t.label === 'Submit Demand' && !!submitHint}
              onClick={() => handleStatusChange(t.next)}
            >
              {t.label}
            </Button>
          ))}
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={handleSave}>Save</Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-5 flex flex-col gap-5">

          {/* ── Mode A: Demand definition ── */}
          {mode === 'A' && (
            <>
              {/* Core fields */}
              <div className="flex flex-col gap-3">
                <Input
                  label="Name"
                  value={draft.name}
                  onChange={e => update(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Plant B MES Phase 2 Rollout"
                />
                <Select label="Type" value={draft.type} onChange={e => update(d => ({ ...d, type: e.target.value as DemandType }))}>
                  {TYPES.map(t => <option key={t}>{t}</option>)}
                </Select>
                <Input label="Owner" value={draft.owner} onChange={e => update(d => ({ ...d, owner: e.target.value }))} placeholder="Name or role" />
                {/* Parent Project (read-only badge for project-spawned; editable for direct Demands in Draft) */}
                {draft.parent_project_id ? (
                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Parent Project</label>
                    <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">
                      {store.projects.find(p => p.id === draft.parent_project_id)?.name ?? draft.parent_project_id}
                    </span>
                  </div>
                ) : null}
                <Textarea label="Description" value={draft.description} onChange={e => update(d => ({ ...d, description: e.target.value }))} placeholder="Brief description" />
              </div>

              {/* Phases (only for direct Demands — parent_project_id === null) */}
              {draft.parent_project_id === null && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">Phases</span>
                    <button onClick={addPhase} className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium">
                      + Add Phase
                    </button>
                  </div>
                  {draft.phases.length > 0 && (
                    <PhaseGantt
                      phases={draft.phases}
                      onClickPhase={phaseId => {
                        document.getElementById(`phase-${phaseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                    />
                  )}
                  <div className="flex flex-col gap-2">
                    {draft.phases.length === 0 && (
                      <p className="text-xs text-gray-400 italic">No phases yet. Add a phase to define resource requirements.</p>
                    )}
                    {draft.phases.map((phase, idx) => (
                      <div key={phase.id} id={`phase-${phase.id}`}>
                        <PhaseEditor
                          phase={phase}
                          index={idx}
                          onChange={p => updatePhase(phase.id, p)}
                          onDelete={() => deletePhase(phase.id)}
                          extReqs={extReqsByPhase[phase.id] ?? []}
                          onExtReqsChange={reqs => { setExtReqsByPhase(prev => ({ ...prev, [phase.id]: reqs })); setIsDirty(true) }}
                          demandId={id}
                          demandStatus={draft.status as DemandStatus}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Mode B: Allocation workspace ── */}
          {mode === 'B' && (
            <AllocationWorkspace
              draft={draft}
              demandItemId={id}
              onChange={d => { setDraft(d); setIsDirty(true) }}
            />
          )}

          {/* Save/Cancel footer repeat */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
