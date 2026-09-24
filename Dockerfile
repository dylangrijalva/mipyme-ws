FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@10.30.3 && HUSKY=0 pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

COPY .env.staging ./

CMD ["node", "dist/src/index.js"]
