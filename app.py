"""Compatibility launcher for the shared DF Scoring local server."""
import subprocess
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    raise SystemExit(subprocess.call(
        ["node", "--env-file-if-exists=.dev.vars", "tools/local-server.mjs"],
        cwd=root,
    ))
