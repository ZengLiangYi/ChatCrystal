FROM node:24.20-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY shared/package.json shared/package.json

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24.20-alpine AS runtime

WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/ZengLiangYi/ChatCrystal"
LABEL org.opencontainers.image.description="ChatCrystal cloud server"
LABEL org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production
ENV PORT=3721
ENV DATA_DIR=/data
ENV CHATCRYSTAL_CLOUD_MODE=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json

RUN corepack enable \
  && pnpm --filter ./server... install --prod --frozen-lockfile --ignore-scripts \
  && pnpm store prune

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/shared/types ./shared/types
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/NOTICE ./NOTICE

RUN chmod +x /app/server/dist/server/src/cli/index.js \
  && ln -s /app/server/dist/server/src/cli/index.js /usr/local/bin/crystal \
  && mkdir -p /data \
  && chown -R node:node /data

USER node
EXPOSE 3721
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3721/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/server/src/index.js"]
