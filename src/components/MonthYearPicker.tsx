import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format, parseISO } from 'date-fns'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseYM(value: string): { year: number; month: number } | null {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null
  const year = parseInt(value.slice(0, 4))
  const month = parseInt(value.slice(5, 7)) - 1
  if (month < 0 || month > 11) return null
  return { year, month }
}

function toYM(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

interface MonthYearPickerProps {
  value: string
  onChange: (value: string) => void
  label?: string
  disabled?: boolean
  minValue?: string   // months before this are disabled in the picker
  placeholder?: string
}

export function MonthYearPicker({
  value, onChange, label, disabled, minValue, placeholder = '—',
}: MonthYearPickerProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})

  const parsed = parseYM(value)
  const currentYear = new Date().getFullYear()
  const [displayYear, setDisplayYear] = useState(parsed?.year ?? currentYear)

  useEffect(() => {
    const p = parseYM(value)
    if (p) setDisplayYear(p.year)
  }, [value])

  const displayLabel = parsed ? format(parseISO(value + '-01'), 'MMM yyyy') : null

  function computeStyle() {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPopoverStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 9999, minWidth: 200 })
  }

  useEffect(() => {
    if (!open) return
    computeStyle()
    window.addEventListener('scroll', computeStyle, true)
    window.addEventListener('resize', computeStyle)
    return () => {
      window.removeEventListener('scroll', computeStyle, true)
      window.removeEventListener('resize', computeStyle)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (!buttonRef.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function openPicker() {
    if (disabled) return
    computeStyle()
    setDisplayYear(parsed?.year ?? currentYear)
    setOpen(o => !o)
  }

  function selectMonth(monthIdx: number) {
    const ym = toYM(displayYear, monthIdx)
    if (minValue && ym < minValue) return
    onChange(ym)
    setOpen(false)
  }

  const popover = open ? createPortal(
    <div ref={popoverRef} style={popoverStyle} className="bg-white border border-border rounded-lg shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setDisplayYear(y => y - 1)}
          className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-semibold text-near-black select-none">{displayYear}</span>
        <button type="button" onClick={() => setDisplayYear(y => y + 1)}
          className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((name, idx) => {
          const ym = toYM(displayYear, idx)
          const isSelected = ym === value
          const isDisabled = !!minValue && ym < minValue
          return (
            <button
              key={name}
              type="button"
              onClick={() => selectMonth(idx)}
              disabled={isDisabled}
              className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                isSelected
                  ? 'bg-brand text-white'
                  : isDisabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'hover:bg-blue-50 text-near-black cursor-pointer'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="flex flex-col gap-0.5">
      {label && <label className="text-xs font-medium text-gray-700">{label}</label>}
      <button
        ref={buttonRef}
        type="button"
        onClick={openPicker}
        disabled={disabled}
        className={`text-left text-xs border border-border rounded px-2 py-1.5 bg-white transition-colors ${
          disabled
            ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
            : 'hover:border-brand cursor-pointer'
        } ${displayLabel ? 'text-near-black' : 'text-gray-400'}`}
      >
        {displayLabel ?? placeholder}
      </button>
      {popover}
    </div>
  )
}
