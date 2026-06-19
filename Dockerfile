# Multi-stage build: Node 22 Alpine, non-root runtime user
FROM node:22-alpine AS builder

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY scripts ./scripts

RUN npm run build

FROM node:22-alpine AS runner

RUN apk add --no-cache ca-certificates

WORKDIR /app

RUN addgroup -g 1001 -S caladdin && adduser -S caladdin -u 1001 -G caladdin

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/web/dist ./web/dist

USER caladdin

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "dist/src/index.js"]
