# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# `npm ci --omit=dev` installs exactly what package-lock.json pins and leaves
# out the test/seed toolchain — including mongodb-memory-server, which must
# never ship to production.
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

# Run unprivileged. The base image already provides the `node` user.
USER node

EXPOSE 4000

# Uses the app's own readiness endpoint, which reports the database connection
# state — a process that is up but cannot reach MongoDB is not healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
