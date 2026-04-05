export interface DeploymentStep {
  key: string
  label: string
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
}

interface APIError extends Error {
  status?: number;
  data?: unknown;
}

const BASE_URL =
  typeof window !== "undefined" ? "" : process.env.BFF_URL || "http://localhost:3000";

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
    if ((error as APIError).status !== undefined) throw error;
    throw new Error(`Network error: ${error}`);
  }
}

export const projectAPI = {
  // GET /projects
  async listProjects() {
    return apiCall<
      {
        projectId: string;
        name: string;
        type: string;
        status: string;
        createdAt: string;
        nodeVersion?: string;
        baseOS?: string;
      }[]
    >("GET", "/projects");
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
      nodeVersion?: string;
      baseOS?: string;
      files: { name: string; content: string }[];
    }>("GET", `/projects/${id}`);
  },

  // GET /projects/:id/files
  async listFiles(id: string) {
    return apiCall<{ files: string[] }>("GET", `/projects/${id}/files`);
  },

  // GET /projects/:id/files/:path
  async getFile(id: string, path: string) {
    return apiCall<{ content: string }>("GET", `/projects/${id}/files/${path}`);
  },

  // PUT /projects/:id/files/:path
  async putFile(id: string, path: string, content: string) {
    return apiCall<void>("PUT", `/projects/${id}/files/${path}`, { content });
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
    return apiCall<{ executableProjectId: string }>("POST", `/projects/${id}/deploy`);
  },

  // GET /deployments/:executableProjectId/steps
  async getDeploymentSteps(executableProjectId: string) {
    return apiCall<DeploymentStep[]>("GET", `/deployments/${executableProjectId}/steps`);
  },
};
