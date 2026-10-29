import { ClineCore } from "@cline/core";
import { logger } from "./logger.mjs";

const MAX_ATTEMPTS = 8;
const RETRY_DELAY_MS = 5_000;

function isSocketError(err) {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return (
    msg.includes("und_err_socket") ||
    msg.includes("socketerror") ||
    msg.includes("other side closed") ||
    msg.includes("terminated")
  );
}

export async function createAgent() {
  logger.info("Initializing ClineCore engine...");
  const cline = await ClineCore.create({ backendMode: "local" });
  return cline;
}

export async function runTask(cline, { prompt, issueNumber, repo, workspaceDir }) {
  const taskLogger = logger.child({ issueNumber, repo, workspaceDir });
  taskLogger.info("Spawning agent task in isolated workspace...");

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        taskLogger.warn({ attempt }, "Retrying agent task after socket error");
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }

      const run = await cline.start({
        config: {
          providerId: "cline",
          modelId: "reflection/beam-free",
          cwd: workspaceDir,
          systemPrompt:
            "You are an autonomous software engineer operating inside an isolated repository workspace. Investigate the issue, apply fixes, and push your changes to a feature branch. Rules: (1) Do NOT run tests locally - verification must happen through GitHub Actions CI only; push your branch and open a PR, then rely on CI. NEVER execute pytest, unittest, npm test, or any test command locally. (2) Always push your changes to a feature branch; do not leave uncommitted or unpushed work. (3) Always append a dated entry to WORK_LOG.md describing what you changed, verified, and pushed. (4) Always open a Pull Request for your branch and report the PR number in your final message. (5) If CI verification fails, fix and re-push until green. (6) Never rely on local-only checks as proof of completion. (7) You may run unrestricted shell scripts/commands inside this container (it is isolated); use bash freely for automation.",
          enableTools: true,
          enableSpawnAgent: false,
          enableAgentTeams: false,
          ephemeral: false,
          onEvent: (event) => {
            if (event.type === "message" || event.type === "assistant-message") {
              if (event.text) {
                taskLogger.info({ trace: "thought" }, `Agent: ${event.text.trim()}`);
              }
            } else if (event.type === "tool-call") {
              taskLogger.info(
                { trace: "tool", tool: event.name, args: event.args },
                `Executing tool: ${event.name}`
              );
            } else if (event.type === "tool-result") {
              taskLogger.debug(
                { trace: "tool-result", tool: event.name },
                `Tool finished: ${event.name}`
              );
            }
          },
        },
        prompt,
        interactive: false,
      });

      const resultText = (run.result?.text || "").toString();
      if (/UND_ERR_SOCKET|SocketError|other side closed|terminated/i.test(resultText)) {
        throw new Error(resultText);
      }

      taskLogger.info({ result: resultText }, "Task completed");
      return run.result;
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
