const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { getEnv } = require('../config/env');
const { getPythonRuntime } = require('../utils/pythonRuntime');
const { ApiError } = require('../utils/ApiError');
const logger = require('../utils/logger');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function getScriptPath() {
  const configuredScript = getEnv('AI_PROCESSOR_SCRIPT');
  if (configuredScript) {
    return path.isAbsolute(configuredScript) ? configuredScript : path.resolve(PROJECT_ROOT, configuredScript);
  }

  return path.join(__dirname, '..', 'scripts', 'colab_ad_insertion.py');
}

function downloadRemoteFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        request.destroy();
        resolve(downloadRemoteFile(response.headers.location, destinationPath));
        return;
      }

      if (response.statusCode !== 200) {
        reject(new ApiError(502, `Failed to download remote video: HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destinationPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close(() => resolve(destinationPath));
      });

      file.on('error', (error) => {
        fs.rmSync(destinationPath, { force: true });
        reject(new ApiError(502, 'Failed to save downloaded video', error.message));
      });
    });

    request.on('error', (error) => {
      fs.rmSync(destinationPath, { force: true });
      reject(new ApiError(502, 'Failed to download remote video', error.message));
    });
  });
}

async function processUploadedVideoFromUrl(videoUrl, config = {}) {
  if (!videoUrl) {
    throw new ApiError(400, 'videoUrl is required');
  }

  const tempDir = path.join(os.tmpdir(), `streamwise-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const storageDir = path.join(__dirname, '..', 'storage');
  const outputDir = path.join(storageDir, 'ai-results', `run-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const inputVideoPath = path.join(tempDir, `input-${Date.now()}.mp4`);
  const outputVideoPath = path.join(outputDir, 'phase3_suggestions.mp4');

  try {
    await downloadRemoteFile(videoUrl, inputVideoPath);

    const result = await processVideoWithColab({
      inputVideoPath,
      outputVideoPath,
      config,
    });

    const outputRelativePath = path.relative(storageDir, outputVideoPath).replace(/\\/g, '/');
    const publicUrl = `/storage/${outputRelativePath}`;

    return {
      ...result,
      inputVideoPath,
      outputVideoPath: publicUrl,
      outputDirectory: outputDir,
      publicUrl,
      finalOutputVideo: publicUrl,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      logger.warn({ message: 'Failed to remove temporary AI input folder', error: cleanupError.message });
    }
  }
}

async function processVideoWithColab({ inputVideoPath, outputVideoPath, config = {} }) {
  if (!inputVideoPath || !outputVideoPath) {
    throw new ApiError(400, 'inputVideoPath and outputVideoPath are required');
  }

  const scriptPath = getScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new ApiError(500, `AI processor script not found at ${scriptPath}`);
  }

  const payloadPath = path.join(os.tmpdir(), `streamwise-ai-${Date.now()}.json`);
  const payload = {
    inputVideoPath,
    outputVideoPath,
    config,
  };

  fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

  return new Promise((resolve, reject) => {
    const runtime = getPythonRuntime();
    const pythonArgs = [...runtime.prefixArgs, scriptPath, '--input', payloadPath];
    const pythonProcess = spawn(runtime.command, pythonArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    pythonProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    pythonProcess.on('error', (error) => {
      try {
        if (fs.existsSync(payloadPath)) {
          fs.unlinkSync(payloadPath);
        }
      } catch (cleanupError) {
        logger.warn({ message: 'Failed to clean AI payload file', error: cleanupError.message });
      }

      reject(new ApiError(500, `Failed to start the AI processor (${runtime.command})`, error.message));
    });

    pythonProcess.on('close', (code) => {
      try {
        if (fs.existsSync(payloadPath)) {
          fs.unlinkSync(payloadPath);
        }
      } catch (cleanupError) {
        logger.warn({ message: 'Failed to clean AI payload file', error: cleanupError.message });
      }

      if (code !== 0) {
        logger.error({ message: 'AI processor failed', exitCode: code, stderr });
        reject(new ApiError(500, 'AI processor exited with an error', { exitCode: code, stderr }));
        return;
      }

      try {
        const result = stdout ? JSON.parse(stdout) : { status: 'completed' };
        logger.info({ message: 'AI processor completed successfully', outputVideoPath, result });
        resolve(result);
      } catch (parseError) {
        logger.error({ message: 'Failed to parse AI processor output', stdout, stderr });
        reject(new ApiError(500, 'AI processor returned invalid output', { stdout, stderr }));
      }
    });
  });
}

module.exports = {
  processVideoWithColab,
  processUploadedVideoFromUrl,
};
