FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json tsconfig.base.json turbo.json ./
COPY deployments.json ./
COPY packages/agent/package.json packages/agent/tsconfig.json ./packages/agent/
COPY packages/oracle/package.json packages/oracle/tsconfig.json ./packages/oracle/
COPY apps/oracle/package.json apps/oracle/tsconfig.json ./apps/oracle/
RUN npm ci

COPY packages/agent ./packages/agent
COPY packages/oracle ./packages/oracle
COPY apps/oracle ./apps/oracle

RUN npm run build --workspace=packages/agent \
  && npm run build --workspace=packages/oracle \
  && npm run build --workspace=apps/oracle \
  && npm prune --omit=dev \
  && mkdir -p packages/agent/node_modules packages/oracle/node_modules apps/oracle/node_modules

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/deployments.json ./deployments.json
COPY --from=builder /app/packages/agent/package.json ./packages/agent/package.json
COPY --from=builder /app/packages/agent/dist ./packages/agent/dist
COPY --from=builder /app/packages/agent/node_modules ./packages/agent/node_modules
COPY --from=builder /app/packages/oracle/package.json ./packages/oracle/package.json
COPY --from=builder /app/packages/oracle/dist ./packages/oracle/dist
COPY --from=builder /app/packages/oracle/node_modules ./packages/oracle/node_modules
COPY --from=builder /app/apps/oracle/package.json ./apps/oracle/package.json
COPY --from=builder /app/apps/oracle/dist ./apps/oracle/dist
COPY --from=builder /app/apps/oracle/node_modules ./apps/oracle/node_modules

WORKDIR /app/apps/oracle
EXPOSE 3001
CMD ["sh", "-c", "node dist/${ORACLE_ENTRY:?ORACLE_ENTRY must be set to a compiled oracle entry, e.g. examples/prediction-market.js}"]
