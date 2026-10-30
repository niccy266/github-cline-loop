import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.mjs";
import { runTask, createAgent } from "./agent.mjs";

/**
 * Determines whether an agent task result text indicates success or failure.
 *
 * Strips backtick-enclosed code snippets (e.g. Python pytest flags like
 * `-W error::DeprecationWarning`) before matching, to avoid false-positive
 * error matches when the agent describes configuration flags in its summary.
 *
 * @param {string} resultText - The agent's final result text
 * @returns {boolean} True if the result indicates failure
 */
export function isTaskFailed(resultText) {
  if (!resultText || typeof resultText !== "string") return true;
  const cleanText = resultText.replace(/`[^`]+`/g, "");
  return /unauthorized|error|failed/i.test(cleanText);
}

export async function pollGitHubIssues(cline, repo, label, pollIntervalMs, agentFactory = createAgent) {
  const pollLogger = logger.child({ repo, label });
  pollLogger.info("Polling GitHub for open issues...");

  let currentCline = cline;

  let issues = [];
  try {
    const rawIssues = execSync(
      `gh issue list --repo ${repo} --state open --label "${label}" --json number,title,body`,
      { encoding: "utf8" }
    );
    issues = JSON.parse(rawIssues || "[]");
  } catch (err) {
    pollLogger.error({ err }, "Failed to fetch issues via GitHub CLI");
    return currentCline;
  }

  if (issues.length === 0) {
    const sleepSeconds = Math.round(pollIntervalMs / 1000);
    pollLogger.info(
      `No pending issues found. Sleeping for ${sleepSeconds}s before next polling cycle (label: '${label}').`
    );
    return currentCline;
  }

  pollLogger.info({ count: issues.length }, `Found ${issues.length} actionable issue(s)`);

  for (const issue of issues) {
    // Skip issues already assigned to another worker
    let alreadyClaimed = false;
    try {
      const info = execSync(`gh issue view ${issue.number} --repo ${repo} --json assignees`, { encoding: "utf8" });
      const parsed = JSON.parse(info || "{}");
      const assignees = (parsed.assignees || []).map((a) => a.login);
      if (assignees.length > 0) {
        pollLogger.info({ issueNumber: issue.number, assignees }, "Issue already assigned; skipping");
        alreadyClaimed = true;
      }
    } catch (e) {
      pollLogger.warn({ err: e, issueNumber: issue.number }, "could not check claim status; proceeding");
    }
    if (alreadyClaimed) continue;

    // 1. Set up isolated workspace directory for this issue
    const workspaceDir = path.resolve(process.cwd(), ".workspaces", `issue-${issue.number}`);

    pollLogger.info({ issueNumber: issue.number, workspaceDir }, `Setting up isolated workspace for Issue #${issue.number}`);

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

      // 3. Claim via assignment: assign to self, wait 20s, verify sole assignee
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

      // 4. Pass the isolated workspaceDir to the task runner
      const { result: taskResult, agent: newAgent } = await runTask(
        currentCline,
        {
          prompt: taskPrompt,
          issueNumber: issue.number,
          repo,
          workspaceDir,
        },
        agentFactory
      );

      // If runTask disposed and recreated the agent, adopt the new instance
      // so subsequent issues in this tick and future ticks use it.
      if (newAgent && newAgent !== currentCline) {
        currentCline = newAgent;
      }

      const resultText = (taskResult?.text || "").toString();
      const failed = isTaskFailed(resultText);

      if (failed) {
        pollLogger.warn({ issueNumber: issue.number, result: resultText }, "Agent did not report success; keeping label");
      } else {
        execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "${label}"`);
        pollLogger.info({ issueNumber: issue.number }, `Successfully removed '${label}' label`);
      }
    } catch (err) {
      pollLogger.error({ err, issueNumber: issue.number }, `Failed to process Issue #${issue.number}`);
    } finally {
      // Release claim and keep workspace persistent for incremental fixes
      try { execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "cline-in-progress"`, { stdio: "ignore" }); } catch (e) { /* label may not exist */ }
      try { execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-assignee "*"`, { stdio: "ignore" }); } catch (e) { /* ignore */ }
      pollLogger.info({ workspaceDir }, "Keeping workspace persistent");
    }
  }

  return currentCline;
}
