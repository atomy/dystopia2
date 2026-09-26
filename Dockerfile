# syntax=docker/dockerfile:1
# Dystopia 2: one image serving the static client, the maps and the game server.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    CLIENT_DIR=/app/client \
    MAPS_DIR=/app/maps
COPY --from=build /app/packages/server/dist/server.mjs ./server.mjs
COPY --from=build /app/packages/client/dist ./client
COPY maps ./maps
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
