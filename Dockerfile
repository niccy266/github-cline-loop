FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git gnupg python3 python3-pip python3-venv \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /home/app --create-home app

# Create workspace directory & grant permissions to non-root app user
RUN mkdir -p /app/.workspaces /home/app/.cline && chown -R app:app /app /home/app

# Set up Git author identity & configure the GitHub CLI as the Git credential helper.
# GH_TOKEN must be supplied at runtime; do not pass it as a build secret.
USER app
RUN git config --global user.email "cline-bot@users.noreply.github.com" \
    && git config --global user.name "github-cline-loop[bot]" \
    && git config --global credential.helper '!gh auth git-credential'

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json index.mjs agent.mjs poller.mjs logger.mjs session-recovery.mjs thought-monitor.mjs ./

CMD ["node", "index.mjs"]
