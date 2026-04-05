"use client"

import { useState } from "react"
import { X, Check, Loader2, AlertTriangle, CheckCircle2, XCircle, ChevronDown } from "lucide-react"
import type { ProjectStatus } from "@/lib/store"
import { projectAPI, type DeploymentStep as PolledStep } from "@/lib/api"
import { cn } from "@/lib/utils"

interface DeployModalProps {
  projectId: string
  projectName: string
  onClose: () => void
  onSuccess: (status: ProjectStatus, score: number, issues?: string[]) => void
}

type DeployPhase = "confirm" | "progress" | "success" | "failed"

interface DeployStep {
  id: string
  label: string
  status: "pending" | "running" | "done" | "failed"
}

const INITIAL_STEPS: DeployStep[] = [
  { id: "packaging",       label: "Packaging files",           status: "pending" },
  { id: "virus-scan",      label: "Running virus scan",        status: "pending" },
  { id: "npm-audit",       label: "Running npm audit",         status: "pending" },
  { id: "container-build", label: "Building Docker container", status: "pending" },
  { id: "container-start", label: "Starting container",        status: "pending" },
]

function toUiStatus(s: string): DeployStep["status"] {
  if (s === "completed") return "done"
  if (s === "skipped")   return "done"
  return s as DeployStep["status"]
}

export function DeployModal({ projectId, projectName, onClose, onSuccess }: DeployModalProps) {
  const [phase, setPhase] = useState<DeployPhase>("confirm")
  const [steps, setSteps] = useState<DeployStep[]>(INITIAL_STEPS)
  const [showDetails, setShowDetails] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)

  async function startDeploy() {
    setPhase("progress")

    let executableProjectId: string
    try {
      const res = await projectAPI.deployProject(projectId)
      executableProjectId = res.executableProjectId
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy request failed")
      setPhase("failed")
      return
    }

    const POLL_INTERVAL = 2000
    const TERMINAL = new Set(["completed", "failed", "skipped"])

    const isTerminal = (polledSteps: PolledStep[]) =>
      polledSteps.every(s => TERMINAL.has(s.status)) ||
      polledSteps.some(s => s.status === "failed")

    while (true) {
      await delay(POLL_INTERVAL)

      let polled: PolledStep[]
      try {
        polled = await projectAPI.getDeploymentSteps(executableProjectId)
      } catch {
        continue
      }

      setSteps(
        INITIAL_STEPS.map(s => {
          const live = polled.find(p => p.key === s.id)
          return live ? { ...s, status: toUiStatus(live.status) } : s
        })
      )

      if (isTerminal(polled)) {
        const failedStep = polled.find(s => s.status === "failed")
        if (failedStep) {
          setDeployError(failedStep.errorMessage ?? "A pipeline step failed")
          setPhase("failed")
        } else {
          setPhase("success")
        }
        break
      }
    }
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 w-full max-w-md mx-4 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3c3c3c]">
          <h2 className="text-[#d4d4d4] font-semibold text-base">
            {phase === "confirm" && "Deploy Project"}
            {phase === "progress" && "Deploying…"}
            {phase === "success" && "Container is live!"}
            {phase === "failed" && "Deploy Failed"}
          </h2>
          {(phase === "confirm" || phase === "success" || phase === "failed") && (
            <button
              onClick={onClose}
              className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-6">
          {/* CONFIRM */}
          {phase === "confirm" && (
            <div className="flex flex-col gap-5">
              <p className="text-[#858585] text-sm leading-relaxed">
                This will zip your current files, scan them for vulnerabilities,
                and build a Docker container. This may take 1–2 minutes.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 rounded text-sm bg-[#3c3c3c] text-[#d4d4d4] hover:bg-[#4a4a4a] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={startDeploy}
                  className="flex-1 px-4 py-2 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
                >
                  Start Deploy
                </button>
              </div>
            </div>
          )}

          {/* PROGRESS */}
          {phase === "progress" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                {steps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3">
                    <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                      {step.status === "pending" && (
                        <div className="w-4 h-4 rounded-full border border-[#3c3c3c]" />
                      )}
                      {step.status === "running" && (
                        <Loader2 className="w-4 h-4 text-[#007acc] spinner" />
                      )}
                      {step.status === "done" && (
                        <CheckCircle2 className="w-4 h-4 text-[#28a745] step-done" />
                      )}
                      {step.status === "failed" && (
                        <XCircle className="w-4 h-4 text-[#dc3545] step-done" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-sm",
                        step.status === "pending" && "text-[#555]",
                        step.status === "running" && "text-[#d4d4d4]",
                        step.status === "done" && "text-[#28a745]",
                        step.status === "failed" && "text-[#dc3545]"
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>

            </div>
          )}

          {/* SUCCESS */}
          {phase === "success" && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 rounded-full bg-[rgba(40,167,69,0.15)] flex items-center justify-center animate-success">
                <Check className="w-8 h-8 text-[#28a745]" />
              </div>
              <div>
                <p className="text-[#858585] text-sm">
                  Deploy job accepted. The container is being built in the background.
                </p>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    onSuccess("approved", 0)
                    onClose()
                  }}
                  className="flex-1 px-4 py-2 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
                >
                  Open Terminal
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded text-sm bg-[#3c3c3c] text-[#d4d4d4] hover:bg-[#4a4a4a] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* FAILED */}
          {phase === "failed" && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 rounded-full bg-[rgba(220,53,69,0.15)] flex items-center justify-center animate-success">
                <AlertTriangle className="w-8 h-8 text-[#dc3545]" />
              </div>
              <div className="w-full text-left">
                <div className="flex items-center justify-center mb-3">
                  <span className="inline-block px-3 py-1.5 rounded text-sm font-bold text-[#dc3545] bg-[rgba(220,53,69,0.13)] border border-[rgba(220,53,69,0.25)]">
                    Deploy Failed
                  </span>
                </div>
                {deployError && (
                  <>
                    <button
                      onClick={() => setShowDetails(!showDetails)}
                      className="flex items-center gap-1 text-xs text-[#858585] hover:text-[#d4d4d4] transition-colors mb-2"
                    >
                      <ChevronDown
                        className={cn("w-3 h-3 transition-transform", showDetails && "rotate-180")}
                      />
                      {showDetails ? "Hide" : "View"} details
                    </button>
                    {showDetails && (
                      <p className="text-xs text-[#dc3545]">{deployError}</p>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={() => {
                  onSuccess("rejected", 0)
                  onClose()
                }}
                className="w-full px-4 py-2 rounded text-sm bg-[#3c3c3c] text-[#d4d4d4] hover:bg-[#4a4a4a] transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
