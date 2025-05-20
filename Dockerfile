FROM node:18-slim AS base
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package manifests
COPY package.json ./
COPY pnpm-lock.yaml ./
# pnpm-workspace.yaml is not typically needed for a single service build like this if dependencies are correctly specified.

# Install dependencies using the lockfile
RUN pnpm install --frozen-lockfile

# --- Build stage ---
FROM base AS build
WORKDIR /app
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
# Copy package.json (might be needed for runtime)
COPY --from=base /app/package.json ./

# Expose the application port (defaulting to 3000, adjust if necessary)
EXPOSE 3000

# Command to run the application
CMD ["node", "dist/index.js"] 