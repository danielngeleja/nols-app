"""Build and inspect the EB CLI's local source bundle before it can be uploaded."""

from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
from contextlib import redirect_stdout
from io import StringIO
import json
import subprocess
import sys

from ebcli.core import fileoperations
from pathspec import PathSpec


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate-eb-archive.py <api-directory>")
    api_dir = Path(sys.argv[1]).resolve()
    repo_dir = api_dir.parent.parent.parent
    ignore_path = api_dir / ".ebignore"
    if not ignore_path.is_file():
        raise SystemExit("EB source bundle requires .ebignore")

    spec = PathSpec.from_lines("gitwildmatch", ignore_path.read_text(encoding="utf-8").splitlines())
    ignored = {entry.path for entry in spec.match_tree_entries(str(api_dir))}
    ignored.add(".ebignore")

    with TemporaryDirectory(prefix="nolsaf-eb-archive-", dir=repo_dir) as temporary:
        archive = Path(temporary) / "bundle.zip"
        # EB CLI logs every included file; keep validation output concise.
        with redirect_stdout(StringIO()):
            fileoperations.zip_up_folder(str(api_dir), str(archive), ignore_list=ignored)
        with ZipFile(archive) as bundle:
            names = set(bundle.namelist())
            if bundle.testzip() is not None:
                raise SystemExit("EB source ZIP failed its CRC check")
            forbidden = [
                name for name in names
                if "node_modules" in name.replace("\\", "/").split("/")
                or any(part.startswith(".env") for part in name.replace("\\", "/").split("/"))
                or name == "package.json.predeploy-bak"
            ]
            if forbidden:
                raise SystemExit(f"EB bundle contains {len(forbidden)} local-only paths")

            required = {
                "package.json", "package-lock.json", "Procfile",
                "dist/release.json", "dist/src/index.js", "prisma/schema.prisma",
                ".platform/hooks/predeploy/generate-prisma.sh",
                "_workspace/@nolsaf/prisma/dist/index.js",
                "certs/eu-north-1-rds-ca-rsa2048-g1.pem",
            }
            missing = required - names
            if missing:
                raise SystemExit(f"EB bundle is missing required files: {sorted(missing)}")

            manifest = json.loads(bundle.read("package.json"))
            if manifest.get("dependencies", {}).get("prisma") != "7.9.1":
                raise SystemExit("EB bundle must install the pinned Prisma CLI as a production dependency")
            revision = json.loads(bundle.read("dist/release.json")).get("revision")
            head = subprocess.check_output(
                ["git", "-C", str(repo_dir), "rev-parse", "HEAD"], text=True
            ).strip()
            if revision != head:
                raise SystemExit("EB bundle revision differs from the release checkout")
            migration_count = sum(
                name.startswith("prisma/migrations/") and name.endswith("/migration.sql")
                for name in names
            )
            if migration_count < 1:
                raise SystemExit("EB bundle contains no Prisma migrations")

            print(
                f"[eb-archive] Verified clean ZIP for {revision[:12]}: "
                f"{len(names)} entries, {migration_count} migrations, no node_modules or env files."
            )


if __name__ == "__main__":
    main()
