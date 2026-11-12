import argparse
import os
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

parser = argparse.ArgumentParser(description="Build the Cloudflare Pages direct-upload ZIP.")
parser.add_argument("--check", action="store_true", help="Run backend tests against the Worker extracted from the ZIP.")
args = parser.parse_args()

root = Path(__file__).resolve().parent.parent
static = root / "static"
worker = (static / "_worker.js").read_text(encoding="utf-8")
for module, name in (("scorer", "MatchScorer"), ("tournament", "TournamentManager")):
    source = (static / "js" / f"{module}.js").read_text(encoding="utf-8")
    source = source.removesuffix(f"export {{ {name} }};\n")
    worker = worker.replace(f'import {{ {name} }} from "./js/{module}.js";', source)

auth = (root / "server" / "auth.js").read_text(encoding="utf-8-sig")
worker_import_start = worker.index("import { ensureSchema")
worker_import_end = worker.index('from "../server/auth.js";', worker_import_start) + len('from "../server/auth.js";')
worker = worker[:worker_import_start] + auth.split("\nexport {", 1)[0] + worker[worker_import_end:]

destination = root / "dfscoring123-static-deploy.zip"
with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(static.rglob("*")):
        if path.is_file() and path.name != "_worker.js":
            archive.write(path, path.relative_to(static).as_posix())
    archive.writestr("_worker.js", worker)

print(destination)

if args.check:
    check_directory = root / ".wrangler"
    check_directory.mkdir(exist_ok=True)
    checked_worker = check_directory / "packaged-worker.mjs"
    with ZipFile(destination) as archive:
        checked_worker.write_bytes(archive.read("_worker.js"))
    try:
        result = subprocess.run(
            ["node", "--test", "tests/shared-scoring.test.mjs", "tests/tournament-access.test.mjs"],
            cwd=root,
            env={**os.environ, "DF_TEST_WORKER_URL": checked_worker.as_uri()},
        )
    finally:
        checked_worker.unlink(missing_ok=True)
    raise SystemExit(result.returncode)
