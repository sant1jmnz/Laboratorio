FROM node:20-slim

# Toolchains de los lenguajes que el editor ejecuta (g++/gcc para C++ y C,
# python3, default-jdk para Java; Node ya viene en la imagen base), gdb para
# el depurador y clang-format para el boton "Formatear" (cubre C, C++, Java
# y JavaScript). python3/make ademas son los que necesita node-gyp para
# compilar el addon nativo de node-pty si no hay binario prebuildeado.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ gcc gdb python3 make default-jdk-headless clang-format \
    && rm -rf /var/lib/apt/lists/*

# black formatea Python. Va aparte y tolera el fallo a proposito: si el
# paquete no estuviera en esta base, el resto del editor tiene que seguir
# funcionando igual (el boton avisa que falta el formateador).
RUN apt-get update \
    && (apt-get install -y --no-install-recommends black \
        || echo 'AVISO: black no disponible; el formateo de Python quedara deshabilitado') \
    && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios con el que corren los programas de los usuarios.
# El servidor sigue siendo root (necesita poder bajar privilegios y limpiar
# los directorios temporales), pero el codigo que se ejecuta nunca lo es:
# de otro modo podria leer /proc/<pid del servidor>/environ y llevarse el
# GITHUB_TOKEN o la APP_PASSWORD.
RUN useradd --system --create-home --home-dir /home/runner --shell /usr/sbin/nologin runner
ENV RUNNER_UID=999
ENV RUNNER_GID=999
RUN usermod -u 999 runner && groupmod -g 999 runner \
    && chown -R 999:999 /home/runner

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# El codigo del servidor queda ilegible para el usuario sin privilegios.
RUN chmod -R go-rwx /app

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
