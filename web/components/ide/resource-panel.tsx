"use client"

import { useState } from "react"
import { Plus, X, Database, Zap, Loader2 } from "lucide-react"
import type { Resource, ResourceDefinition } from "@/lib/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface ResourcePanelProps {
  projectId: string
  resources: Resource[]
  catalog: ResourceDefinition[]
  onAddResource: (type: string) => Promise<void>
  onRemoveResource: (resourceId: number) => Promise<void>
  isLoading: boolean
}

function getResourceIcon(type: string) {
  switch (type.toLowerCase()) {
    case "redis":
      return <Zap className="w-3.5 h-3.5 text-red-400" />
    default:
      return <Database className="w-3.5 h-3.5 text-blue-400" />
  }
}

function getStatusDot(status: string) {
  switch (status) {
    case "ready":
      return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
    case "provisioning":
      return <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
    case "failed":
      return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
    default:
      return <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
  }
}

export function ResourcePanel({
  projectId,
  resources,
  catalog,
  onAddResource,
  onRemoveResource,
  isLoading,
}: ResourcePanelProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [addingType, setAddingType] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<number | null>(null)

  const provisionedTypes = new Set(resources.map((r) => r.resourceType.toLowerCase()))
  const availableResources = catalog.filter(
    (c) => !provisionedTypes.has(c.type.toLowerCase())
  )

  async function handleAdd(type: string) {
    setAddingType(type)
    setPopoverOpen(false)
    try {
      await onAddResource(type)
    } finally {
      setAddingType(null)
    }
  }

  async function handleRemove(resourceId: number) {
    setRemovingId(resourceId)
    try {
      await onRemoveResource(resourceId)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#3c3c3c]">
        <span className="text-[10px] font-semibold text-[#858585] uppercase tracking-wider">
          Resources
        </span>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors disabled:opacity-50"
              disabled={availableResources.length === 0 || addingType !== null}
              title="Add resource"
            >
              {addingType ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="right"
            className="w-56 p-2 bg-[#252526] border-[#3c3c3c]"
          >
            <div className="space-y-1">
              {availableResources.map((def) => (
                <button
                  key={def.type}
                  onClick={() => handleAdd(def.type)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors text-left"
                >
                  {getResourceIcon(def.type)}
                  <div>
                    <div className="font-medium">{def.displayName}</div>
                    <div className="text-[#858585] text-[10px]">
                      alias: {def.defaultAlias}
                    </div>
                  </div>
                </button>
              ))}
              {availableResources.length === 0 && (
                <div className="text-[#858585] text-xs px-2 py-1">
                  All resource types provisioned.
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Resource list */}
      <div className="px-2 pb-2 space-y-1">
        {resources.map((resource) => (
          <div
            key={resource.id}
            className="flex items-center justify-between px-2 py-1.5 rounded bg-[#2d2d2d] group"
          >
            <div className="flex items-center gap-2 min-w-0">
              {getResourceIcon(resource.resourceType)}
              <div className="min-w-0">
                <div className="text-xs text-[#d4d4d4] truncate">
                  {resource.resourceType}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[#858585]">
                  {getStatusDot(resource.status)}
                  <span>{resource.alias}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => handleRemove(resource.id)}
              disabled={removingId === resource.id}
              className="p-0.5 rounded text-[#858585] opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-[#3c3c3c] transition-all disabled:opacity-50"
              title="Remove resource"
            >
              {removingId === resource.id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <X className="w-3 h-3" />
              )}
            </button>
          </div>
        ))}

        {resources.length === 0 && !isLoading && (
          <div className="text-[#585858] text-[10px] px-2 py-1">
            No resources. Click + to add a database or cache.
          </div>
        )}

        {isLoading && resources.length === 0 && (
          <div className="flex items-center gap-2 text-[#585858] text-[10px] px-2 py-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading...
          </div>
        )}
      </div>
    </div>
  )
}
