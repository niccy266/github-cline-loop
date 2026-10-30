import { ClineCore } from "@cline/core";
import { logger } from "./logger.mjs";
import { addThought, addErrorBlock } from "./thought-monitor.mjs";
import { execSync } from "node:child_process";

export const MAX_ATTEMPTS = 8;
export const RETRY_DELAY_MS = 5_000;

/**
 * Number of consecutive socket-error retries after which we dispose the
 * existing ClineCore instance and create a brand-new one. The local runtime
 * host's transport can be left in a broken state after a disconnect, so
 * retrying `start()` on the same instance will just fail again.
 */
const RECREATE_AFTER_ATTEMPT = 3;

/**
 * Detects whether an error is caused by a transport/session-level socket
 * failure (as opposed to a business-logic or API error).
 */
export function isSocketError(err) {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return (
    msg.includes("und_err_socket") ||
    msg.includes("socketerror") ||
    msg.includes("other side closed") ||
    msg.includes("terminated") ||
    msg.includes("socket hang up")
  );
}

/**
 * Safely dispose a ClineCore instance so all underlying transports and
 * resources are released before we create a replacement.
 */
export async function disposeAgent(cline) {
  if (!cline || typeof cline.dispose !== "function") {
    return;
  }
  try {
    await cline.dispose("recreating agent after disconnect");
    logger.info("Previous ClineCore instance disposed");
  } catch (err) {
    logger.warn({ err }, "Error while disposing ClineCore instance; continuing");
  }
}

/**
 * Creates a new ClineCore instance configured for local backend execution.
 */
export async function createAgent() {
  logger.info("Initializing ClineCore engine...");
  const cline = await ClineCore.create({ backendMode: "local" });
  return cline;
}

/**
 * Runs a single agent task for a GitHub issue, with robust retry and
 * agent-recreation logic for socket disconnects.
 *
 * Returns `{ result, agent }` so the caller can update its reference to
 * the ClineCore instance in case it was disposed and recreated during
 * retries.
 */
export async function runTask(
  cline,
  { prompt, issueNumber, repo, workspaceDir },
  agentFactory = createAgent,
  sessionId
) {
  const taskLogger = logger.child({ issueNumber, repo, workspaceDir });
  if (sessionId) {
    taskLogger.info(
      { sessionId, issueNumber, repo },
      `Spawning agent task for Issue #${issueNumber} [Session: ${sessionId}]`
    );
  } else {
    taskLogger.info("Spawning agent task in isolated workspace...");
  }

  let lastErr = null;
  let currentCline = cline;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        taskLogger.warn(
          { attempt },
          "Retrying agent task after socket error"
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }

      // When socket errors persist across multiple retries, the underlying
      // ClineCore transport is likely dead. Dispose it and spin up a fresh
      // instance rather than hammering the same broken host.
      if (attempt >= RECREATE_AFTER_ATTEMPT && isSocketError(lastErr)) {
        taskLogger.warn(
          { attempt },
          "Transport appears dead; disposing and recreating ClineCore instance"
        );
        await disposeAgent(currentCline);
        currentCline = await agentFactory();
      }

      const run = await currentCline.start({
        config: {
          providerId: "cline",
          modelId: "reflection/beam-free",
          cwd: workspaceDir,
          systemPrompt:
            `You are an autonomous software engineer operating inside an isolated repository workspace. Your task is to resolve GitHub Issue #${issueNumber} in ${repo}.

=== REQUIRED: GitHub Issue Progress Comments ===
You MUST comment on the GitHub issue as you work, so that another agent can continue if you stall, disconnect, or time out. Use "gh issue comment" for each milestone:

1. When starting: gh issue comment ${issueNumber} --repo ${repo} --body "//agent-bot started working on this issue"
2. After each commit: gh issue comment ${issueNumber} --repo ${repo} --body "//agent-bot committed: <summary> (commit <short-hash>)"
3. After pushing branch: gh issue comment ${issueNumber} --repo ${repo} --body "//agent-bot pushed to branch: <branch-name>"
4. When opening PR: gh issue comment ${issueNumber} --repo ${repo} --body "//agent-bot PR: <PR link>"
5. On error/stuck: gh issue comment ${issueNumber} --repo ${repo} --body "//agent-bot error: <description>"
6. On completion: gh issue comment ${issueNumber} --repo ${repo} --body "//agent-bot done: <summary>. PR: <link>"

Always include a "//agent-bot" prefix in comments so they are easy to find. If you disconnect mid-task, the next agent that claims this issue should read these comments to understand what has already been tried.

=== Rules ===
1. Do NOT run tests locally - verification must happen through GitHub Actions CI only; push your branch and open a PR, then rely on CI. NEVER execute pytest, unittest, npm test, or any test command locally.
2. Always push your changes to a feature branch; do not leave uncommitted or unpushed work.
3. Always append a dated entry to WORK_LOG.md describing what you changed, verified, and pushed.
4. Always open a Pull Request for your branch and report the PR number in your final message.
5. If CI verification fails, fix and re-push until green.
6. Never rely on local-only checks as proof of completion.
7. You may run unrestricted shell scripts/commands inside this container (it is isolated). Use \`bash\` (alias for \`run_commands\`) or \`run_commands\` freely for automation.

The repository is ALREADY cloned into your current working directory. Do NOT search for the repository, clone it, or check out git remote URLs; start immediately by exploring and inspecting files in the current working directory. Issue title and description have been provided. Go!`,
          enableTools: true,
          enableSpawnAgent: false,
          enableAgentTeams: false,
          ephemeral: false,
          onEvent: (event) => {
            // Handle raw stream chunks from the agent (real-time thought streaming)
            if (event.type === "chunk") {
              if (event.payload.stream === "agent" && event.payload.chunk) {
                addThought(event.payload.chunk);
                taskLogger.agent(
                  { trace: "thought" },
                  event.payload.chunk.trim()
                );
              }
            }
            // Handle structured agent events for tool calls and other events
            else if (event.type === "agent_event") {
              const agentEvent = event.payload.event;
              // Handle tool calls
              if (agentEvent.type === "content_start" && agentEvent.contentType === "tool") {
                taskLogger.agent(
                  { trace: "tool", tool: agentEvent.toolName, args: agentEvent.input },
                  `Executing tool: ${agentEvent.toolName}`
                );
              }
            }
            // Handle hook events for tool calls and results
            else if (event.type === "hook") {
              if (event.payload.hookEventName === "tool_call") {
                taskLogger.agent(
                  { trace: "tool", tool: event.payload.toolName, args: event.payload },
                  `Executing tool: ${event.payload.toolName}`
                );
              } else if (event.payload.hookEventName === "tool_result") {
                if (event.payload.isError) {
                  const errText =
                    typeof event.payload.output === "string"
                      ? event.payload.output
                      : JSON.stringify(event.payload.output ?? "");
                  addErrorBlock(`Error: ${errText}`);
                }
                taskLogger.debug(
                  { trace: "tool-result", tool: event.payload.toolName, isError: event.payload.isError },
                  `Tool finished: ${event.payload.toolName}`
                );
              }
            }
          },
        },
        prompt,
        interactive: false,
      });

      const resultText = (run.result?.text || "").toString();
      if (/UND_ERR_SOCKET|SocketError|other side closed|terminated|socket hang up/i.test(resultText)) {
        throw new Error(resultText);
      }

      taskLogger.info({ result: resultText }, "Task completed");
      return { result: run.result, agent: currentCline };
    } catch (err) {
      lastErr = err;
      taskLogger.error({ err, attempt }, "Agent task attempt failed");
      if (!isSocketError(err) || attempt === MAX_ATTEMPTS) {
        throw err;
      }
    }
  }
  throw lastErr;
}
