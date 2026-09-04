FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @prototype-hub/db prisma:generate
RUN pnpm build
EXPOSE 3000 4000
