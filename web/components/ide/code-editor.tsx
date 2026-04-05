"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import Editor, { type Monaco } from "@monaco-editor/react"
import type { editor } from "monaco-editor"
import type { ProjectFile } from "@/lib/store"

// ---------------------------------------------------------------------------
// Module-level state — survives React remounts
// ---------------------------------------------------------------------------

let monacoInstance: Monaco | null = null
let ataInitialized = false

// Map of extra-lib disposables so we can update them on file changes
const extraLibDisposables = new Map<string, { dispose(): void }>()

function getLanguageId(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase()
  if (ext === "ts" || ext === "tsx") return "typescript"
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript"
  if (ext === "json") return "json"
  if (ext === "css") return "css"
  if (ext === "html") return "html"
  if (ext === "md") return "markdown"
  return "plaintext"
}

// ---------------------------------------------------------------------------
// Configure Monaco's built-in TypeScript/JavaScript language service
// ---------------------------------------------------------------------------

function configureTypeScriptDefaults(monaco: Monaco) {
  const jsDefaults = monaco.languages.typescript.javascriptDefaults
  const tsDefaults = monaco.languages.typescript.typescriptDefaults

  const sharedCompilerOptions: import("monaco-editor").languages.typescript.CompilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    module: monaco.languages.typescript.ModuleKind.CommonJS,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    strict: false,
    skipLibCheck: true,
    resolveJsonModule: true,
    // The base URL tells the TS worker where to resolve bare imports from
    baseUrl: "file:///workspace",
  }

  jsDefaults.setCompilerOptions(sharedCompilerOptions)
  tsDefaults.setCompilerOptions(sharedCompilerOptions)

  jsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })

  // Enable eager model sync so cross-file go-to-definition works
  jsDefaults.setEagerModelSync(true)
  tsDefaults.setEagerModelSync(true)
}

// ---------------------------------------------------------------------------
// Load all project files as Monaco models (enables cross-file references)
// ---------------------------------------------------------------------------

function syncProjectModels(monaco: Monaco, files: ProjectFile[]) {
  const fileUris = new Set<string>()

  for (const f of files) {
    const uri = monaco.Uri.parse(`file:///workspace/${f.name}`)
    const uriStr = uri.toString()
    fileUris.add(uriStr)

    const existing = monaco.editor.getModel(uri)
    if (existing) {
      // Update content if it changed (avoid resetting cursor in active editor)
      if (existing.getValue() !== f.content) {
        existing.setValue(f.content)
      }
    } else {
      monaco.editor.createModel(f.content, getLanguageId(f.name), uri)
    }
  }

  // Dispose models for files that no longer exist
  for (const model of monaco.editor.getModels()) {
    const uriStr = model.uri.toString()
    if (uriStr.startsWith("file:///workspace/") && !fileUris.has(uriStr)) {
      model.dispose()
    }
  }
}

// ---------------------------------------------------------------------------
// Automatic Type Acquisition (ATA) — fetches @types/* from npm CDN
// ---------------------------------------------------------------------------

async function initAta(monaco: Monaco) {
  if (ataInitialized) return
  ataInitialized = true

  try {
    const ts = await import("typescript")
    const { setupTypeAcquisition } = await import("@typescript/ata")

    const ata = setupTypeAcquisition({
      projectName: "workspace",
      typescript: ts,
      delegate: {
        receivedFile: (code: string, path: string) => {
          // Dispose previous version of this lib if it exists
          extraLibDisposables.get(path)?.dispose()
          const disposable = monaco.languages.typescript.javascriptDefaults.addExtraLib(
            code,
            `file://${path}`
          )
          extraLibDisposables.set(path, disposable)
          // Also add to TypeScript defaults
          monaco.languages.typescript.typescriptDefaults.addExtraLib(
            code,
            `file://${path}`
          )
        },
      },
    })

    // Scan all current models for imports
    for (const model of monaco.editor.getModels()) {
      const lang = model.getLanguageId()
      if (lang === "javascript" || lang === "typescript") {
        ata(model.getValue())
      }
    }

    // Store ata on the module level so we can call it on content changes
    ;(globalThis as any).__ata = ata
  } catch (err) {
    console.warn("[editor] ATA init failed (non-fatal — completions still work for local code):", err)
  }
}

// Debounced ATA trigger
let ataTimeout: ReturnType<typeof setTimeout> | null = null
function triggerAta(content: string) {
  const ata = (globalThis as any).__ata
  if (!ata) return
  if (ataTimeout) clearTimeout(ataTimeout)
  ataTimeout = setTimeout(() => ata(content), 1500)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CodeEditorProps {
  projectId: string
  file: ProjectFile
  allFiles: ProjectFile[]
  onChange: (content: string) => void
  onSave: () => void
  isDirty: boolean
}

type MonacoLanguageId = "json" | "typescript" | "javascript" | "text"

export function CodeEditor({ projectId, file, allFiles, onChange, onSave, isDirty }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState("Starting workspace...")
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Use a ref to store the latest onSave callback to avoid stale closures in Monaco commands
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const monacoLanguage: MonacoLanguageId =
    file.language === "json" ? "json"
    : file.language === "typescript" || file.name.endsWith(".ts") ? "typescript"
    : file.language === "javascript" ? "javascript"
    : "text"

  // Start editor session (container for terminal/runtime — not for LSP)
  useEffect(() => {
    let cancelled = false

    async function startSession() {
      setSessionLoading(true)
      setLoadingMessage("Starting workspace...")
      try {
        const res = await fetch("/editor-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        })
        if (!res.ok) {
          let errorDetailsMessage = `HTTP ${res.status}`
          try {
            const errorBody = await res.json()
            errorDetailsMessage = errorBody.message || JSON.stringify(errorBody)
          } catch {
            errorDetailsMessage = res.statusText || `HTTP ${res.status}`
          }
          throw new Error(`Session start failed: ${errorDetailsMessage}`)
        }

        if (cancelled) return
        setSessionLoading(false)

        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          fetch(`/editor-sessions/${projectId}/heartbeat`, { method: "POST" }).catch(() => {})
        }, 60_000)
      } catch (err: any) {
        if (!cancelled) {
          console.error("[editor] failed to start session:", err)
          setLoadingMessage(`Failed to start workspace: ${err.message || "Unknown error"}. Check BFF logs.`)
        }
      }
    }

    startSession()

    return () => {
      cancelled = true
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [projectId])

  // Sync all project files as Monaco models whenever allFiles changes
  useEffect(() => {
    if (monacoInstance) {
      syncProjectModels(monacoInstance, allFiles)
    }
  }, [allFiles])

  // Called once when Monaco mounts
  const handleEditorWillMount = useCallback((monaco: Monaco) => {
    monacoInstance = monaco
    configureTypeScriptDefaults(monaco)
    syncProjectModels(monaco, allFiles)
    initAta(monaco)
  }, [allFiles])

  // Called after editor mounts
  const handleEditorDidMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor

      // Ctrl+S to save - use the ref to always call the latest handleSave from IDEView
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current()
      })
    },
    [] // No dependencies needed as we use the stable ref
  )

  function handleEditorChange(value: string | undefined) {
    if (value !== undefined) {
      onChange(value)
      // Trigger ATA to pick up new imports
      if (monacoLanguage === "javascript" || monacoLanguage === "typescript") {
        triggerAta(value)
      }
    }
  }

  if (sessionLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#1e1e1e] text-white gap-3">
        <div
          className="rounded-full h-8 w-8 border-t-2 border-blue-400"
          style={{ animation: "spin 1s linear infinite" }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span className="text-sm text-gray-400">{loadingMessage}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={monacoLanguage}
          value={file.content}
          path={`file:///workspace/${file.name}`}
          theme="vs-dark"
          options={{
            fontSize: 13,
            fontFamily: "Menlo, Monaco, 'Courier New', monospace",
            minimap: { enabled: true },
            wordWrap: "on",
            scrollBeyondLastLine: false,
            renderLineHighlight: "all",
            tabSize: 2,
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            parameterHints: { enabled: true },
          }}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorDidMount}
          onChange={handleEditorChange}
        />
      </div>
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-0.5 bg-[#007acc] text-white text-xs font-mono flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>
            {monacoLanguage === "typescript"
              ? "TypeScript"
              : monacoLanguage === "javascript"
              ? "JavaScript"
              : monacoLanguage === "json"
              ? "JSON"
              : "Plain Text"}
          </span>
          <span>UTF-8</span>
        </div>
        <div />
      </div>
    </div>
  )
}
