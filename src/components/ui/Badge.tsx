import { clsx } from 'clsx'
import type { DemandStatus } from '../../types'

const STATUS_STYLES: Record<DemandStatus, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Submitted: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  Approved: 'bg-blue-50 text-blue-700 border border-blue-200',
  PartiallyAllocated: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  Allocated: 'bg-green-50 text-green-700 border border-green-200',
  Parked: 'bg-orange-50 text-orange-600 border border-orange-200',
  Closed: 'bg-gray-50 text-gray-500 border border-gray-200',
}

export function StatusBadge({ status }: { status: DemandStatus }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', STATUS_STYLES[status])}>
      {status}
    </span>
  )
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600', className)}>
      {children}
    </span>
  )
}
