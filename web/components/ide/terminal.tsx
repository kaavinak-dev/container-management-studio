"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Plus, Terminal } from "lucide-react"
import type { ProjectStatus } from "@/lib/store"

interface TerminalPanelProps {
  projectId: string
  status: ProjectStatus
  isOpen: boolean
  onToggle: () => void
}

const MOCK_OUTPUT = [
  { type: "cmd", text: "node index.js" },
  { type: "stdout", text: "Simple Node App listening on port 3000" },
  { type: "stdout", text: "[gRPC sidecar] Connected on :50051" },
  { type: "stdout", text: "" },
  { type: "info", text: "GET / 200 2.3ms" },
  { type: "info", text: "GET /health 200 0.8ms" },
  { type: "stdout", text: "" },
]

export function TerminalPanel({ projectId, status, isOpen, onToggle }: TerminalPanelProps) {
  const [inputValue, setInputValue] = useState("")
  const [history, setHistory] = useState(
    status === "approved" ? MOCK_OUTPUT : []
  )

  const containerRunning = status === "approved"

  function handleCommand(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && inputValue.trim()) {
      const cmd = inputValue.trim()
      setHistory((prev) => [
        ...prev,
        { type: "cmd", text: cmd },
        { type: "stdout", text: `bash: ${cmd}: command not found` },
      ])
      setInputValue("")
    }
  }

  return (
    <div
      className="flex flex-col border-t border-[#3c3c3c] bg-[#0d1117] transition-all"
      style={{ height: isOpen ? "220px" : "32px" }}
    >
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 h-8 bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold text-[#858585] uppercase tracking-widest">
            Terminal
          </span>
          {containerRunning && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1e1e1e] border border-[#3c3c3c]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#28a745]" />
              <span className="text-[10px] text-[#858585] font-mono">
                bash — container-{projectId.slice(-6)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onToggle}
            className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
          >
            {isOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Terminal body */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
          {!containerRunning ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[#555]">
              <Terminal className="w-8 h-8 opacity-40" />
              <p>Deploy your project to start a live terminal</p>
            </div>
          ) : (
            <>
              {history.map((line, i) => (
                <div key={i} className="leading-5">
                  {line.type === "cmd" && (
                    <span className="text-[#4af626]">
                      <span className="text-[#007acc]">$ </span>
                      {line.text}
                    </span>
                  )}
                  {line.type === "stdout" && (
                    <span className="text-[#d4d4d4]">{line.text || "\u00A0"}</span>
                  )}
                  {line.type === "stderr" && (
                    <span className="text-[#dc3545]">{line.text}</span>
                  )}
                  {line.type === "info" && (
                    <span className="text-[#858585]">{line.text}</span>
                  )}
                </div>
              ))}
              {/* Input line */}
              <div className="flex items-center gap-1 mt-1">
                <span className="text-[#007acc]">$</span>
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleCommand}
                  className="flex-1 bg-transparent text-[#4af626] outline-none caret-[#4af626] font-mono text-xs"
                  spellCheck={false}
                  autoFocus
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
