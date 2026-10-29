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
    // Skip issues already claimed by another worker
    try {
      const info = execSync(`gh issue view ${issue.number} --repo ${repo} --json labels,assignees`, { encoding: "utf8" });
      const parsed = JSON.parse(info || "{}");
      const labels = (parsed.labels || []).map((l) => l.name);
      if (labels.includes("cline-in-progress")) {
        pollLogger.info({ issueNumber: issue.number }, "Issue already in progress; skipping");
        continue;
      }
    } catch (e) {
      pollLogger.warn({ err: e, issueNumber: issue.number }, "could not check claim status; proceeding");
    }

    // 1. Create a dedicated workspace directory for this issue
    const workspaceDir = path.resolve(process.cwd(), `.workspaces`, `issue-${issue.number}`);
    
    pollLogger.info(
      { issueNumber: issue.number, workspaceDir },
      `Setting up isolated workspace for Issue #${issue.number}`
    );

    try {
      // 2. Reuse existing workspace if present; otherwise clone fresh
     if (!fs.existsSync(workspaceDir)) {
       fs.mkdirSync(workspaceDir, { recursive: true });
       execSync(`git clone https://${process.env.GH_TOKEN}@github.com/${repo}.git .`, {
         cwd: workspaceDir,
         stdio: "ignore",
       });
     } else {
       try {
         execSync(`git -C "${workspaceDir}" fetch origin`, { stdio: "ignore" });
       } catch (e) {
         pollLogger.warn({ err: e, workspaceDir }, "fetch failed; continuing with existing state");
       }
     }
      if (fs.existsSync(workspaceDir)) {
        execSync(`rm -rf "${workspaceDir}"`);
      }
      fs.mkdirSync(workspaceDir, { recursive: true });

      execSync(`git clone https://${process.env.GH_TOKEN}@github.com/${repo}.git .`, {
        cwd: workspaceDir,
        stdio: "ignore",
      });

     // Claim via assignment: assign to self, wait 20s, verify sole assignee
     let me = null;
     try { me = execSync("gh api user --jq .login", { encoding: "utf8" }).trim(); } catch (e) { me = null; }
     try {
       execSync(`gh issue edit ${issue.number} --repo ${repo} --add-assignee @me`, { stdio: "ignore" });
     } catch (e) {
       pollLogger.warn({ err: e, issueNumber: issue.number }, "could not assign issue");
     }
     await new Promise((r) => setTimeout(r, 20000));
     let claimed = false;
     try {
       const info = execSync(`gh issue view ${issue.number} --repo ${repo} --json assignees`, { encoding: "utf8" });
       const parsed = JSON.parse(info || "{}");
       const assignees = (parsed.assignees || []).map((a) => a.login);
       if (assignees.length === 1 && (!me || assignees[0] === me)) {
         claimed = true;
       } else {
         pollLogger.info({ issueNumber: issue.number, assignees }, "Issue not solely assigned to us; skipping");
       }
     } catch (e) {
       pollLogger.warn({ err: e, issueNumber: issue.number }, "could not verify assignment; proceeding");
       claimed = true;
     }
     if (!claimed) continue;

const taskPrompt = `Please resolve GitHub Issue #${issue.number} in ${repo}.\n\nTitle: ${issue.title}\n\nDescription:\n${issue.body}`;

      // 3. Pass the isolated workspaceDir as workspacePath to the task runner
      const result = await runTask(cline, {
        prompt: taskPrompt,
        issueNumber: issue.number,
        repo,
        workspaceDir,
      });

      const resultText = (result?.text || "").toString();
      const failed =
        !resultText ||
        /unauthorized|error|failed/i.test(resultText);

      if (failed) {
        pollLogger.warn(
          { issueNumber: issue.number, result: resultText },
          "Agent did not report success; keeping label"
        );
      } else {
        execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "${label}"`);
        pollLogger.info(
          { issueNumber: issue.number },
          `Successfully removed '${label}' label`
        );
      }
    } catch (err) {
      pollLogger.error(
        { err, issueNumber: issue.number },
        `Failed to process Issue #${issue.number}`
      );
    } finally {
      // Release in-progress claim
      try { execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "cline-in-progress"`, { stdio: "ignore" }); } catch (e) {}
      // Keep workspace persistent across restarts for incremental fixes
      pollLogger.info({ workspaceDir }, "Keeping workspace persistent");
    }
  }
}
