"use client"

import { useState, useEffect } from "react"
import type { Project } from "@/lib/store"
import { projectAPI } from "@/lib/api"
import { DashboardView } from "@/components/dashboard/dashboard-view"
import { CreateProjectModal } from "@/components/dashboard/create-project-modal"
import { IDEView } from "@/components/ide/ide-view"

type View = "dashboard" | "ide"

export default function Page() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [view, setView] = useState<View>("dashboard")
  const [showCreateModal, setShowCreateModal] = useState(false)

  useEffect(() => {
    async function loadProjects() {
      try {
        setLoading(true)
        const data = await projectAPI.listProjects()
        setProjects(
          data.map((p) => ({
            id: p.projectId,
            name: p.name,
            type: p.type as Project["type"],
            status: p.status as Project["status"],
            createdAt: new Date(p.createdAt),
            files: [],
            nodeVersion: p.nodeVersion ?? "20",
            baseOS: (p.baseOS ?? "ubuntu") as Project["baseOS"],
          }))
        )
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load projects")
        setProjects([])
      } finally {
        setLoading(false)
      }
    }

    loadProjects()
  }, [])

  function handleOpenProject(project: Project) {
    setActiveProject(project)
    setView("ide")
  }

  function handleDeleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id))
    projectAPI.deleteProject(id).catch((err) => {
      console.error("Failed to delete project:", err)
    })
  }

  async function handleCreateProject(payload: {
    name: string
    baseOS: string
    nodeVersion: string
  }) {
    const response = await projectAPI.createProject({
      ...payload,
      type: "nodejs",
    })

    const newProject: Project = {
      id: response.projectId,
      name: response.name,
      type: "nodejs",
      status: "draft",
      createdAt: new Date(),
      files: response.files.map((name) => ({
        name,
        content: "",
        language: "text" as const,
      })),
      nodeVersion: payload.nodeVersion,
      baseOS: payload.baseOS as Project["baseOS"],
    }

    setProjects((prev) => [newProject, ...prev])
    setShowCreateModal(false)
    setActiveProject(newProject)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1e1e1e]">
        <div className="text-[#d4d4d4]">Loading projects...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1e1e1e]">
        <div className="text-[#dc3545]">{error}</div>
      </div>
    )
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
