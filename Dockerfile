FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY railway-hub.js ./

EXPOSE ${PORT:-3000}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "railway-hub.js"]
