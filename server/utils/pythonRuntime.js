const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function getPythonRuntime() {
  const configured = process.env.PYTHON_EXECUTABLE?.trim();
  if (configured) {
    const hasPath = path.isAbsolute(configured) || configured.includes('/') || configured.includes('\\');
    return {
      command: hasPath ? (path.isAbsolute(configured) ? configured : path.resolve(PROJECT_ROOT, configured)) : configured,
      prefixArgs: configured.toLowerCase() === 'py' ? ['-3'] : [],
    };
  }

  const venvPython = path.join(PROJECT_ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (fs.existsSync(venvPython)) return { command: venvPython, prefixArgs: [] };

  return process.platform === 'win32'
    ? { command: 'py', prefixArgs: ['-3'] }
    : { command: 'python3', prefixArgs: [] };
}

module.exports = { getPythonRuntime };
