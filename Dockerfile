# Usar imagen base oficial de Node.js 18 con Alpine (más ligera)
FROM node:18-alpine

# Instalar dependencias del sistema para Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Crear directorio de trabajo
WORKDIR /app

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node.js
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente
COPY --chown=nextjs:nodejs . .

# Cambiar permisos
RUN chown -R nextjs:nodejs /app

# Cambiar a usuario no-root
USER nextjs

# Exponer puerto
EXPOSE 3000

# Variables de entorno para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# Comando para ejecutar la aplicación
CMD ["npm", "start"]
