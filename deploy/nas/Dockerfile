FROM node:24.22.1-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /source
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsx scripts/build.ts --profile community-desktop
RUN pnpm --config.allow-unused-patches=true --filter @deepseek-ai/dsh deploy \
      --prod --legacy --config.node-linker=hoisted --config.auto-install-peers=false /runtime \
  && test -f /runtime/lib/bin.js \
  && test -f /runtime/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html

FROM node:24.22.1-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV DSH_HOME=/config
WORKDIR /opt/open-dsh
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate \
  && groupadd --gid 1000 harness \
  && useradd --uid 1000 --gid harness --create-home harness \
  && mkdir -p /config /workspaces \
  && chown -R harness:harness /config /workspaces
COPY --from=build --chown=harness:harness /runtime /opt/open-dsh
COPY --chmod=755 deploy/nas/entrypoint.sh /usr/local/bin/open-dsh-nas-entrypoint
USER harness
EXPOSE 3080
ENTRYPOINT ["/usr/local/bin/open-dsh-nas-entrypoint"]
CMD ["node", "lib/bin.js", "--profile", "web", "--no-open", "--host", "0.0.0.0", "--port", "3080", "--trusted-host", "harness.local", "--nas"]
