import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { Domain, Skill } from '../types'

// AppFunction inline type to avoid circular imports
interface AppFunction { id: string; name: string; active: boolean }

interface Props {
  value: string | null
  onChange: (skillId: string) => void
  domains: Domain[]
  skills: Skill[]
  functions?: AppFunction[]      // required when crossFunctionMode=true
  crossFunctionMode?: boolean    // two-step Function→Domain→Skill (Project Scoping)
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function DomainSkillSelector({
  value, onChange, domains, skills, functions = [],
  crossFunctionMode = false,
  placeholder = 'Select skill…', className, disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pickedFunctionId, setPickedFunctionId] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const selectedSkill = skills.find(s => s.id === value)
  const selectedDomain = selectedSkill ? domains.find(t => t.id === selectedSkill.domain_id) : null
  const selectedFunction = crossFunctionMode && selectedDomain
    ? functions.find(f => f.id === selectedDomain.functionId)
    : null

  function close() { setOpen(false); setSearch(''); setPickedFunctionId(null) }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !dropdownRef.current?.contains(t)) close()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    function updatePos() {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240), zIndex: 9999 })
    }
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => { window.removeEventListener('scroll', updatePos, true); window.removeEventListener('resize', updatePos) }
  }, [open])

  const openDropdown = () => {
    if (disabled) return
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setDropdownStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 240), zIndex: 9999 })
    setOpen(o => !o)
    setSearch('')
    setPickedFunctionId(null)
  }

  // ── Dropdown content ──────────────────────────────────────────────────────

  function selectSkill(skillId: string) { onChange(skillId); close() }

  // Cross-Function search hits: match across all Functions/Domains/Skills
  const crossSearchHits = crossFunctionMode && search
    ? skills.filter(s => {
        const d = domains.find(d => d.id === s.domain_id)
        const fn = d ? functions.find(f => f.id === d.functionId) : null
        const text = `${fn?.name ?? ''} ${d?.name ?? ''} ${s.name}`.toLowerCase()
        return text.includes(search.toLowerCase())
      })
    : []

  // Single-Function filtered skills
  const singleFiltered = !crossFunctionMode && search
    ? skills.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : skills

  const skillsByDomain = domains.map(d => ({
    domain: d,
    skills: (!crossFunctionMode ? singleFiltered : skills.filter(s => s.domain_id === d.id && (!pickedFunctionId || d.functionId === pickedFunctionId)))
      .filter(s => s.domain_id === d.id),
  })).filter(g => g.skills.length > 0)

  const dropdownContent = crossFunctionMode ? (
    <div ref={dropdownRef} style={dropdownStyle} className="bg-white border border-border rounded shadow-lg overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <Search size={11} className="text-gray-400 shrink-0" />
        <input
          autoFocus
          value={search}
          onChange={e => { setSearch(e.target.value); setPickedFunctionId(null) }}
          placeholder="Search all skills…"
          className="flex-1 text-xs focus:outline-none"
        />
        {search && <button onClick={() => setSearch('')} className="text-gray-300 hover:text-gray-500"><X size={11} /></button>}
      </div>

      {search ? (
        /* Search results — cross-Function with Function·Domain prefix */
        <div className="max-h-56 overflow-y-auto">
          {crossSearchHits.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400 italic">No skills match.</p>
          )}
          {crossSearchHits.map(skill => {
            const d = domains.find(d => d.id === skill.domain_id)
            const fn = d ? functions.find(f => f.id === d.functionId) : null
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => selectSkill(skill.id)}
                className={clsx('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors', skill.id === value && 'text-brand font-medium bg-blue-50/50')}
              >
                <span className="text-gray-400">{fn?.name} · {d?.name}</span>
                <span className="text-gray-300 mx-1">›</span>
                <span className="text-near-black">{skill.name}</span>
              </button>
            )
          })}
        </div>
      ) : pickedFunctionId ? (
        /* Step 2: Domain → Skill for chosen Function */
        <div>
          <button
            type="button"
            onClick={() => setPickedFunctionId(null)}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-brand hover:text-brand-hover border-b border-border w-full"
          >
            <ChevronLeft size={12} />
            <span className="font-medium">{functions.find(f => f.id === pickedFunctionId)?.name}</span>
          </button>
          <div className="max-h-52 overflow-y-auto">
            {domains.filter(d => d.functionId === pickedFunctionId).map(domain => {
              const dSkills = skills.filter(s => s.domain_id === domain.id)
              if (dSkills.length === 0) return null
              return (
                <div key={domain.id}>
                  <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 sticky top-0">
                    {domain.name}
                  </div>
                  {dSkills.map(skill => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => selectSkill(skill.id)}
                      className={clsx('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors', skill.id === value && 'text-brand font-medium bg-blue-50/50')}
                    >
                      {skill.name}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* Step 1: Function list */
        <div className="max-h-52 overflow-y-auto">
          {functions.filter(f => f.active).map(fn => (
            <button
              key={fn.id}
              type="button"
              onClick={() => setPickedFunctionId(fn.id)}
              className="w-full text-left px-3 py-2 text-xs font-medium text-near-black hover:bg-gray-50 transition-colors flex items-center justify-between"
            >
              <span>{fn.name}</span>
              <ChevronDown size={12} className="text-gray-400 -rotate-90" />
            </button>
          ))}
        </div>
      )}
    </div>
  ) : (
    /* Single-Function mode (existing) */
    <div ref={dropdownRef} style={dropdownStyle} className="bg-white border border-border rounded shadow-lg overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <Search size={11} className="text-gray-400 shrink-0" />
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="flex-1 text-xs focus:outline-none"
        />
        {search && <button onClick={() => setSearch('')} className="text-gray-300 hover:text-gray-500"><X size={11} /></button>}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {skillsByDomain.length === 0 && <p className="px-3 py-2 text-xs text-gray-400 italic">No skills match.</p>}
        {skillsByDomain.map(({ domain, skills: dSkills }) => (
          <div key={domain.id}>
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 sticky top-0">
              {domain.name}
            </div>
            {dSkills.map(skill => (
              <button
                key={skill.id}
                type="button"
                onClick={() => selectSkill(skill.id)}
                className={clsx('w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors', skill.id === value ? 'text-brand font-medium bg-blue-50/50' : 'text-near-black')}
              >
                {skill.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={clsx('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={openDropdown}
        className={clsx(
          'w-full flex items-center justify-between gap-1 text-xs border border-border rounded px-2 py-1 bg-white text-left',
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-border-hover cursor-pointer',
          open && 'border-brand ring-1 ring-brand/20'
        )}
      >
        {selectedSkill ? (
          crossFunctionMode && selectedFunction ? (
            /* Cross-Function display: Function · Domain > Skill */
            <span className="flex items-center gap-1 truncate">
              <span className="text-near-black font-medium">{selectedFunction.name}</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">{selectedDomain?.name}</span>
              <span className="text-gray-300">›</span>
              <span className="text-near-black">{selectedSkill.name}</span>
            </span>
          ) : (
            /* Single-Function display: Domain > Skill */
            <span className="flex items-center gap-1 truncate">
              <span className="text-gray-400">{selectedDomain?.name}</span>
              <span className="text-gray-300">›</span>
              <span className="text-near-black">{selectedSkill.name}</span>
            </span>
          )
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
        <ChevronDown size={12} className={clsx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? createPortal(dropdownContent, document.body) : null}
    </div>
  )
}
