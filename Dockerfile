# syntax=docker/dockerfile:1
# Multi-stage build to compile TypeScript and run the app with only production deps.

FROM node:20.11-slim AS builder
WORKDIR /app

# Install dependencies (including dev dependencies required for the TypeScript build)
COPY package*.json ./
RUN npm ci

# Copy source files and compile to JavaScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20.11-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Bring over the compiled output and static assets
COPY --from=builder /app/dist ./dist
COPY public ./public

# Expose the HTTP port used by the Express server
EXPOSE 3000

# Run the compiled server
CMD ["node", "dist/index.js"]
