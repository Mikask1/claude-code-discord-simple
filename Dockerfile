FROM oven/bun:1-alpine

# Install git for repo cloning
RUN apk add --no-cache git

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json* ./
COPY COVENA_CLAUDE.md ./

ARG GITHUB_TOKEN
RUN mkdir -p /app/Covena-AI && \
    if [ -n "$GITHUB_TOKEN" ]; then \
      git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Covena-AI/eden-prompts-hub /app/Covena-AI/eden-prompts-hub && \
      git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Covena-AI/eden-flow-tools /app/Covena-AI/eden-flow-tools; \
      git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Covena-AI/eden-flow-experimental /app/Covena-AI/eden-flow-experimental; \
      git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Covena-AI/eden-garden-hub-fe /app/Covena-AI/eden-garden-hub-fe; \
      git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Covena-AI/eden-flow-eval /app/Covena-AI/eden-flow-eval; \
      git clone --depth 1 https://oauth2:${GITHUB_TOKEN}@github.com/Covena-AI/eden-flow-tools /app/Covena-AI/eden-flow-tools; \
    fi && \
    cp /app/COVENA_CLAUDE.md /app/Covena-AI/CLAUDE.md

ENV DEFAULT_CWD=/app/Covena-AI

EXPOSE 3000

CMD ["bun", "src/index.ts"]
