import { useState } from 'react'
import { Plus, Trash2, Edit2, Check, X, AlertTriangle, RefreshCw } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import type { Theme, Skill, Person, BauStream, BauAllocation, Level, PersonSkill } from '../../types'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/FormFields'
import { ThemeSkillSelector } from '../../components/ThemeSkillSelector'
import { clsx } from 'clsx'

const LEVELS: Level[] = ['Basic', 'Advanced', 'Specialist']
const TABS = ['Themes & Skills', 'People', 'BAU', 'Reset'] as const
type Tab = typeof TABS[number]

// ---- Themes & Skills ----
function ThemesSkillsPanel() {
  const store = useAppStore()
  const [editThemeId, setEditThemeId] = useState<string | null>(null)
  const [newTheme, setNewTheme] = useState({ name: '', description: '' })
  const [showNewTheme, setShowNewTheme] = useState(false)
  const [editSkillId, setEditSkillId] = useState<string | null>(null)
  const [showNewSkillFor, setShowNewSkillFor] = useState<string | null>(null)
  const [newSkill, setNewSkill] = useState({ name: '', theme_id: '' })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-near-black">Themes</h3>
          <Button size="sm" variant="secondary" onClick={() => setShowNewTheme(true)}>
            <Plus size={12} /> Add Theme
          </Button>
        </div>
        {showNewTheme && (
          <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/30 flex flex-col gap-2">
            <Input label="Theme Name" value={newTheme.name} onChange={e => setNewTheme(n => ({ ...n, name: e.target.value }))} />
            <Input label="Description" value={newTheme.description} onChange={e => setNewTheme(n => ({ ...n, description: e.target.value }))} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => { store.addTheme(newTheme); setNewTheme({ name: '', description: '' }); setShowNewTheme(false) }}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewTheme(false)}>Cancel</Button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {store.themes.map(theme => {
            const themeSkills = store.skills.filter(s => s.theme_id === theme.id)
            return (
              <div key={theme.id} className="border border-border rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                  {editThemeId === theme.id ? (
                    <InlineEdit
                      value={theme.name}
                      onSave={v => { store.updateTheme(theme.id, { name: v }); setEditThemeId(null) }}
                      onCancel={() => setEditThemeId(null)}
                    />
                  ) : (
                    <>
                      <span className="text-sm font-semibold flex-1">{theme.name}</span>
                      <span className="text-xs text-gray-400">{theme.description}</span>
                      <button onClick={() => setEditThemeId(theme.id)} className="text-gray-400 hover:text-near-black"><Edit2 size={13} /></button>
                      <button onClick={() => store.deleteTheme(theme.id)} className="text-gray-300 hover:text-accent-red"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
                <div className="px-3 py-2 flex flex-col gap-1.5">
                  {themeSkills.map(skill => (
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
                  {showNewSkillFor === theme.id ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        autoFocus
                        value={newSkill.name}
                        onChange={e => setNewSkill({ name: e.target.value, theme_id: theme.id })}
                        placeholder="Skill name"
                        className="flex-1 text-xs border border-border rounded px-2 py-1 focus:outline-none focus:border-brand"
                        onKeyDown={e => {
                          if (e.key === 'Enter') { store.addSkill({ name: newSkill.name, theme_id: theme.id }); setNewSkill({ name: '', theme_id: '' }); setShowNewSkillFor(null) }
                          if (e.key === 'Escape') { setShowNewSkillFor(null) }
                        }}
                      />
                      <button onClick={() => { store.addSkill({ name: newSkill.name, theme_id: theme.id }); setNewSkill({ name: '', theme_id: '' }); setShowNewSkillFor(null) }} className="text-brand hover:text-brand-hover"><Check size={13} /></button>
                      <button onClick={() => setShowNewSkillFor(null)} className="text-gray-400"><X size={13} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setShowNewSkillFor(theme.id)} className="text-xs text-brand hover:text-brand-hover flex items-center gap-1 mt-1">
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

// ---- People ----
function PersonForm({ person, onSave, onCancel }: { person?: Person; onSave: (p: any) => void; onCancel: () => void }) {
  const store = useAppStore()
  const [form, setForm] = useState<Omit<Person, 'id'>>(person ?? {
    name: '', primary_theme_id: store.themes[0]?.id ?? '', contracted_hours_per_month: 152,
    available_from: null, available_to: null, active: true, skills: []
  })

  const addSkill = () => setForm(f => ({ ...f, skills: [...f.skills, { skill_id: store.skills[0]?.id ?? '', level: 'Basic' as Level }] }))
  const updateSkill = (i: number, ps: PersonSkill) => setForm(f => ({ ...f, skills: f.skills.map((s, j) => j === i ? ps : s) }))
  const removeSkill = (i: number) => setForm(f => ({ ...f, skills: f.skills.filter((_, j) => j !== i) }))

  const getThemeName = (skillId: string) => {
    const skill = store.skills.find(s => s.id === skillId)
    return store.themes.find(t => t.id === skill?.theme_id)?.name ?? ''
  }

  return (
    <div className="border border-brand rounded-md p-3 bg-blue-50/20 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <Select label="Primary Theme" value={form.primary_theme_id} onChange={e => setForm(f => ({ ...f, primary_theme_id: e.target.value }))}>
          {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
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
              <ThemeSkillSelector
                value={ps.skill_id}
                onChange={id => updateSkill(i, { ...ps, skill_id: id })}
                themes={store.themes}
                skills={store.skills}
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
        <Button size="sm" variant="primary" onClick={() => onSave(form)}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function PeoplePanel() {
  const store = useAppStore()
  const [editId, setEditId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const themeMap = new Map(store.themes.map(t => [t.id, t.name]))
  const skillMap = new Map(store.skills.map(s => [s.id, { name: s.name, theme_id: s.theme_id }]))

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">People ({store.people.length})</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}><Plus size={12} /> Add Person</Button>
      </div>
      {showNew && (
        <div className="mb-3">
          <PersonForm onSave={p => { store.addPerson(p); setShowNew(false) }} onCancel={() => setShowNew(false)} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        {store.people.map(person => (
          <div key={person.id} className="border border-border rounded-md overflow-hidden">
            {editId === person.id ? (
              <div className="p-3">
                <PersonForm person={person} onSave={p => { store.updatePerson(person.id, p); setEditId(null) }} onCancel={() => setEditId(null)} />
              </div>
            ) : (
              <div className="flex items-start gap-3 px-3 py-2.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{person.name}</span>
                    {!person.active && <span className="text-xs text-gray-400 bg-gray-100 rounded px-1">Inactive</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {themeMap.get(person.primary_theme_id)} · {person.contracted_hours_per_month}h/mo
                    {person.available_from && ` · From ${person.available_from}`}
                    {person.available_to && ` · To ${person.available_to}`}
                  </div>
                  {person.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {person.skills.map((ps, i) => {
                        const s = skillMap.get(ps.skill_id)
                        const theme = s ? themeMap.get(store.skills.find(sk => sk.id === ps.skill_id)?.theme_id ?? '') : ''
                        return (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                            {theme && <span className="text-gray-400">{theme} › </span>}
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
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- BAU ----
function BauPanel() {
  const store = useAppStore()
  const [showNewStream, setShowNewStream] = useState(false)
  const [newStream, setNewStream] = useState({ name: '', description: '', owning_theme_id: '' })
  const [showNewAlloc, setShowNewAlloc] = useState<string | null>(null)
  const [newAlloc, setNewAlloc] = useState<Omit<BauAllocation, 'id'>>({
    person_id: '', stream_id: '', hours_per_month: 0, effective_from: '', effective_to: null
  })
  const personMap = new Map(store.people.map(p => [p.id, p.name]))
  const themeMap = new Map(store.themes.map(t => [t.id, t.name]))

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-near-black">BAU Streams</h3>
        <Button size="sm" variant="secondary" onClick={() => setShowNewStream(true)}><Plus size={12} /> Add Stream</Button>
      </div>
      {showNewStream && (
        <div className="border border-brand rounded-md p-3 mb-3 bg-blue-50/20 flex flex-col gap-2">
          <Input label="Stream Name" value={newStream.name} onChange={e => setNewStream(n => ({ ...n, name: e.target.value }))} />
          <Input label="Description" value={newStream.description} onChange={e => setNewStream(n => ({ ...n, description: e.target.value }))} />
          <Select label="Owning Theme" value={newStream.owning_theme_id} onChange={e => setNewStream(n => ({ ...n, owning_theme_id: e.target.value }))}>
            <option value="">Select theme</option>
            {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => { store.addBauStream(newStream); setNewStream({ name: '', description: '', owning_theme_id: '' }); setShowNewStream(false) }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowNewStream(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {store.bauStreams.map(stream => {
          const allocs = store.bauAllocations.filter(a => a.stream_id === stream.id)
          return (
            <div key={stream.id} className="border border-border rounded-md overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50">
                <div className="flex-1">
                  <span className="text-sm font-medium">{stream.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{themeMap.get(stream.owning_theme_id)}</span>
                </div>
                <button onClick={() => setShowNewAlloc(stream.id)} className="text-xs text-brand flex items-center gap-1"><Plus size={11} /> Allocation</button>
                <button onClick={() => store.deleteBauStream(stream.id)} className="text-gray-300 hover:text-accent-red"><Trash2 size={13} /></button>
              </div>
              {showNewAlloc === stream.id && (
                <div className="px-3 py-2 border-t border-border bg-blue-50/20 flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Select label="Person" value={newAlloc.person_id} onChange={e => setNewAlloc(a => ({ ...a, person_id: e.target.value }))}>
                      <option value="">Select person</option>
                      {store.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                    <Input label="Hours/Month" type="number" value={newAlloc.hours_per_month} onChange={e => setNewAlloc(a => ({ ...a, hours_per_month: Number(e.target.value) }))} />
                    <Input label="Effective From" value={newAlloc.effective_from} onChange={e => setNewAlloc(a => ({ ...a, effective_from: e.target.value }))} placeholder="YYYY-MM" />
                    <Input label="Effective To" value={newAlloc.effective_to ?? ''} onChange={e => setNewAlloc(a => ({ ...a, effective_to: e.target.value || null }))} placeholder="YYYY-MM or blank" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => {
                      store.addBauAllocation({ ...newAlloc, stream_id: stream.id })
                      setShowNewAlloc(null)
                      setNewAlloc({ person_id: '', stream_id: '', hours_per_month: 0, effective_from: '', effective_to: null })
                    }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowNewAlloc(null)}>Cancel</Button>
                  </div>
                </div>
              )}
              <div className="px-3 py-2 flex flex-col gap-1.5">
                {allocs.length === 0 && <p className="text-xs text-gray-400 italic">No allocations yet.</p>}
                {allocs.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-xs">
                    <span className="flex-1">{personMap.get(a.person_id) ?? a.person_id}</span>
                    <span className="text-gray-600 font-medium">{a.hours_per_month}h/mo</span>
                    <span className="text-gray-400">{a.effective_from} → {a.effective_to ?? 'open'}</span>
                    <button onClick={() => store.deleteBauAllocation(a.id)} className="text-gray-300 hover:text-accent-red"><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- Reset ----
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
            <p className="mt-1 text-xs text-orange-600">All changes — demand items, people, BAU allocations, themes, and skills — will be permanently discarded.</p>
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

export default function Admin() {
  const [tab, setTab] = useState<Tab>('Themes & Skills')

  return (
    <div className="flex h-full">
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
        {tab === 'Themes & Skills' && <ThemesSkillsPanel />}
        {tab === 'People' && <PeoplePanel />}
        {tab === 'BAU' && <BauPanel />}
        {tab === 'Reset' && <ResetPanel />}
      </div>
    </div>
  )
}
