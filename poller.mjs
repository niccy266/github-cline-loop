import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.mjs";
import { runTask } from "./agent.mjs";

export async function pollGitHubIssues(cline, repo, label, pollIntervalMs) {
  const pollLogger = logger.child({ repo, label });
  pollLogger.info("Polling GitHub for open issues...");

  let issues = [];
  try {
    const rawIssues = execSync(
      `gh issue list --repo ${repo} --state open --label "${label}" --json number,title,body`,
      { encoding: "utf8" }
    );
    issues = JSON.parse(rawIssues || "[]");
  } catch (err) {
    pollLogger.error({ err }, "Failed to fetch issues via GitHub CLI");
    return;
  }

  if (issues.length === 0) {
    const sleepSeconds = Math.round(pollIntervalMs / 1000);
    pollLogger.info(
      `No pending issues found. Sleeping for ${sleepSeconds}s before next polling cycle (label: '${label}').`
    );
    return;
  }

  pollLogger.info({ count: issues.length }, `Found ${issues.length} actionable issue(s)`);

  for (const issue of issues) {
    // 1. Create a dedicated workspace directory for this issue
    const workspaceDir = path.resolve(process.cwd(), `.workspaces`, `issue-${issue.number}`);
    
    pollLogger.info(
      { issueNumber: issue.number, workspaceDir },
      `Setting up isolated workspace for Issue #${issue.number}`
    );

    try {
      // 2. Clone fresh repo or clean existing directory
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workspaceDir, { recursive: true });

      execSync(`git clone https://github.com/${repo}.git .`, {
        cwd: workspaceDir,
        stdio: "ignore",
      });

      const taskPrompt = `Please resolve GitHub Issue #${issue.number} in ${repo}.\n\nTitle: ${issue.title}\n\nDescription:\n${issue.body}`;

      // 3. Pass the isolated workspaceDir as workspacePath to the task runner
      await runTask(cline, {
        prompt: taskPrompt,
        issueNumber: issue.number,
        repo,
        workspaceDir,
      });

      // 4. Remove label once completed
      execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "${label}"`);
      pollLogger.info(
        { issueNumber: issue.number },
        `Successfully removed '${label}' label`
      );
    } catch (err) {
      pollLogger.error(
        { err, issueNumber: issue.number },
        `Failed to process Issue #${issue.number}`
      );
    } finally {
      // 5. Clean up isolated workspace
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        pollLogger.info({ workspaceDir }, "Cleaned up isolated workspace directory");
      }
    }
  }
}
