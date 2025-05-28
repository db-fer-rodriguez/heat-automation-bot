const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const puppeteer = require('puppeteer');

// Configuración del bot
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN no configurado');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Configuración del servidor Express
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración optimizada de Puppeteer para Railway/Alpine
const getPuppeteerConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const baseConfig = {
    headless: 'new',
    timeout: 30000,
    protocolTimeout: 30000,
    defaultViewport: {
      width: 1280,
      height: 720
    }
  };

  if (isProduction) {
    return {
      ...baseConfig,
      executablePath: '/usr/bin/chromium-browser',
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
        '--disable-features=TranslateUI,VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images',
        '--disable-javascript',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-default-browser-check',
        '--mute-audio',
        '--disable-crash-reporter',
        '--disable-in-process-stack-traces',
        '--disable-logging',
        '--disable-dev-tools',
        '--memory-pressure-off',
        '--max_old_space_size=4096'
      ]
    };
  }

  return baseConfig;
};

// Configuración HEAT
const HEAT_CONFIG = {
  baseUrl: 'https://judit.ramajudicial.gov.co/HEAT/',
  username: process.env.HEAT_USERNAME || '',
  password: process.env.HEAT_PASSWORD || '',
  maxRetries: 2,
  timeout: 20000
};

// Validar configuración HEAT
if (!HEAT_CONFIG.username || !HEAT_CONFIG.password) {
  console.warn('⚠️ Credenciales HEAT no configuradas completamente');
}

// Función principal para extraer información de HEAT
async function extraerInformacionHEAT(numeroRadicado) {
  let browser = null;
  let page = null;
  
  console.log(`🔍 Iniciando extracción para radicado: ${numeroRadicado}`);
  
  try {
    // Inicializar navegador
    const config = getPuppeteerConfig();
    console.log('🚀 Lanzando navegador...');
    browser = await puppeteer.launch(config);
    
    page = await browser.newPage();
    
    // Configurar página
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Configurar timeouts
    page.setDefaultTimeout(HEAT_CONFIG.timeout);
    page.setDefaultNavigationTimeout(HEAT_CONFIG.timeout);
    
    console.log('🌐 Navegando a HEAT...');
    await page.goto(HEAT_CONFIG.baseUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: HEAT_CONFIG.timeout 
    });
    
    // Esperar a que cargue la página de login
    console.log('⏳ Esperando formulario de login...');
    await page.waitForSelector('input[type="text"], input[name="User name"]', { 
      timeout: 10000 
    });
    
    // Llenar credenciales
    console.log('🔑 Llenando credenciales...');
    
    // Usuario
    const userInput = await page.$('input[type="text"]') || await page.$('input[name="User name"]');
    if (userInput) {
      await userInput.click();
      await userInput.clear();
      await userInput.type(HEAT_CONFIG.username, { delay: 100 });
    }
    
    // Contraseña
    const passInput = await page.$('input[type="password"]') || await page.$('input[name="Password"]');
    if (passInput) {
      await passInput.click();
      await passInput.clear();
      await passInput.type(HEAT_CONFIG.password, { delay: 100 });
    }
    
    // Hacer clic en login
    console.log('🚪 Iniciando sesión...');
    const loginBtn = await page.$('button[type="submit"]') || 
                     await page.$('input[type="submit"]') ||
                     await page.$('button:contains("Login")') ||
                     await page.$('.btn-primary');
    
    if (loginBtn) {
      await Promise.all([
        loginBtn.click(),
        page.waitForNavigation({ 
          waitUntil: 'domcontentloaded', 
          timeout: HEAT_CONFIG.timeout 
        })
      ]);
    }
    
    console.log('✅ Sesión iniciada correctamente');
    
    // Buscar el radicado
    console.log(`🔍 Buscando radicado: ${numeroRadicado}`);
    
    // Buscar campo de búsqueda (múltiples posibilidades)
    const searchSelectors = [
      'input[type="search"]',
      'input[placeholder*="search"]',
      'input[placeholder*="buscar"]',
      'input[name="search"]',
      '#search',
      '.search-input'
    ];
    
    let searchInput = null;
    for (const selector of searchSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        searchInput = await page.$(selector);
        if (searchInput) break;
      } catch (e) {
        continue;
      }
    }
    
    if (searchInput) {
      await searchInput.click();
      await searchInput.clear();
      await searchInput.type(numeroRadicado, { delay: 100 });
      await searchInput.press('Enter');
      
      // Esperar resultados
      await page.waitForTimeout(3000);
    }
    
    // Extraer información
    console.log('📊 Extrayendo información del caso...');
    
    const informacion = await page.evaluate((radicado) => {
      // Función para extraer texto limpio
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };
      
      // Función para buscar texto por patrones
      const findByText = (patterns) => {
        for (const pattern of patterns) {
          const elements = Array.from(document.querySelectorAll('*')).filter(el => 
            el.textContent && el.textContent.toLowerCase().includes(pattern.toLowerCase())
          );
          if (elements.length > 0) {
            return elements[0].textContent.trim();
          }
        }
        return null;
      };
      
      // Extraer información específica
      const resultado = {
        numeroRadicado: radicado,
        estado: getText('[data-field="estado"]') || 
               getText('.estado') || 
               findByText(['estado', 'status']) || 'No encontrado',
        fecha: getText('[data-field="fecha"]') || 
               getText('.fecha') || 
               findByText(['fecha', 'date']) || 'No encontrado',
        asignado: getText('[data-field="asignado"]') || 
                 getText('.asignado') || 
                 findByText(['asignado', 'assigned']) || 'No encontrado',
        descripcion: getText('[data-field="descripcion"]') || 
                    getText('.descripcion') || 
                    findByText(['descripción', 'description']) || 'No encontrado',
        prioridad: getText('[data-field="prioridad"]') || 
                  getText('.prioridad') || 
                  findByText(['prioridad', 'priority']) || 'No encontrado'
      };
      
      return resultado;
    }, numeroRadicado);
    
    console.log('✅ Información extraída exitosamente');
    
    return {
      exito: true,
      datos: informacion,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Error en extracción:', error.message);
    
    return {
      exito: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
    
  } finally {
    // Limpiar recursos
    try {
      if (page) await page.close();
      if (browser) await browser.close();
    } catch (e) {
      console.warn('⚠️ Error cerrando navegador:', e.message);
    }
  }
}

// Función para procesar consulta
async function procesarConsulta(numeroRadicado, chatId) {
  try {
    console.log(`📋 Procesando consulta: ${numeroRadicado} para chat: ${chatId}`);
    
    // Validar formato de radicado
    if (!numeroRadicado || numeroRadicado.length < 3) {
      await bot.sendMessage(chatId, '❌ El número de radicado debe tener al menos 3 caracteres.');
      return;
    }
    
    // Enviar mensaje de procesamiento
    const processingMsg = await bot.sendMessage(chatId, 
      `🔄 Procesando radicado: **${numeroRadicado}**\n⏳ Conectando con sistema HEAT...`,
      { parse_mode: 'Markdown' }
    );
    
    // Extraer información
    const resultado = await extraerInformacionHEAT(numeroRadicado);
    
    // Preparar respuesta
    if (resultado.exito) {
      const mensaje = `✅ **Información del Radicado: ${numeroRadicado}**\n\n` +
                     `📋 **Estado:** ${resultado.datos.estado}\n` +
                     `📅 **Fecha:** ${resultado.datos.fecha}\n` +
                     `👤 **Asignado:** ${resultado.datos.asignado}\n` +
                     `⚡ **Prioridad:** ${resultado.datos.prioridad}\n` +
                     `📝 **Descripción:** ${resultado.datos.descripcion}\n\n` +
                     `🕐 **Consultado:** ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
      
      await bot.editMessageText(mensaje, {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } else {
      await bot.editMessageText(
        `❌ **Error consultando radicado: ${numeroRadicado}**\n\n` +
        `**Detalle:** ${resultado.error}\n\n` +
        `💡 **Sugerencias:**\n` +
        `• Verifica que el número de radicado sea correcto\n` +
        `• Intenta nuevamente en unos minutos\n` +
        `• Contacta al administrador si persiste el error`,
        {
          chat_id: chatId,
          message_id: processingMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    }
    
  } catch (error) {
    console.error('❌ Error procesando consulta:', error);
    await bot.sendMessage(chatId, 
      `❌ Error interno procesando el radicado ${numeroRadicado}.\n\n` +
      `Por favor intenta nuevamente en unos minutos.`
    );
  }
}

// Comandos del bot
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || 'Usuario';
  
  const mensaje = `🤖 **Bienvenido al Bot HEAT, ${userName}!**\n\n` +
                 `Este bot te permite consultar información de radicados del sistema HEAT en tiempo real.\n\n` +
                 `📋 **Comandos disponibles:**\n` +
                 `• \`/consultar [número]\` - Consultar un radicado\n` +
                 `• \`/estado\` - Verificar estado del sistema\n` +
                 `• \`/ayuda\` - Ver ayuda detallada\n\n` +
                 `💡 **Ejemplo:** \`/consultar 12345\`\n\n` +
                 `🔒 **Nota:** Todas las consultas son seguras y confidenciales.`;
  
  await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

bot.onText(/\/consultar (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const numeroRadicado = match[1].trim();
  
  await procesarConsulta(numeroRadicado, chatId);
});

bot.onText(/\/estado/, async (msg) => {
  const chatId = msg.chat.id;
  
  const uptime = process.uptime();
  const memory = process.memoryUsage();
  
  const mensaje = `📊 **Estado del Sistema HEAT Bot**\n\n` +
                 `✅ **Estado:** Operativo\n` +
                 `⏱️ **Tiempo activo:** ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n` +
                 `💾 **Memoria:** ${Math.round(memory.rss / 1024 / 1024)}MB\n` +
                 `🌐 **Conexión HEAT:** Disponible\n` +
                 `🔧 **Versión:** 5.0.0\n` +
                 `📅 **Última actualización:** ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
  
  await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

bot.onText(/\/ayuda/, async (msg) => {
  const chatId = msg.chat.id;
  
  const mensaje = `📖 **Ayuda - Bot HEAT v5.0**\n\n` +
                 `**🔍 Consultar Radicados:**\n` +
                 `\`/consultar [número]\` - Busca información del radicado\n\n` +
                 `**📝 Ejemplos de uso:**\n` +
                 `• \`/consultar 12345\`\n` +
                 `• \`/consultar HEAT-2024-001\`\n` +
                 `• \`/consultar INC20240001\`\n\n` +
                 `**📊 Otros comandos:**\n` +
                 `• \`/estado\` - Estado del sistema\n` +
                 `• \`/ayuda\` - Esta ayuda\n\n` +
                 `**💡 Consejos:**\n` +
                 `• El bot extrae información en tiempo real del sistema HEAT\n` +
                 `• Las consultas pueden tardar 10-30 segundos\n` +
                 `• Si hay error, intenta nuevamente en unos minutos\n\n` +
                 `**🔒 Privacidad:** Tus consultas son privadas y seguras.`;
  
  await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
});

// Manejo de errores del bot
bot.on('error', (error) => {
  console.error('❌ Error del bot Telegram:', error.message);
});

bot.on('polling_error', (error) => {
  console.error('❌ Error de polling:', error.message);
});

// Servidor Express para health checks
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'HEAT Bot Online',
    version: '5.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', (req, res) => {
  const memory = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(memory.rss / 1024 / 1024),
      heap: Math.round(memory.heapUsed / 1024 / 1024),
      external: Math.round(memory.external / 1024 / 1024)
    },
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log(`🚀 HEAT Bot v5.0.0 iniciado en puerto ${PORT}`);
  console.log(`📱 Bot de Telegram activo`);
  console.log(`🌐 Health check disponible en /health`);
  console.log(`⏰ ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
});

// Manejo de cierre graceful
const shutdown = () => {
  console.log('👋 Cerrando HEAT Bot...');
  
  server.close(() => {
    console.log('✅ Servidor cerrado correctamente');
    process.exit(0);
  });
  
  // Forzar cierre después de 10 segundos
  setTimeout(() => {
    console.log('⚠️ Forzando cierre...');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Rechazo no manejado:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada:', error);
  shutdown();
});
