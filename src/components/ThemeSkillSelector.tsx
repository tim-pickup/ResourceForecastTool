import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import type { Theme, Skill } from '../types'

interface Props {
  value: string | null
  onChange: (skillId: string) => void
  themes: Theme[]
  skills: Skill[]
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function ThemeSkillSelector({ value, onChange, themes, skills, placeholder = 'Select skill…', className, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})

  const selectedSkill = skills.find(s => s.id === value)
  const selectedTheme = selectedSkill ? themes.find(t => t.id === selectedSkill.theme_id) : null

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      const inButton = buttonRef.current?.contains(target)
      const inDropdown = dropdownRef.current?.contains(target)
      if (!inButton && !inDropdown) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Recompute position on scroll/resize while open
  useEffect(() => {
    if (!open) return
    function updatePos() {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 9999,
      })
    }
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  const openDropdown = () => {
    if (disabled) return
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 220),
      zIndex: 9999,
    })
    setOpen(o => !o)
    setSearch('')
  }

  const filteredSkills = search
    ? skills.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
    : skills

  const skillsByTheme = themes.map(t => ({
    theme: t,
    skills: filteredSkills.filter(s => s.theme_id === t.id),
  })).filter(g => g.skills.length > 0)

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className="bg-white border border-border rounded shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border">
        <Search size={11} className="text-gray-400 shrink-0" />
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="flex-1 text-xs focus:outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-gray-300 hover:text-gray-500">
            <X size={11} />
          </button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto">
        {skillsByTheme.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400 italic">No skills match.</p>
        )}
        {skillsByTheme.map(({ theme, skills: tSkills }) => (
          <div key={theme.id}>
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 sticky top-0">
              {theme.name}
            </div>
            {tSkills.map(skill => (
              <button
                key={skill.id}
                type="button"
                onClick={() => { onChange(skill.id); setOpen(false); setSearch('') }}
                className={clsx(
                  'w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 transition-colors',
                  skill.id === value ? 'text-brand font-medium bg-blue-50/50' : 'text-near-black'
                )}
              >
                {skill.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body
  ) : null

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
          <span className="flex items-center gap-1 truncate">
            <span className="text-gray-400">{selectedTheme?.name}</span>
            <span className="text-gray-300">›</span>
            <span className="text-near-black">{selectedSkill.name}</span>
          </span>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
        <ChevronDown size={12} className={clsx('shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {dropdown}
    </div>
  )
}
