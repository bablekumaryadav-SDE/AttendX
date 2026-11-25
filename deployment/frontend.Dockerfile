FROM node:22-alpine AS build
WORKDIR /srv/attendx/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/attendx/frontend/dist /usr/share/nginx/html
EXPOSE 80 443
