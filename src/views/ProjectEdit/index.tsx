/**
 * ProjectEdit — Mode A editor for Projects (§4.5.2)
 *
 * Project Draft:   name, type, owner, description, Programme, phases + Teams Assigned (no requirements)
 * Project Scoping: same + requirements UI + per-team confirmation strip
 * Submitted+:      read-only, shows child Demands summary
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { Project, ProjectStatus, DemandType, ExternalResourceRequirement, Phase } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { ProjectStatusBadge } from '../../components/ui/Badge'
import { PhaseEditor, blankPhase, PhaseGantt } from '../DemandEdit/ModeAEditor'
import { generateId } from '../../utils/ids'

const TYPES: DemandType[] = ['Group Strategy Project', 'Plant Project', 'NPD Demand', 'BAU']

function blankProject(): Omit<Project, 'id'> {
  return {
    name: '',
    type: 'Group Strategy Project',
    owner: '',
    description: '',
    programme_id: null,
    status: 'Draft',
    phases: [],
    active: true,
  }
}

// ─── Teams Assigned picker (Projects only) ────────────────────────────────────

function TeamsAssignedSection({
  projectId,
  phaseId,
  projectStatus,
}: {
  projectId: string
  phaseId: string
  projectStatus: ProjectStatus
}) {
  const store = useAppStore()
  const readOnly = projectStatus !== 'Draft' && projectStatus !== 'Scoping'
  const assignments = store.projectTeamAssignments.filter(
    a => a.projectId === projectId && a.phaseId === phaseId
  )
  const assignedTeamIds = new Set(assignments.map(a => a.teamId))
  const allTeams = store.teams.filter(t => t.active)
  const unassignedTeams = allTeams.filter(t => !assignedTeamIds.has(t.id))

  function handleAdd(teamId: string) {
    if (!teamId) return
    store.addProjectTeamAssignment({
      projectId,
      phaseId,
      teamId,
      confirmed: false,
      confirmedBy: null,
      confirmedAt: null,
    })
  }

  function handleRemove(assignmentId: string) {
    store.deleteProjectTeamAssignment(assignmentId)
  }

  function handleConfirmToggle(assignmentId: string, confirmed: boolean) {
    store.updateProjectTeamAssignment(assignmentId, { confirmed: !confirmed })
  }

  return (
    <div className="border border-dashed border-gray-300 rounded p-2.5">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Teams Assigned</div>

      {/* Assigned list */}
      {assignments.length === 0 ? (
        <p className="text-xs text-gray-400 italic mb-2">No teams assigned. Add at least one team before submitting for scoping.</p>
      ) : (
        <div className="flex flex-col gap-1 mb-2">
          {assignments.map(a => {
            const team = store.teams.find(t => t.id === a.teamId)
            const fn = team ? store.functions.find(f => f.id === team.functionId) : null
            return (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-50 border border-border">
                <div className="flex-1">
                  <span className="text-xs font-medium text-near-black">{team?.name ?? a.teamId}</span>
                  {fn && <span className="ml-1.5 text-[10px] text-gray-400">{fn.name}</span>}
                </div>
                {projectStatus === 'Scoping' && (
                  <button
                    onClick={() => handleConfirmToggle(a.id, a.confirmed)}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${a.confirmed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}
                  >
                    {a.confirmed ? '✓ Confirmed' : 'Confirm'}
                  </button>
                )}
                {!readOnly && (
                  <button
                    onClick={() => handleRemove(a.id)}
                    className="text-gray-300 hover:text-accent-red text-[10px] ml-1"
                  >
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Picker */}
      {!readOnly && unassignedTeams.length > 0 && (
        <select
          onChange={e => { handleAdd(e.target.value); e.target.value = '' }}
          defaultValue=""
          className="w-full text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="">Add a team to this phase…</option>
          {unassignedTeams.map(t => {
            const fn = store.functions.find(f => f.id === t.functionId)
            return <option key={t.id} value={t.id}>{t.name}{fn ? ` (${fn.name})` : ''}</option>
          })}
        </select>
      )}
    </div>
  )
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

// ─── Project phase wrapper (adds Teams Assigned) ───────────────────────────────

function ProjectPhaseEditor({
  phase,
  index,
  projectId,
  projectStatus,
  onChange,
  onDelete,
  extReqs,
  onExtReqsChange,
}: {
  phase: Phase
  index: number
  projectId: string
  projectStatus: ProjectStatus
  onChange: (p: Phase) => void
  onDelete: () => void
  extReqs: ExternalResourceRequirement[]
  onExtReqsChange: (r: ExternalResourceRequirement[]) => void
}) {
  const showRequirements = projectStatus === 'Scoping'

  return (
    <div className="border-2 border-border rounded-lg overflow-hidden">
      {/* Phase header */}
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
        />
        {/* Teams Assigned (Projects only) */}
        {projectId && (
          <TeamsAssignedSection
            projectId={projectId}
            phaseId={phase.id}
            projectStatus={projectStatus}
          />
        )}
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

  // Submit Project (Scoping → Submitted + spawn)
  const handleSubmitProject = () => {
    if (!id) return
    const unconfirmed = store.projectTeamAssignments.filter(pta => pta.projectId === id && !pta.confirmed)
    if (unconfirmed.length > 0) {
      const names = unconfirmed.map(pta => store.teams.find(t => t.id === pta.teamId)?.name ?? pta.teamId).join(', ')
      if (!window.confirm(`${unconfirmed.length} team(s) unconfirmed:\n${names}\n\nProceed and spawn Demands?`)) return
    }
    store.updateProject(id, draft)
    const err = store.submitProject(id)
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

  // Gate hints
  const submitHint = id && draft.status === 'Draft' ? (() => {
    if (draft.phases.length === 0) return 'Add at least one phase.'
    const phasesWithoutTeams = draft.phases.filter(ph =>
      !store.projectTeamAssignments.some(pta => pta.projectId === id && pta.phaseId === ph.id)
    )
    if (phasesWithoutTeams.length > 0) return `${phasesWithoutTeams.length} phase(s) need at least one team assigned.`
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
                onChange={e => update(d => ({ ...d, type: e.target.value as DemandType }))}
                disabled={isReadOnly}
              >
                {TYPES.map(t => <option key={t}>{t}</option>)}
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
            {/* Functions involved (derived, read-only) */}
            {functionsInvolved.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">Functions:</span>
                {functionsInvolved.map(fn => fn && (
                  <span key={fn.id} className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium">
                    {fn.name}
                  </span>
                ))}
              </div>
            )}
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
                        projectId={id}
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
    </div>
  )
}
