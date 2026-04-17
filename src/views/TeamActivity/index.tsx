import { useState, useMemo } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { generateMonths, getCurrentMonth, getPersonBauHours, getPersonNamedProjectHours, monthInRange, formatMonthLabel, utilPct } from '../../utils/capacity'
import { DemandEditor } from '../../components/DemandEditor/DemandEditor'
import { clsx } from 'clsx'

const HORIZONS = [6, 12, 24, 60]

interface Block {
  label: string
  hours: number
  type: 'bau' | 'project'
  demandId?: string
}

export default function TeamActivity() {
  const store = useAppStore()
  const [horizon, setHorizon] = useState(6)
  const [filterTheme, setFilterTheme] = useState('')
  const [filterPerson, setFilterPerson] = useState('')
  const [showBau, setShowBau] = useState(true)
  const [editorId, setEditorId] = useState<string | null>(null)

  const months = useMemo(() => generateMonths(getCurrentMonth(), horizon), [horizon])
  const now = getCurrentMonth()

  const people = useMemo(() =>
    store.people.filter(p =>
      p.active &&
      (!filterTheme || p.primary_theme_id === filterTheme) &&
      (!filterPerson || p.id === filterPerson)
    ),
    [store.people, filterTheme, filterPerson]
  )

  const themes = useMemo(() => store.themes, [store.themes])

  function getBlocksForPersonMonth(personId: string, month: string): Block[] {
    const blocks: Block[] = []

    if (showBau) {
      const bauAllocsForPerson = store.bauAllocations.filter(a =>
        a.person_id === personId && monthInRange(month, a.effective_from, a.effective_to)
      )
      for (const alloc of bauAllocsForPerson) {
        const stream = store.bauStreams.find(s => s.id === alloc.stream_id)
        blocks.push({ label: stream?.name ?? 'BAU', hours: alloc.hours_per_month, type: 'bau' })
      }
    }

    for (const item of store.demandItems) {
      if (item.status !== 'Accepted' && item.status !== 'Allocated') continue
      for (const phase of item.phases) {
        if (!monthInRange(month, phase.start_month, phase.end_month)) continue
        for (const req of phase.requirements) {
          if (req.shape === 'named' && req.person_id === personId) {
            blocks.push({ label: item.name, hours: req.hours_per_month, type: 'project', demandId: item.id })
          }
        }
      }
    }

    return blocks
  }

  function getTotalHours(personId: string, month: string): number {
    const bau = showBau ? getPersonBauHours(personId, month, store.bauAllocations) : 0
    const project = getPersonNamedProjectHours(personId, month, store.demandItems)
    return bau + project
  }

  const groupedPeople = useMemo(() =>
    themes.map(t => ({
      theme: t,
      rows: people.filter(p => p.primary_theme_id === t.id),
    })).filter(g => g.rows.length > 0),
    [people, themes]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white flex-wrap">
        <span className="text-sm font-semibold text-near-black">Team Activity</span>
        <div className="h-4 w-px bg-border" />

        {/* Horizon */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Horizon:</span>
          {HORIZONS.map(h => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={clsx('px-2 py-0.5 text-xs rounded font-medium transition-colors',
                horizon === h ? 'bg-near-black text-white' : 'text-gray-500 hover:bg-gray-100'
              )}
            >
              {h}m
            </button>
          ))}
        </div>

        {/* Filters */}
        <select
          value={filterTheme}
          onChange={e => { setFilterTheme(e.target.value); setFilterPerson('') }}
          className="text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="">All Themes</option>
          {store.themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          value={filterPerson}
          onChange={e => setFilterPerson(e.target.value)}
          className="text-xs border border-border rounded px-2 py-1 bg-white"
        >
          <option value="">All People</option>
          {store.people.filter(p => !filterTheme || p.primary_theme_id === filterTheme).map(p =>
            <option key={p.id} value={p.id}>{p.name}</option>
          )}
        </select>

        {/* BAU toggle */}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showBau}
            onChange={e => setShowBau(e.target.checked)}
            className="accent-brand"
          />
          Show BAU
        </label>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 border-b border-border">
              <th className="sticky left-0 bg-gray-50 z-20 text-left px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide border-r border-border min-w-[180px]">
                Person
              </th>
              {months.map(m => (
                <th key={m} className={clsx(
                  'px-2 py-2 text-center font-medium border-r border-border/50 min-w-[120px]',
                  m === now ? 'text-brand bg-blue-50/50' : 'text-gray-500'
                )}>
                  {formatMonthLabel(m)}
                  {m === now && <div className="text-[9px] text-brand font-semibold">NOW</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedPeople.map(group => (
              <>
                <tr key={group.theme.id + '-header'} className="bg-gray-50/80">
                  <td colSpan={months.length + 1} className="px-4 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-border">
                    {group.theme.name}
                  </td>
                </tr>
                {group.rows.map(person => (
                  <tr key={person.id} className="border-b border-border/50 hover:bg-gray-50/30">
                    <td className="sticky left-0 bg-white border-r border-border px-4 py-2 z-10">
                      <div className="font-medium text-near-black">{person.name}</div>
                      <div className="text-gray-400">{person.contracted_hours_per_month}h/mo contracted</div>
                      {person.available_from && person.available_from > now && (
                        <div className="text-xs text-yellow-600">Joins {person.available_from}</div>
                      )}
                      {person.available_to && person.available_to < months[months.length - 1] && (
                        <div className="text-xs text-orange-600">Leaves {person.available_to}</div>
                      )}
                    </td>
                    {months.map(month => {
                      const blocks = getBlocksForPersonMonth(person.id, month)
                      const total = getTotalHours(person.id, month)
                      const pct = utilPct(total, person.contracted_hours_per_month)
                      const isOver = total > person.contracted_hours_per_month
                      const notAvailable = !monthInRange(month, person.available_from, person.available_to)

                      if (notAvailable) {
                        return (
                          <td key={month} className="px-2 py-2 border-r border-border/50 bg-gray-50">
                            <div className="text-center text-gray-300 text-xs">n/a</div>
                          </td>
                        )
                      }

                      return (
                        <td
                          key={month}
                          className={clsx(
                            'px-1.5 py-1.5 border-r border-border/50 align-top',
                            isOver && 'bg-red-50'
                          )}
                        >
                          <div className="flex flex-col gap-0.5">
                            {blocks.map((block, i) => (
                              <div
                                key={i}
                                onClick={() => block.demandId && setEditorId(block.demandId)}
                                className={clsx(
                                  'rounded px-1.5 py-0.5 text-xs truncate max-w-[110px]',
                                  block.type === 'bau'
                                    ? 'bg-gray-200 text-gray-700'
                                    : 'bg-brand/10 text-brand cursor-pointer hover:bg-brand/20',
                                  block.demandId && 'cursor-pointer'
                                )}
                                title={`${block.label}: ${block.hours}h`}
                              >
                                {block.hours}h {block.label}
                              </div>
                            ))}
                            {blocks.length === 0 && (
                              <span className="text-gray-300 text-xs text-center block">free</span>
                            )}
                            <div className={clsx('text-xs font-medium tabular-nums mt-0.5', isOver ? 'text-accent-red' : 'text-gray-400')}>
                              {pct}%
                            </div>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-5 py-2 border-t border-border bg-gray-50 text-xs text-gray-500">
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-gray-200" /> BAU</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-brand/10 border border-brand/20" /> Project</div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Over-allocated</div>
      </div>

      {editorId && <DemandEditor demandId={editorId} onClose={() => setEditorId(null)} />}
    </div>
  )
}
