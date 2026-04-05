const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const minio = require('./minioClient');

const execFileAsync = promisify(execFile);

async function initProjectFromTemplate(projectId, templateFiles) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proj-'));
  try {
    // Write template files to disk
    for (const [filePath, content] of Object.entries(templateFiles)) {
      const abs = path.join(tmpDir, filePath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    }

    // Generate package-lock.json without installing node_modules.
    // On Windows, npm is a .cmd script and must be run through a shell (required on Node v20+).
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await execFileAsync(npmCmd, ['install', '--package-lock-only'], {
      cwd: tmpDir,
      timeout: 30_000,
      shell: process.platform === 'win32',
    });

    // Upload all template files + the generated lockfile to MinIO
    const filesToUpload = { ...templateFiles };
    const lockContent = await fs.readFile(path.join(tmpDir, 'package-lock.json'), 'utf8');
    filesToUpload['package-lock.json'] = lockContent;

    for (const [filePath, content] of Object.entries(filesToUpload)) {
      await minio.putFile(projectId, filePath, content);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { initProjectFromTemplate };
