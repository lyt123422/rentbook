FROM node:22-slim
WORKDIR /app
COPY package.json server.js db.js keys.js pages.js ./
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "server.js"]
