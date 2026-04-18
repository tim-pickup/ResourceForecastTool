import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts'

export interface ChartPoint {
  month: string
  label: string
  capacity: number
  subCapacity?: number
  strategy: number
  plant: number
  npd: number
  bau: number
  overlay: number
}

const C = {
  bau:      '#94a3b8',
  plant:    '#60a5fa',
  npd:      '#34d399',
  strategy: '#a78bfa',
  overlay:  '#f59e0b',
  capacity: '#111827',
  sub:      '#6b7280',
}

function totalDemand(d: ChartPoint) {
  return d.bau + d.plant + d.npd + d.strategy + d.overlay
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const tot = totalDemand(d)
  const over = tot - d.capacity
  return (
    <div className="bg-white border border-gray-200 rounded shadow-md p-3 text-xs min-w-[170px]">
      <p className="font-semibold mb-2 text-near-black">{d.label}</p>
      <div className="space-y-1">
        <Row label="Capacity" val={d.capacity} color={C.capacity} bold />
        {d.bau > 0 && <Row label="BAU" val={d.bau} color={C.bau} />}
        {d.plant > 0 && <Row label="Plant Project" val={d.plant} color={C.plant} />}
        {d.npd > 0 && <Row label="NPD Demand" val={d.npd} color={C.npd} />}
        {d.strategy > 0 && <Row label="Group Strategy" val={d.strategy} color={C.strategy} />}
        {d.overlay > 0 && <Row label="Submitted (overlay)" val={d.overlay} color={C.overlay} prefix="+" />}
        {over > 0 && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-red-600 font-semibold">
            Over by {Math.round(over)}h
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ label, val, color, bold, prefix = '' }: { label: string; val: number; color: string; bold?: boolean; prefix?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color }} className={bold ? 'font-medium' : ''}>{label}</span>
      <span className={bold ? 'font-semibold' : ''}>{prefix}{Math.round(val)}h</span>
    </div>
  )
}

interface Props {
  title: string
  subtitle?: string
  data: ChartPoint[]
  subCapacityLabel?: string
  compact?: boolean
  onClick?: () => void
}

export function CapacityChart({ title, subtitle, data, subCapacityLabel, compact = false, onClick }: Props) {
  const h = compact ? 180 : 260
  const overMonths = data.filter(d => totalDemand(d) > d.capacity).map(d => d.label)
  const isOverCapacity = overMonths.length > 0

  return (
    <div
      className={`bg-white border rounded-lg p-4 transition-colors ${isOverCapacity ? 'border-red-300' : 'border-border'} ${onClick ? 'cursor-pointer hover:border-gray-400' : ''}`}
      onClick={onClick}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-near-black">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {isOverCapacity && (
          <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700 rounded-full border border-red-200 whitespace-nowrap">
            Over capacity
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
          <Tooltip content={<ChartTooltip />} />

          {overMonths.map(lbl => (
            <ReferenceArea key={lbl} x1={lbl} x2={lbl} fill="rgba(239,68,68,0.08)" />
          ))}

          <Area type="monotone" dataKey="bau"      stackId="d" fill={C.bau}      stroke="none" fillOpacity={0.85} name="BAU" />
          <Area type="monotone" dataKey="plant"    stackId="d" fill={C.plant}    stroke="none" fillOpacity={0.85} name="Plant Project" />
          <Area type="monotone" dataKey="npd"      stackId="d" fill={C.npd}      stroke="none" fillOpacity={0.85} name="NPD Demand" />
          <Area type="monotone" dataKey="strategy" stackId="d" fill={C.strategy} stroke="none" fillOpacity={0.85} name="Group Strategy" />
          <Area type="monotone" dataKey="overlay"  stackId="d" fill={C.overlay}  stroke="none" fillOpacity={0.55} name="Submitted" strokeDasharray="4 2" />

          <Line type="monotone" dataKey="capacity"    stroke={C.capacity} strokeWidth={2.5} dot={false} name="Capacity" />
          {subCapacityLabel && (
            <Line type="monotone" dataKey="subCapacity" stroke={C.sub} strokeWidth={1.5} strokeDasharray="4 2" dot={false} name={subCapacityLabel} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 justify-end">
        {[
          { color: C.bau,      label: 'BAU' },
          { color: C.plant,    label: 'Plant' },
          { color: C.npd,      label: 'NPD' },
          { color: C.strategy, label: 'Group Strategy' },
          { color: C.overlay,  label: 'Submitted' },
          { color: C.capacity, label: 'Capacity', line: true },
        ].map(({ color, label, line }) => (
          <span key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
            {line
              ? <span className="inline-block w-5 h-0.5 rounded" style={{ background: color }} />
              : <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color, opacity: 0.85 }} />
            }
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
