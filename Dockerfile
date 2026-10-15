FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server.js"]
