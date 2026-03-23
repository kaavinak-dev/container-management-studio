"use client"

import { useState } from "react"
import type { Project } from "@/lib/store"
import { MOCK_PROJECTS } from "@/lib/store"
import { DashboardView } from "@/components/dashboard/dashboard-view"
import { CreateProjectModal } from "@/components/dashboard/create-project-modal"
import { IDEView } from "@/components/ide/ide-view"

type View = "dashboard" | "ide"

export default function Page() {
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS)
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [view, setView] = useState<View>("dashboard")
  const [showCreateModal, setShowCreateModal] = useState(false)

  function handleOpenProject(project: Project) {
    setActiveProject(project)
    setView("ide")
  }

  function handleDeleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }

  function handleCreateProject(project: Project) {
    setProjects((prev) => [project, ...prev])
    setShowCreateModal(false)
    // Open the new project in the IDE
    setActiveProject(project)
    setView("ide")
  }

  function handleProjectUpdate(updated: Project) {
    setProjects((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    )
    setActiveProject(updated)
  }

  function handleBackToDashboard() {
    setActiveProject(null)
    setView("dashboard")
  }

  if (view === "ide" && activeProject) {
    return (
      <IDEView
        project={activeProject}
        onBack={handleBackToDashboard}
        onProjectUpdate={handleProjectUpdate}
      />
    )
  }

  return (
    <>
      <DashboardView
        projects={projects}
        onOpenProject={handleOpenProject}
        onDeleteProject={handleDeleteProject}
        onNewProject={() => setShowCreateModal(true)}
      />
      {showCreateModal && (
        <CreateProjectModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateProject}
        />
      )}
    </>
  )
}
