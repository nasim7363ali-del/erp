FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY web/package.json ./web/
RUN npm ci --ignore-scripts
COPY api ./api
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/api ./api
COPY --from=build --chown=node:node /app/web/package.json ./web/package.json
COPY --from=build --chown=node:node /app/web/dist ./web/dist
USER node
EXPOSE 3000
CMD ["npm", "start"]
