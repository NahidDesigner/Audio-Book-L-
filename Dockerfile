# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .

# Supabase public client config is compiled into frontend bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY
ARG VITE_LIBRARY_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=${VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY}
ENV VITE_LIBRARY_KEY=${VITE_LIBRARY_KEY}

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/lamejs.d.ts ./lamejs.d.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
