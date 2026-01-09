FROM oven/bun:1

WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Install Playwright browsers (--with-deps handles all system deps)
RUN bunx playwright install chromium --with-deps

# Copy application code
COPY . .

# Create data directory for SQLite with proper permissions
RUN mkdir -p /app/data && chmod 777 /app/data

# Run the bot
CMD ["bun", "run", "index.ts"]
