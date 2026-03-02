FROM node:22-alpine AS builder

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache unzip

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY backend/src/data ./dist/data
COPY backend/src/proto ./dist/proto

# Copy root package.json for runtime version reading
COPY package.json ./root-package.json

EXPOSE 3001
CMD ["node", "dist/index.js"]
