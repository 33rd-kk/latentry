# Latentry in a container. See docs/install/docker.md, and compose.yaml for
# how it is meant to be run.
#
# Nothing in the container is trusted for being on 127.0.0.1
# (LATENTRY_TRUST_LOOPBACK=off): every browser pairs, the first one with a
# code from `docker compose exec latentry npm run owner-code`.

# node:22.23.2-bookworm-slim, pinned so a build is reproducible.
ARG NODE_IMAGE=node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

FROM ${NODE_IMAGE} AS build
# git: one package (panorail) comes from its GitHub tag.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund
# What the image never runs: onnxruntime's builds for other systems and
# processors and its GPU providers (the tagger runs on the CPU, see
# lib/tagger/wd14.ts), and Playwright, which Next.js lists only for tests.
RUN arch=$(case "$(uname -m)" in aarch64) echo arm64 ;; *) echo x64 ;; esac) \
  && ort=node_modules/onnxruntime-node/bin/napi-v6 \
  && rm -rf "$ort/win32" "$ort/darwin" \
  && find "$ort/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} + \
  && rm -f "$ort/linux/$arch"/libonnxruntime_providers_cuda.so "$ort/linux/$arch"/libonnxruntime_providers_tensorrt.so \
  && rm -rf node_modules/@playwright node_modules/playwright node_modules/playwright-core

FROM ${NODE_IMAGE}
# ca-certificates: the engine's downloads (uv, Python, PyTorch, models).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    LATENTRY_HOST=0.0.0.0 \
    LATENTRY_TRUST_LOOPBACK=off \
    LATENTRY_SETTINGS_FILE=/data/latentry.settings.json \
    LATENTRY_RUNTIME_DIR=/data/runtime \
    GALLERY_SAVE_DIR=/data/output \
    LATENTRY_NO_LOGO=1
WORKDIR /app
# The app stays root's, so the server cannot change its own code; it writes
# only to Next's cache and to /data.
COPY --from=build /app ./
# Everything Latentry keeps is under /data: settings, keys, pictures, the
# engine and its models (/app/models points there).
RUN mkdir -p /data/models /data/output /data/runtime /app/.next/cache \
  && chown -R node:node /data /app/.next/cache \
  && ln -s /data/models /app/models
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/pair').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "scripts/serve.mjs", "start"]
