# Usar imagen base de Node.js 18
FROM node:18-slim

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libxss1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Crear directorio de la aplicación
WORKDIR /app

# Copiar package.json
COPY package.json ./

# Instalar dependencias usando npm install (no npm ci)
RUN npm install --production

# Copiar código fuente
COPY . .

# Crear usuario no-root para seguridad
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

# Cambiar a usuario no-root
USER pptruser

# Exponer puerto
EXPOSE 3000

# Comando de inicio
CMD ["node", "index.js"]
