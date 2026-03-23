"use client"

import { useState } from "react"
import { X, ChevronLeft, Loader2 } from "lucide-react"
import type { Project, BaseOS } from "@/lib/store"
import { generateId } from "@/lib/store"
import { cn } from "@/lib/utils"

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (project: Project) => void
}

type Step = 1 | 2

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [step, setStep] = useState<Step>(1)
  const [projectName, setProjectName] = useState("")
  const [baseOS, setBaseOS] = useState<BaseOS>("ubuntu")
  const [nodeVersion, setNodeVersion] = useState("20")
  const [loading, setLoading] = useState(false)
  const [nameError, setNameError] = useState("")

  function handleCreate() {
    if (!projectName.trim()) {
      setNameError("Project name is required")
      return
    }
    if (!/^[a-z0-9-]+$/.test(projectName.trim())) {
      setNameError("Use only lowercase letters, numbers, and hyphens")
      return
    }
    setNameError("")
    setLoading(true)

    setTimeout(() => {
      const newProject: Project = {
        id: generateId(),
        name: projectName.trim(),
        type: "nodejs",
        status: "draft",
        createdAt: new Date(),
        nodeVersion,
        baseOS,
        files: [
          {
            name: "index.js",
            language: "javascript",
            content: `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from ${projectName.trim()}!\\n');
});

server.listen(3000, () => {
  console.log('Simple Node App listening on port 3000');
});
`,
          },
          {
            name: "package.json",
            language: "json",
            content: JSON.stringify(
              {
                name: projectName.trim(),
                version: "1.0.0",
                main: "index.js",
                scripts: { start: "node index.js" },
                dependencies: {},
              },
              null,
              2
            ) + "\n",
          },
        ],
      }
      setLoading(false)
      onCreate(newProject)
    }, 1800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={!loading ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-2xl overflow-hidden">
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-20 bg-[#252526]/95 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-[#007acc] spinner" />
            <p className="text-[#d4d4d4] text-sm font-medium">Setting up your project…</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3c3c3c]">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="text-[#d4d4d4] font-semibold text-base">
              {step === 1 ? "What are you building?" : "Configure your project"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#858585] hover:text-[#d4d4d4] hover:bg-[#3c3c3c] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-[#3c3c3c]">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors",
                  step >= s
                    ? "bg-[#007acc] text-white"
                    : "bg-[#3c3c3c] text-[#858585]"
                )}
              >
                {s}
              </div>
              <span
                className={cn(
                  "text-xs transition-colors",
                  step >= s ? "text-[#d4d4d4]" : "text-[#858585]"
                )}
              >
                {s === 1 ? "Project Type" : "Configure"}
              </span>
              {s < 2 && <div className="w-8 h-px bg-[#3c3c3c]" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="p-6">
          {step === 1 ? (
            <Step1 onSelectNodeJs={() => setStep(2)} />
          ) : (
            <Step2
              projectName={projectName}
              setProjectName={setProjectName}
              nameError={nameError}
              baseOS={baseOS}
              setBaseOS={setBaseOS}
              nodeVersion={nodeVersion}
              setNodeVersion={setNodeVersion}
              onBack={() => setStep(1)}
              onCreate={handleCreate}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function Step1({ onSelectNodeJs }: { onSelectNodeJs: () => void }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Node.js — active */}
      <button
        onClick={onSelectNodeJs}
        className="flex flex-col items-center gap-3 p-4 rounded border border-[#3c3c3c] bg-[#2d2d2d] hover:border-[#007acc] hover:bg-[rgba(0,122,204,0.08)] transition-all group cursor-pointer text-left"
      >
        <div className="w-12 h-12 rounded-lg bg-[rgba(40,167,69,0.15)] flex items-center justify-center text-[#28a745]">
          <NodeJsLogo />
        </div>
        <div>
          <p className="text-[#d4d4d4] font-medium text-sm text-center">Node.js</p>
          <p className="text-[#858585] text-xs text-center mt-1 leading-relaxed">
            Express / vanilla Node — Docker container with gRPC sidecar
          </p>
        </div>
      </button>

      {/* Python — disabled */}
      <DisabledTypeCard name="Python" icon={<PythonIcon />} />
      {/* Go — disabled */}
      <DisabledTypeCard name="Go" icon={<GoIcon />} />
    </div>
  )
}

function DisabledTypeCard({ name, icon }: { name: string; icon: React.ReactNode }) {
  return (
    <div className="relative flex flex-col items-center gap-3 p-4 rounded border border-[#3c3c3c] bg-[#1e1e1e] opacity-50 cursor-not-allowed overflow-hidden">
      <div className="absolute top-2 right-2">
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#3c3c3c] text-[#858585]">
          Soon
        </span>
      </div>
      <div className="w-12 h-12 rounded-lg bg-[#2d2d2d] flex items-center justify-center text-[#555]">
        {icon}
      </div>
      <p className="text-[#555] font-medium text-sm">{name}</p>
    </div>
  )
}

interface Step2Props {
  projectName: string
  setProjectName: (v: string) => void
  nameError: string
  baseOS: BaseOS
  setBaseOS: (v: BaseOS) => void
  nodeVersion: string
  setNodeVersion: (v: string) => void
  onBack: () => void
  onCreate: () => void
}

function Step2({
  projectName,
  setProjectName,
  nameError,
  baseOS,
  setBaseOS,
  nodeVersion,
  setNodeVersion,
  onBack,
  onCreate,
}: Step2Props) {
  const osOptions: { value: BaseOS; label: string; desc: string; disabled?: boolean }[] = [
    { value: "ubuntu", label: "Ubuntu 22.04 (Linux)", desc: "Recommended, full compatibility" },
    { value: "alpine", label: "Alpine Linux", desc: "Lightweight, minimal image" },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Project name */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-[#858585] uppercase tracking-wide">
          Project Name <span className="text-[#dc3545]">*</span>
        </label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
          placeholder="my-awesome-app"
          className={cn(
            "w-full px-3 py-2 rounded border bg-[#1e1e1e] text-[#d4d4d4] text-sm font-mono",
            "placeholder:text-[#555] outline-none focus:border-[#007acc] transition-colors",
            nameError ? "border-[#dc3545]" : "border-[#3c3c3c]"
          )}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && onCreate()}
        />
        {nameError && (
          <p className="text-xs text-[#dc3545]">{nameError}</p>
        )}
      </div>

      {/* Base OS */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-[#858585] uppercase tracking-wide">Base OS</label>
        <div className="flex flex-col gap-2">
          {osOptions.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors",
                baseOS === opt.value
                  ? "border-[#007acc] bg-[rgba(0,122,204,0.08)]"
                  : "border-[#3c3c3c] hover:border-[#555] bg-[#1e1e1e]"
              )}
            >
              <input
                type="radio"
                name="baseOS"
                value={opt.value}
                checked={baseOS === opt.value}
                onChange={() => setBaseOS(opt.value)}
                className="accent-[#007acc]"
              />
              <div>
                <p className="text-sm text-[#d4d4d4] font-medium">{opt.label}</p>
                <p className="text-xs text-[#858585]">{opt.desc}</p>
              </div>
            </label>
          ))}
          {/* Windows — disabled */}
          <div className="flex items-center gap-3 p-3 rounded border border-[#3c3c3c] bg-[#1e1e1e] opacity-40 cursor-not-allowed">
            <input type="radio" disabled className="accent-[#007acc]" />
            <div>
              <p className="text-sm text-[#555] font-medium">Windows</p>
              <p className="text-xs text-[#555]">Not supported for Node.js</p>
            </div>
          </div>
        </div>
      </div>

      {/* Node version */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-[#858585] uppercase tracking-wide">
          Node.js Version
        </label>
        <select
          value={nodeVersion}
          onChange={(e) => setNodeVersion(e.target.value)}
          className="w-full px-3 py-2 rounded border border-[#3c3c3c] bg-[#1e1e1e] text-[#d4d4d4] text-sm outline-none focus:border-[#007acc] transition-colors cursor-pointer"
        >
          <option value="20">Node 20 LTS (Recommended)</option>
          <option value="18">Node 18 LTS</option>
          <option value="22">Node 22</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onBack}
          className="px-4 py-2 rounded text-sm text-[#d4d4d4] bg-[#3c3c3c] hover:bg-[#4a4a4a] transition-colors"
        >
          Back
        </button>
        <button
          onClick={onCreate}
          className="flex-1 px-4 py-2 rounded text-sm font-medium bg-[#007acc] text-white hover:bg-[#0088e0] transition-colors"
        >
          Create Project
        </button>
      </div>
    </div>
  )
}

function NodeJsLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
      <path d="M11.998 24c-.321 0-.641-.084-.924-.247l-2.937-1.737c-.438-.245-.224-.332-.08-.383.585-.203.703-.25 1.328-.605.065-.037.151-.023.218.017l2.256 1.339c.082.045.199.045.275 0l8.795-5.076c.082-.047.134-.141.134-.238V6.921c0-.099-.052-.19-.137-.242l-8.791-5.072c-.081-.047-.189-.047-.271 0L3.075 6.68c-.087.05-.141.144-.141.243v10.15c0 .097.054.189.139.235l2.409 1.392c1.307.654 2.108-.116 2.108-.891V7.787c0-.142.114-.253.256-.253h1.115c.139 0 .255.11.255.253v10.021c0 1.745-.95 2.745-2.604 2.745-.508 0-.909 0-2.026-.551L2.28 18.675c-.572-.329-.924-.943-.924-1.604V6.921c0-.661.352-1.275.924-1.601l8.795-5.082c.557-.315 1.296-.315 1.848 0l8.794 5.082c.573.326.925.939.925 1.601v10.15c0 .661-.352 1.275-.925 1.604l-8.794 5.076c-.283.163-.602.247-.925.247z" />
    </svg>
  )
}

function PythonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
      <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969c0 6.18 3.403 5.963 3.403 5.963h2.032v-2.867s-.109-3.402 3.35-3.402h5.766s3.24.052 3.24-3.13V3.13S18.28 0 11.914 0zm-3.21 1.809a1.05 1.05 0 0 1 1.052 1.05 1.05 1.05 0 0 1-1.051 1.05A1.05 1.05 0 0 1 7.654 2.86a1.05 1.05 0 0 1 1.051-1.051z" />
      <path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752H12v-.826h8.121S24 18.211 24 12.031c0-6.18-3.403-5.963-3.403-5.963h-2.032v2.867s.109 3.402-3.35 3.402H9.449s-3.24-.052-3.24 3.13v5.403S5.72 24 12.086 24zm3.21-1.809a1.05 1.05 0 0 1-1.051-1.05 1.05 1.05 0 0 1 1.05-1.05 1.05 1.05 0 0 1 1.052 1.05 1.05 1.05 0 0 1-1.051 1.05z" />
    </svg>
  )
}

function GoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
      <path d="M1.811 10.231c-.047 0-.058-.023-.035-.059l.246-.315c.023-.035.081-.058.128-.058h4.172c.046 0 .058.035.035.07l-.199.303c-.023.036-.082.07-.117.07zM.047 11.306c-.047 0-.059-.023-.035-.058l.245-.316c.023-.035.082-.058.129-.058h5.328c.047 0 .07.035.058.07l-.093.28c-.012.047-.058.07-.105.07zm2.828 1.075c-.047 0-.059-.035-.035-.07l.163-.292c.023-.035.07-.07.117-.07h2.337c.047 0 .07.035.07.082l-.023.28c0 .047-.047.082-.082.082zm12.129-2.36c-.736.187-1.239.327-1.963.514-.176.046-.187.058-.34-.117-.174-.199-.303-.327-.548-.444-.737-.362-1.45-.257-2.115.175-.795.514-1.204 1.274-1.192 2.22.011.935.654 1.706 1.577 1.835.795.105 1.46-.175 1.987-.771.105-.129.198-.269.315-.432H10.47c-.245 0-.304-.152-.222-.35.152-.362.432-.966.596-1.274a.315.315 0 0 1 .292-.187h4.253c-.023.316-.023.631-.07.947a4.983 4.983 0 0 1-.958 2.29c-.841 1.11-1.94 1.8-3.33 1.986-1.145.152-2.209-.07-3.143-.77-.865-.655-1.356-1.52-1.484-2.595-.152-1.274.222-2.419.993-3.424.83-1.086 1.928-1.776 3.272-2.02 1.098-.2 2.15-.07 3.096.571.62.41 1.063.97 1.356 1.648.07.105.023.164-.117.2z" />
      <path d="M15.591 17.913c-1.086-.024-2.078-.35-2.918-1.064-.71-.618-1.157-1.402-1.274-2.336-.152-1.18.152-2.243.794-3.2.7-1.04 1.637-1.718 2.848-2.02 1.04-.257 2.056-.199 2.99.362.863.52 1.379 1.262 1.53 2.267.198 1.449-.257 2.643-1.239 3.655-.678.713-1.507 1.157-2.444 1.32-.105.012-.21.012-.287.016zm2.796-4.59c-.012-.128-.012-.234-.035-.327-.222-1.17-1.274-1.835-2.42-1.577-1.122.246-1.847 1.004-2.09 2.15-.21.993.257 2.02 1.121 2.467.655.34 1.321.316 1.964-.023.99-.514 1.473-1.344 1.46-2.69z" />
    </svg>
  )
}
