FROM node:18-slim AS base
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package manifests
COPY package.json ./
COPY pnpm-lock.yaml ./

# Install dependencies using the lockfile
RUN pnpm install --frozen-lockfile

# --- Build stage ---
FROM base AS build
WORKDIR /app
# node_modules are already correctly installed in the base stage
# Copy source code
COPY . .
# Build the application
RUN pnpm build

# --- Production stage ---
FROM node:18-slim AS production
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts from the build stage
COPY --from=build /app/dist ./dist
# Copy production dependencies from the base stage
COPY --from=base /app/node_modules ./node_modules
# Copy package.json (might be needed for runtime and for pnpm migrate:up)
COPY --from=base /app/package.json ./
# Copy pnpm-lock.yaml as well, as pnpm might need it for migrate:up script resolution
COPY --from=base /app/pnpm-lock.yaml ./

# Copy migration scripts from the build stage
COPY --from=build /app/migrations ./migrations

# Expose the application port (defaulting to 3000, adjust if necessary)
EXPOSE 3000

# Command to run migrations and then the application
CMD ["sh", "-c", "pnpm migrate:up && node dist/index.js"] 