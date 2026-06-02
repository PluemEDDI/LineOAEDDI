# syntax=docker/dockerfile:1.7
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY content.json faq.json faq.th.json manual.config.json translations.th.json richmenu-areas.json ./
COPY img ./img
COPY preview ./preview
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
