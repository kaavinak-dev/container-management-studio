'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Terminal as TerminalIcon } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  projectId: string
  isOpen: boolean
  sessionReady: boolean
  onToggle: () => void
}

// Handles client-side line buffering (cooked mode).
// Printable chars are echoed locally and buffered; the line is sent only on Enter.
// Control signals (Ctrl+C, Ctrl+D, Ctrl+Z) and escape sequences bypass the buffer
// and are sent immediately so they remain responsive.
class LineBuffer {
  private buffer: string = '';

  constructor(
    private term: XTerm,
    private ws: WebSocket,
    private rawMode: () => boolean,   // live getter so toggle takes effect immediately
  ) {}

  handle(data: string) {
    if (this.rawMode()) {
      // Raw mode: every keystroke goes straight to the server
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(new TextEncoder().encode(data));
      }
      return;
    }

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      const code = char.charCodeAt(0);

      // Ctrl+C / Ctrl+D / Ctrl+Z — send immediately (process signals must not be delayed)
      if (code === 0x03 || code === 0x04 || code === 0x1a) {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new TextEncoder().encode(char));
        }
        continue;
      }

      // Escape sequences (arrow keys, Tab) — send immediately, bypass buffer
      if (code === 0x1b || char === '\t') {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new TextEncoder().encode(char));
        }
        continue;
      }

      // Backspace (0x08) or DEL (0x7f) — erase last char from buffer locally
      if (code === 0x08 || code === 0x7f) {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.term.write('\x08\x1b[K'); // move cursor back + erase to end of line
        }
        continue;
      }

      // Enter (CR or LF) — flush buffer to server
      if (code === 0x0d || code === 0x0a) {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(new TextEncoder().encode(this.buffer + '\n'));
        }
        this.term.write('\r\n'); // local echo of newline (server won't echo in cooked mode)
        this.buffer = '';
        continue;
      }

      // Printable ASCII — echo locally and append to buffer
      if (code >= 0x20 && code < 0x7f) {
        this.buffer += char;
        this.term.write(char);
      }
    }
  }
}

export function TerminalPanel({ projectId, isOpen, sessionReady, onToggle }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [rawMode, setRawMode] = useState(false)
  const rawModeRef = useRef(rawMode)

  // Keep ref in sync so LineBuffer's live getter always reads the latest value
  // without needing to recreate the LineBuffer instance on every toggle
  useEffect(() => {
    rawModeRef.current = rawMode
  }, [rawMode])

  useEffect(() => {
    if (!isOpen || !sessionReady || !containerRef.current) return

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#0d1117' },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term

    async function connect() {
      const res = await fetch(`/editor-sessions/${projectId}/terminal`, { method: 'POST' })
      if (!res.ok) {
        term.writeln('\r\n\x1b[31mFailed to start terminal session.\x1b[0m')
        return
      }
      const { sessionId } = await res.json()

      // NEXT_PUBLIC_BFF_WS_URL is set in .env.local (e.g. ws://localhost:3000).
      // We cannot use window.location.host here because the browser is on the Next.js
      // dev server port (3001), but /proxy/:id is served by the BFF (port 3000).
      // Next.js rewrites only handle HTTP — WS upgrades must go directly to the BFF.
      const bffWsBase = process.env.NEXT_PUBLIC_BFF_WS_URL ?? `ws://${window.location.host}`
      const ws = new WebSocket(`${bffWsBase}/proxy/${sessionId}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      const lineBuffer = new LineBuffer(term, ws, () => rawModeRef.current)

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data))
        } else {
          term.write(event.data)
        }
      }

      ws.onclose = () => term.writeln('\r\n\x1b[33m[Terminal closed]\x1b[0m')
      ws.onerror = () => term.writeln('\r\n\x1b[31m[Connection error]\x1b[0m')

      term.onData((data) => lineBuffer.handle(data))

      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      })
    }

    connect()

    const observer = new ResizeObserver(() => {
      if (termRef.current) fitAddon.fit()
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      wsRef.current?.close()
      term.dispose()
      termRef.current = null
      wsRef.current = null
    }
  }, [isOpen, sessionReady, projectId])

  return (
    <div
      className="flex flex-col border-t border-[#3c3c3c] bg-[#0d1117] transition-all"
      style={{ height: isOpen ? '220px' : '32px' }}
    >
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 h-8 bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold text-[#858585] uppercase tracking-widest">
            Terminal
          </span>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1e1e1e] border border-[#3c3c3c]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#28a745]" />
            <span className="text-[10px] text-[#858585] font-mono">
              bash — editor-{projectId.slice(-6)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Raw mode toggle — switch to raw when using vim/nano or interactive programs */}
          <button
            onClick={() => setRawMode((r) => !r)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
              rawMode
                ? 'bg-[#007acc] border-[#007acc] text-white'
                : 'bg-[#1e1e1e] border-[#3c3c3c] text-[#858585] hover:text-[#d4d4d4]'
            }`}
            title={rawMode ? 'Switch to cooked mode (line buffering)' : 'Switch to raw mode (every keystroke sent immediately)'}
          >
            <TerminalIcon className="w-3 h-3" />
            {rawMode ? 'RAW' : 'COOKED'}
          </button>
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

      {/* xterm.js mount point */}
      {isOpen && (
        <>
          {!sessionReady && (
            <div className="flex items-center justify-center flex-1 text-[#858585] text-xs font-mono">
              Initializing session…
            </div>
          )}
          <div ref={containerRef} className={`flex-1 overflow-hidden p-1 ${!sessionReady ? 'hidden' : ''}`} />
        </>
      )}
    </div>
  )
}
