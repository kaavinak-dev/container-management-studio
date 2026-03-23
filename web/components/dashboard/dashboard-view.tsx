"use client"

import { Plus, Box } from "lucide-react"
import type { Project } from "@/lib/store"
import { ProjectCard } from "@/components/dashboard/project-card"
import { cn } from "@/lib/utils"

interface DashboardViewProps {
  projects: Project[]
  onOpenProject: (project: Project) => void
  onDeleteProject: (id: string) => void
  onNewProject: () => void
}

export function DashboardView({
  projects,
  onOpenProject,
  onDeleteProject,
  onNewProject,
}: DashboardViewProps) {
  return (
    <div className="flex flex-col min-h-screen bg-[#1e1e1e]">
      {/* Navbar */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#323233] border-b border-[#3c3c3c] sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-[#007acc] flex items-center justify-center">
            <Box className="w-4 h-4 text-white" />
          </div>
          <span className="text-[#d4d4d4] font-semibold text-sm tracking-tight">
            Container Management Studio
          </span>
        </div>
        <button
          onClick={onNewProject}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-[#d4d4d4]">Projects</h1>
            <p className="text-sm text-[#858585] mt-0.5">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 gap-5">
            <div className="w-20 h-20 rounded-2xl bg-[#252526] border border-[#3c3c3c] flex items-center justify-center">
              <Box className="w-10 h-10 text-[#3c3c3c]" />
            </div>
            <div className="text-center">
              <p className="text-[#d4d4d4] font-medium text-lg">No projects yet</p>
              <p className="text-[#858585] text-sm mt-1">
                Get started by creating your first containerized app
              </p>
            </div>
            <button
              onClick={onNewProject}
              className="flex items-center gap-2 px-6 py-3 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create your first project
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "grid gap-4",
              "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            )}
          >
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpenProject}
                onDelete={onDeleteProject}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
