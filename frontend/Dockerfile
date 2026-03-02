FROM node:22-alpine AS builder
WORKDIR /app

# Copy root package.json for version extraction
COPY package.json /tmp/root-package.json

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN APP_VERSION=$(node -p "require('/tmp/root-package.json').version") npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
