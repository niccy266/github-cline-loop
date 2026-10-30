import { logger } from "./logger.mjs";
import { createAgent } from "./agent.mjs";
import { pollGitHubIssues } from "./poller.mjs";

const REPO = "niccy266/musicbee-tagger-mcp";
const TARGET_LABEL = "cline-todo";
const POLL_INTERVAL_MS = 60_000;

async function main() {
  logger.info("Starting Autonomous GitHub Loop Service...");

  let cline = await createAgent();

  const tick = async () => {
    try {
      const updatedCline = await pollGitHubIssues(cline, REPO, TARGET_LABEL, POLL_INTERVAL_MS);
      // Adopt a recreated agent instance if runTask disposed and rebuilt it
      if (updatedCline && updatedCline !== cline) {
        cline = updatedCline;
      }
    } catch (err) {
      logger.error({ err }, "Unhandled error during polling tick");
    }
  };

  // Run initial check immediately, then schedule
  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
