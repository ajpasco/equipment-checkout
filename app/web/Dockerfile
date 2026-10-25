# The client's image: the production build of app/web, served by nginx as a non-root user, which
# passes /api to the API (blueprint sections 1 and 13.1).

FROM node:22.23.4-slim AS build
WORKDIR /src
# The lockfile first, so a change to the code does not reinstall the dependencies.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# The only value that enters the bundle, and it is not a secret (blueprint section 6).
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN node_modules/.bin/vite build --outDir /built --emptyOutDir

FROM nginx:1.27.5-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /built /usr/share/nginx/html
# The image's own `nginx` user. nginx.conf keeps its pid file and temporary files in /tmp and
# listens on 8080, so nothing it needs belongs to root.
USER nginx
EXPOSE 8080
