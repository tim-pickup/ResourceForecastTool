import { useId } from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts'

export interface ChartPoint {
  month: string
  label: string
  capacity: number
  strategy: number
  plant: number
  npd: number
  bau: number
  overlay: number
  grey: number
  teamCapacity?: number  // dashed secondary line — team-scoped capacity
  teamDemand?: number    // tinted area — committed hours owned by selected team
}

// Internal type with the grey-band base derived from capacity
interface InternalPoint extends ChartPoint {
  greyBase: number
}

export const DEMAND_COLORS = {
  bau:      '#94a3b8',
  plant:    '#60a5fa',
  npd:      '#34d399',
  strategy: '#a78bfa',
  overlay:  '#f59e0b',
  capacity: '#111827',
} as const

const C = DEMAND_COLORS

function committedDemand(d: ChartPoint) {
  return d.bau + d.plant + d.npd + d.strategy
}

function totalDemandWithOverlay(d: ChartPoint) {
  return committedDemand(d) + d.overlay
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: InternalPoint }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const committed = committedDemand(d)
  const withOverlay = totalDemandWithOverlay(d)
  const overCommitted = committed - d.capacity
  const overWithOverlay = withOverlay - d.capacity
  const bandBottom = Math.max(0, d.capacity - d.grey)
  const intoBand = d.grey > 0 && withOverlay > bandBottom && withOverlay <= d.capacity
  return (
    <div className="bg-white border border-gray-200 rounded shadow-md p-3 text-xs min-w-[200px]">
      <p className="font-semibold mb-2 text-near-black">{d.label}</p>
      <div className="space-y-1">
        <Row label="Capacity" val={d.capacity} color={C.capacity} bold />
        {d.teamCapacity != null && (
          <Row label="Team capacity" val={d.teamCapacity} color="#146ef5" />
        )}
        {d.bau > 0 && <Row label="BAU" val={d.bau} color={C.bau} />}
        {d.plant > 0 && <Row label="Plant Project" val={d.plant} color={C.plant} />}
        {d.npd > 0 && <Row label="NPD Demand" val={d.npd} color={C.npd} />}
        {d.strategy > 0 && <Row label="Group Strategy" val={d.strategy} color={C.strategy} />}
        {d.teamDemand != null && d.teamDemand > 0 && (
          <Row label="Team-owned demand" val={d.teamDemand} color="#7a3dff" />
        )}
        {d.overlay > 0 && <Row label="Overlay (Submitted)" val={d.overlay} color={C.overlay} prefix="+" />}
        {d.grey > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-100">
            <Row label="Capacity consumed elsewhere" val={d.grey} color="#9ca3af" prefix="~" />
            <p className="text-gray-400 text-[10px] mt-0.5">
              Projected onto this skill pool's people by unallocated demand elsewhere
            </p>
          </div>
        )}
        {overCommitted > 0 && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-red-600 font-semibold">
            Over by {Math.round(overCommitted)}h
          </p>
        )}
        {overCommitted <= 0 && overWithOverlay > 0 && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-amber-600 font-semibold">
            Over by {Math.round(overWithOverlay)}h with overlay
          </p>
        )}
        {!overCommitted && !overWithOverlay && intoBand && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-orange-600 font-semibold">
            Pool oversubscribed once projected consumption counted
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
  compact?: boolean
  onClick?: () => void
  teamName?: string  // when set, shows team capacity dashed line legend label
}

export function CapacityChart({ title, subtitle, data, compact = false, onClick, teamName }: Props) {
  const h = compact ? 180 : 260

  // Unique pattern ID — multiple charts on same page need distinct SVG ids
  const uid = useId().replace(/:/g, '')
  const greyHatchId = `greyHatch${uid}`

  // Derive internal points with grey-band base
  const chartData: InternalPoint[] = data.map(d => ({
    ...d,
    greyBase: Math.max(0, d.capacity - d.grey),
  }))

  // Only mount the overlay Area when at least one month has overlay > 0.
  // When overlay is universally 0, the stacked Area path is identical to the
  // top committed-stack path — a silent duplicate. §4 View 1 overlay correctness.
  const hasOverlay = chartData.some(d => d.overlay > 0)
  const hasTeamCapacity = chartData.some(d => d.teamCapacity != null)
  const hasTeamDemand = chartData.some(d => d.teamDemand != null && d.teamDemand > 0)

  // Over-capacity: committed demand alone exceeds capacity line
  const overCommittedMonths = data
    .filter(d => committedDemand(d) > d.capacity)
    .map(d => d.label)

  // Overlay-induced over-capacity: committed alone OK but with overlay over
  const overOverlayMonths = data
    .filter(d => committedDemand(d) <= d.capacity && totalDemandWithOverlay(d) > d.capacity)
    .map(d => d.label)

  // Soft warning: demand (with overlay) crosses into the grey band but stays below capacity
  const intoBandMonths = data
    .filter(d => {
      if (d.grey <= 0) return false
      const total = totalDemandWithOverlay(d)
      const bandBottom = Math.max(0, d.capacity - d.grey)
      return total > bandBottom && total <= d.capacity
    })
    .map(d => d.label)

  const isOverCapacity = overCommittedMonths.length > 0
  const isIntoBand = !isOverCapacity && intoBandMonths.length > 0

  return (
    <div
      className={`bg-white border rounded-lg p-4 transition-colors ${
        isOverCapacity ? 'border-red-300' : 'border-border'
      } ${onClick ? 'cursor-pointer hover:border-gray-400' : ''}`}
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
        {!isOverCapacity && overOverlayMonths.length > 0 && (
          <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 rounded-full border border-amber-200 whitespace-nowrap">
            Over with overlay
          </span>
        )}
        {isIntoBand && (
          <span className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-700 rounded-full border border-orange-200 whitespace-nowrap">
            Pool constrained
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>

          {/* Cross-hatch pattern for grey band — §2.4.4 */}
          <defs>
            <pattern id={greyHatchId} width="8" height="8" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="8" y2="8" stroke="#9ca3af" strokeWidth="1" strokeOpacity="0.5" />
              <line x1="8" y1="0" x2="0" y2="8" stroke="#9ca3af" strokeWidth="1" strokeOpacity="0.5" />
            </pattern>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} tickFormatter={v => `${v}h`} />
          <Tooltip content={<ChartTooltip />} />

          {/* Strong red background — committed demand alone exceeds capacity */}
          {overCommittedMonths.map(lbl => (
            <ReferenceArea key={`oc-${lbl}`} x1={lbl} x2={lbl} fill="rgba(239,68,68,0.10)" />
          ))}
          {/* Amber background — overlay tips it over capacity */}
          {overOverlayMonths.map(lbl => (
            <ReferenceArea key={`oo-${lbl}`} x1={lbl} x2={lbl} fill="rgba(245,158,11,0.06)" />
          ))}
          {/* Soft orange background — demand crosses into grey band */}
          {intoBandMonths.map(lbl => (
            <ReferenceArea key={`gb-${lbl}`} x1={lbl} x2={lbl} fill="rgba(251,146,60,0.10)" />
          ))}

          {/* Grey band — §2.4.4 DOM-layer mandate.
              Always mounted (even when grey=0 → zero-height band), never absent.
              Uses its own stackId so it sits independent of the demand stack.
              greyBase (transparent) raises the floor to capacity−grey;
              grey (cross-hatched) fills from that floor up to the capacity line.
              Dotted line traces the band's lower edge (greyBase). */}
          <Area
            type="monotone"
            dataKey="greyBase"
            stackId="grey"
            fill="transparent"
            stroke="none"
            legendType="none"
            isAnimationActive={false}
            name="_greyBase"
          />
          <Area
            type="monotone"
            dataKey="grey"
            stackId="grey"
            fill={`url(#${greyHatchId})`}
            stroke="none"
            isAnimationActive={false}
            name="Proj. elsewhere"
          />
          {/* Dotted lower-bound line — traces bottom edge of grey band */}
          <Line
            type="monotone"
            dataKey="greyBase"
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="2 3"
            dot={false}
            legendType="none"
            isAnimationActive={false}
            name="_greyLowerBound"
          />

          {/* Committed demand stack — from x-axis upward */}
          <Area type="monotone" dataKey="bau"      stackId="d" fill={C.bau}      stroke="none" fillOpacity={0.85} name="BAU" />
          <Area type="monotone" dataKey="plant"    stackId="d" fill={C.plant}    stroke="none" fillOpacity={0.85} name="Plant Project" />
          <Area type="monotone" dataKey="npd"      stackId="d" fill={C.npd}      stroke="none" fillOpacity={0.85} name="NPD Demand" />
          <Area type="monotone" dataKey="strategy" stackId="d" fill={C.strategy} stroke="none" fillOpacity={0.85} name="Group Strategy" />

          {/* Overlay demand — solid amber, stacked above committed.
              Only mounted when overlay > 0 in at least one month; when overlay is
              universally 0 the stacked Area's d path duplicates the strategy layer.
              §4 View 1 overlay layer correctness. */}
          {hasOverlay && (
            <Area
              type="monotone"
              dataKey="overlay"
              stackId="d"
              fill="#f59e0b"
              fillOpacity={0.65}
              stroke="none"
              name="Overlay (Submitted)"
            />
          )}

          {/* Team-owned demand tint — semi-transparent purple area from 0 to teamDemand.
              Not stacked with "d" so underlying demand colours show through.
              Visually marks the portion of committed demand owned by selected team. */}
          {hasTeamDemand && (
            <Area
              type="monotone"
              dataKey="teamDemand"
              fill="#7a3dff"
              fillOpacity={0.18}
              stroke="#7a3dff"
              strokeWidth={1}
              strokeOpacity={0.4}
              dot={false}
              name="Team-owned demand"
              isAnimationActive={false}
            />
          )}

          {/* Capacity line — drawn last so it sits on top */}
          <Line type="monotone" dataKey="capacity" stroke={C.capacity} strokeWidth={2.5} dot={false} name="Capacity" />

          {/* Dashed secondary capacity line — team-scoped capacity when team filter active */}
          {hasTeamCapacity && (
            <Line
              type="monotone"
              dataKey="teamCapacity"
              stroke="#146ef5"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              name="Team capacity"
              isAnimationActive={false}
            />
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
          { color: C.overlay,  label: 'Overlay' },
          { color: '#9ca3af',  label: 'Proj. elsewhere', crosshatch: true },
          { color: C.capacity, label: 'Capacity', line: true },
          ...(hasTeamCapacity ? [{ color: '#146ef5', label: teamName ? `${teamName} capacity` : 'Team capacity', line: true, dashed: true }] : []),
          ...(hasTeamDemand   ? [{ color: '#7a3dff', label: 'Team-owned demand', tint: true }] : []),
        ].map(({ color, label, line, crosshatch, dashed, tint }) => (
          <span key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
            {line && dashed
              ? <svg width="20" height="4" className="inline-block"><line x1="0" y1="2" x2="20" y2="2" stroke={color} strokeWidth="1.5" strokeDasharray="5 3" /></svg>
              : line
              ? <span className="inline-block w-5 h-0.5 rounded" style={{ background: color }} />
              : crosshatch
              ? (
                <svg width="10" height="10" className="inline-block">
                  <defs>
                    <pattern id={`leg-${label.replace(/\s/g,'')}`} width="4" height="4" patternUnits="userSpaceOnUse">
                      <line x1="0" y1="0" x2="4" y2="4" stroke={color} strokeWidth="1" strokeOpacity="0.8" />
                      <line x1="4" y1="0" x2="0" y2="4" stroke={color} strokeWidth="1" strokeOpacity="0.8" />
                    </pattern>
                  </defs>
                  <rect width="10" height="10" rx="2" fill={`url(#leg-${label.replace(/\s/g,'')})`} />
                </svg>
              )
              : tint
              ? <span className="inline-block w-2.5 h-2.5 rounded-sm border" style={{ background: color, opacity: 0.3, borderColor: color }} />
              : <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color, opacity: 0.85 }} />
            }
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
