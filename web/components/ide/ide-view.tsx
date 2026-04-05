"use client"

import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, Rocket } from "lucide-react"
import { projectAPI } from "@/lib/api"
import type { Project, ProjectFile, ProjectStatus } from "@/lib/store"
import { StatusBadge } from "@/components/status-badge"
import { FileTree } from "@/components/ide/file-tree"
import { CodeEditor } from "@/components/ide/code-editor"
import { TerminalPanel } from "@/components/ide/terminal"
import { DeployModal } from "@/components/ide/deploy-modal"


interface IDEViewProps {
  project: Project
  onBack: () => void
  onProjectUpdate: (updated: Project) => void
}

export function IDEView({ project, onBack, onProjectUpdate }: IDEViewProps) {
  const [files, setFiles] = useState<ProjectFile[]>(project.files)
  const [activeFileName, setActiveFileName] = useState(
    project.files[0]?.name ?? ""
  )
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [showDeploy, setShowDeploy] = useState(
    project.status === "deploying"
  )
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set())

  const activeFile = files.find((f) => f.name === activeFileName) ?? files[0]
  const isActiveDirty = dirtyFiles.has(activeFileName)

  // Lazy-load file contents from backend when IDE opens
  useEffect(() => {
    async function loadFileContents() {
      try {
        const fileList = await projectAPI.listFiles(project.id)
        const filesWithContent = await Promise.all(
          fileList.files.map(async (fileName) => {
            const { content } = await projectAPI.getFile(project.id, fileName)
            const ext = fileName.split(".").pop()
            const language =
              ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx"
                ? "javascript"
                : ext === "json"
                ? "json"
                : "text"
            return { name: fileName, content, language }
          })
        )
        setFiles(filesWithContent)
        setActiveFileName(filesWithContent[0]?.name ?? "")
        // Sync back to parent so project state is cached
        onProjectUpdate({ ...project, files: filesWithContent })
      } catch (error) {
        console.error("Failed to load file contents:", error)
      }
    }

    // Load if files are missing or content hasn't been loaded yet
    const hasEmptyFiles = files.length === 0 || files.some(f => f.content === "")
    if (hasEmptyFiles) {
      loadFileContents()
    }
  }, [project.id])

  const handleFileChange = useCallback((content: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.name === activeFileName ? { ...f, content } : f))
    )
    setDirtyFiles((prev) => new Set(prev).add(activeFileName))
  }, [activeFileName])

  const handleSave = useCallback(async () => {
    if (!activeFile || !isActiveDirty) return
    try {
      await projectAPI.putFile(project.id, activeFileName, activeFile.content)
      setDirtyFiles((prev) => {
        const next = new Set(prev)
        next.delete(activeFileName)
        return next
      })
      onProjectUpdate({ ...project, files })
    } catch (error) {
      console.error("Failed to save file:", error)
    }
  }, [activeFile, isActiveDirty, project, activeFileName, files, onProjectUpdate])

  function handleSelectFile(name: string) {
    setActiveFileName(name)
  }

  async function handleCreateFile(name: string) {
    const ext = name.split(".").pop()
    const lang =
      ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx"
        ? "javascript"
        : ext === "json"
        ? "json"
        : "text"
    const newFile: ProjectFile = { name, content: "", language: lang as ProjectFile["language"] }
    const updated = [...files, newFile]
    setFiles(updated)
    setActiveFileName(name)

    try {
      await projectAPI.putFile(project.id, name, "")
      onProjectUpdate({ ...project, files: updated })
    } catch (error) {
      console.error("Failed to create file:", error)
      setFiles(files)
      setActiveFileName(files[0]?.name ?? "")
    }
  }

  async function handleDeleteFile(name: string) {
    const updated = files.filter((f) => f.name !== name)
    setFiles(updated)
    if (activeFileName === name) {
      setActiveFileName(updated[0]?.name ?? "")
    }

    try {
      await projectAPI.deleteFile(project.id, name)
      onProjectUpdate({ ...project, files: updated })
    } catch (error) {
      console.error("Failed to delete file:", error)
      setFiles(files)
      setActiveFileName(name)
    }
  }

  async function handleRenameFile(oldName: string, newName: string) {
    const updated = files.map((f) =>
      f.name === oldName ? { ...f, name: newName } : f
    )
    setFiles(updated)
    if (activeFileName === oldName) setActiveFileName(newName)

    try {
      const file = files.find((f) => f.name === oldName)
      if (file) {
        await projectAPI.putFile(project.id, newName, file.content)
        await projectAPI.deleteFile(project.id, oldName)
        onProjectUpdate({ ...project, files: updated })
      }
    } catch (error) {
      console.error("Failed to rename file:", error)
      setFiles(files)
      setActiveFileName(oldName)
    }
  }

  function handleBack() {
    if (dirtyFiles.size > 0) {
      if (window.confirm("You have unsaved changes. Leave anyway?")) {
        onBack()
      }
    } else {
      onBack()
    }
  }

  function handleDeploySuccess(
    newStatus: ProjectStatus,
    score: number,
    issues?: string[]
  ) {
    setStatus(newStatus)
    if (newStatus === "approved") {
      setTerminalOpen(true)
    }
    onProjectUpdate({ ...project, status: newStatus, riskScore: score, issues })
    setShowDeploy(false)
  }

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#323233] border-b border-[#3c3c3c] flex-shrink-0 h-11">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-1.5 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-[#d4d4d4] font-semibold font-mono text-sm">
            {project.name}
          </span>
          <StatusBadge status={status} />
        </div>
        <button
          onClick={() => setShowDeploy(true)}
          className="flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
        >
          <Rocket className="w-4 h-4" />
          Deploy
        </button>
      </div>

      {/* Main 3-panel area */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-56 flex-shrink-0 bg-[#252526] border-r border-[#3c3c3c] overflow-hidden">
          <FileTree
            files={files}
            activeFile={activeFileName}
            onSelectFile={handleSelectFile}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            onRenameFile={handleRenameFile}
          />
        </div>

        {/* Center + right area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Tab bar */}
          {activeFile && (
            <div className="flex items-center bg-[#2d2d2d] border-b border-[#3c3c3c] flex-shrink-0 h-9">
              <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-[#d4d4d4] bg-[#1e1e1e] border-r border-[#3c3c3c] border-t-2 border-t-[#007acc] font-mono">
                {activeFile.name}
                {isActiveDirty && (
                  <span
                    className="w-2 h-2 rounded-full bg-[#d4d4d4] inline-block flex-shrink-0"
                    title="Unsaved changes — press Ctrl+S to save"
                  />
                )}
              </div>
            </div>
          )}

          {/* Editor + terminal */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-hidden">
              {activeFile ? (
                <CodeEditor projectId={project.id} file={activeFile} allFiles={files} onChange={handleFileChange} onSave={handleSave} isDirty={isActiveDirty} />
              ) : (
                <div className="flex items-center justify-center h-full text-[#555] text-sm">
                  Select or create a file
                </div>
              )}
            </div>
            <TerminalPanel
              projectId={project.id}
              isOpen={terminalOpen}
              onToggle={() => setTerminalOpen((o) => !o)}
            />
          </div>
        </div>
      </div>

      {/* Deploy modal */}
      {showDeploy && (
        <DeployModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setShowDeploy(false)}
          onSuccess={handleDeploySuccess}
        />
      )}
    </div>
  )
}
