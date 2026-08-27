FROM node:20-slim

# g++ compila el codigo C++ de los usuarios; python3/make son los que
# necesita node-gyp para compilar el addon nativo de node-pty si no hay
# binario prebuildeado disponible para esta plataforma.
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ python3 make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
