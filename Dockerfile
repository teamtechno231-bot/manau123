FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js database.js ./
COPY whizzy-admin-data.json ./
COPY public ./public
COPY tests ./tests
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node","server.js"]
