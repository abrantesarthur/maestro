## Build stage: compile the backend into a standalone binary
FROM oven/bun:1.3.1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
COPY src ./src
# If dependencies are added later, install them here (using --production for runtime deps only).
RUN bun build src/server.ts --compile --outfile /app/server

## Runtime stage: minimal, non-root base
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app

COPY --from=builder /app/server /app/server

USER nonroot
ENTRYPOINT ["/app/server"]
