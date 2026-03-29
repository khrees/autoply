# Use the official Bun image
# https://hub.docker.com/r/oven/bun
FROM oven/bun:1.1.26 as base
WORKDIR /app

# --- Dependencies Stage ---
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install with --production for a smaller final image
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# --- Build Stage (Optional: If you want to bundle/transpile) ---
# Currently we run directly with Bun for maximum performance and simplicity
# but we build the extension if needed for serving or inclusion
FROM base AS build
COPY --from=install /temp/dev/node_modules node_modules
COPY . .
# RUN bun run extension:build

# --- Runtime Stage ---
FROM base AS release
# Copy production node_modules and all source files
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Install Playwright system dependencies and Chromium
# This ensures scrapers can run in a headless environment
RUN bunx playwright install --with-deps chromium

# Set environment defaults
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# Expose the API port
EXPOSE 3000

# Run the API server
CMD ["bun", "run", "src/api/server.ts"]
