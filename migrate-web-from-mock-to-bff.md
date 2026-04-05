# Migration: Web Frontend from Mock Data to BFF Integration

**Date:** 2026-03-29
**Scope:** Container Management Studio - Web UI Layer
**Objective:** Migrate from stub/mock data to real Backend-for-Frontend (BFF) API integration

---

## 1. PROBLEM STATEMENT

The web frontend (`/web`) is currently a **visual mockup with zero backend integration**:

- ✅ UI components are fully built (dashboard, IDE, editor, terminal)
- ✅ State management (React hooks) is in place
- ✅ Next.js dev server is configured with route rewrites to BFF
- ❌ **No API client layer exists**
- ❌ **Project creation uses setTimeout stub, not real API**
- ❌ **All data is in-memory React state (MOCK_PROJECTS)**
- ❌ **Data is lost on page refresh**
- ❌ **File operations (create/edit/delete) are local-only**

### Current Data Flow (Broken)
```
User clicks "Create Project"
  ↓
CreateProjectModal.handleCreate()
  ↓
setTimeout(1800ms) [STUB]
  ↓
Build Project object locally
  ↓
setProjects([...]) [React state]
  ↓
Data is lost on refresh
```

### Required Data Flow (Target)
```
User clicks "Create Project"
  ↓
CreateProjectModal.handleCreate()
  ↓
fetch POST /projects { name, baseOS, nodeVersion }
  ↓
BFF → Create in backend DB
BFF → Upload template files to MinIO
  ↓
Response: { projectId, name, files }
  ↓
Update local React state with backend data
  ↓
Data persists across page refreshes
```

---

## 2. CURRENT ARCHITECTURE

### Frontend Layer (`/web`)
- **Entry:** `app/page.tsx` - Main page component
- **Dashboard:** `components/dashboard/` - Project list view
- **IDE:** `components/ide/` - Code editor, file tree, terminal
- **Store:** `lib/store.ts` - Type definitions + MOCK_PROJECTS
- **State:** All stored in React hooks (useState)
- **API:** None (this is what needs to be added)

### BFF Layer (`/bff`)
Already implemented and ready:
- `POST /projects` - Create project
- `GET /projects` - List projects
- `GET /projects/:id` - Get project details
- `GET /projects/:id/files` - List files
- `GET /projects/:id/files/:path` - Read file
- `PUT /projects/:id/files/:path` - Write file
- `DELETE /projects/:id/files/:path` - Delete file
- `DELETE /projects/:id` - Delete project
- `POST /projects/:id/deploy` - Deploy project

### Route Rewrites (`next.config.mjs`)
Already configured:
```javascript
{ source: '/projects',                    destination: `${BFF_URL}/projects` },
{ source: '/projects/:id',                destination: `${BFF_URL}/projects/:id` },
{ source: '/projects/:id/files/:path*',   destination: `${BFF_URL}/projects/:id/files/:path*` },
```

---

## 3. ROOT CAUSES

### 3.1 No API Client Layer
**Files:** `lib/api.ts` does not exist

Current code directly uses `setTimeout()` in component:
```typescript
// ❌ CURRENT: components/dashboard/create-project-modal.tsx:36
setTimeout(() => {
  const newProject: Project = { /* hardcoded */ }
  onCreate(newProject)
}, 1800)
```

**Should be:** Centralized `lib/api.ts` with fetch wrappers

### 3.2 State Initialized with Mock Data
**File:** `app/page.tsx:13`
```typescript
const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS)  // ❌
```

**Should be:** Initialize empty, fetch on mount with useEffect

### 3.3 No Data Fetching on Page Load
**File:** `app/page.tsx` - Missing useEffect hook

**Should have:**
```typescript
useEffect(() => {
  projectAPI.listProjects().then(setProjects)
}, [])
```

### 3.4 Hardcoded Project Properties in Modal
**File:** `components/dashboard/create-project-modal.tsx:37-77`

Creates Project object locally:
```typescript
const newProject: Project = {
  id: generateId(),              // ❌ Client-side ID
  name: projectName.trim(),
  type: "nodejs",
  status: "draft",
  createdAt: new Date(),         // ❌ Client-side timestamp
  nodeVersion,
  baseOS,
  files: [ /* template */ ]      // ❌ Hardcoded files
}
```

**Should be:** Receive from backend response

### 3.5 File Operations Don't Call API
**File:** `components/ide/ide-view.tsx` (lines 32-79)

Functions like `handleFileChange()`, `handleCreateFile()`, etc. only update React state:
```typescript
const updated = [...files, newFile]
setFiles(updated)                  // ❌ Local only, no API call
```

---

## 4. SOLUTION ARCHITECTURE

### 4.1 New API Client Layer
**File to create:** `lib/api.ts`

Centralized fetch wrapper for all BFF endpoints:
- Error handling (network, 4xx, 5xx)
- JSON serialization
- Type safety with TypeScript
- Consistent request/response format

### 4.2 Data Loading Strategy
1. **On Page Load:** Fetch projects from `GET /projects`
2. **On Create:** Call `POST /projects`, use response for new project
3. **On File Change:** Call `PUT /projects/:id/files/:path` to persist
4. **On Deploy:** Call `POST /projects/:id/deploy` for upload

### 4.3 State Management
- **Local state (React hooks):** Cache of projects + active file
- **Backend source-of-truth:** BFF/Database/MinIO
- **Sync strategy:** Optimistic updates with error rollback

---

## 5. IMPLEMENTATION PLAN

### Phase 1: Create API Client Layer
**File:** `lib/api.ts` (NEW)

```typescript
interface APIError extends Error {
  status?: number;
  data?: unknown;
}

const BASE_URL = typeof window !== "undefined" ? "" : process.env.BFF_URL || "http://localhost:3000";

async function apiCall<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = new Error(`API Error: ${response.status}`) as APIError;
      error.status = response.status;
      try {
        error.data = await response.json();
      } catch {
        error.data = { message: response.statusText };
      }
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new Error(`Network error: ${error}`);
  }
}

export const projectAPI = {
  // GET /projects
  async listProjects() {
    return apiCall<{
      projectId: string;
      name: string;
      type: string;
      status: string;
      createdAt: string;
    }[]>("GET", "/projects");
  },

  // POST /projects
  async createProject(payload: {
    name: string;
    type: string;
    baseOS: string;
    nodeVersion: string;
  }) {
    return apiCall<{
      projectId: string;
      name: string;
      files: string[];
    }>("POST", "/projects", payload);
  },

  // GET /projects/:id
  async getProject(id: string) {
    return apiCall<{
      projectId: string;
      name: string;
      type: string;
      status: string;
      createdAt: string;
      files: { name: string; content: string }[];
    }>("GET", `/projects/${id}`);
  },

  // GET /projects/:id/files
  async listFiles(id: string) {
    return apiCall<{ files: string[] }>("GET", `/projects/${id}/files`);
  },

  // GET /projects/:id/files/:path
  async getFile(id: string, path: string) {
    return apiCall<{ content: string }>(
      "GET",
      `/projects/${id}/files/${path}`
    );
  },

  // PUT /projects/:id/files/:path
  async putFile(id: string, path: string, content: string) {
    return apiCall<void>("PUT", `/projects/${id}/files/${path}`, {
      content,
    });
  },

  // DELETE /projects/:id/files/:path
  async deleteFile(id: string, path: string) {
    return apiCall<void>("DELETE", `/projects/${id}/files/${path}`);
  },

  // DELETE /projects/:id
  async deleteProject(id: string) {
    return apiCall<void>("DELETE", `/projects/${id}`);
  },

  // POST /projects/:id/deploy
  async deployProject(id: string) {
    return apiCall<{
      deploymentId: string;
      status: string;
    }>("POST", `/projects/${id}/deploy`);
  },
};
```

---

### Phase 2: Update Main Page Component
**File:** `app/page.tsx` (MODIFY)

**Current issues:**
- Line 13: `useState(MOCK_PROJECTS)` - initializes with mock data
- Missing useEffect to fetch projects
- No error handling

**Changes:**
1. Import projectAPI
2. Initialize projects as empty array
3. Add useEffect to fetch on mount
4. Add error state for UI feedback
5. Update handleCreateProject to map BFF response to Project type

```typescript
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

  // Fetch projects on mount
  useEffect(() => {
    async function loadProjects() {
      try {
        setLoading(true)
        const data = await projectAPI.listProjects()
        setProjects(data.map((p) => ({
          id: p.projectId,
          name: p.name,
          type: p.type as any,
          status: p.status as any,
          createdAt: new Date(p.createdAt),
          files: [],
          nodeVersion: "20",
          baseOS: "ubuntu" as any,
        })))
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
      // TODO: Show error toast
    })
  }

  async function handleCreateProject(payload: {
    name: string
    baseOS: string
    nodeVersion: string
  }) {
    try {
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
        baseOS: payload.baseOS,
      }

      setProjects((prev) => [newProject, ...prev])
      setShowCreateModal(false)
      setActiveProject(newProject)
      setView("ide")
    } catch (err) {
      console.error("Failed to create project:", err)
      // TODO: Show error toast
    }
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
```

---

### Phase 3: Update Create Project Modal
**File:** `components/dashboard/create-project-modal.tsx` (MODIFY)

**Current issues:**
- Lines 36-80: Uses `setTimeout` stub instead of real API
- Hardcodes project properties
- No error handling for API failures

**Changes:**
1. Import projectAPI
2. Replace setTimeout with async API call
3. Pass only required fields to backend
4. Handle errors with setNameError
5. Receive project data from response

```typescript
"use client"

import { useState } from "react"
import { X, ChevronLeft, Loader2 } from "lucide-react"
import type { BaseOS } from "@/lib/store"
import { projectAPI } from "@/lib/api"
import { cn } from "@/lib/utils"

interface CreateProjectModalProps {
  onClose: () => void
  onCreate: (payload: {
    name: string
    baseOS: BaseOS
    nodeVersion: string
  }) => void | Promise<void>
}

type Step = 1 | 2

export function CreateProjectModal({ onClose, onCreate }: CreateProjectModalProps) {
  const [step, setStep] = useState<Step>(1)
  const [projectName, setProjectName] = useState("")
  const [baseOS, setBaseOS] = useState<BaseOS>("ubuntu")
  const [nodeVersion, setNodeVersion] = useState("20")
  const [loading, setLoading] = useState(false)
  const [nameError, setNameError] = useState("")

  async function handleCreate() {
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

    try {
      // ✅ Real API call
      await onCreate({
        name: projectName.trim(),
        baseOS,
        nodeVersion,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create project"
      setNameError(message)
    } finally {
      setLoading(false)
    }
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

// ... Rest of the component (Step1, Step2, icons) remains the same
```

---

### Phase 4: Update IDE File Operations
**File:** `components/ide/ide-view.tsx` (MODIFY)

**Current issues:**
- Line 32-41: `handleFileChange()` only updates local state
- Line 48-61: `handleCreateFile()` only updates local state
- Line 63-70: `handleDeleteFile()` only updates local state
- Line 72-79: `handleRenameFile()` only updates local state

**Strategy:** Add debounced `PUT /projects/:id/files/:path` calls

```typescript
// Add to ide-view.tsx at the top

import { useCallback, useRef } from "react"
import { projectAPI } from "@/lib/api"

// Helper: Debounce file save
function useDebounce<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
) {
  const timeoutRef = useRef<NodeJS.Timeout>()

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => callback(...args), delay)
    },
    [callback, delay]
  )
}

// In IDEView component:
function handleFileChange(content: string) {
  const newContent = content
  setFiles((prev) =>
    prev.map((f) =>
      f.name === activeFileName ? { ...f, content: newContent } : f
    )
  )
  setHasUnsaved(true)

  // ✅ Save to backend (debounced)
  debouncedSave(activeFileName, newContent)
}

// Debounced save function
const debouncedSave = useDebounce(
  async (fileName: string, content: string) => {
    try {
      await projectAPI.putFile(project.id, fileName, content)
      setHasUnsaved(false)
      // TODO: Show success toast
    } catch (error) {
      console.error("Failed to save file:", error)
      // TODO: Show error toast
    }
  },
  1500
)

// For file create
async function handleCreateFile(name: string) {
  const ext = name.split(".").pop()
  const lang =
    ext === "js" || ext === "ts" || ext === "jsx" || ext === "tsx"
      ? "javascript"
      : ext === "json"
      ? "json"
      : "text"

  const newFile = { name, content: "", language: lang as ProjectFile["language"] }
  const updated = [...files, newFile]
  setFiles(updated)
  setActiveFileName(name)

  try {
    // ✅ Save to backend
    await projectAPI.putFile(project.id, name, "")
    onProjectUpdate({ ...project, files: updated })
  } catch (error) {
    console.error("Failed to create file:", error)
    // Rollback local state
    setFiles(files.filter((f) => f.name !== name))
  }
}

// For file delete
async function handleDeleteFile(name: string) {
  const updated = files.filter((f) => f.name !== name)
  setFiles(updated)
  if (activeFileName === name) {
    setActiveFileName(updated[0]?.name ?? "")
  }

  try {
    // ✅ Delete from backend
    await projectAPI.deleteFile(project.id, name)
    onProjectUpdate({ ...project, files: updated })
  } catch (error) {
    console.error("Failed to delete file:", error)
    // Rollback local state
    setFiles(files)
  }
}

// For file rename
async function handleRenameFile(oldName: string, newName: string) {
  const updated = files.map((f) =>
    f.name === oldName ? { ...f, name: newName } : f
  )
  setFiles(updated)
  if (activeFileName === oldName) setActiveFileName(newName)

  try {
    // ✅ Rename on backend: delete old, create new
    const file = files.find((f) => f.name === oldName)
    if (file) {
      await projectAPI.putFile(project.id, newName, file.content)
      await projectAPI.deleteFile(project.id, oldName)
      onProjectUpdate({ ...project, files: updated })
    }
  } catch (error) {
    console.error("Failed to rename file:", error)
    // Rollback
    setFiles(files)
    setActiveFileName(oldName)
  }
}
```

---

## 6. BFF API CONTRACTS

### POST /projects
**Request:**
```json
{
  "name": "my-app",
  "type": "nodejs",
  "baseOS": "ubuntu",
  "nodeVersion": "20"
}
```

**Response:** `201 Created`
```json
{
  "projectId": "proj-abc123",
  "name": "my-app",
  "files": ["index.js", "package.json"]
}
```

---

### GET /projects
**Response:** `200 OK`
```json
[
  {
    "projectId": "proj-1",
    "name": "api-gateway",
    "type": "nodejs",
    "status": "approved",
    "createdAt": "2026-03-29T10:00:00Z"
  }
]
```

---

### PUT /projects/:id/files/:path
**Request:**
```json
{
  "content": "const http = require('http')..."
}
```

**Response:** `204 No Content`

---

### DELETE /projects/:id/files/:path
**Response:** `204 No Content`

---

## 7. DATA TYPE MAPPINGS

### BFF Response → Frontend Project Type

**BFF returns:**
```json
{
  "projectId": "proj-123",
  "name": "my-app",
  "type": "nodejs",
  "status": "draft",
  "createdAt": "2026-03-29T10:00:00Z",
  "nodeVersion": "20",
  "baseOS": "ubuntu"
}
```

**Map to Frontend Project:**
```typescript
const project: Project = {
  id: response.projectId,
  name: response.name,
  type: response.type as ProjectType,
  status: response.status as ProjectStatus,
  createdAt: new Date(response.createdAt),
  nodeVersion: response.nodeVersion,
  baseOS: response.baseOS as BaseOS,
  files: [],  // Load separately if needed
  riskScore: response.riskScore,
  issues: response.issues,
}
```

---

## 8. TESTING CHECKLIST

- [ ] Create API client (`lib/api.ts`) without errors
- [ ] Update `app/page.tsx` to import and use projectAPI
- [ ] Verify projects load on page mount (empty → API response)
- [ ] Test create project modal calls API
- [ ] Verify new project appears in dashboard immediately after creation
- [ ] Test file operations (create, edit, delete) call API
- [ ] Verify data persists on page refresh
- [ ] Test error handling (network failures, validation)
- [ ] Verify loading/error states in UI
- [ ] Remove all references to MOCK_PROJECTS after verification

---

## 9. FILES TO CREATE/MODIFY

### Create
- `lib/api.ts` - API client layer

### Modify
- `app/page.tsx` - Add data fetching
- `components/dashboard/create-project-modal.tsx` - Replace stub with API call
- `components/ide/ide-view.tsx` - Add file operation API calls

### Preserve
- `lib/store.ts` - Keep types, remove MOCK_PROJECTS later
- `components/dashboard/dashboard-view.tsx` - No changes
- `components/ide/` (other files) - No changes
- `next.config.mjs` - Already configured

---

## 10. IMPLEMENTATION ORDER

1. **Create `lib/api.ts`** - Foundation for all API calls
2. **Update `app/page.tsx`** - Load projects from backend
3. **Update `create-project-modal.tsx`** - Real project creation
4. **Update `ide-view.tsx`** - Real file operations
5. **Test end-to-end** - Create project → edit files → refresh page
6. **Remove MOCK_PROJECTS** - Once verified working

---

## 11. ERROR HANDLING STRATEGY

### Network Errors
```typescript
try {
  const data = await projectAPI.listProjects()
} catch (error) {
  if (error instanceof APIError && error.status === 404) {
    // Handle not found
  } else {
    // Network error
    setError("Failed to load projects. Please try again.")
  }
}
```

### Validation Errors
- Backend returns `400` with `{ error: "..." }`
- Frontend shows error in UI (red text under input field)
- User can retry

### Optimistic Updates
- Update UI immediately
- Rollback if API fails
- Show error toast to user

---

## 12. FUTURE ENHANCEMENTS

- [ ] Add toast notifications (sonner already in dependencies)
- [ ] Implement optimistic updates with rollback
- [ ] Add project search/filter
- [ ] Add project favorites
- [ ] Implement WebSocket for real-time file sync
- [ ] Add undo/redo for file edits
- [ ] Implement conflict detection for concurrent edits

---

## NOTES FOR CODE GENERATION

When implementing these changes:

1. **Preserve Component Structure** - Don't refactor component tree
2. **Keep Styling** - All CSS classes should remain unchanged
3. **Add TypeScript Types** - All API responses should be typed
4. **Error Boundaries** - Wrap API calls with try/catch
5. **Backward Compatibility** - Ensure MOCK_PROJECTS still works during migration
6. **Testing** - Changes should be testable in dev environment
7. **No Breaking Changes** - Existing props/interfaces should remain

---

**Status:** Ready for implementation
**Complexity:** Medium
**Effort:** 2-3 developer hours
