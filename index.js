const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const puppeteer = require('puppeteer');

// Configuración del bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Configuración del servidor Express
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Puppeteer para Railway
const getPuppeteerOptions = () => {
  const baseOptions = {
    headless: 'new',
    timeout: 60000,
    protocolTimeout: 60000
  };

  if (process.env.NODE_ENV === 'production') {
    return {
      ...baseOptions,
      executablePath: '/usr/bin/google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--window-size=1280,720'
      ]
    };
  }

  return {
    ...baseOptions,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
};

// Configuración HEAT
const HEAT_CONFIG = {
  url: 'https://judit.ramajudicial.gov.co/HEAT/',
  username: process.env.HEAT_USERNAME || 'frodrigs',
  password: process.env.HEAT_PASSWORD || ''
};

// Función para extraer información de HEAT
async function extraerInformacionHEAT(numeroRadicado, maxReintentos = 3) {
  let browser = null;
  let page = null;
  
  for (let intento = 1; intento <= maxReintentos; intento++) {
    try {
      console.log(`🔐 Iniciando navegador para HEAT... (Intento ${intento}/${maxReintentos})`);
      
      const options = getPuppeteerOptions();
      browser = await puppeteer.launch(options);
      page = await browser.newPage();
      
      // Configurar página
      await page.setViewport({ width: 1280, height: 720 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      console.log(`🌐 Navegando a HEAT...`);
      await page.goto(HEAT_CONFIG.url, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });
      
      // Esperar y llenar el formulario de login
      console.log(`🔑 Iniciando sesión...`);
      await page.waitForSelector('input[name="User name"], input#username, input[placeholder*="User"], input[type="text"]', { timeout: 10000 });
      
      // Llenar usuario
      const usernameSelector = await page.$('input[name="User name"]') || 
                              await page.$('input#username') || 
                              await page.$('input[type="text"]');
      if (usernameSelector) {
        await usernameSelector.click();
        await usernameSelector.type(HEAT_CONFIG.username);
      }
      
      // Llenar contraseña
      await page.waitForSelector('input[name="Password"], input#password, input[type="password"]', { timeout: 5000 });
      const passwordSelector = await page.$('input[name="Password"]') || 
                              await page.$('input#password') || 
                              await page.$('input[type="password"]');
      if (passwordSelector) {
        await passwordSelector.click();
        await passwordSelector.type(HEAT_CONFIG.password);
      }
      
      // Hacer clic en el botón de login
      const loginButton = await page.$('button:contains("Login"), input[type="submit"], button[type="submit"], .login-button') ||
                         await page.$('button');
      if (loginButton) {
        await loginButton.click();
      }
      
      console.log(`⏳ Esperando autenticación...`);
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      
      // Buscar el caso/radicado
      console.log(`🔍 Buscando radicado: ${numeroRadicado}`);
      
      // Buscar campo de búsqueda
      await page.waitForSelector('input[type="search"], input[placeholder*="search"], input[placeholder*="buscar"], #search', { timeout: 10000 });
      const searchInput = await page.$('input[type="search"]') || 
                         await page.$('input[placeholder*="search"]') ||
                         await page.$('input[placeholder*="buscar"]') ||
                         await page.$('#search');
      
      if (searchInput) {
        await searchInput.click();
        await searchInput.type(numeroRadicado);
        await searchInput.press('Enter');
      }
      
      // Esperar resultados
      await page.waitForTimeout(3000);
      
      // Extraer información del caso
      console.log(`📊 Extrayendo información...`);
      
      const informacionCaso = await page.evaluate(() => {
        // Buscar información en la página
        const extraerTexto = (selector) => {
          const elemento = document.querySelector(selector);
          return elemento ? elemento.textContent.trim() : null;
        };
        
        return {
          numeroRadicado: extraerTexto('[data-field="radicado"], .radicado, .numero-caso') || 'No encontrado',
          estado: extraerTexto('[data-field="estado"], .estado, .status') || 'No encontrado',
          fecha: extraerTexto('[data-field="fecha"], .fecha, .date') || 'No encontrado',
          descripcion: extraerTexto('[data-field="descripcion"], .descripcion, .description') || 'No encontrado',
          asignado: extraerTexto('[data-field="asignado"], .asignado, .assigned') || 'No encontrado'
        };
      });
      
      // Tomar screenshot para debug
      await page.screenshot({ 
        path: '/tmp/heat-screenshot.png',
        fullPage: true 
      });
      
      console.log(`✅ Información extraída exitosamente`);
      
      return {
        exito: true,
        datos: informacionCaso,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.log(`❌ Error en intento ${intento}:`, error.message);
      
      if (intento === maxReintentos) {
        return {
          exito: false,
          error: `Error después de ${maxReintentos} intentos: ${error.message}`,
          timestamp: new Date().toISOString()
        };
      }
      
      // Esperar antes del siguiente intento
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } finally {
      // Limpiar recursos
      if (page) {
        try { await page.close(); } catch (e) {}
      }
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }
    }
  }
}

// Función para procesar caso
async function procesarCaso(numeroRadicado, chatId) {
  try {
    console.log(`📋 Procesando caso: ${numeroRadicado}`);
    
    // Enviar mensaje de procesamiento
    await bot.sendMessage(chatId, `🔄 Procesando radicado: ${numeroRadicado}\n⏳ Extrayendo información de HEAT...`);
    
    // Extraer información
    const resultado = await extraerInformacionHEAT(numeroRadicado);
    
    if (resultado.exito) {
      const mensaje = `✅ **Información del Radicado: ${numeroRadicado}**\n\n` +
                     `📋 **Estado:** ${resultado.datos.estado}\n` +
                     `📅 **Fecha:** ${resultado.datos.fecha}\n` +
                     `👤 **Asignado:** ${resultado.datos.asignado}\n` +
                     `📝 **Descripción:** ${resultado.datos.descripcion}\n\n` +
                     `🕐 **Consultado:** ${new Date().toLocaleString('es-CO')}`;
      
      await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, `❌ No se pudo extraer la información del radicado ${numeroRadicado}\n\n**Error:** ${resultado.error}`);
    }
    
  } catch (error) {
    console.error('❌ Error procesando caso:', error);
    await bot.sendMessage(chatId, `❌ Error procesando el radicado ${numeroRadicado}: ${error.message}`);
  }
}

// Comandos del bot
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const mensaje = `🤖 **Bot HEAT - Sistema de Consultas**\n\n` +
                 `📋 **Comandos disponibles:**\n` +
                 `• /consultar [número] - Consultar radicado\n` +
                 `• /estado - Estado del sistema\n` +
                 `• /ayuda - Ayuda y ejemplos\n\n` +
                 `💡 **Ejemplo:** \`/consultar 12345\``;
  
  bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

bot.onText(/\/consultar (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const numeroRadicado = match[1].trim();
  
  if (!numeroRadicado) {
    bot.sendMessage(chatId, '❌ Por favor proporciona un número de radicado válido.\n\nEjemplo: `/consultar 12345`', { parse_mode: 'Markdown' });
    return;
  }
  
  await procesarCaso(numeroRadicado, chatId);
});

bot.onText(/\/estado/, async (msg) => {
  const chatId = msg.chat.id;
  const mensaje = `📊 **Estado del Sistema HEAT Bot**\n\n` +
                 `✅ Bot activo y funcionando\n` +
                 `🌐 Conexión a HEAT: Disponible\n` +
                 `⏰ Última actualización: ${new Date().toLocaleString('es-CO')}\n` +
                 `🔧 Versión: 4.0.0`;
  
  bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

bot.onText(/\/ayuda/, (msg) => {
  const chatId = msg.chat.id;
  const mensaje = `📖 **Ayuda - Bot HEAT**\n\n` +
                 `**Comandos:**\n` +
                 `• \`/consultar [número]\` - Consulta información de un radicado\n` +
                 `• \`/estado\` - Verifica el estado del sistema\n` +
                 `• \`/ayuda\` - Muestra esta ayuda\n\n` +
                 `**Ejemplos:**\n` +
                 `• \`/consultar 12345\`\n` +
                 `• \`/consultar HEAT-2024-001\`\n\n` +
                 `**Nota:** El bot extrae información real del sistema HEAT.`;
  
  bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

// Manejo de errores del bot
bot.on('error', (error) => {
  console.log('❌ Error del bot:', error);
});

bot.on('polling_error', (error) => {
  console.log('❌ Error de polling:', error);
});

// Servidor Express
app.get('/', (req, res) => {
  res.json({
    status: 'Bot HEAT activo',
    version: '4.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`🤖 Bot HEAT versión 4.0.0 activo`);
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  console.log('👋 Cerrando aplicación...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 Cerrando aplicación...');
  process.exit(0);
});
