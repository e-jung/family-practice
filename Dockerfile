FROM node:24-alpine
ENV NODE_ENV=production PORT=8088 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /data/tts && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8088/api/state').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
