import { ClineCore } from "@cline/core";
import { logger } from "./logger.mjs";

export async function createAgent() {
  logger.info("Initializing ClineCore engine...");
  const cline = await ClineCore.create({ backendMode: "local" });
  return cline;
}

export async function runTask(cline, { prompt, issueNumber, repo, workspaceDir }) {
  const taskLogger = logger.child({ issueNumber, repo, workspaceDir });
  taskLogger.info("Spawning agent task in isolated workspace...");

  // Start the session
  const run = await cline.start({
    config: {
      providerId: "cline",
      modelId: "reflection/beam-free",
      cwd: workspaceDir, // Agent is strictly anchored inside its isolated clone
      systemPrompt:
        "You are an autonomous software engineer operating inside an isolated repository workspace. Investigate the issue, apply fixes, test, and push your changes to a feature branch.",
      enableTools: true,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      // Ephemeral mode prevents storing UI state
      ephemeral: true,
      // Stream live events into our logger
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

  taskLogger.info({ result: run.result?.text }, "Task completed");
  return run.result;
}
