# Deploy Polling — Ideation

## Problem

`POST /api/projects/:id/deploy` returns `202 Accepted` with `{ executableProjectId }` immediately.
The actual pipeline runs async inside a Hangfire background job:

```
ClamAV scan → npm audit → risk assessment → docker build → container start
```

The web UI has no way to observe which step is running, what the risk score is, or whether the
container started successfully. Currently the deploy modal animates a fake progress sequence and
shows a hardcoded success message — real outcomes (quarantined, rejected, build failure) are never
surfaced to the user.

---

## What needs to exist

### Backend — new polling endpoint

```
GET /api/deployments/:executableProjectId/steps
```

Returns the current state of each pipeline step and the overall result once complete.

Suggested response shape:

```json
{
  "executableProjectId": "uuid",
  "status": "pending | running | approved | quarantined | rejected | failed",
  "riskScore": 18,
  "steps": [
    { "id": "scan",   "label": "Virus scan",              "status": "done",    "completedAt": "..." },
    { "id": "audit",  "label": "npm audit",               "status": "done",    "completedAt": "..." },
    { "id": "assess", "label": "Risk assessment",         "status": "running", "completedAt": null  },
    { "id": "build",  "label": "Docker build",            "status": "pending", "completedAt": null  },
    { "id": "start",  "label": "Container start",         "status": "pending", "completedAt": null  }
  ],
  "issues": ["2 moderate vulnerabilities found"],
  "containerId": null
}
```

**Where to add it:** `ContainerManagerBackend/Controllers/` — new `DeploymentsController` or
extend `ProjectsController` with a `GET /{id}/deploy/status` route.

**What backs it:** The Hangfire job worker (`AsyncJobWorkers`) needs to write step progress
into the database as it executes each stage. A new table (`DeploymentStepRecord` or similar) would
hold one row per step per `executableProjectId`.

---

## BFF — already stubbed

`bff/src/services/backendClient.js` already has:

```js
async function getDeploymentSteps(executableProjectId) {
  const { data } = await http.get(`/api/deployments/${executableProjectId}/steps`);
  return data;
}
```

A BFF route needs to expose this to the web:

```
GET /projects/:id/deploy/:executableProjectId/steps
```

Or simpler — just proxy through:

```
GET /deployments/:executableProjectId/steps
```

---

## Web — polling loop in DeployModal

Once the BFF route exists, `DeployModal` can poll on an interval:

```tsx
// After POST /projects/:id/deploy returns { executableProjectId }:
const { executableProjectId } = await projectAPI.deployProject(projectId)

// Poll every 2s until terminal state
const POLL_INTERVAL = 2000
const TERMINAL = new Set(["approved", "quarantined", "rejected", "failed"])

while (true) {
  await delay(POLL_INTERVAL)
  const result = await projectAPI.getDeploymentSteps(executableProjectId)
  updateStepsFromPolledData(result.steps)   // drive the step UI from real data
  if (TERMINAL.has(result.status)) {
    setOutcome(result)
    break
  }
}
```

`projectAPI` needs a new method:

```ts
async getDeploymentSteps(executableProjectId: string) {
  return apiCall<DeploymentStepsResponse>("GET", `/deployments/${executableProjectId}/steps`)
}
```

The `DeployModal` step list (`INITIAL_STEPS`) can remain as display labels; their `status` field
gets overwritten by the polled data instead of the current timer-based animation.

---

## Data model change needed in AsyncJobWorkers

The Hangfire job (`JSProjectProcessingJobEnque.DoWork`) currently does not write per-step
progress anywhere. It needs to:

1. Write a `DeploymentStep` row with `status = "running"` before each stage starts.
2. Update it to `"done"` or `"failed"` when the stage completes.
3. Write the final `riskScore`, `status`, and `issues` to `ExecutableProject` when the job ends.

The EF Core `ProjectDbContext` would need a new `DeploymentSteps` `DbSet` and a migration.

---

## Summary of work items

| Area | Work |
|---|---|
| `.NET` — new table | `DeploymentStepRecord` entity + EF migration |
| `.NET` — job worker | Write step rows in `JSProjectProcessingJobEnque.DoWork` |
| `.NET` — new endpoint | `GET /api/deployments/:id/steps` (or on ProjectsController) |
| BFF — new route | `GET /deployments/:id/steps` proxying backendClient |
| Web — api.ts | Add `getDeploymentSteps(executableProjectId)` |
| Web — DeployModal | Replace timer animation with real polling loop |
