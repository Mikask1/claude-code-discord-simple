FROM oven/bun:1-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY src/ ./src/
COPY tsconfig.json* ./

CMD ["bun", "src/index.ts"]
