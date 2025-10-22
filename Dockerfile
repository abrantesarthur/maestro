FROM oven/bun:1.3.1

WORKDIR /app

COPY package.json ./
COPY server.ts ./

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
