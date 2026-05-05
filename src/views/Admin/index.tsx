import { useState, useMemo } from 'react'
import { Plus, Trash2, Edit2, Check, X, AlertTriangle, RefreshCw, ToggleLeft, ToggleRight, GripVertical } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore } from '../../store/useAppStore'
import type { AppFunction, Domain, Skill, Person, Level, PersonSkill, Team, ProjectType } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/FormFields'
import { DomainSkillSelector } from '../../components/DomainSkillSelector'
import { project_internal_hours, project_external_hours } from '../../lib/capacity'
import { generateMonths, getCurrentMonth } from '../../utils/capacity'
import { slugifyProjectTypeId } from '../../utils/ids'
import { clsx } from 'clsx'

const LEVELS: Level[] = ['Basic', 'Advanced', 'Specialist']
const TEAM_TYPES: Team['type'][] = ['Plant', 'Central', 'Specialist', 'Other']
const TABS = ['Functions', 'Teams', 'Domains & Skills', 'People', 'Programmes', 'Projects', 'Providers', 'Project Types', 'Reset'] as const
type Tab = typeof TABS[number]

function derivedPersonDomain(personSkills: PersonSkill[], skills: Skill[], domains: Domain[]): Domain | null {
  const counts = new Map<string, number>()
  for (const ps of personSkills) {
    const skill = skills.find(s => s.id === ps.skill_id)
    if (!skill) continue
    counts.set(skill.domain_id, (counts.get(skill.domain_id) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  const [topId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return domains.find(d => d.id === topId) ?? null
}

// ─── Functions (full CRUD) ─────────────────────────────────────────────────

function FunctionsPanel() {
  const store = useAppStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', description: '' })
  const [editForm, setEditForm] = useState({ name: '', description: '' })
  const [blockId, setBlockId] = useState<string | null>(null)

  const activeFns = store.functions.filter(f => f.active)

  function domainCount(fnId: string) { return store.domains.filter(d => d.functionId === fnId).length }
  function teamCount(fnId: string) { return store.teams.filter(t => t.functionId === fnId).length }
  function peopleCount(fnId: string) {
    const teamIds = new Set(store.teams.filter(t => t.functionId === fnId).map(t => t.id))
    return store.people.filter(p => teamIds.has(p.teamId)).length
  }

  function handleDeactivate(fn: AppFunction) {
    if (fn.active && activeFns.length <= 1) {
      alert('Cannot deactivate — at least one active Function is required.')
      return
    }
    store.updateFunction(fn.id, { active: !fn.active })
    // If we're deactivating the currently-active Function, fall back to next alphabetical
    if (fn.active && store.activeFunctionId === fn.id) {
      const next = store.functions
        .filter(f => f.active && f.id !== fn.id)
        .sort((a, b) => a.name.localeCompare(b.name))[0]
      if (next) store.setActiveFunctionId(next.id)
    }
  }

  function handleDelete(fn: AppFunction) {
    const dc = domainCount(fn.id)
    const tc = teamCount(fn.id)
    const pc = peopleCount(fn.id)
    if (dc > 0 || tc > 0 || pc > 0) {
      setBlockId(fn.id)
      return
    }
    if (store.activeFunctionId === fn.id) {
      const next = store.functions.filter(f => f.active && f.id !== fn.id)
        .sort((a, b) => a.name.localeCompare(b.name))[0]
      if (next) store.setActiveFunctionId(next.id)
    }
    store.deleteFunction(fn.id)
  }

  function startEdit(fn: AppFunction) {
    setEditId(fn.id)
    setEditForm({ name: fn.name, description: fn.description })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">Functions ({store.functions.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => { setNewForm({ name: '', description: '' }); setShowNew(true) }}>
          <Plus size={12} /> Add Function
        </Button>
      </div>

      {blockId && (() => {
        const fn = store.functions.find(f => f.id === blockId)!
        const dc = domainCount(blockId), tc = teamCount(blockId), pc = peopleCount(blockId)
        return (
          <div className="border border-red-300 rounded-md p-3 mb-3 bg-red-50 flex flex-col gap-2">
            <p className="text-xs font-medium text-red-700">
              Cannot delete <strong>{fn?.name}</strong> — it still has{' '}
              {[dc > 0 && `${dc} domain(s)`, tc > 0 && `${tc} team(s)`, pc > 0 && `${pc} person/people`].filter(Boolean).join(', ')}.
              Move or delete them first.
            </p>
            <Button size="sm" variant="ghost" onClick={() => setBlockId(null)}>Dismiss</Button>
          </div>
        )
      })()}

      {showNew && (
        <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-2">
          <Input label="Name (required, unique)" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
          <Input label="Description" value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => {
              if (!newForm.name.trim()) return
              const dupe = store.functions.some(f => f.name.toLowerCase() === newForm.name.trim().toLowerCase())
              if (dupe) { alert('A Function with that name already exists.'); return }
              store.addFunction({ name: newForm.name.trim(), description: newForm.description, active: true })
              setShowNew(false)
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {[...store.functions].sort((a, b) => a.name.localeCompare(b.name)).map(fn => {
          const dc = domainCount(fn.id), tc = teamCount(fn.id), pc = peopleCount(fn.id)
          const isActive = store.activeFunctionId === fn.id
          return (
            <div key={fn.id} className={clsx('border rounded-md px-3 py-2.5', isActive ? 'border-brand bg-blue-50/20' : 'border-border')}>
              {editId === fn.id ? (
                <div className="flex flex-col gap-2">
                  <Input label="Name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                  <Input label="Description" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => {
                      if (!editForm.name.trim()) return
                      const dupe = store.functions.some(f => f.id !== fn.id && f.name.toLowerCase() === editForm.name.trim().toLowerCase())
                      if (dupe) { alert('Name collision.'); return }
                      store.updateFunction(fn.id, { name: editForm.name.trim(), description: editForm.description })
                      setEditId(null)
                    }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{fn.name}</span>
                      {!fn.active && <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">Inactive</span>}
                      {isActive && <span className="text-xs text-brand bg-blue-50 border border-brand/30 rounded px-1.5 py-0.5">Active lens</span>}
                    </div>
                    {fn.description && <p className="text-xs text-gray-500 mt-0.5">{fn.description}</p>}
                    <div className="text-xs text-gray-400 mt-1">{dc} domain(s) · {tc} team(s) · {pc} person/people</div>
                  </div>
                  <div className="flex gap-1 items-center">
                    <button
                      onClick={() => handleDeactivate(fn)}
                      className={clsx('p-1 transition-colors', fn.active ? 'text-gray-400 hover:text-brand' : 'text-gray-300 hover:text-brand')}
                      title={fn.active ? (activeFns.length <= 1 ? 'Cannot deactivate last active Function' : 'Deactivate') : 'Activate'}
                    >
                      {fn.active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                    </button>
                    <button onClick={() => startEdit(fn)} className="text-gray-400 hover:text-near-black p-1"><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete(fn)} className="text-gray-300 hover:text-accent-red p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Teams (scoped to active Function) ───────────────────────────────────────

function TeamsPanel() {
  const store = useAppStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState<{ name: string; type: Team['type'] }>({ name: '', type: 'Plant' })
  const [editForm, setEditForm] = useState<{ name: string; type: Team['type'] }>({ name: '', type: 'Plant' })
  const [blockId, setBlockId] = useState<string | null>(null)

  const activeFunctionId = store.activeFunctionId ?? store.functions[0]?.id ?? ''
  const activeFnName = store.functions.find(f => f.id === activeFunctionId)?.name ?? ''
  // §5: show only active Function's Teams
  const scopedTeams = store.teams.filter(t => t.functionId === activeFunctionId)

  function memberCount(teamId: string) { return store.people.filter(p => p.teamId === teamId).length }

  function handleDelete(team: Team) {
    const blocking = store.people.filter(p => p.teamId === team.id)
    if (blocking.length > 0) { setBlockId(team.id); return }
    store.deleteTeam(team.id)
  }

  function startEdit(team: Team) {
    setEditId(team.id)
    setEditForm({ name: team.name, type: team.type })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">
          Teams — {activeFnName} ({scopedTeams.length})
        </h3>
        <Button size="sm" variant="secondary" onClick={() => { setNewForm({ name: '', type: 'Plant' }); setShowNew(true) }}>
          <Plus size={12} /> Add Team
        </Button>
      </div>

      {blockId && (() => {
        const team = store.teams.find(t => t.id === blockId)!
        const blocking = store.people.filter(p => p.teamId === blockId)
        return (
          <div className="border border-red-300 rounded-md p-3 mb-3 bg-red-50 flex flex-col gap-2">
            <p className="text-xs font-medium text-red-700">Cannot delete <strong>{team?.name}</strong> — {blocking.length} person(s) must be reassigned first:</p>
            <ul className="text-xs text-red-600 list-disc list-inside">
              {blocking.map(p => <li key={p.id}>{p.name}</li>)}
            </ul>
            <Button size="sm" variant="ghost" onClick={() => setBlockId(null)}>Dismiss</Button>
          </div>
        )
      })()}

      {showNew && (
        <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Input label="Name (required)" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
            <Select label="Type" value={newForm.type} onChange={e => setNewForm(f => ({ ...f, type: e.target.value as Team['type'] }))}>
              {TEAM_TYPES.map(t => <option key={t}>{t}</option>)}
            </Select>
          </div>
          <div className="text-xs text-gray-400">Function: {activeFnName} (derived from active Function)</div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => {
              if (!newForm.name.trim()) return
              store.addTeam({ name: newForm.name.trim(), description: '', functionId: activeFunctionId, type: newForm.type, active: true })
              setShowNew(false)
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {scopedTeams.map(team => {
          const count = memberCount(team.id)
          return (
            <div key={team.id} className="border border-border rounded-md px-3 py-2.5">
              {editId === team.id ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                    <Select label="Type" value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value as Team['type'] }))}>
                      {TEAM_TYPES.map(t => <option key={t}>{t}</option>)}
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => {
                      if (!editForm.name.trim()) return
                      store.updateTeam(team.id, { name: editForm.name.trim(), type: editForm.type })
                      setEditId(null)
                    }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{team.name}</span>
                      <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{team.type}</span>
                      {!team.active && <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">Inactive</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {count} member{count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex gap-1 items-center">
                    <button onClick={() => store.updateTeam(team.id, { active: !team.active })} className="text-gray-400 hover:text-brand p-1" title={team.active ? 'Deactivate' : 'Activate'}>
                      {team.active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                    </button>
                    <button onClick={() => startEdit(team)} className="text-gray-400 hover:text-near-black p-1"><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete(team)} className="text-gray-300 hover:text-accent-red p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {scopedTeams.length === 0 && (
          <p className="text-xs text-gray-400 italic">No teams in this Function yet.</p>
        )}
      </div>
    </div>
  )
}

// ─── Domains & Skills (scoped to active Function) ────────────────────────────

function DomainsSkillsPanel() {
  const store = useAppStore()
  const [editDomainId, setEditDomainId] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState({ name: '', description: '' })
  const [showNewDomain, setShowNewDomain] = useState(false)
  const [editSkillId, setEditSkillId] = useState<string | null>(null)
  const [showNewSkillFor, setShowNewSkillFor] = useState<string | null>(null)
  const [newSkill, setNewSkill] = useState({ name: '', domain_id: '' })

  const activeFunctionId = store.activeFunctionId ?? store.functions[0]?.id ?? ''
  // §5: show only active Function's Domains
  const scopedDomains = store.domains.filter(d => d.functionId === activeFunctionId)
  const activeFnName = store.functions.find(f => f.id === activeFunctionId)?.name ?? ''

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-near-black">
            Domains & Skills — {activeFnName} ({scopedDomains.length} domains)
          </h3>
          <Button size="sm" variant="secondary" onClick={() => setShowNewDomain(true)}>
            <Plus size={12} /> Add Domain
          </Button>
        </div>
        {showNewDomain && (
          <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-2">
            <Input label="Domain Name" value={newDomain.name} onChange={e => setNewDomain(n => ({ ...n, name: e.target.value }))} />
            <Input label="Description" value={newDomain.description} onChange={e => setNewDomain(n => ({ ...n, description: e.target.value }))} />
            <div className="text-xs text-gray-400">Function: {activeFnName} (derived from active Function)</div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => {
                if (!newDomain.name.trim()) return
                store.addDomain({ ...newDomain, functionId: activeFunctionId })
                setNewDomain({ name: '', description: '' })
                setShowNewDomain(false)
              }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewDomain(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {scopedDomains.length === 0 && (
          <p className="text-xs text-gray-400 italic">No domains in this Function yet.</p>
        )}
        <div className="flex flex-col gap-2">
          {scopedDomains.map(domain => {
            const domainSkills = store.skills.filter(s => s.domain_id === domain.id)
            return (
              <div key={domain.id} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                  {editDomainId === domain.id ? (
                    <InlineEdit
                      value={domain.name}
                      onSave={v => { store.updateDomain(domain.id, { name: v }); setEditDomainId(null) }}
                      onCancel={() => setEditDomainId(null)}
                    />
                  ) : (
                    <>
                      <span className="text-sm font-semibold flex-1">{domain.name}</span>
                      <span className="text-xs text-gray-400">{domain.description}</span>
                      <button onClick={() => setEditDomainId(domain.id)} className="text-gray-400 hover:text-near-black"><Edit2 size={13} /></button>
                      <button onClick={() => store.deleteDomain(domain.id)} className="text-gray-300 hover:text-accent-red"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
                <div className="px-3 py-2 flex flex-col gap-1.5">
                  {domainSkills.map(skill => (
                    <div key={skill.id} className="flex items-center gap-2 text-sm">
                      {editSkillId === skill.id ? (
                        <InlineEdit
                          value={skill.name}
                          onSave={v => { store.updateSkill(skill.id, { name: v }); setEditSkillId(null) }}
                          onCancel={() => setEditSkillId(null)}
                        />
                      ) : (
                        <>
                          <span className="flex-1 text-xs">{skill.name}</span>
                          <button onClick={() => setEditSkillId(skill.id)} className="text-gray-400 hover:text-near-black"><Edit2 size={12} /></button>
                          <button onClick={() => store.deleteSkill(skill.id)} className="text-gray-300 hover:text-accent-red"><Trash2 size={12} /></button>
                        </>
                      )}
                    </div>
                  ))}
                  {showNewSkillFor === domain.id ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        autoFocus
                        value={newSkill.name}
                        onChange={e => setNewSkill({ name: e.target.value, domain_id: domain.id })}
                        placeholder="Skill name"
                        className="flex-1 text-xs border border-border rounded px-2 py-1 focus:outline-none focus:border-brand"
                        onKeyDown={e => {
                          if (e.key === 'Enter') { store.addSkill({ name: newSkill.name, domain_id: domain.id }); setNewSkill({ name: '', domain_id: '' }); setShowNewSkillFor(null) }
                          if (e.key === 'Escape') { setShowNewSkillFor(null) }
                        }}
                      />
                      <button onClick={() => { store.addSkill({ name: newSkill.name, domain_id: domain.id }); setNewSkill({ name: '', domain_id: '' }); setShowNewSkillFor(null) }} className="text-brand hover:text-brand-hover"><Check size={13} /></button>
                      <button onClick={() => setShowNewSkillFor(null)} className="text-gray-400"><X size={13} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setShowNewSkillFor(domain.id)} className="text-xs text-brand hover:text-brand-hover flex items-center gap-1 mt-1">
                      <Plus size={11} /> Add skill
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InlineEdit({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(value)
  return (
    <div className="flex items-center gap-2 flex-1">
      <input
        autoFocus
        value={v}
        onChange={e => setV(e.target.value)}
        className="flex-1 text-sm border border-brand rounded px-2 py-0.5 focus:outline-none"
        onKeyDown={e => { if (e.key === 'Enter') onSave(v); if (e.key === 'Escape') onCancel() }}
      />
      <button onClick={() => onSave(v)} className="text-brand hover:text-brand-hover"><Check size={13} /></button>
      <button onClick={onCancel} className="text-gray-400 hover:text-near-black"><X size={13} /></button>
    </div>
  )
}

// ─── People (scoped to active Function) ──────────────────────────────────────

function PersonForm({ person, activeFunctionId, onSave, onCancel }: {
  person?: Person
  activeFunctionId: string
  onSave: (p: any) => void
  onCancel: () => void
}) {
  const store = useAppStore()
  const [form, setForm] = useState<Omit<Person, 'id'>>(person ?? {
    name: '', primary_domain_id: '', contracted_hours_per_month: 152,
    available_from: null, available_to: null, active: true, skills: [], teamId: ''
  })

  // §5: Team dropdown scoped to active Function's active Teams
  const scopedTeams = store.teams.filter(t => t.functionId === activeFunctionId && t.active)

  // Scope skills picker to person's function (via their team)
  const personTeam = store.teams.find(t => t.id === form.teamId)
  const scopedDomains = personTeam
    ? store.domains.filter(d => d.functionId === personTeam.functionId)
    : store.domains.filter(d => d.functionId === activeFunctionId)
  const scopedSkills = store.skills.filter(s => scopedDomains.some(d => d.id === s.domain_id))

  const derivedDomain = derivedPersonDomain(form.skills, store.skills, store.domains)

  const addSkill = () => setForm(f => ({ ...f, skills: [...f.skills, { skill_id: scopedSkills[0]?.id ?? '', level: 'Basic' as Level }] }))
  const updateSkill = (i: number, ps: PersonSkill) => setForm(f => ({ ...f, skills: f.skills.map((s, j) => j === i ? ps : s) }))
  const removeSkill = (i: number) => setForm(f => ({ ...f, skills: f.skills.filter((_, j) => j !== i) }))

  return (
    <div className="border border-brand rounded-md p-3 bg-blue-50/20 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <Select label="Team (required)" value={form.teamId} onChange={e => setForm(f => ({ ...f, teamId: e.target.value }))}>
          <option value="">— select team —</option>
          {scopedTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>
      <div className="text-xs text-gray-500 bg-gray-50 border border-border rounded px-2 py-1.5">
        <span className="font-medium text-gray-600">Primary Domain</span> (derived from skills):{' '}
        <span className="italic">{derivedDomain?.name ?? 'Unassigned'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input label="Hours/Month" type="number" value={form.contracted_hours_per_month} onChange={e => setForm(f => ({ ...f, contracted_hours_per_month: Number(e.target.value) }))} />
        <Input label="Available From" value={form.available_from ?? ''} onChange={e => setForm(f => ({ ...f, available_from: e.target.value || null }))} placeholder="YYYY-MM" />
        <Input label="Available To" value={form.available_to ?? ''} onChange={e => setForm(f => ({ ...f, available_to: e.target.value || null }))} placeholder="YYYY-MM" />
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="accent-brand" />
        Active
      </label>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Skills</span>
          <button onClick={addSkill} className="text-xs text-brand flex items-center gap-1"><Plus size={11} /> Add</button>
        </div>
        {form.skills.map((ps, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <div className="flex-1">
              <DomainSkillSelector
                value={ps.skill_id}
                onChange={id => updateSkill(i, { ...ps, skill_id: id })}
                domains={scopedDomains}
                skills={scopedSkills}
              />
            </div>
            <select value={ps.level} onChange={e => updateSkill(i, { ...ps, level: e.target.value as Level })} className="text-xs border border-border rounded px-1.5 py-1 bg-white">
              {LEVELS.map(l => <option key={l}>{l}</option>)}
            </select>
            <button onClick={() => removeSkill(i)} className="text-gray-300 hover:text-accent-red"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => {
          const derived = derivedPersonDomain(form.skills, store.skills, store.domains)
          onSave({ ...form, primary_domain_id: derived?.id ?? form.primary_domain_id })
        }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function PeoplePanel() {
  const store = useAppStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const activeFunctionId = store.activeFunctionId ?? store.functions[0]?.id ?? ''
  const activeFnName = store.functions.find(f => f.id === activeFunctionId)?.name ?? ''

  // §5: scope to active Function's people (via team membership)
  const activeFnTeamIds = new Set(store.teams.filter(t => t.functionId === activeFunctionId).map(t => t.id))
  const scopedPeople = store.people.filter(p => activeFnTeamIds.has(p.teamId) || (!p.teamId && false))

  const teamMap = new Map(store.teams.map(t => [t.id, t.name]))
  const skillMap = new Map(store.skills.map(s => [s.id, { name: s.name, domain_id: s.domain_id }]))
  const domainMap = new Map(store.domains.map(t => [t.id, t.name]))

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">
          People — {activeFnName} ({scopedPeople.length})
        </h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}><Plus size={12} /> Add Person</Button>
      </div>
      {showNew && (
        <div className="mb-3">
          <PersonForm activeFunctionId={activeFunctionId} onSave={p => { store.addPerson(p); setShowNew(false) }} onCancel={() => setShowNew(false)} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        {scopedPeople.map(person => (
          <div key={person.id} className="border border-border rounded-md overflow-hidden">
            {editId === person.id ? (
              <div className="p-3">
                <PersonForm person={person} activeFunctionId={activeFunctionId} onSave={p => { store.updatePerson(person.id, p); setEditId(null) }} onCancel={() => setEditId(null)} />
              </div>
            ) : (
              <>
                {!person.teamId && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 border-b border-yellow-200 text-xs text-yellow-700">
                    <AlertTriangle size={12} className="shrink-0" />
                    This person is not assigned to a team. Please assign a team.
                  </div>
                )}
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{person.name}</span>
                      {!person.active && <span className="text-xs text-gray-400 bg-gray-100 rounded px-1">Inactive</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {teamMap.get(person.teamId) ?? <span className="text-yellow-600 italic">No team</span>}
                      {' · '}
                      {derivedPersonDomain(person.skills, store.skills, store.domains)?.name ?? 'Unassigned'} (derived)
                      {' · '}{person.contracted_hours_per_month}h/mo
                      {person.available_from && ` · From ${person.available_from}`}
                      {person.available_to && ` · To ${person.available_to}`}
                    </div>
                    {person.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {person.skills.map((ps, i) => {
                          const s = skillMap.get(ps.skill_id)
                          const domain = s ? domainMap.get(store.skills.find(sk => sk.id === ps.skill_id)?.domain_id ?? '') : ''
                          return (
                            <span key={i} className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                              {domain && <span className="text-gray-400">{domain} › </span>}
                              {s?.name ?? ps.skill_id} <span className="text-gray-400">({ps.level})</span>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setEditId(person.id)} className="text-gray-400 hover:text-near-black p-1"><Edit2 size={13} /></button>
                    <button onClick={() => store.deletePerson(person.id)} className="text-gray-300 hover:text-accent-red p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
        {scopedPeople.length === 0 && (
          <p className="text-xs text-gray-400 italic">No people in this Function yet.</p>
        )}
      </div>
    </div>
  )
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function ResetPanel() {
  const store = useAppStore()
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="max-w-md">
      <h3 className="text-sm font-semibold text-near-black mb-3">Reset to Seed Data</h3>
      <div className="border border-orange-200 rounded-md p-4 bg-orange-50 flex flex-col gap-3">
        <div className="flex items-start gap-2 text-sm text-orange-700">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">This will reset all data to the demo seed state.</p>
            <p className="mt-1 text-xs text-orange-600">All changes — demand items, people, domains, and skills — will be permanently discarded.</p>
          </div>
        </div>
        {!confirm ? (
          <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>
            <RefreshCw size={13} /> Reset to seed data
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-orange-800">Are you sure? This cannot be undone.</p>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={() => { store.resetToSeed(); setConfirm(false) }}>
                Yes, reset everything
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Programmes (global — unchanged) ─────────────────────────────────────────

function ProgrammesPanel() {
  const store = useAppStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', description: '' })
  const [editForm, setEditForm] = useState({ name: '', description: '' })

  function projectCount(progId: string) { return store.projects.filter(p => p.programme_id === progId).length }
  function demandCount(progId: string) {
    const projectIds = new Set(store.projects.filter(p => p.programme_id === progId).map(p => p.id))
    return store.demandItems.filter(d => d.parent_project_id && projectIds.has(d.parent_project_id)).length
  }

  function startEdit(prog: typeof store.programmes[0]) {
    setEditId(prog.id)
    setEditForm({ name: prog.name, description: prog.description })
  }

  function handleDelete(progId: string) {
    const hasProjects = store.projects.some(p => p.programme_id === progId)
    if (hasProjects) { alert('Cannot delete: this Programme has Projects. Reassign or delete the Projects first.'); return }
    store.deleteProgramme(progId)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">Programmes ({store.programmes.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}><Plus size={12} /> Add Programme</Button>
      </div>

      {showNew && (
        <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-2">
          <Input label="Name" value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} />
          <Input label="Description" value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => {
              if (!newForm.name.trim()) return
              const dupe = store.programmes.some(p => p.name.toLowerCase() === newForm.name.trim().toLowerCase())
              if (dupe) { alert('A Programme with that name already exists.'); return }
              store.addProgramme({ name: newForm.name.trim(), description: newForm.description, active: true })
              setNewForm({ name: '', description: '' }); setShowNew(false)
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {store.programmes.map(prog => (
          <div key={prog.id} className="border border-border rounded-md px-3 py-2.5">
            {editId === prog.id ? (
              <div className="flex flex-col gap-2">
                <Input label="Name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                <Input label="Description" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => {
                    if (!editForm.name.trim()) return
                    const dupe = store.programmes.some(p => p.id !== prog.id && p.name.toLowerCase() === editForm.name.trim().toLowerCase())
                    if (dupe) { alert('A Programme with that name already exists.'); return }
                    store.updateProgramme(prog.id, { name: editForm.name.trim(), description: editForm.description }); setEditId(null)
                  }}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{prog.name}</span>
                    {!prog.active && <span className="text-xs text-gray-400 bg-gray-100 rounded px-1">Inactive</span>}
                  </div>
                  {prog.description && <p className="text-xs text-gray-500 mt-0.5">{prog.description}</p>}
                  <div className="text-xs text-gray-400 mt-1">{projectCount(prog.id)} projects · {demandCount(prog.id)} demands</div>
                </div>
                <div className="flex gap-1 items-center">
                  <button onClick={() => store.updateProgramme(prog.id, { active: !prog.active })} className="text-gray-400 hover:text-brand p-1" title={prog.active ? 'Deactivate' : 'Activate'}>
                    {prog.active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                  </button>
                  <button onClick={() => startEdit(prog)} className="text-gray-400 hover:text-near-black p-1"><Edit2 size={13} /></button>
                  <button onClick={() => handleDelete(prog.id)} className="text-gray-300 hover:text-accent-red p-1"><Trash2 size={13} /></button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Projects (global, v1.18 — list view with cascade delete, no soft-delete) ──
// §5: list all Projects across all Functions; edit via deep-link to Manage Projects.
// §3: delete cascades to child Demands, their materialised activities/requirements, and allocations.

const PROJECT_STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Scoping: 'bg-blue-50 text-blue-700',
  Submitted: 'bg-yellow-50 text-yellow-700',
  Approved: 'bg-green-50 text-green-700',
  Allocated: 'bg-purple-50 text-purple-700',
}

function ProjectsPanel() {
  const store = useAppStore()
  const navigate = useNavigate()
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Rolled-up hours across next 12 months
  const months = useMemo(() => generateMonths(getCurrentMonth(), 12), [])
  const progMap = new Map(store.programmes.map(p => [p.id, p.name]))

  function childDemandCount(projId: string) {
    return store.demandItems.filter(d => d.parent_project_id === projId).length
  }

  function allocationCount(projId: string) {
    let count = 0
    for (const d of store.demandItems) {
      if (d.parent_project_id !== projId) continue
      for (const activity of d.activities) {
        for (const req of activity.requirements) count += req.allocations.length
      }
    }
    const project = store.projects.find(p => p.id === projId)
    if (project) {
      for (const activity of project.activities) {
        for (const req of activity.requirements) count += req.allocations.length
      }
    }
    return count
  }

  const deleteTarget = deleteConfirmId ? store.projects.find(p => p.id === deleteConfirmId) : null
  const deleteCascadeInfo = deleteTarget ? {
    demands: childDemandCount(deleteTarget.id),
    allocations: allocationCount(deleteTarget.id),
    activities: deleteTarget.activities.length,
  } : null

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-near-black">Projects ({store.projects.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => navigate('/manage-projects')}>
          Manage Projects →
        </Button>
      </div>
      <p className="text-xs text-gray-400 italic mb-4">
        All Projects across all Functions. Click a row to open its edit page. Delete cascades to child Demands and allocations.
      </p>

      {/* Cascade delete confirmation */}
      {deleteTarget && deleteCascadeInfo && (
        <div className="border border-red-300 rounded-md p-4 mb-4 bg-red-50">
          <p className="text-sm font-semibold text-red-700 mb-2">Delete "{deleteTarget.name}"?</p>
          <p className="text-xs text-red-600 mb-3">
            This will permanently delete{' '}
            <strong>{deleteCascadeInfo.demands}</strong> child Demand{deleteCascadeInfo.demands !== 1 ? 's' : ''},{' '}
            <strong>{deleteCascadeInfo.allocations}</strong> allocation{deleteCascadeInfo.allocations !== 1 ? 's' : ''}, and{' '}
            <strong>{deleteCascadeInfo.activities}</strong> activit{deleteCascadeInfo.activities !== 1 ? 'ies' : 'y'}. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => { store.deleteProject(deleteTarget.id); setDeleteConfirmId(null) }}>
              Delete permanently
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border bg-gray-50 text-gray-400 uppercase tracking-wide text-[10px]">
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-left px-3 py-2 font-medium">Programme</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Owner</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-right px-3 py-2 font-medium">Demands</th>
              <th className="text-right px-3 py-2 font-medium">Int. hrs (12m)</th>
              <th className="text-right px-3 py-2 font-medium">Ext. hrs (12m)</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {store.projects.map(proj => {
              const intHrs = Math.round(months.reduce((s, m) => s + project_internal_hours(proj.id, m, store), 0))
              const extHrs = Math.round(months.reduce((s, m) => s + project_external_hours(proj.id, m, store), 0))
              const demands = childDemandCount(proj.id)
              return (
                <tr
                  key={proj.id}
                  className="border-b border-border/50 hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/manage-projects/${proj.id}/edit`)}
                >
                  <td className="px-3 py-2 font-medium text-brand">{proj.name}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {proj.programme_id
                      ? (progMap.get(proj.programme_id) ?? '—')
                      : <em className="text-gray-300">No Programme</em>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium', PROJECT_STATUS_COLORS[proj.status] ?? 'bg-gray-100 text-gray-600')}>
                      {proj.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 truncate max-w-[90px]">{proj.owner || <em className="text-gray-300">—</em>}</td>
                  <td className="px-3 py-2 text-gray-400 text-[10px] truncate max-w-[90px]">{proj.type}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{demands}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{intHrs > 0 ? `${intHrs}h` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{extHrs > 0 ? `${extHrs}h` : '—'}</td>
                  <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setDeleteConfirmId(proj.id)}
                      className="text-gray-300 hover:text-accent-red p-1"
                      title="Delete with cascade"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {store.projects.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-400 italic text-xs">
                  No projects yet. Create one from Manage Projects.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Providers (global — unchanged) ──────────────────────────────────────────

function ProvidersPanel() {
  const store = useAppStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [editName, setEditName] = useState('')
  const [reassignFrom, setReassignFrom] = useState<string | null>(null)
  const [reassignTo, setReassignTo] = useState('')

  function inUseCount(providerId: string) {
    return store.externalResourceRequirements.filter(r => r.provider_id === providerId).length
  }

  function handleDelete(providerId: string) {
    const count = inUseCount(providerId)
    if (count > 0) { alert(`Cannot delete: ${count} external requirement(s) reference this Provider. Use "Reassign all" first.`); return }
    store.deleteProvider(providerId)
  }

  function handleReassign(fromId: string, toId: string) {
    if (!toId || toId === fromId) return
    for (const req of store.externalResourceRequirements) {
      if (req.provider_id === fromId) store.updateExternalRequirement(req.id, { provider_id: toId })
    }
    setReassignFrom(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">Providers ({store.providers.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}><Plus size={12} /> Add Provider</Button>
      </div>

      {showNew && (
        <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-2">
          <Input label="Name" value={newName} onChange={e => setNewName(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => {
              if (!newName.trim()) return
              const dupe = store.providers.some(p => p.name.toLowerCase() === newName.trim().toLowerCase())
              if (dupe) { alert('A Provider with that name already exists.'); return }
              store.addProvider({ name: newName.trim() }); setNewName(''); setShowNew(false)
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {store.providers.map(prov => {
          const count = inUseCount(prov.id)
          return (
            <div key={prov.id} className="border border-border rounded-md px-3 py-2.5">
              {editId === prov.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    className="flex-1 text-sm border border-brand rounded px-2 py-0.5"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const dupe = store.providers.some(p => p.id !== prov.id && p.name.toLowerCase() === editName.trim().toLowerCase())
                        if (dupe) { alert('Name collision.'); return }
                        store.updateProvider(prov.id, { name: editName.trim() }); setEditId(null)
                      }
                      if (e.key === 'Escape') setEditId(null)
                    }}
                  />
                  <button onClick={() => {
                    const dupe = store.providers.some(p => p.id !== prov.id && p.name.toLowerCase() === editName.trim().toLowerCase())
                    if (dupe) { alert('Name collision.'); return }
                    store.updateProvider(prov.id, { name: editName.trim() }); setEditId(null)
                  }} className="text-brand"><Check size={13} /></button>
                  <button onClick={() => setEditId(null)} className="text-gray-400"><X size={13} /></button>
                </div>
              ) : reassignFrom === prov.id ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-600">Reassign all {count} requirement(s) from <strong>{prov.name}</strong> to:</p>
                  <Select label="" value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
                    <option value="">— select provider —</option>
                    {store.providers.filter(p => p.id !== prov.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => handleReassign(prov.id, reassignTo)}>Reassign all</Button>
                    <Button size="sm" variant="ghost" onClick={() => setReassignFrom(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <span className="text-sm font-medium">{prov.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{count} requirement{count !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex gap-1">
                    {count > 0 && (
                      <button onClick={() => { setReassignFrom(prov.id); setReassignTo('') }} className="text-xs text-brand hover:text-brand-hover px-2 py-1 border border-brand rounded">
                        Reassign all
                      </button>
                    )}
                    <button onClick={() => { setEditId(prov.id); setEditName(prov.name) }} className="text-gray-400 hover:text-near-black p-1"><Edit2 size={13} /></button>
                    <button onClick={() => handleDelete(prov.id)} className="text-gray-300 hover:text-accent-red p-1"><Trash2 size={13} /></button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Project Types (global, new in v1.19) ─────────────────────────────────────

const PROJECT_TYPE_PALETTE: { token: string; label: string; hex: string }[] = [
  { token: 'colour-bau',            label: 'Slate',   hex: '#94a3b8' },
  { token: 'colour-plant-project',  label: 'Blue',    hex: '#60a5fa' },
  { token: 'colour-npd',            label: 'Emerald', hex: '#34d399' },
  { token: 'colour-group-strategy', label: 'Violet',  hex: '#a78bfa' },
  { token: 'colour-amber',          label: 'Amber',   hex: '#fbbf24' },
  { token: 'colour-rose',           label: 'Rose',    hex: '#fb7185' },
  { token: 'colour-teal',           label: 'Teal',    hex: '#2dd4bf' },
  { token: 'colour-orange',         label: 'Orange',  hex: '#fb923c' },
]

function hexForToken(token: string): string {
  return PROJECT_TYPE_PALETTE.find(p => p.token === token)?.hex ?? '#94a3b8'
}

function SwatchPicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PROJECT_TYPE_PALETTE.map(p => (
        <button key={p.token} type="button" title={p.label} onClick={() => onChange(p.token)}
          className={clsx('w-6 h-6 rounded border-2 transition-all',
            value === p.token ? 'border-near-black ring-1 ring-near-black' : 'border-transparent hover:border-gray-400')}
          style={{ backgroundColor: p.hex }}
        />
      ))}
    </div>
  )
}

interface STypeRowProps {
  pt: ProjectType
  count: number
  isEditing: boolean; editName: string; editToken: string
  isReassigning: boolean; reassignTo: string
  otherTypes: ProjectType[]
  onStartEdit: () => void; onSaveEdit: () => void; onCancelEdit: () => void
  onEditName: (v: string) => void; onEditToken: (v: string) => void
  onToggleActive: () => void; onDelete: () => void
  onStartReassign: () => void; onReassignTo: (v: string) => void
  onDoReassign: () => void; onCancelReassign: () => void
}

function STypeRow(props: STypeRowProps) {
  const { pt, count, isEditing, editName, editToken, isReassigning, reassignTo, otherTypes } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pt.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div ref={setNodeRef} style={style} className={clsx('border border-border rounded-md px-3 py-2.5 bg-white', isDragging && 'opacity-50 shadow-card')}>
      {isEditing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input autoFocus value={editName} onChange={e => props.onEditName(e.target.value)}
              placeholder="Name" className="flex-1 text-sm border border-brand rounded px-2 py-0.5"
              onKeyDown={e => { if (e.key === 'Enter') props.onSaveEdit(); if (e.key === 'Escape') props.onCancelEdit() }}
            />
          </div>
          <div><p className="text-xs text-gray-500 mb-1">Colour</p><SwatchPicker value={editToken} onChange={props.onEditToken} /></div>
          <div className="flex gap-2">
            <button onClick={props.onSaveEdit} className="text-brand p-1"><Check size={13} /></button>
            <button onClick={props.onCancelEdit} className="text-gray-400 p-1"><X size={13} /></button>
          </div>
        </div>
      ) : isReassigning ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-600">Reassign all {count} item(s) from <strong>{pt.name}</strong> to:</p>
          <Select label="" value={reassignTo} onChange={e => props.onReassignTo(e.target.value)}>
            <option value="">— select type —</option>
            {otherTypes.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={props.onDoReassign}>Reassign all</Button>
            <Button size="sm" variant="ghost" onClick={props.onCancelReassign}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div {...listeners} {...attributes} className="text-gray-300 hover:text-gray-400 cursor-grab shrink-0">
            <GripVertical size={15} />
          </div>
          <div className="w-4 h-4 rounded border border-border shrink-0" style={{ backgroundColor: hexForToken(pt.colour_token) }} title={pt.colour_token} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{pt.name}</span>
              {pt.is_bau && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">BAU</span>}
              {!pt.active && <span className="text-[10px] text-gray-400 italic">inactive</span>}
            </div>
            <code className="text-[10px] text-gray-400 font-mono">{pt.id}</code>
          </div>
          <span className="text-xs text-gray-400 shrink-0">{count} in use</span>
          <div className="flex items-center gap-1.5">
            {count > 0 && (
              <button onClick={props.onStartReassign} className="text-xs text-brand hover:text-brand-hover px-2 py-0.5 border border-brand rounded">
                Reassign all
              </button>
            )}
            <button onClick={props.onToggleActive} title={pt.active ? 'Deactivate' : 'Activate'} className="p-0.5">
              {pt.active ? <ToggleRight size={18} className="text-brand" /> : <ToggleLeft size={18} className="text-gray-400" />}
            </button>
            <button onClick={props.onStartEdit} className="text-gray-400 hover:text-near-black p-1"><Edit2 size={13} /></button>
            <button onClick={props.onDelete} className="text-gray-300 hover:text-accent-red p-1"><Trash2 size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectTypesPanel() {
  const store = useAppStore()
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newToken, setNewToken] = useState(PROJECT_TYPE_PALETTE[0].token)
  const [newNameError, setNewNameError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editToken, setEditToken] = useState('')
  const [reassignFrom, setReassignFrom] = useState<string | null>(null)
  const [reassignTo, setReassignTo] = useState('')

  const sorted = useMemo(
    () => [...store.projectTypes].sort((a, b) => a.display_order - b.display_order),
    [store.projectTypes]
  )
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function inUseCount(ptId: string) {
    return store.projects.filter(p => p.type === ptId).length + store.demandItems.filter(d => d.type === ptId).length
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sorted.findIndex(p => p.id === active.id)
    const newIdx = sorted.findIndex(p => p.id === over.id)
    arrayMove(sorted, oldIdx, newIdx).forEach((pt, idx) => {
      if (pt.display_order !== idx) store.updateProjectType(pt.id, { display_order: idx })
    })
  }

  function handleDelete(ptId: string) {
    const pt = store.projectTypes.find(p => p.id === ptId)
    if (!pt) return
    if (pt.is_bau) { alert('The BAU Project Type cannot be deleted — the system requires exactly one BAU record at all times.'); return }
    const count = inUseCount(ptId)
    if (count > 0) { alert(`Cannot delete: ${count} Project(s)/Demand(s) reference this type. Reassign them first or deactivate the type.`); return }
    store.deleteProjectType(ptId)
  }

  function handleReassign(fromId: string, toId: string) {
    if (!toId || toId === fromId) return
    store.projects.filter(p => p.type === fromId).forEach(p => store.updateProject(p.id, { type: toId }))
    store.demandItems.filter(d => d.type === fromId).forEach(d => store.updateDemandItem(d.id, { type: toId }))
    setReassignFrom(null); setReassignTo('')
  }

  function saveNew() {
    if (!newName.trim()) return
    const nextOrder = sorted.length > 0 ? sorted[sorted.length - 1].display_order + 1 : 0
    const err = store.addProjectType({ name: newName.trim(), display_order: nextOrder, colour_token: newToken, is_bau: false, active: true })
    if (err) { setNewNameError(err); return }
    setNewName(''); setNewToken(PROJECT_TYPE_PALETTE[0].token); setShowNew(false); setNewNameError(null)
  }

  function saveEdit(ptId: string) {
    if (!editName.trim()) return
    const dupe = store.projectTypes.some(p => p.id !== ptId && p.active && p.name.toLowerCase() === editName.trim().toLowerCase())
    if (dupe) { alert('An active Project Type with that name already exists.'); return }
    store.updateProjectType(ptId, { name: editName.trim(), colour_token: editToken })
    setEditId(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">Project Types ({store.projectTypes.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}><Plus size={12} /> Add Project Type</Button>
      </div>
      <p className="text-xs text-gray-500 mb-4">Drag to reorder — order drives capacity-stack bottom-to-top on all charts. Inactive types remain on existing records but disappear from pickers.</p>

      {showNew && (
        <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <Input label="Name" value={newName} onChange={e => { setNewName(e.target.value); setNewNameError(null) }} />
            {newName.trim() && (
              <p className="text-[11px] text-gray-500 mt-0.5">
                System key: <code className="font-mono text-gray-700">{slugifyProjectTypeId(newName.trim())}</code>
              </p>
            )}
            {newNameError && <p className="text-[11px] text-accent-red mt-0.5">{newNameError}</p>}
          </div>
          <div><p className="text-xs text-gray-500 mb-1.5">Colour</p><SwatchPicker value={newToken} onChange={setNewToken} /></div>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={saveNew}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setNewName(''); setShowNew(false); setNewNameError(null) }}>Cancel</Button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sorted.map(p => p.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {sorted.map(pt => (
              <STypeRow key={pt.id} pt={pt} count={inUseCount(pt.id)}
                isEditing={editId === pt.id} editName={editName} editToken={editToken}
                isReassigning={reassignFrom === pt.id} reassignTo={reassignTo}
                otherTypes={sorted.filter(p => p.id !== pt.id)}
                onStartEdit={() => { setEditId(pt.id); setEditName(pt.name); setEditToken(pt.colour_token) }}
                onSaveEdit={() => saveEdit(pt.id)}
                onCancelEdit={() => setEditId(null)}
                onEditName={setEditName}
                onEditToken={setEditToken}
                onToggleActive={() => store.updateProjectType(pt.id, { active: !pt.active })}
                onDelete={() => handleDelete(pt.id)}
                onStartReassign={() => { setReassignFrom(pt.id); setReassignTo('') }}
                onReassignTo={setReassignTo}
                onDoReassign={() => handleReassign(pt.id, reassignTo)}
                onCancelReassign={() => setReassignFrom(null)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

// ─── Admin shell ──────────────────────────────────────────────────────────────

export default function Admin() {
  const [tab, setTab] = useState<Tab>('Functions')

  return (
    <div className="flex h-full" data-admin-screen="true">
      <div className="w-48 border-r border-border bg-gray-50 flex flex-col py-4 gap-0.5 px-2">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'text-left px-3 py-2 text-sm rounded transition-colors',
              tab === t ? 'bg-near-black text-white font-medium' : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'Functions'        && <FunctionsPanel />}
        {tab === 'Teams'            && <TeamsPanel />}
        {tab === 'Domains & Skills' && <DomainsSkillsPanel />}
        {tab === 'People'           && <PeoplePanel />}
        {tab === 'Programmes'       && <ProgrammesPanel />}
        {tab === 'Projects'         && <ProjectsPanel />}
        {tab === 'Providers'        && <ProvidersPanel />}
        {tab === 'Project Types'    && <ProjectTypesPanel />}
        {tab === 'Reset'            && <ResetPanel />}
      </div>
    </div>
  )
}
