FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/core/migrations packages/core/migrations
COPY docs/REVIEW_LOG.md docs/APPROVALS.md docs/
COPY scripts/restore.mjs scripts/restore.mjs
RUN apk add --no-cache postgresql17-client \
 && npm install --omit=dev --no-audit --no-fund && mkdir -p /app/data /app/backups && chown -R node:node /app
COPY --from=builder --chown=node:node /app/apps/web/dist apps/web/dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4321/healthz || exit 1
CMD ["node", "apps/web/dist/server/entry.mjs"]
