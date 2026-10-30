import subprocess, sys, os, json
from pathlib import Path

def get_release(args=None):
    """Pull the latest GitHub release and install it to the agent tools directory."""
    # Determine the agent tools directory - use K:/tools/agent_tools/cline_github_loop
    # or fall back to the scripts directory
    agent_tools_dir = Path(
        os.environ.get(
            "AGENT_TOOLS_DIR",
            "K:/tools/agent_tools/cline_github_loop",
        )
    )

    # Ensure the directory exists
    agent_tools_dir.mkdir(parents=True, exist_ok=True)

    # Get the latest release from GitHub
    repo = "niccy266/github-cline-loop"
    print(f"Getting latest release from {repo}...")

    try:
        # Get release info using gh release view
        result = subprocess.run(
            ["gh", "release", "view", "latest", "--repo", repo, "--json", "name,tagName,zipballUrl,tarballUrl,assets"],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            print(f"Error: Failed to get release info: {result.stderr}", file=sys.stderr)
            print("Tip: Make sure gh CLI is authenticated and you have access to the repo.", file=sys.stderr)
            return 1

        release_data = json.loads(result.stdout)

        # Find the first asset that looks like a zip or tarball
        assets = release_data.get("assets", [])
        download_url = None

        # Try to find a suitable asset
        for asset in assets:
            name = asset.get("name", "").lower()
            if any(ext in name for ext in [".zip", ".tar.gz"]):
                download_url = asset.get("browser_download_url")
                break

        # If no suitable asset found, use the source URL
        if not download_url:
            # Use the tarball URL as fallback
            tarball_url = release_data.get("tarball_url")
            if tarball_url:
                download_url = tarball_url

        if not download_url:
            print("Error: Could not find a download URL in the release assets.", file=sys.stderr)
            print("Available assets:", file=sys.stderr)
            for asset in assets:
                print(f"  - {asset.get('name', 'unknown')}", file=sys.stderr)
            return 1

        print(f"Downloading release asset from: {download_url}")

        # Download the file
        download_result = subprocess.run(
            ["curl", "-L", "-o", str(agent_tools_dir / "release.zip"), download_url],
            capture_output=True,
            text=True,
            check=False,
        )

        if download_result.returncode != 0:
            print(f"Error: Failed to download release: {download_result.stderr}", file=sys.stderr)
            return 1

        print(f"Downloaded release to: {agent_tools_dir / 'release.zip'}")

        # Extract the zip file
        print("Extracting release...")

        # Determine extraction command based on OS
        if sys.platform.startswith("win"):
            # On Windows, use Python to extract
            import zipfile
            with zipfile.ZipFile(agent_tools_dir / "release.zip", "r") as zip_ref:
                zip_ref.extractall(agent_tools_dir)
        else:
            # On Unix, use unzip
            import shutil
            subprocess.run(
                ["unzip", "-o", str(agent_tools_dir / "release.zip"), "-d", str(agent_tools_dir)],
                check=False,
            )

        # Clean up the zip file
        try:
            os.remove(agent_tools_dir / "release.zip")
        except Exception:
            pass

        print(f"Release successfully installed to: {agent_tools_dir}")
        print("\nTo use the new release:")
        print("  1. Restart your Docker container: cline_github_loop update")
        print("  2. Or start a new session: cline_github_loop watch latest")
        return 0

    except Exception as e:
        print(f"Error: Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(get_release(sys.argv[1:]))