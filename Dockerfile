# Briefly has no runtime dependencies: Node 22 runs the TypeScript sources directly.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "src/server.ts"]
