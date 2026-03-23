"use client"

import { useState, useRef, useEffect } from "react"
import { FilePlus, FileCode, FileJson, File, Pencil, Trash2, ChevronDown } from "lucide-react"
import type { ProjectFile } from "@/lib/store"
import { cn } from "@/lib/utils"

interface FileTreeProps {
  files: ProjectFile[]
  activeFile: string
  onSelectFile: (name: string) => void
  onCreateFile: (name: string) => void
  onDeleteFile: (name: string) => void
  onRenameFile: (oldName: string, newName: string) => void
}

export function FileTree({
  files,
  activeFile,
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
}: FileTreeProps) {
  const [creating, setCreating] = useState(false)
  const [newFileName, setNewFileName] = useState("")
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    fileName: string
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating && newFileInputRef.current) {
      newFileInputRef.current.focus()
    }
  }, [creating])

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  function handleCreateFile() {
    const name = newFileName.trim()
    if (name) onCreateFile(name)
    setCreating(false)
    setNewFileName("")
  }

  function handleRename() {
    const name = renameValue.trim()
    if (name && renaming && name !== renaming) {
      onRenameFile(renaming, name)
    }
    setRenaming(null)
    setRenameValue("")
  }

  function openContextMenu(e: React.MouseEvent, fileName: string) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, fileName })
  }

  function getFileIcon(name: string) {
    const ext = name.split(".").pop()
    if (ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx") {
      return <FileCode className="w-4 h-4 text-[#cccc00]" />
    }
    if (ext === "json") {
      return <FileJson className="w-4 h-4 text-[#ce9178]" />
    }
    return <File className="w-4 h-4 text-[#858585]" />
  }

  return (
    <div className="flex flex-col h-full select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
        <div className="flex items-center gap-1.5">
          <ChevronDown className="w-3 h-3 text-[#858585]" />
          <span className="text-[10px] font-semibold text-[#858585] uppercase tracking-widest">
            Explorer
          </span>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
          title="New File"
        >
          <FilePlus className="w-4 h-4" />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* New file input */}
        {creating && (
          <div className="flex items-center gap-2 px-3 py-1">
            {getFileIcon(newFileName || "file")}
            <input
              ref={newFileInputRef}
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFile()
                if (e.key === "Escape") {
                  setCreating(false)
                  setNewFileName("")
                }
              }}
              onBlur={handleCreateFile}
              placeholder="filename.js"
              className="flex-1 px-1 py-0.5 text-xs bg-[#3c3c3c] text-[#d4d4d4] border border-[#007acc] rounded outline-none font-mono min-w-0"
            />
          </div>
        )}

        {files.map((file) => (
          <div key={file.name}>
            {renaming === file.name ? (
              <div className="flex items-center gap-2 px-3 py-1">
                {getFileIcon(file.name)}
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename()
                    if (e.key === "Escape") { setRenaming(null); setRenameValue("") }
                  }}
                  onBlur={handleRename}
                  className="flex-1 px-1 py-0.5 text-xs bg-[#3c3c3c] text-[#d4d4d4] border border-[#007acc] rounded outline-none font-mono min-w-0"
                />
              </div>
            ) : (
              <button
                onClick={() => onSelectFile(file.name)}
                onContextMenu={(e) => openContextMenu(e, file.name)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1 text-xs text-left transition-colors",
                  activeFile === file.name
                    ? "bg-[#37373d] text-[#d4d4d4]"
                    : "text-[#cccccc] hover:bg-[#2d2d2d]"
                )}
              >
                {getFileIcon(file.name)}
                <span className="font-mono truncate">{file.name}</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-40 bg-[#252526] border border-[#3c3c3c] rounded shadow-xl py-1 text-xs"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                setRenaming(contextMenu.fileName)
                setRenameValue(contextMenu.fileName)
                setContextMenu(null)
              }}
              className="flex items-center gap-2 w-full px-4 py-1.5 text-[#d4d4d4] hover:bg-[#37373d] transition-colors"
            >
              <Pencil className="w-3 h-3" />
              Rename
            </button>
            <button
              onClick={() => {
                onDeleteFile(contextMenu.fileName)
                setContextMenu(null)
              }}
              className="flex items-center gap-2 w-full px-4 py-1.5 text-[#dc3545] hover:bg-[rgba(220,53,69,0.1)] transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
