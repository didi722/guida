FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN chmod +x scripts/docker-entrypoint.sh
VOLUME /data
EXPOSE 3000
# parte come root solo per sistemare i permessi del disco, poi il sito gira come utente `node`
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
