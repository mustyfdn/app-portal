FROM node:23-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE ${PORT:-3000}

CMD ["node", "server.js"]
