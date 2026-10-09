FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/dados
VOLUME /dados
EXPOSE 3000
CMD ["node", "server.js"]
