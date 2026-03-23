"use client"

import type { ProjectStatus } from "@/lib/store"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; color: string; bg: string; pulse?: boolean }
> = {
  draft: {
    label: "Draft",
    color: "#6c757d",
    bg: "rgba(108,117,125,0.15)",
  },
  deploying: {
    label: "Deploying",
    color: "#007acc",
    bg: "rgba(0,122,204,0.15)",
    pulse: true,
  },
  approved: {
    label: "Approved",
    color: "#28a745",
    bg: "rgba(40,167,69,0.15)",
  },
  quarantined: {
    label: "Quarantined",
    color: "#ffc107",
    bg: "rgba(255,193,7,0.15)",
  },
  rejected: {
    label: "Rejected",
    color: "#dc3545",
    bg: "rgba(220,53,69,0.15)",
  },
}

interface StatusBadgeProps {
  status: ProjectStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium",
        config.pulse && "badge-deploying",
        className
      )}
      style={{
        color: config.color,
        backgroundColor: config.bg,
        border: `1px solid ${config.color}40`,
      }}
    >
      {status === "deploying" && (
        <Loader2 className="w-3 h-3 spinner" style={{ color: config.color }} />
      )}
      {config.label}
    </span>
  )
}
