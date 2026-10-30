#!/usr/bin/env python3
import sys, os, subprocess, json
from pathlib import Path
from datetime import datetime, timezone, timedelta

BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = Path(__file__).parent

_CUTOFF_SPRING = (9, 25)
_CUTOFF_AUTUMN = (4, 25)

def _is_nz_dst(dt):
    month = dt.month
    day = dt.day
    if month >= 9 and day >= _CUTOFF_SPRING[1]:
        return True
    if month <= _CUTOFF_AUTUMN[1] and day >= _CUTOFF_AUTUMN[1]:
        return False
    return month in (10, 11, 12, 1, 2, 3)

def _now_nz():
    utc_now = datetime.now(timezone.utc)
    offset = timedelta(hours=13) if _is_nz_dst(utc_now) else timedelta(hours=12)
    return utc_now + offset

def _format_nz(dt=None):
    if dt is None:
        dt = _now_nz()
    return dt.strftime('%Y-%m-%d %H:%M:%S')

def run_cmd(cmd, check=True):
    print(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stdout: print(result.stdout)
    if result.stderr: print(result.stderr, file=sys.stderr)
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    return result

def get_workspace_dir():
    return BASE_DIR / ".workspaces"

def get_docker_compose_file():
    return BASE_DIR / "docker-compose.yml"

def show_usage():
    print("Usage:")
    print("  cline_github_loop <command> [args]")
    print()
    print("Commands:")
    print("  update              Docker container update")
    print("  watch latest        Load latest session")
    print("  watch               Select from last 5 sessions")
    print("  logs                Live Docker logs")
    print("  issues              List open issues")
    print("  sessions            List saved sessions")
    print("  status              Show agent loop status")
    print("  health              Docker health check")
    print("  prs                 View PRs created by loop")
    print("  test-status         Show test status")
    print("  info                Show info")
    print("  list                List items")
    print("  help                Show this help message")
    return 0

def watch_latest(args):
    print("watch-latest command received:", args)

def watch(args):
    print("watch command received:", args)

def show_logs(args):
    print("logs command received:", args)

def list_issues(args):
    print("issues command received:", args)

def list_sessions(args):
    print("sessions command received:", args)

def show_status(args):
    print("status command received:", args)

def health_check(args):
    print("health command received:", args)

def show_prs(args):
    print("prs command received:", args)

def show_test_status(args):
    print("test-status command received:", args)

def info(args):
    print("info command received:", args)

def list_cmd(args):
    print("list command received:", args)

def update_container(args):
    print("=== Updating Docker container ===")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]")
    print("\n[1/4] Pulling latest code...")
    try:
        run_cmd(["git", "pull", "origin", "master"], check=False)
    except Exception as e:
        print(f"Warning: git pull failed: {e}")
    print("\n[2/4] Stopping old container...")
    run_cmd(["docker-compose", "down"], check=False)
    print("\n[3/4] Rebuilding and starting container...")
    run_cmd(["docker-compose", "build"], check=False)
    run_cmd(["docker-compose", "up", "-d", "--remove-orphans"], check=False)
    print("\n[4/4] Verifying update...")
    run_cmd(["docker-compose", "ps"])
    print(f"\n=== Update complete at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ===")
    return 0

def get_command(name):
    COMMANDS = {
        "update": update_container,
        "watch": watch,
        "watch-latest": watch_latest,
        "logs": show_logs,
        "issues": list_issues,
        "sessions": list_sessions,
        "status": show_status,
        "health": health_check,
        "prs": show_prs,
        "test-status": show_test_status,
        "help": show_help,
        "info": info,
        "list": list_cmd,
    }
    return COMMANDS.get(name)

def show_help():
    print("cline_github_loop - Docker-based GitHub issue resolver wrapper")
    print()
    print("Usage:")
    print("  cline_github_loop <command> [args]")
    print()
    print("Commands:")
    print("  update              Docker container update")
    print("  watch latest        Load latest session")
    print("  watch               Select from last 5 sessions")
    print("  logs                Live Docker logs")
    print("  issues              List open issues")
    print("  sessions            List saved sessions")
    print("  status              Show agent loop status")
    print("  health              Docker health check")
    print("  prs                 View PRs created by loop")
    print("  test-status         Show test status")
    print("  info                Show info")
    print("  list                List items")
    print("  help                Show this help message")
    return 0

def main():
    args = sys.argv[1:]
    if not args:
        show_help()
        return 0
    command = args[0]
    if command in ("-h", "--help", "help"):
        show_help()
        return 0
    handler = get_command(command)
    if handler is None:
        print(f"Error: Unknown command '{command}'", file=sys.stderr)
        print("Run 'cline_github_loop help' for usage.", file=sys.stderr)
        return 1
    return handler(args[1:])

if __name__ == "__main__":
    sys.exit(main())
