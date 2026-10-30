import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.mjs";
import { runTask, createAgent } from "./agent.mjs";
import { startMonitoring, stopMonitoring } from "./thought-monitor.mjs";

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
  pollLogger.info(`Searching for issues on ${repo}...`);

  let currentCline = cline;

  // Use Docker container instance name or fallback to unique ID
  const containerName = process.env.HOSTNAME || process.env.CONTAINER_NAME || `agent-${Math.random().toString(36).slice(2, 11)}`;
  const agentLabel = `agent-${containerName}`.replace(/[^a-zA-Z0-9-_]/g, "-");
  const agentWorkspace = process.cwd();

  // Track issues claimed by this container for graceful shutdown
  const claimedIssues = new Set();

  // Separate logger without repo/label context for issue initialization logs
  const contextLogger = logger.child({});

  let issues = [];
  try {
    const rawIssues = execSync(
      `gh issue list --repo ${repo} --state open --label "${label}" --json number,title,body,labels`,
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
    let alreadyClaimed = false;
    
    try {
      const info = execSync(`gh issue view ${issue.number} --repo ${repo} --json labels`, { encoding: "utf8" });
      const parsed = JSON.parse(info || "{}");
      const labels = (parsed.labels || []).map((l) => l.name);
      
      const otherAgentLabels = labels.filter((l) => l.startsWith("agent-") && l !== agentLabel);
      
      if (otherAgentLabels.length > 0) {
        pollLogger.info({ otherAgentLabels, issueNumber: issue.number }, "Issue already claimed by another agent label; skipping");
        alreadyClaimed = true;
      } else if (labels.includes(agentLabel)) {
        pollLogger.info({ agentLabel, issueNumber: issue.number }, "Issue already claimed by us; resuming work");
        claimedIssues.add(issue.number);
      } else {
        // Claim the issue by adding our agent label
        pollLogger.info({ agentLabel, issueNumber: issue.number }, "Claiming issue with agent label, waiting 20s for race condition verification...");
        execSync(`gh issue edit ${issue.number} --repo ${repo} --add-label "${agentLabel}"`, { stdio: "ignore" });
        
        // Wait 20 seconds as requested
        await new Promise((resolve) => setTimeout(resolve, 20000));
        
        // Verify labels after grace period
        const verifyInfo = execSync(`gh issue view ${issue.number} --repo ${repo} --json labels`, { encoding: "utf8" });
        const verifyParsed = JSON.parse(verifyInfo || "{}");
        const verifyLabels = (verifyParsed.labels || []).map((l) => l.name);
        
        const conflictLabels = verifyLabels.filter((l) => l.startsWith("agent-") && l !== agentLabel);
        if (conflictLabels.length > 0 || !verifyLabels.includes(agentLabel)) {
          pollLogger.warn({ conflictLabels, verifyLabels, issueNumber: issue.number }, "Race condition detected during grace period; releasing claim and skipping");
          try {
            execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "${agentLabel}"`, { stdio: "ignore" });
          } catch (e) {}
          alreadyClaimed = true;
        } else {
          // Claim verified successfully - track for graceful shutdown
          claimedIssues.add(issue.number);
          pollLogger.info({ agentLabel, issueNumber: issue.number }, "Claim verified successfully");
        }
      }
    } catch (e) {
      pollLogger.warn({ err: e, issueNumber: issue.number }, "could not check/claim status via labels; proceeding cautiously");
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
        // Post agent identification comment to track which instance is working on this issue
        execSync(
          `gh issue comment ${issue.number} --repo ${repo} --body "//agent-${agentLabel} claimed issue #${issue.number}"`,
          { stdio: "ignore" }
        );
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
          pollLogger.info("Issue not solely assigned to us; skipping");
        }
      } catch (e) {
        pollLogger.warn({ err: e, issueNumber: issue.number }, "could not verify assignment; proceeding");
        claimed = true;
      }
      if (!claimed) continue;

      // Fetch issue comments so we can print them before starting the agent
      let comments = [];
      try {
        const info = execSync(`gh issue view ${issue.number} --repo ${repo} --json comments`, {
          encoding: "utf8",
        });
        const parsed = JSON.parse(info || "{}");
        comments = parsed.comments || [];
      } catch (e) {
        pollLogger.warn({ err: e, issueNumber: issue.number }, "could not fetch comments; continuing without them");
      }

      // Print the initial context block once per issue — this is the
      // data stub the agent sees at the start of its work. It is not
      // repeated on every heartbeat log line.
      // Print the data stub once — this is the context the agent sees
      // at the start of its work. It is printed only once, not repeated.
      logger.info(
        {
          repo,
          label,
          issueNumber: issue.number,
          title: issue.title,
          workspaceDir,
        },
        "Data stub for Issue #" + issue.number
      );

      // Use a separate logger without repo/label in context for subsequent
      // log lines so pino-pretty doesn't print them on every line.
      contextLogger.info(`Initialising workspace for Issue #${issue.number}`);
      contextLogger.info(`Workspace created at ${workspaceDir}`);
      contextLogger.info(`Starting agent for Issue #${issue.number}`);
      contextLogger.info(
        { issueNumber: issue.number, title: issue.title, workspaceDir },
        `Issue #${issue.number}: ${issue.title}`
      );
      contextLogger.info(`Description: ${issue.body}`);
      contextLogger.info(`Comment count: ${comments.length}`);
      comments.forEach((c, i) => {
        const author = c.author ? c.author.login : "unknown";
        const body = c.body || "";
        pollLogger.info(`  [${i + 1}] ${author}: ${body}`);
      });

      // Start the one-minute thought monitor for this issue
      startMonitoring({
        issueNumber: issue.number,
        repo,
        workspaceDir,
      });

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
        agentFactory,
        agentLabel  // Pass agentLabel as sessionId for traceability
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
        // Remove both the target label and the agent claim label
        execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "${label}"`);
        execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "${agentLabel}"`);
        pollLogger.info({ issueNumber: issue.number }, `Successfully removed '${label}' and '${agentLabel}' labels`);
      }
    } catch (err) {
      pollLogger.error({ err, issueNumber: issue.number }, `Failed to process Issue #${issue.number}`);
    } finally {
      // Stop the one-minute thought monitor for this issue
      stopMonitoring();
      // Release claim and keep workspace persistent for incremental fixes
      try { 
        execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-label "cline-in-progress"`, { stdio: "ignore" });
        // Post agent release comment with agent label for traceability
        execSync(
          `gh issue comment ${issue.number} --repo ${repo} --body "//agent-${agentLabel} released issue #${issue.number}"`,
          { stdio: "ignore" }
        );
      } catch (e) { /* label may not exist */ }
      try { execSync(`gh issue edit ${issue.number} --repo ${repo} --remove-assignee "*"`, { stdio: "ignore" }); } catch (e) { /* ignore */ }
      pollLogger.info({ workspaceDir }, "Keeping workspace persistent");
    }
  }

  // Graceful shutdown: release all agent claims when container exits
  const shutdownHandler = (signal) => {
    pollLogger.info(`Received ${signal} signal, releasing all agent claims...`);
    for (const issueNumber of claimedIssues) {
      try {
        execSync(`gh issue edit ${issueNumber} --repo ${repo} --remove-label "${agentLabel}"`, { stdio: "ignore" });
        pollLogger.info({ issueNumber, action: "released" }, `Removed agent label from Issue #${issueNumber}`);
      } catch (err) {
        pollLogger.warn({ issueNumber, error: err.message }, `Failed to release claim for Issue #${issueNumber}`);
      }
    }
    pollLogger.info("All agent claims released. Shutting down.");
  };

  process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
  process.on("SIGINT", () => shutdownHandler("SIGINT"));

  return currentCline;
}
