FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY hosted/package.json hosted/package-lock.json ./hosted/
RUN npm --prefix hosted ci --ignore-scripts
COPY . .
RUN npm run build && npm --prefix hosted run typecheck

FROM build AS test
CMD ["sh", "-c", "npm test && npm --prefix hosted test && npm run verify:no-secrets"]

FROM build AS dependencies
RUN npm prune --omit=dev --ignore-scripts && npm --prefix hosted prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production PORT=8080 HOSTED_DATABASE_PATH=/data/auth.sqlite
WORKDIR /app
COPY --from=dependencies /app/package.json /app/LICENSE ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=dependencies /app/hosted/package.json ./hosted/package.json
COPY --from=dependencies /app/hosted/node_modules ./hosted/node_modules
COPY --from=build /app/hosted/src ./hosted/src
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "hosted/src/main.ts"]
