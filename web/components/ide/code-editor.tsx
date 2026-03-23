"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import type { ProjectFile } from "@/lib/store"
import { cn } from "@/lib/utils"

interface CodeEditorProps {
  file: ProjectFile
  onChange: (content: string) => void
}

type SaveState = "idle" | "saving" | "saved"

// Token types for our syntax highlighter
type TokenType =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "punctuation"
  | "function"
  | "property"
  | "default"
  | "json-key"
  | "json-string"
  | "json-number"
  | "json-boolean"

interface Token {
  type: TokenType
  value: string
}

const JS_KEYWORDS = new Set([
  "const","let","var","function","return","if","else","for","while","do",
  "switch","case","break","continue","new","this","class","extends",
  "import","export","default","from","require","module","async","await",
  "try","catch","finally","throw","typeof","instanceof","in","of","null",
  "undefined","true","false","void","delete","yield","static","super",
])

function tokenizeJS(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    // Line comment
    if (line[i] === "/" && line[i + 1] === "/") {
      tokens.push({ type: "comment", value: line.slice(i) })
      break
    }
    // String (single / double / template)
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i]
      let j = i + 1
      while (j < line.length) {
        if (line[j] === "\\" ) { j += 2; continue }
        if (line[j] === quote) { j++; break }
        j++
      }
      tokens.push({ type: "string", value: line.slice(i, j) })
      i = j
      continue
    }
    // Number
    if (/[0-9]/.test(line[i]) && (i === 0 || /\W/.test(line[i - 1]))) {
      let j = i
      while (j < line.length && /[0-9.]/.test(line[j])) j++
      tokens.push({ type: "number", value: line.slice(i, j) })
      i = j
      continue
    }
    // Punctuation
    if (/[{}[\]().,;:=+\-*/<>!&|^~%?]/.test(line[i])) {
      tokens.push({ type: "punctuation", value: line[i] })
      i++
      continue
    }
    // Word (keyword or identifier)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++
      const word = line.slice(i, j)
      if (JS_KEYWORDS.has(word)) {
        tokens.push({ type: "keyword", value: word })
      } else if (j < line.length && line[j] === "(") {
        tokens.push({ type: "function", value: word })
      } else if (i > 0 && line[i - 1] === ".") {
        tokens.push({ type: "property", value: word })
      } else {
        tokens.push({ type: "default", value: word })
      }
      i = j
      continue
    }
    // Default: whitespace etc.
    tokens.push({ type: "default", value: line[i] })
    i++
  }
  return tokens
}

function tokenizeJSON(line: string): Token[] {
  const tokens: Token[] = []
  const trimmed = line.trimStart()
  const leading = line.slice(0, line.length - trimmed.length)
  if (leading) tokens.push({ type: "default", value: leading })

  let i = 0
  const t = trimmed
  while (i < t.length) {
    if (t[i] === '"') {
      // Check if JSON key (followed by : after closing quote)
      let j = i + 1
      while (j < t.length && t[j] !== '"') {
        if (t[j] === "\\") j++
        j++
      }
      j++
      const word = t.slice(i, j)
      const rest = t.slice(j).trimStart()
      if (rest[0] === ":") {
        tokens.push({ type: "json-key", value: word })
      } else {
        tokens.push({ type: "json-string", value: word })
      }
      i = j
      continue
    }
    if (/[0-9\-]/.test(t[i])) {
      let j = i
      while (j < t.length && /[0-9.eE+\-]/.test(t[j])) j++
      tokens.push({ type: "json-number", value: t.slice(i, j) })
      i = j
      continue
    }
    if (t.slice(i).startsWith("true") || t.slice(i).startsWith("false") || t.slice(i).startsWith("null")) {
      const word = t.slice(i).match(/^(true|false|null)/)![0]
      tokens.push({ type: "json-boolean", value: word })
      i += word.length
      continue
    }
    tokens.push({ type: "punctuation", value: t[i] })
    i++
  }
  return tokens
}

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: "#569cd6",
  string: "#ce9178",
  comment: "#6a9955",
  number: "#b5cea8",
  punctuation: "#d4d4d4",
  function: "#dcdcaa",
  property: "#9cdcfe",
  default: "#d4d4d4",
  "json-key": "#9cdcfe",
  "json-string": "#ce9178",
  "json-number": "#b5cea8",
  "json-boolean": "#569cd6",
}

function renderHighlightedLine(line: string, language: string, lineIdx: number) {
  if (line === "") return <span key={lineIdx}>&nbsp;</span>
  const tokens = language === "json" ? tokenizeJSON(line) : tokenizeJS(line)
  return (
    <span key={lineIdx}>
      {tokens.map((tok, i) => (
        <span key={i} style={{ color: TOKEN_COLORS[tok.type] }}>
          {tok.value}
        </span>
      ))}
    </span>
  )
}

export function CodeEditor({ file, onChange }: CodeEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })

  const lines = file.content.split("\n")
  const lineCount = lines.length

  // Sync scroll between textarea and highlight
  function syncScroll() {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }

  const triggerSave = useCallback(
    (value: string) => {
      setSaveState("saving")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        onChange(value)
        setSaveState("saved")
        setTimeout(() => setSaveState("idle"), 2000)
      }, 800)
    },
    [onChange]
  )

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    triggerSave(e.target.value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault()
      const ta = textareaRef.current!
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newVal =
        file.content.substring(0, start) + "  " + file.content.substring(end)
      onChange(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }

  function updateCursor() {
    const ta = textareaRef.current
    if (!ta) return
    const text = ta.value.substring(0, ta.selectionStart)
    const lineNum = text.split("\n").length
    const colNum = text.split("\n").pop()!.length + 1
    setCursor({ line: lineNum, col: colNum })
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const langLabel =
    file.language === "javascript"
      ? "JavaScript"
      : file.language === "json"
      ? "JSON"
      : "Plain Text"

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Editor area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Line numbers */}
        <div
          className="flex-shrink-0 w-12 bg-[#1e1e1e] text-[#858585] text-xs font-mono pt-3 pb-3 text-right select-none overflow-hidden"
          aria-hidden="true"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="leading-5 pr-3">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Highlight layer + textarea */}
        <div className="relative flex-1 overflow-auto" onScroll={syncScroll}>
          {/* Highlighted code (visual) */}
          <pre
            ref={highlightRef}
            className="absolute inset-0 m-0 p-3 text-xs font-mono leading-5 whitespace-pre pointer-events-none overflow-hidden"
            aria-hidden="true"
          >
            {lines.map((line, idx) => (
              <div key={idx} className="leading-5">
                {renderHighlightedLine(line, file.language, idx)}
              </div>
            ))}
          </pre>

          {/* Actual textarea (transparent, on top) */}
          <textarea
            ref={textareaRef}
            value={file.content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            spellCheck={false}
            className="relative w-full h-full min-h-full p-3 text-xs font-mono leading-5 bg-transparent text-transparent caret-[#d4d4d4] resize-none outline-none border-0 whitespace-pre overflow-auto"
            style={{ caretColor: "#d4d4d4" }}
          />
        </div>

        {/* Minimap (decorative) */}
        <div
          className="w-20 flex-shrink-0 bg-[#1e1e1e] border-l border-[#3c3c3c] overflow-hidden opacity-60"
          aria-hidden="true"
        >
          <div className="p-1">
            {lines.slice(0, 80).map((line, i) => (
              <div
                key={i}
                className="h-1.5 mb-px rounded-sm opacity-40"
                style={{
                  width: `${Math.min(line.length * 1.2, 64)}px`,
                  backgroundColor:
                    line.trimStart().startsWith("//")
                      ? "#6a9955"
                      : line.includes("function") || line.includes("const")
                      ? "#569cd6"
                      : "#d4d4d4",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-0.5 bg-[#007acc] text-white text-xs font-mono flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>{langLabel}</span>
          <span>UTF-8</span>
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
        </div>
        <div>
          {saveState === "saving" && (
            <span className="text-blue-200">Saving…</span>
          )}
          {saveState === "saved" && (
            <span className="text-green-300">Saved ✓</span>
          )}
        </div>
      </div>
    </div>
  )
}
