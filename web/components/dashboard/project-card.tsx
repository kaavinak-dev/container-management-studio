"use client"

import { useState } from "react"
import { Trash2, FolderOpen } from "lucide-react"
import type { Project } from "@/lib/store"
import { getRelativeTime } from "@/lib/store"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"

interface ProjectCardProps {
  project: Project
  onOpen: (project: Project) => void
  onDelete: (id: string) => void
}

export function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)

  return (
    <div
      className={cn(
        "relative rounded border border-[#3c3c3c] bg-[#252526] p-5 flex flex-col gap-4",
        "transition-all duration-150 hover:-translate-y-0.5 hover:border-[#555] hover:shadow-lg hover:shadow-black/30"
      )}
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h3 className="text-[#d4d4d4] font-semibold text-base truncate font-mono leading-tight">
            {project.name}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Type badge */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[rgba(40,167,69,0.15)] text-[#28a745] border border-[#28a74540]">
              <NodeJsIcon />
              Node.js
            </span>
            <StatusBadge status={project.status} />
          </div>
        </div>
        {/* Delete button */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowConfirm(true)}
            className="p-1.5 rounded text-[#858585] hover:text-[#dc3545] hover:bg-[rgba(220,53,69,0.1)] transition-colors"
            aria-label="Delete project"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {showConfirm && (
            <div className="absolute right-0 top-8 z-20 w-64 bg-[#2d2d2d] border border-[#3c3c3c] rounded shadow-xl p-3 text-sm">
              <p className="text-[#d4d4d4] mb-3 leading-relaxed">
                Delete{" "}
                <span className="text-[#ce9178] font-mono">
                  &apos;{project.name}&apos;
                </span>
                ? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-3 py-1.5 rounded text-xs bg-[#3c3c3c] text-[#d4d4d4] hover:bg-[#4a4a4a] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onDelete(project.id)
                    setShowConfirm(false)
                  }}
                  className="flex-1 px-3 py-1.5 rounded text-xs bg-[#dc3545] text-white hover:bg-[#c82333] transition-colors font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="text-xs text-[#858585]">
        Created {getRelativeTime(project.createdAt)}
      </div>

      {/* Action button */}
      <button
        onClick={() => onOpen(project)}
        className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
      >
        <FolderOpen className="w-4 h-4" />
        Open Editor
      </button>

      {/* Overlay to close confirm when clicking outside */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}

function NodeJsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
      <path d="M11.998 24c-.321 0-.641-.084-.924-.247l-2.937-1.737c-.438-.245-.224-.332-.08-.383.585-.203.703-.25 1.328-.605.065-.037.151-.023.218.017l2.256 1.339c.082.045.199.045.275 0l8.795-5.076c.082-.047.134-.141.134-.238V6.921c0-.099-.052-.19-.137-.242l-8.791-5.072c-.081-.047-.189-.047-.271 0L3.075 6.68c-.087.05-.141.144-.141.243v10.15c0 .097.054.189.139.235l2.409 1.392c1.307.654 2.108-.116 2.108-.891V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.11.255.253v10.021c0 1.745-.95 2.745-2.604 2.745-.508 0-.909 0-2.026-.551L2.28 18.675c-.572-.329-.924-.943-.924-1.604V6.921c0-.661.352-1.275.924-1.601l8.795-5.082c.557-.315 1.296-.315 1.848 0l8.794 5.082c.573.326.925.939.925 1.601v10.15c0 .661-.352 1.275-.925 1.604l-8.794 5.076c-.283.163-.602.247-.925.247z" />
    </svg>
  )
}
