FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
RUN npm install --omit=dev

EXPOSE 3000
CMD ["sh", "-c", "node dist/${ORACLE_ENTRY:?ORACLE_ENTRY must be set to examples/prediction-market.js or examples/web-data-oracle.js}"]
