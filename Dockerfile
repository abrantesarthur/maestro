FROM oven/bun:1.3.1

WORKDIR /app

COPY package.json server.ts bun.lock ./

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
