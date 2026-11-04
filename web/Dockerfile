# The web app as a container, for AWS ECS Express Mode (docs/AWS.md).
# Build from the repo root, not web/: `next build` type-checks scripts that
# import from platform/, as CI does.
#
#   docker build -f web/Dockerfile -t sectionary-web .
#   docker run -p 8080:8080 --env-file web/.env.local sectionary-web
#
# NEXT_PUBLIC_* values are baked into the browser code at build time, so they
# are build arguments here; every other setting is read when the server runs.

FROM node:24-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_BLOCKS_SRC
ARG NEXT_PUBLIC_STORES_SRC
ARG NEXT_PUBLIC_SITES_SRC
ARG NEXT_PUBLIC_ASSET_BASE
ARG NEXT_PUBLIC_CONTACT_EMAIL
# An argument left out arrives as an empty string, which is not the same as
# unset (NEXT_PUBLIC_BLOCKS_SRC="" would point the wall at nothing); empty ones are dropped.
RUN cd web \
  && for v in $(env | grep '^NEXT_PUBLIC_[A-Z_]*=$' | cut -d= -f1); do unset "$v"; done \
  && npm run build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/web/.next/static ./.next/static
COPY --from=build --chown=node:node /repo/web/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
