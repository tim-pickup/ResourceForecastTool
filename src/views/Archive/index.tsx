import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

// Archive view is deprecated in v1.18 — the Closed status and Archive entity
// are removed. This placeholder remains until Change 10 removes the route.
export default function Archive() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-white">
        <button onClick={() => navigate('/manage-demand')} className="text-gray-400 hover:text-near-black transition-colors">
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-near-black">Archive</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
        <p className="text-sm">Archive has been removed in v1.18.</p>
        <p className="text-xs">Items are now managed directly through Delete on the Manage Demand board.</p>
      </div>
    </div>
  )
}
