#!/usr/bin/env python3
import sys, os, subprocess, json, time
from pathlib import Path
from datetime import datetime, timezone, timedelta
from get_release import get_release
from quick_update import quick_update

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
    candidates = [
        BASE_DIR,
        Path.cwd(),
        Path("K:/dev/vibe-coding/github-cline-loop"),
    ]
    for d in candidates:
        compose = d / "docker-compose.yml"
        dockerfile = d / "Dockerfile"
        package = d / "package.json"
        if compose.exists() and dockerfile.exists() and package.exists():
            return compose
    # Fall back to BASE_DIR
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
    print("  sessions            List saved sessions (latest to load latest)")
    print("  status              Show agent loop status")
    print("  health              Docker health check")
    print("  prs                 View PRs created by loop")
    print("  test-status         Show test status")
    print("  info                Show info")
    print("  list                List items")
    print("  agent-issues        List issues and which agent (workspace) is working on them")
    print("  clear-assignees     Clear assignees and agent claim labels from an issue")
    print("  release             Get latest release from GitHub and install it")
    print("  quick-update        Quick copy of build files to tool folder")
    print("  help                Show this help message")
    return 0

def stream_thoughts(session_id=None):
    """Stream new agent 'thinking' blocks from a session's messages.json."""
    base = Path.home() / ".cline-docker" / "data" / "sessions"
    try:
        base.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    if session_id is None:
        try:
            dirs = sorted([d for d in base.iterdir() if d.is_dir()], key=lambda p: p.name)
        except FileNotFoundError:
            dirs = []
        if not dirs:
            print("No sessions found.", file=sys.stderr)
            return 1
        session_dir = dirs[-1]
        session_id = session_dir.name
    else:
        session_dir = base / session_id
    msg_file = session_dir / f"{session_id}.messages.json"
    print(f"Watching session {session_id} (Ctrl+C to stop)\n", flush=True)
    seen = set()
    first = True
    try:
        while True:
            try:
                if msg_file.exists():
                    data = json.loads(msg_file.read_text(encoding="utf-8"))
                    for m in data.get("messages", []):
                        for c in m.get("content", []) or []:
                            if c.get("type") == "thinking":
                                txt = c.get("thinking", "")
                                if txt and txt not in seen:
                                    if not first:
                                        print(f"\n[thinking] {txt}\n", flush=True)
                                    seen.add(txt)
            except Exception:
                pass
            first = False
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nStopped watching.")
        return 0


def watch_latest(args):
    """Stream thoughts from the latest Cline session."""
    print("Loading latest Cline session...")
    return stream_thoughts(None)


def watch(args):
    """Stream thoughts from a session, or list recent sessions."""
    if args and args[0] in ("latest",):
        return watch_latest(args[1:])
    if args and not str(args[0]).startswith("-"):
        return stream_thoughts(args[0])
    print("Available Cline sessions (last 5):")
    base = Path.home() / ".cline-docker" / "data" / "sessions"
    try:
        dirs = sorted([d.name for d in base.iterdir() if d.is_dir()], reverse=True)[:5]
        for d in dirs:
            print(d)
    except FileNotFoundError:
        print("No sessions found.")
    return 0


def show_logs(args):
    """Show live Docker container logs."""
    print("Showing live logs for cline-autonomous-loop container...")
    try:
        run_cmd(["docker-compose", "logs", "-f", "cline-loop"])
        return 0
    except Exception as e:
        print(f"Failed to show logs: {e}", file=sys.stderr)
        return 1

def list_issues(args):
    """List open GitHub issues with the cline-todo label."""
    repo = "niccy266/musicbee-tagger-mcp"
    if "--repo" in args:
        try:
            repo_idx = args.index("--repo")
            repo = args[repo_idx + 1]
        except (IndexError, ValueError):
            pass
    
    print(f"Open issues in {repo} with 'cline-todo' label:")
    try:
        result = run_cmd(["gh", "issue", "list", "--repo", repo, "--state", "open", "--label", "cline-todo", "--json", "number,title,assignees", "--jq", r'.[] | "#\(.number) | \(.title) | assignees: \(.assignees | map(.login) | join(", "))"'], check=False)
        if result.returncode == 0 and result.stdout.strip():
            print(result.stdout)
        else:
            print("No open issues found.")
        return 0
    except Exception as e:
        print(f"Failed to list issues: {e}", file=sys.stderr)
        return 1


def clear_assignees(args):
    """Clear assignees and agent labels from a GitHub issue or all open issues.

    Usage:
        cline_github_loop clear-assignees <issue_number>
        cline_github_loop clear-assignees all [--repo <owner/repo>]
    """
    if not args:
        print("Error: Issue number or 'all' required", file=sys.stderr)
        print("Usage: cline_github_loop clear-assignees <issue_number|all> [--repo <owner/repo>]", file=sys.stderr)
        return 1

    issue_spec = args[0]
    repo = "niccy266/musicbee-tagger-mcp"  # Default repo from index.mjs

    # Check for optional --repo flag
    if "--repo" in args:
        try:
            repo_idx = args.index("--repo")
            repo = args[repo_idx + 1]
        except (IndexError, ValueError):
            print("Error: --repo requires a value", file=sys.stderr)
            return 1

    def clear_issue(issue_num, repo_name):
        """Clear assignees and agent labels from a single issue."""
        # First, get all agent labels on the issue
        try:
            info = run_cmd(
                ["gh", "issue", "view", issue_num, "--repo", repo_name, "--json", "labels"],
                check=False,
            )
            if info.returncode == 0 and info.stdout.strip():
                labels = json.loads(info.stdout).get("labels", [])
                agent_labels = [l["name"] for l in labels if l["name"].startswith("agent-")]
                for al in agent_labels:
                    try:
                        run_cmd(
                            ["gh", "issue", "edit", issue_num, "--repo", repo_name, "--remove-label", al],
                            check=False,
                        )
                    except Exception:
                        pass
        except Exception:
            pass

        # Clear assignees
        try:
            run_cmd(["gh", "issue", "edit", issue_num, "--repo", repo_name, "--remove-assignee", "*"], check=False)
            print(f"  Cleared issue #{issue_num}")
        except Exception as e:
            print(f"  Failed to clear issue #{issue_num}: {e}", file=sys.stderr)
            return False
        return True

    if issue_spec.lower() == "all":
        print(f"Listing all open issues in {repo} to clear assignees and agent labels...")
        result = run_cmd(
            ["gh", "issue", "list", "--repo", repo, "--state", "open", "--json", "number", "--jq", ".[].number"],
            check=False,
        )
        if result.returncode != 0:
            print("Failed to list issues", file=sys.stderr)
            return 1

        issues = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
        if not issues:
            print("No open issues found.")
            return 0

        print(f"Found {len(issues)} open issue(s). Clearing assignees and agent labels...")
        success = 0
        failed = 0
        for issue_num in issues:
            if clear_issue(issue_num, repo):
                success += 1
            else:
                failed += 1

        print(f"Cleared {success}/{len(issues)} issue(s){f', {failed} failed' if failed else ''}")
        return 0
    else:
        print(f"Clearing assignees and agent labels from issue #{issue_spec} in {repo}...")
        if clear_issue(issue_spec, repo):
            print(f"Successfully cleared issue #{issue_spec}")
            return 0
        return 1

    if issue_spec.lower() == "all":
        print(f"Listing all open issues in {repo} to clear assignees...")
        result = run_cmd(["gh", "issue", "list", "--repo", repo, "--state", "open", "--json", "number", "--jq", ".[].number"], check=False)
        if result.returncode != 0:
            print("Failed to list issues", file=sys.stderr)
            return 1

        issues = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
        if not issues:
            print("No open issues found.")
            return 0

        print(f"Found {len(issues)} open issue(s). Clearing assignees...")
        success = 0
        failed = 0
        for issue_num in issues:
            try:
                run_cmd(["gh", "issue", "edit", issue_num, "--repo", repo, "--remove-assignee", "*"], check=False)
                success += 1
            except Exception as e:
                print(f"  Failed to clear issue #{issue_num}: {e}", file=sys.stderr)
                failed += 1

        print(f"Cleared assignees from {success}/{len(issues)} issue(s){f', {failed} failed' if failed else ''}")
        return 0
    else:
        print(f"Clearing assignees from issue #{issue_spec} in {repo}...")
        try:
            run_cmd(["gh", "issue", "edit", issue_spec, "--repo", repo, "--remove-assignee", "*"])
            print(f"Successfully cleared assignees from issue #{issue_spec}")
            return 0
        except RuntimeError as e:
            print(f"Failed to clear assignees: {e}", file=sys.stderr)
            return 1


def agent_issues(args):
    """List issues and which agent (workspace) is working on them."""
    repo = "niccy266/musicbee-tagger-mcp"  # Default repo from index.mjs

    # Check for optional --repo flag
    if "--repo" in args:
        try:
            repo_idx = args.index("--repo")
            repo = args[repo_idx + 1]
        except (IndexError, ValueError):
            print("Error: --repo requires a value", file=sys.stderr)
            return 1

    print(f"Listing issues with agent claim info in {repo}...")
    
    # Get all issues with cline-todo label and their agent labels
    result = run_cmd(
        ["gh", "issue", "list", "--repo", repo, "--state", "open", "--label", "cline-todo", "--json", "number,title,labels"],
        check=False,
    )
    if result.returncode != 0:
        print("Failed to list issues", file=sys.stderr)
        return 1

    issues = json.loads(result.stdout) if result.stdout.strip() else []
    
    if not issues:
        print("No issues with cline-todo label found.")
        return 0

    # Also get all agent claim comments for context
    claimComments = []
    for issue in issues:
        try:
            commentResult = run_cmd(
                ["gh", "issue", "view", issue["number"], "--repo", repo, "--json", "comments"],
                check=False,
            )
            commentData = json.loads(commentResult.stdout) if commentResult.stdout.strip() else {}
            for comment in commentData.get("comments", []):
                if comment.get("body", "").startswith("//agent-"):
                    claimComments.append({
                        "issueNumber": issue["number"],
                        "commentBody": comment.get("body"),
                        "author": comment.get("author", {}).get("login", "unknown"),
                        "createdAt": comment.get("createdAt")
                    })
        except Exception:
            pass

    # Print header - using labels instead of assignees
    print("\nActive Agent Claims (Label-based):")
    print("Issue # | Title | Agent Label")
    print("--------|-------|-----------")

    for issue in issues:
        allLabels = issue.get("labels", [])
        agentLabel = None
        for label in allLabels:
            if label.startswith("agent-"):
                agentLabel = label
                break

        # Find the most recent claim comment for this issue
        issueClaims = [c for c in claimComments if c["issueNumber"] == issue["number"]]
        latestClaim = issueClaims[-1] if issueClaims else None

        agentInfo = latestClaim["commentBody"] if latestClaim else (agentLabel or "no active agent claim")
        print(f"#{issue['number']}  | {issue['title']} | {agentInfo}")

    return 0


def list_sessions(args):
    """List saved Cline sessions.

    Usage:
        cline_github_loop sessions        List all saved sessions
        cline_github_loop sessions latest Load the latest session
    """
    if args and args[0] in ("latest",):
        return watch_latest(args[1:])

    print("Listing saved Cline sessions...")
    try:
        # Run session-recovery.mjs inside the Docker container
        result = run_cmd(["docker", "exec", "cline-autonomous-loop", "node", "/app/session-recovery.mjs", "list"], check=False)
        if result.returncode == 0:
            print(result.stdout)
        else:
            print("No sessions found.")
            return 0
    except Exception as e:
        print(f"Failed to list sessions: {e}", file=sys.stderr)
        return 1


def show_sessions_help():
    """Show help for sessions command."""
    print("Usage:")
    print("  sessions            List all saved sessions")
    print("  sessions latest     Load the latest session")
    return 0


def show_status(args):
    """Show agent loop status."""
    print("=== Agent Loop Status ===")
    try:
        result = run_cmd(["gh", "issue", "list", "--repo", "niccy266/musicbee-tagger-mcp", "--state", "open", "--label", "cline-todo", "--json", "number,title,labels"], check=False)
        if result.returncode == 0:
            import json as _json
            issues = _json.loads(result.stdout) if result.stdout.strip() else []
            print(f"\nOpen issues with cline-todo label: {len(issues)}")
            for issue in issues:
                agent_labels = [l["name"] for l in issue.get("labels", []) if l["name"].startswith("agent-")]
                agent_label = agent_labels[0] if agent_labels else "unclaimed"
                print(f"  #{issue['number']} {issue['title']} | Agent: {agent_label}")
            return 0
        else:
            print("Failed to fetch status", file=sys.stderr)
            return 1
    except Exception as e:
        print(f"Failed to show status: {e}", file=sys.stderr)
        return 1


def show_prs(args):
    """View PRs created by loop."""
    print("=== PRs created by loop ===")
    try:
        result = run_cmd(["gh", "pr", "list", "--repo", "niccy266/musicbee-tagger-mcp", "--state", "open", "--json", "number,title,url"], check=False)
        if result.returncode == 0:
            import json as _json
            prs = _json.loads(result.stdout) if result.stdout.strip() else []
            if not prs:
                print("No open PRs found.")
                return 0
            print(f"\nOpen PRs: {len(prs)}")
            for pr in prs:
                print(f"  #{pr['number']} {pr['title']} - {pr['url']}")
            return 0
        else:
            print("Failed to fetch PRs", file=sys.stderr)
            return 1
    except Exception as e:
        print(f"Failed to show PRs: {e}", file=sys.stderr)
        return 1


def health_check(args):
    """Docker health check."""
    print("=== Docker Health Check ===")
    try:
        result = run_cmd(["docker", "ps", "--filter", "name=cline_github_loop", "--format", "{{.Status}}"], check=False)
        if result.returncode == 0:
            print(result.stdout.strip() if result.stdout.strip() else "Container not running")
            return 0
        else:
            print("Docker not available or container not found")
            return 1
    except Exception as e:
        print(f"Health check failed: {e}", file=sys.stderr)
        return 1


def show_test_status(args):
    """Show test status."""
    print("=== Test Status ===")
    try:
        result = run_cmd(["npm", "test", "--", "--reporter=spec"], check=False)
        if result.returncode == 0:
            print(result.stdout)
            return 0
        else:
            print("Tests failed", file=sys.stderr)
            return 1
    except Exception as e:
        print(f"Failed to run tests: {e}", file=sys.stderr)
        return 1


def info(args):
    """Show info."""
    print("=== Cline GitHub Loop Info ===")
    print(f"Repository: niccy266/musicbee-tagger-mcp")
    print(f"Base directory: {BASE_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Workspace directory: {get_workspace_dir()}")
    print(f"Docker compose file: {get_docker_compose_file()}")
    return 0


def list_cmd(args):
    """List items."""
    if args and args[0] == "sessions":
        return list_sessions(args[1:])
    if args and args[0] == "issues":
        return list_issues(args[1:])
    if args and args[0] == "prs":
        return show_prs(args[1:])
    if args and args[0] == "agent-issues":
        return agent_issues(args[1:])
    print("=== List Items ===")
    print("Available items:")
    print("  issues              - List open GitHub issues")
    print("  sessions            - List saved Cline sessions")
    print("  prs                 - View PRs created by loop")
    print("  agent-issues        - List issues and which agent (workspace) is working on them")
    print("  release             - Get latest release from GitHub")
    return 0


def update_container(args):
    print("=== Updating Docker container ===")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]")
    print("\n[1/4] Pulling latest code...")
    try:
        run_cmd(["git", "pull", "origin", "master"], check=False)
    except Exception as e:
        print(f"Warning: git pull failed: {e}")
    print("\n[2/4] Stopping old container...")
    compose_file = get_docker_compose_file()
    run_cmd(
        ["docker-compose", "-f", str(compose_file), "down"],
        check=False,
    )
    print("\n[3/4] Rebuilding and starting container...")
    run_cmd(
        ["docker-compose", "-f", str(compose_file), "build"],
        check=False,
    )
    run_cmd(
        ["docker-compose", "-f", str(compose_file), "up", "-d", "--remove-orphans"],
        check=False,
    )
    print("\n[4/4] Verifying update...")
    run_cmd(
        ["docker-compose", "-f", str(compose_file), "ps"],
        check=False,
    )
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
        "clear-assignees": clear_assignees,
        "agent-issues": agent_issues,
        "release": get_release,
        "quick-update": quick_update,
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
    print("  sessions            List saved sessions (latest to load latest)")
    print("  status              Show agent loop status")
    print("  health              Docker health check")
    print("  prs                 View PRs created by loop")
    print("  test-status         Show test status")
    print("  info                Show info")
    print("  list                List items")
    print("  agent-issues        List issues and which agent (workspace) is working on them")
    print("  clear-assignees     Clear assignees and agent claim labels from an issue")
    print("  release             Get latest release from GitHub and install it")
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
