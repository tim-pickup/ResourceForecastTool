/**
 * ProjectEdit — Mode A editor for Projects (§4.5.2)
 *
 * Project Draft:   name, type, owner, description, Programme, phases + requirements
 * Project Scoping: same + requirements UI
 * Submitted+:      read-only, shows child Demands summary
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { Project, ProjectStatus, ExternalResourceRequirement, Phase } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { ProjectStatusBadge } from '../../components/ui/Badge'
import { PhaseEditor, blankPhase, PhaseGantt } from '../DemandEdit/ModeAEditor'
import { SubmitProjectDialog } from '../../components/SubmitProjectDialog'


function blankProject(): Omit<Project, 'id'> {
  return {
    name: '',
    type: '',
    owner: '',
    description: '',
    programme_id: null,
    status: 'Draft',
    phases: [],
    active: true,
    functions_required: [],
    functions_actually_involved: [],
  }
}

// ─── Programme picker ─────────────────────────────────────────────────────────

function ProgrammePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const store = useAppStore()
  const programmes = store.programmes.filter(p => p.active)

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-gray-700">Programme</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value || null)}
        className="text-xs border border-border rounded px-2 py-1.5 bg-white"
      >
        <option value="">— Unaligned (no Programme) —</option>
        {programmes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

// ─── Project phase wrapper ────────────────────────────────────────────────────

function ProjectPhaseEditor({
  phase,
  index,
  projectStatus,
  onChange,
  onDelete,
  extReqs,
  onExtReqsChange,
}: {
  phase: Phase
  index: number
  projectStatus: ProjectStatus
  onChange: (p: Phase) => void
  onDelete: () => void
  extReqs: ExternalResourceRequirement[]
  onExtReqsChange: (r: ExternalResourceRequirement[]) => void
}) {
  const showRequirements = projectStatus === 'Scoping'

  return (
    <div className="border-2 border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-100 border-b border-border">
        <h3 className="text-sm font-semibold text-near-black">
          Phase {index + 1}{phase.name ? ` · ${phase.name}` : ''}{' '}
          <span className="font-normal text-gray-500">
            {phase.end_month === null
              ? `${phase.start_month || '?'} → ongoing`
              : `${phase.start_month || '?'} – ${phase.end_month || '?'}`}
          </span>
        </h3>
      </div>
      <div className="px-4 py-3 flex flex-col gap-3">
        <PhaseEditor
          phase={phase}
          index={index}
          onChange={onChange}
          onDelete={onDelete}
          extReqs={showRequirements ? extReqs : []}
          onExtReqsChange={showRequirements ? onExtReqsChange : () => undefined}
          showRequirements={showRequirements}
          functionScopeId={null}           // Project Scoping: full Skill catalogue across all Functions
          showFunctionTagPicker={showRequirements}  // Function tag picker on ext reqs in Scoping
        />
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useAppStore()

  const isNew = !id
  const existing = id ? store.projects.find(p => p.id === id) : null

  const [draft, setDraft] = useState<Omit<Project, 'id'>>(() =>
    existing ? { ...existing } : blankProject()
  )
  const [isDirty, setIsDirty] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)

  // External requirements state keyed by phase_id
  const [extReqsByPhase, setExtReqsByPhase] = useState<Record<string, ExternalResourceRequirement[]>>(() => {
    if (!existing) return {}
    const result: Record<string, ExternalResourceRequirement[]> = {}
    for (const phase of existing.phases) {
      result[phase.id] = store.externalResourceRequirements.filter(r => r.phase_id === phase.id)
    }
    return result
  })

  const update = (fn: (d: Omit<Project, 'id'>) => Omit<Project, 'id'>) => {
    setDraft(fn); setIsDirty(true)
  }

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const isReadOnly = draft.status !== 'Draft' && draft.status !== 'Scoping'

  const handleSave = () => {
    if (isNew) {
      store.addProject(draft)
    } else if (id) {
      store.updateProject(id, draft)
      // Sync external requirements for project phases
      const phaseIds = new Set(draft.phases.map(p => p.id))
      for (const ext of store.externalResourceRequirements) {
        if (phaseIds.has(ext.phase_id)) store.deleteExternalRequirement(ext.id)
      }
      for (const [, reqs] of Object.entries(extReqsByPhase)) {
        for (const req of reqs) {
          if (phaseIds.has(req.phase_id)) store.addExternalRequirement({ ...req })
        }
      }
    }
    setIsDirty(false)
    navigate('/manage-projects')
  }

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return
    navigate('/manage-projects')
  }

  // Submit for Scoping (Draft → Scoping)
  const handleSubmitForScoping = () => {
    if (!id) return
    // Save first
    store.updateProject(id, draft)
    const err = store.submitProjectForScoping(id)
    if (err) { setSubmitError(err); return }
    setDraft(d => ({ ...d, status: 'Scoping' }))
    setIsDirty(false)
    setSubmitError(null)
  }

  // Submit Project (Scoping → Submitted + spawn) — always opens §11.18 dialog
  const handleSubmitProject = () => {
    if (!id) return
    store.updateProject(id, draft)
    setShowSubmitDialog(true)
  }

  const handleConfirmSubmit = () => {
    if (!id) return
    const err = store.submitProject(id)
    setShowSubmitDialog(false)
    if (err) { setSubmitError(err); return }
    setDraft(d => ({ ...d, status: 'Submitted' }))
    setIsDirty(false)
    setSubmitError(null)
  }

  const updatePhase = (phaseId: string, p: Phase) =>
    update(d => ({ ...d, phases: d.phases.map(x => x.id === phaseId ? p : x) }))
  const deletePhase = (phaseId: string) =>
    update(d => ({ ...d, phases: d.phases.filter(x => x.id !== phaseId) }))
  const addPhase = () =>
    update(d => ({ ...d, phases: [...d.phases, blankPhase()] }))

  // Derived: Functions involved from requirements
  const domFn = new Map(store.domains.map(d => [d.id, d.functionId]))
  const sklFn = new Map(store.skills.map(s => [s.id, domFn.get(s.domain_id)]))
  const fnIds = new Set<string>()
  for (const phase of draft.phases) {
    for (const req of phase.requirements) {
      const fnId = sklFn.get(req.skill_id)
      if (fnId) fnIds.add(fnId)
    }
  }
  const functionsInvolved = [...fnIds].map(fid => store.functions.find(f => f.id === fid)).filter(Boolean)

  const childDemands = id ? store.demandItems.filter(d => d.parent_project_id === id) : []

  // Gate hints — Submit for Scoping requires ≥1 phase AND ≥1 Function in functions_required
  const submitHint = id && draft.status === 'Draft' ? (() => {
    if (draft.phases.length === 0) return 'Add at least one phase.'
    if (draft.functions_required.length === 0) return 'Add at least one Function to Functions Required.'
    return null
  })() : null

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-white sticky top-0 z-10 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={handleCancel} className="text-gray-400 hover:text-near-black transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <ProjectStatusBadge status={draft.status as ProjectStatus} />
            <span className="text-sm font-semibold text-near-black">
              {isNew ? 'New Project' : (draft.name || 'Unnamed Project')}
            </span>
            {isDirty && <span className="text-xs text-amber-600 font-medium">Unsaved</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {submitError && <span className="text-xs text-red-600">{submitError}</span>}
          {submitHint && <span className="text-xs text-amber-600">{submitHint}</span>}

          {/* Action buttons by status */}
          {!isNew && draft.status === 'Draft' && (
            <Button size="sm" variant="primary" onClick={handleSubmitForScoping} disabled={!!submitHint}>
              Submit for Scoping
            </Button>
          )}
          {!isNew && draft.status === 'Scoping' && (
            <Button size="sm" variant="primary" onClick={handleSubmitProject}>
              Submit Project
            </Button>
          )}

          {!isReadOnly && (
            <>
              <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
              <Button size="sm" variant="secondary" onClick={handleSave} disabled={!isDirty && !isNew}>Save</Button>
            </>
          )}
          {isReadOnly && (
            <Button size="sm" variant="ghost" onClick={handleCancel}>Close</Button>
          )}
        </div>
      </div>

      {/* Page body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 max-w-3xl mx-auto w-full">
        <div className="flex flex-col gap-6">

          {/* Metadata */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Project Name"
                value={draft.name}
                onChange={e => update(d => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Plant C MES Migration"
                disabled={isReadOnly}
              />
              <Select
                label="Type"
                value={draft.type}
                onChange={e => update(d => ({ ...d, type: e.target.value }))}
                disabled={isReadOnly}
              >
                <option value="">— Select type —</option>
                {store.projectTypes.filter(pt => pt.active).sort((a, b) => a.display_order - b.display_order).map(pt => (
                  <option key={pt.id} value={pt.id}>{pt.name}</option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Owner"
                value={draft.owner}
                onChange={e => update(d => ({ ...d, owner: e.target.value }))}
                placeholder="e.g. John Smith"
                disabled={isReadOnly}
              />
              <ProgrammePicker
                value={draft.programme_id}
                onChange={v => update(d => ({ ...d, programme_id: v }))}
              />
            </div>
            <Textarea
              label="Description"
              value={draft.description}
              onChange={e => update(d => ({ ...d, description: e.target.value }))}
              placeholder="What is this project about?"
              disabled={isReadOnly}
            />
            {/* Functions Required picker (Draft and Scoping only — frozen at Submit) */}
            {(draft.status === 'Draft' || draft.status === 'Scoping') && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-700">
                  Functions Required
                  <span className="ml-1 font-normal text-gray-400">(originator's plan — hint, not binding)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {store.functions.filter(f => f.active).sort((a, b) => a.name.localeCompare(b.name)).map(fn => {
                    const checked = draft.functions_required.includes(fn.id)
                    return (
                      <label key={fn.id} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...draft.functions_required, fn.id]
                              : draft.functions_required.filter(id => id !== fn.id)
                            update(d => ({ ...d, functions_required: next }))
                          }}
                          className="accent-brand"
                        />
                        {fn.name}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Functions Actually Involved chips (derived live; frozen at Submit as audit record) */}
            <div className="flex flex-col gap-1">
              {(draft.status === 'Draft' || draft.status === 'Scoping') ? (
                <>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Functions Actually Involved (derived from requirements)</span>
                  <div className="flex flex-wrap gap-1">
                    {functionsInvolved.length === 0 ? (
                      <span className="text-[10px] text-gray-400 italic">None yet — add requirements to phases in Scoping.</span>
                    ) : (
                      functionsInvolved.map(fn => fn && (
                        <span
                          key={fn.id}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            draft.functions_required.includes(fn.id)
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-300'
                          }`}
                        >
                          {fn.name}
                          {!draft.functions_required.includes(fn.id) && (
                            <span className="ml-1 italic">(added during Scoping)</span>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </>
              ) : (
                /* Submitted+: show frozen Functions Actually Involved */
                draft.functions_actually_involved.length > 0 && (
                  <>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Functions Actually Involved</span>
                    <div className="flex flex-wrap gap-1">
                      {draft.functions_actually_involved.map(fnId => {
                        const fn = store.functions.find(f => f.id === fnId)
                        return fn ? (
                          <span key={fnId} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium">
                            {fn.name}
                          </span>
                        ) : null
                      })}
                    </div>
                  </>
                )
              )}
            </div>
          </div>

          {/* Child Demands (Submitted+) */}
          {childDemands.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Child Demands</h3>
              <div className="flex flex-col gap-1.5">
                {childDemands.map(d => {
                  const fn = store.functions.find(f => f.id === d.function_id)
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded bg-gray-50 border border-border text-xs">
                      <span className="flex-1 font-medium">{d.name}</span>
                      {fn && <span className="text-gray-400">{fn.name}</span>}
                      <span className="text-gray-500 capitalize">{d.status}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Phases */}
          {!isReadOnly && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Phases</h3>
                <Button size="sm" variant="ghost" onClick={addPhase}><Plus size={12} /> Add Phase</Button>
              </div>

              {draft.phases.length > 0 && (
                <PhaseGantt
                  phases={draft.phases}
                  onClickPhase={phaseId => {
                    document.getElementById(`prj-phase-${phaseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                />
              )}

              {draft.phases.length === 0 && (
                <p className="text-xs text-gray-400 italic">No phases yet. Add at least one phase.</p>
              )}

              <div className="flex flex-col gap-4 mt-3">
                {draft.phases.map((phase, idx) => (
                  <div key={phase.id} id={`prj-phase-${phase.id}`}>
                    {id ? (
                      <ProjectPhaseEditor
                        phase={phase}
                        index={idx}
                        projectStatus={draft.status as ProjectStatus}
                        onChange={p => updatePhase(phase.id, p)}
                        onDelete={() => deletePhase(phase.id)}
                        extReqs={extReqsByPhase[phase.id] ?? []}
                        onExtReqsChange={reqs => { setExtReqsByPhase(prev => ({ ...prev, [phase.id]: reqs })); setIsDirty(true) }}
                      />
                    ) : (
                      // For new projects (no id yet), use simple PhaseEditor without teams
                      <div className="border-2 border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 bg-gray-100 border-b border-border">
                          <h3 className="text-sm font-semibold text-near-black">
                            Phase {idx + 1}{phase.name ? ` · ${phase.name}` : ''}
                          </h3>
                        </div>
                        <div className="px-4 py-3">
                          <PhaseEditor
                            phase={phase}
                            index={idx}
                            onChange={p => updatePhase(phase.id, p)}
                            onDelete={() => deletePhase(phase.id)}
                            extReqs={[]}
                            onExtReqsChange={() => undefined}
                            demandStatus="Draft"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save footer (for Draft/Scoping) */}
          {!isReadOnly && (
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={handleSave}>Save</Button>
            </div>
          )}
        </div>
      </div>

      {/* §11.18 Submit Project confirmation dialog */}
      {showSubmitDialog && id && (
        <SubmitProjectDialog
          projectId={id}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setShowSubmitDialog(false)}
        />
      )}
    </div>
  )
}
