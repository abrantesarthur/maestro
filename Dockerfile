## Build stage: compile the backend into a standalone binary
FROM oven/bun:1.3.1 AS builder
WORKDIR /app

COPY package.json bun.lock server.ts ./
# If dependencies are added later, install them here (using --production for runtime deps only).
RUN bun build server.ts --compile --outfile /app/server

## Runtime stage: minimal, non-root base
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app

COPY --from=builder /app/server /app/server

EXPOSE 3000
USER nonroot
ENTRYPOINT ["/app/server"]
