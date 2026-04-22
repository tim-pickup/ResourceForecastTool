import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { DemandItem, DemandStatus, DemandType, ExternalResourceRequirement } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { StatusBadge } from '../../components/ui/Badge'
import { generateId } from '../../utils/ids'
import { PhaseEditor, blankPhase, PhaseGantt } from './ModeAEditor'
import { AllocationWorkspace, computeAutoStatus } from './AllocationWorkspace'

const TYPES: DemandType[] = ['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU']
const MODE_A: DemandStatus[] = ['Draft', 'Submitted', 'Parked']
const MODE_B: DemandStatus[] = ['Approved', 'PartiallyAllocated', 'Allocated']

interface Transition { label: string; next: DemandStatus; variant?: 'danger' | 'secondary' }

function pageTransitions(status: DemandStatus, isNew: boolean): Transition[] {
  if (isNew) return []
  switch (status) {
    case 'Draft':     return [{ label: 'Submit', next: 'Submitted' }]
    case 'Submitted': return [{ label: 'Approve', next: 'Approved' }, { label: 'Revert to Draft', next: 'Draft' }, { label: 'Park', next: 'Parked' }]
    case 'Approved':  return [{ label: 'Revise', next: 'Submitted' }, { label: 'Park', next: 'Parked' }, { label: 'Close', next: 'Closed', variant: 'danger' }]
    case 'PartiallyAllocated': return [{ label: 'Park', next: 'Parked' }, { label: 'Close', next: 'Closed', variant: 'danger' }]
    case 'Allocated': return [{ label: 'Park', next: 'Parked' }, { label: 'Close', next: 'Closed', variant: 'danger' }]
    case 'Parked':    return [{ label: 'Revive', next: 'Submitted' }]
    case 'Closed':    return []
  }
}

function blankDemand(domainId: string): Omit<DemandItem, 'id'> {
  return {
    name: '', type: 'Plant Project', status: 'Draft', owner: '',
    primary_domain_id: domainId, description: '', parked_reason: null,
    previous_status: null, closed_at: null, phases: [], project_id: null,
  }
}

export default function DemandEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useAppStore()

  const isNew = !id
  const existing = id ? store.demandItems.find(d => d.id === id) : null

  const [draft, setDraft] = useState<Omit<DemandItem, 'id'>>(() =>
    existing ? { ...existing } : blankDemand(store.domains[0]?.id ?? '')
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
          // Use addExternalRequirement (generates new ID) if needed, else preserve existing
          store.addExternalRequirement({ ...req })
        }
      }
    }

    setIsDirty(false)
    navigate('/demand')
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    navigate('/demand')
  }

  const handleStatusChange = (next: DemandStatus) => {
    if (next === 'Closed') {
      if (!window.confirm(`Archive "${draft.name || 'this item'}"? It will be removed from the Demand list and all charts.`)) return
      const updates: Partial<DemandItem> = {
        status: 'Closed',
        previous_status: draft.status as DemandStatus,
        closed_at: new Date().toISOString().slice(0, 10),
      }
      if (!isNew && id) store.updateDemandItem(id, updates)
      navigate('/demand')
      return
    }

    let parkedReason: string | null = draft.parked_reason
    if (next === 'Parked') {
      parkedReason = window.prompt('Parked reason (optional):', '') ?? null
      if (parkedReason === '') parkedReason = null
    }

    update(d => ({ ...d, status: next, parked_reason: next === 'Parked' ? parkedReason : null }))
    if (!isNew && id) {
      store.updateDemandItem(id, { status: next, parked_reason: next === 'Parked' ? parkedReason : null })
    }
    setIsDirty(false)
  }

  const handleRevise = () => {
    if (!window.confirm('Return this demand to Submitted for revision? Existing allocations are preserved but will be excluded from capacity calculations while Submitted. On re-Approval they will be re-validated.')) return
    const updates: Partial<DemandItem> = { status: 'Submitted' }
    if (!isNew && id) store.updateDemandItem(id, updates)
    update(d => ({ ...d, status: 'Submitted' }))
    setIsDirty(false)
  }

  const handleParkToRevise = () => {
    const msg = isDirty
      ? 'Park this demand? Unsaved allocation changes will be discarded. Named allocations already saved are preserved.'
      : 'Park this demand? It will be removed from capacity calculations. Named allocations are preserved and will reappear when re-approved.'
    if (!window.confirm(msg)) return
    const updates: Partial<DemandItem> = { status: 'Parked', parked_reason: null }
    if (!isNew && id) store.updateDemandItem(id, updates)
    update(d => ({ ...d, status: 'Parked', parked_reason: null }))
    setIsDirty(false)
  }

  const trans = pageTransitions(draft.status as DemandStatus, isNew)
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
          {!isNew && trans.map(t => (
            <Button key={t.label} size="sm" variant={t.variant ?? 'secondary'} onClick={() => handleStatusChange(t.next)}>
              {t.label}
            </Button>
          ))}
          {!isNew && (
            <Button size="sm" variant="ghost" onClick={() => { store.duplicateDemandItem(id!); navigate('/demand') }}>
              <Copy size={12} /> Duplicate
            </Button>
          )}
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
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Type" value={draft.type} onChange={e => update(d => ({ ...d, type: e.target.value as DemandType }))}>
                    {TYPES.map(t => <option key={t}>{t}</option>)}
                  </Select>
                  <Select label="Primary Domain" value={draft.primary_domain_id} onChange={e => update(d => ({ ...d, primary_domain_id: e.target.value }))}>
                    {store.domains.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </div>
                <Input label="Owner" value={draft.owner} onChange={e => update(d => ({ ...d, owner: e.target.value }))} placeholder="Name or role" />
                {/* Project alignment */}
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Project Alignment</label>
                  <select
                    value={draft.project_id ?? ''}
                    onChange={e => update(d => ({ ...d, project_id: e.target.value || null }))}
                    className="text-xs border border-border rounded px-2 py-1.5 bg-white w-full"
                  >
                    <option value="">Unaligned</option>
                    {store.programmes.filter(p => p.active).map(prog => (
                      <optgroup key={prog.id} label={prog.name}>
                        {store.projects.filter(p => p.programme_id === prog.id && p.active).map(proj => (
                          <option key={proj.id} value={proj.id}>{proj.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <Textarea label="Description" value={draft.description} onChange={e => update(d => ({ ...d, description: e.target.value }))} placeholder="Brief description" />
                {draft.status === 'Parked' && (
                  <Textarea
                    label="Parked Reason"
                    value={draft.parked_reason ?? ''}
                    onChange={e => update(d => ({ ...d, parked_reason: e.target.value || null }))}
                    placeholder="Why is this parked? When might it be revived?"
                  />
                )}
              </div>

              {/* Phases */}
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
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── Mode B: Allocation workspace ── */}
          {mode === 'B' && (
            <AllocationWorkspace
              draft={draft}
              demandItemId={id}
              onChange={d => { setDraft(d); setIsDirty(true) }}
              onParkToRevise={handleParkToRevise}
              onRevise={handleRevise}
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
