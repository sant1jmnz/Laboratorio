FROM node:20-slim

# Toolchains de los lenguajes que el editor puede ejecutar (g++/gcc para
# C++ y C, python3, default-jdk para Java; Node ya viene en la imagen base)
# mas gdb para el debugger. python3/make ademas son los que necesita
# node-gyp para compilar los addons nativos (node-pty, classic-level) si no
# hay binario prebuildeado para esta plataforma.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ gcc gdb python3 make default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
