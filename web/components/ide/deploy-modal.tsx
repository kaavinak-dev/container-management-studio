"use client"

import { useState, useEffect } from "react"
import { X, Check, Loader2, AlertTriangle, CheckCircle2, XCircle, ChevronDown } from "lucide-react"
import type { ProjectStatus } from "@/lib/store"
import { cn } from "@/lib/utils"

interface DeployModalProps {
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
  { id: "package", label: "Packaging files", status: "pending" },
  { id: "scan", label: "Running virus scan", status: "pending" },
  { id: "audit", label: "Running npm audit", status: "pending" },
  { id: "build", label: "Building Docker container", status: "pending" },
  { id: "start", label: "Starting container", status: "pending" },
]

const LOG_LINES: string[] = [
  "→ Compressing project files...",
  "→ Archive size: 24.3 KB",
  "✓ Files packaged successfully",
  "",
  "→ Starting ClamAV scan...",
  "→ Scanning 12 files...",
  "✓ No threats detected",
  "",
  "→ Running npm audit...",
  "→ Fetching vulnerability database...",
  "found 0 vulnerabilities in 3 packages",
  "✓ npm audit passed",
  "",
  "→ docker build -t container-app:latest .",
  "Step 1/6 : FROM node:20-slim",
  "Step 2/6 : WORKDIR /app",
  "Step 3/6 : COPY package*.json ./",
  "Step 4/6 : RUN npm install",
  "added 3 packages in 1.8s",
  "Step 5/6 : COPY . .",
  "Step 6/6 : CMD [\"node\", \"index.js\"]",
  "Successfully built 2f3d9a1b4c5e",
  "✓ Docker image built",
  "",
  "→ Starting container...",
  "Container ID: a1b2c3d4e5f6",
  "→ Waiting for health check...",
  "✓ Container is healthy",
]

export function DeployModal({ projectName, onClose, onSuccess }: DeployModalProps) {
  const [phase, setPhase] = useState<DeployPhase>("confirm")
  const [steps, setSteps] = useState<DeployStep[]>(INITIAL_STEPS)
  const [logs, setLogs] = useState<string[]>([])
  const [logIdx, setLogIdx] = useState(0)
  const [showDetails, setShowDetails] = useState(false)

  // Determine outcome (80% success, 10% quarantined, 10% rejected)
  const [outcome] = useState(() => {
    const r = Math.random()
    if (r < 0.8) return { status: "approved" as ProjectStatus, score: Math.floor(Math.random() * 25) }
    if (r < 0.9) return {
      status: "quarantined" as ProjectStatus,
      score: 45 + Math.floor(Math.random() * 20),
      issues: ["2 moderate-severity npm vulnerabilities found", "Unusual outbound network pattern detected"],
    }
    return {
      status: "rejected" as ProjectStatus,
      score: 72 + Math.floor(Math.random() * 25),
      issues: ["3 high-severity npm vulnerabilities found", "Suspicious file count: 12,000 files", "Known malware signature match"],
    }
  })

  function startDeploy() {
    setPhase("progress")
    runSteps()
  }

  async function runSteps() {
    const delays = [600, 1000, 1200, 2000, 800]

    for (let i = 0; i < INITIAL_STEPS.length; i++) {
      // Mark current as running
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s))
      )

      // Stream log lines
      await streamLogs(i)

      await delay(delays[i])

      // Mark done (or fail on last if outcome is bad)
      const isFinalStep = i === INITIAL_STEPS.length - 1
      const shouldFail = isFinalStep && outcome.status !== "approved"

      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: shouldFail ? "failed" : "done" } : s
        )
      )

      if (shouldFail) {
        await delay(400)
        setPhase("failed")
        return
      }
    }

    await delay(400)
    setPhase("success")
  }

  async function streamLogs(stepIdx: number) {
    const logsPerStep = [3, 3, 3, 8, 3]
    const count = logsPerStep[stepIdx]
    for (let i = 0; i < count; i++) {
      await delay(200)
      setLogs((prev) => {
        const nextIdx = prev.length
        return [...prev, LOG_LINES[nextIdx] ?? ""]
      })
    }
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function getRiskLevel(score: number) {
    if (score < 25) return { label: "LOW RISK", color: "#28a745" }
    if (score < 50) return { label: "MEDIUM RISK", color: "#ffc107" }
    if (score < 75) return { label: "HIGH RISK", color: "#fd7e14" }
    return { label: "CRITICAL RISK", color: "#dc3545" }
  }

  const risk = getRiskLevel(outcome.score)

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
            {phase === "failed" && (outcome.status === "quarantined" ? "Deploy Quarantined" : "Deploy Rejected")}
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

              {/* Log output */}
              <div className="bg-[#0d1117] rounded border border-[#3c3c3c] p-3 h-32 overflow-y-auto font-mono text-xs text-[#858585] leading-relaxed">
                {logs.map((line, i) => (
                  <div key={i}>{line || "\u00A0"}</div>
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
                <p className="text-[#858585] text-sm mb-3">Risk assessment result</p>
                <span
                  className="inline-block px-3 py-1.5 rounded text-sm font-bold"
                  style={{ color: risk.color, backgroundColor: `${risk.color}22`, border: `1px solid ${risk.color}40` }}
                >
                  {risk.label} — Score: {outcome.score}/100
                </span>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    onSuccess(outcome.status, outcome.score)
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
                  <span
                    className="inline-block px-3 py-1.5 rounded text-sm font-bold"
                    style={{ color: risk.color, backgroundColor: `${risk.color}22`, border: `1px solid ${risk.color}40` }}
                  >
                    {risk.label} — Score: {outcome.score}/100
                  </span>
                </div>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-xs text-[#858585] hover:text-[#d4d4d4] transition-colors mb-2"
                >
                  <ChevronDown
                    className={cn("w-3 h-3 transition-transform", showDetails && "rotate-180")}
                  />
                  {showDetails ? "Hide" : "View"} details
                </button>
                {showDetails && outcome.issues && (
                  <ul className="flex flex-col gap-1.5">
                    {outcome.issues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#dc3545]">
                        <span className="mt-0.5 flex-shrink-0">•</span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={() => {
                  onSuccess(outcome.status, outcome.score, outcome.issues)
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
