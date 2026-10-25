"""The compose check: what the exam will start from a builder's app/compose.yml, and what it won't.

Usage: python3 -I eval/check_compose.py <compose file> <project name> <env file> <app folder>

The journey rows run against the builder's own Compose stack. Its containers run on the machine
that holds the exam, beside the gate, whose process holds a token that can write check runs. A
container given that machine's filesystem, its process table, its Docker socket or its network
could read that token, or start anything it likes, and judge its own pull request. So before
anything starts, this reads the file as Compose itself resolves it (`docker compose config`) and
allows only what an ordinary three-service stack needs: images built from inside app/, settings
taken from the env file, published ports, named volumes and networks of its own project, and
health checks. Anything else is refused by name, so a key nobody thought of fails closed.

The allowed keys are written below. Widening them is an eval change, which is the founder's.

Standard library only, run with -I, so nothing in the tree under test can change how it reads.
"""

import json
import os
import re
import subprocess
import sys

SERVICE_KEYS = {
    "build", "command", "depends_on", "entrypoint", "environment", "expose", "healthcheck",
    "image", "init", "labels", "networks", "ports", "pull_policy", "read_only", "restart",
    "stop_grace_period", "stop_signal", "tmpfs", "user", "volumes", "working_dir",
}
BUILD_KEYS = {"context", "dockerfile", "args", "target"}
VOLUME_MOUNT_KEYS = {"type", "source", "target", "read_only", "volume", "bind"}
TOP_KEYS = {"name", "services", "volumes", "networks"}

# Read from the raw file before Compose resolves it: `include` and `extends` can pull in other
# files, from outside app/ or from a remote repository, while the file is being read.
RAW_REFUSED = re.compile(r"^\s*(include|extends)\s*:", re.MULTILINE)


def inside(path, folder):
    real = os.path.realpath(path)
    return real == folder or real.startswith(folder + os.sep)


def check(config, project, app):
    problems = []
    for key in sorted(set(config) - TOP_KEYS):
        problems.append(f"the top-level key `{key}` is not allowed")

    volumes = config.get("volumes") or {}
    for name, spec in volumes.items():
        spec = spec or {}
        for key in sorted(set(spec) - {"name", "labels"}):
            problems.append(f"volume `{name}`: `{key}` is not allowed (a named volume of the "
                            "project's own, with the local driver and no options, is)")
        if spec.get("name", f"{project}_{name}") != f"{project}_{name}":
            problems.append(f"volume `{name}`: a fixed `name` is not allowed; the exam gives each "
                            "run its own project, and the volume must belong to it")

    networks = config.get("networks") or {}
    for name, spec in networks.items():
        spec = spec or {}
        for key in sorted(set(spec) - {"name", "ipam", "labels"}):
            problems.append(f"network `{name}`: `{key}` is not allowed")
        if spec.get("ipam"):
            problems.append(f"network `{name}`: `ipam` settings are not allowed")
        if spec.get("name", f"{project}_{name}") != f"{project}_{name}":
            problems.append(f"network `{name}`: a fixed `name` is not allowed")

    services = config.get("services") or {}
    if not services:
        problems.append("the file defines no service")
    for svc, spec in services.items():
        where = f"service `{svc}`"
        for key in sorted(k for k in set(spec) - SERVICE_KEYS if spec[k] is not None):
            problems.append(f"{where}: `{key}` is not allowed")

        build = spec.get("build")
        if build is not None:
            for key in sorted(set(build) - BUILD_KEYS):
                problems.append(f"{where}: `build.{key}` is not allowed")
            context = build.get("context", "")
            if not inside(context, app):
                problems.append(f"{where}: the build context must be inside app/")
            dockerfile = build.get("dockerfile")
            if dockerfile and not inside(os.path.join(context, dockerfile), app):
                problems.append(f"{where}: the Dockerfile must be inside app/")

        for mount in spec.get("volumes") or []:
            kind = mount.get("type")
            for key in sorted(set(mount) - VOLUME_MOUNT_KEYS):
                problems.append(f"{where}: a mount's `{key}` is not allowed")
            if kind == "volume":
                if mount.get("source") not in volumes:
                    problems.append(f"{where}: a volume mount must name one of the file's own "
                                    "named volumes")
            elif kind == "bind":
                if not inside(mount.get("source", ""), app):
                    problems.append(f"{where}: a bind mount's source must be a file or folder "
                                    "inside app/")
                elif not mount.get("read_only"):
                    problems.append(f"{where}: a bind mount must be read-only (`:ro`)")
            else:
                problems.append(f"{where}: a `{kind}` mount is not allowed")

        attached = spec.get("networks") or {}
        for name, how in attached.items():
            if name not in networks:
                problems.append(f"{where}: network `{name}` is not one of the file's own")
            for key in sorted(set(how or {}) - {"aliases"}):
                problems.append(f"{where}: `networks.{name}.{key}` is not allowed")
    return problems


def main(compose_file, project, env_file, app):
    app = os.path.realpath(app)
    if not os.path.isfile(compose_file):
        print(f"[compose] {compose_file} is absent")
        return 1
    if not inside(compose_file, app):
        print(f"[compose] {compose_file} is not inside app/")
        return 1
    with open(compose_file, encoding="utf-8") as handle:
        found = RAW_REFUSED.search(handle.read())
    if found:
        print(f"[compose] REFUSED: `{found.group(1)}` is not allowed in {compose_file}; "
              "the stack is one file")
        return 1
    resolved = subprocess.run(
        ["docker", "compose", "-p", project, "-f", compose_file, "--env-file", env_file,
         "config", "--format", "json"],
        capture_output=True, text=True,
    )
    if resolved.returncode != 0:
        print(f"[compose] REFUSED: Compose cannot read {compose_file}:\n{resolved.stderr.strip()}")
        return 1
    problems = check(json.loads(resolved.stdout), project, app)
    if problems:
        print(f"[compose] REFUSED: the exam does not start {compose_file}, because:")
        for problem in problems:
            print(f"    {problem}")
        return 1
    print(f"[compose] {compose_file}: every service uses only what the exam allows")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    sys.exit(main(*sys.argv[1:]))
