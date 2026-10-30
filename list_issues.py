#!/usr/bin/env python3
import subprocess
import json
import sys

def list_issues(repo):
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/issues?state=all&per_page=30"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        print(f"Error querying {repo}: {result.stderr}")
        return []
    
    issues = json.loads(result.stdout)
    for issue in issues:
        labels = [l['name'] for l in issue.get('labels', [])]
        priority_label = None
        for label in labels:
            if label.startswith('priority:'):
                priority_label = label.split(':', 1)[1]
                break
        
        print(f"#{issue['number']}: {issue['title']}")
        print(f"   Labels: {labels if labels else 'none'}")
        if priority_label:
            print(f"   Priority: {priority_label}")
        print(f"   URL: {issue['html_url']}")
        print()

if __name__ == "__main__":
    repos = ["niccy266/github-cline-loop", "niccy266/musicbee-tagger-mcp"]
    for repo in repos:
        print(f"\n{'='*60}")
        print(f"Repository: {repo}")
        print(f"{'='*60}")
        list_issues(repo)
else:
    print(f"Error: {result.stderr}")