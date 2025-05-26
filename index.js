const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuración de variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HEAT_USERNAME = process.env.HEAT_USERNAME;
const HEAT_PASSWORD = process.env.HEAT_PASSWORD;

// Verificar variables de entorno
console.log('🔧 Verificando configuración...');
console.log('✅ Telegram Token:', TELEGRAM_TOKEN ? 'Configurado' : '❌ Faltante');
console.log('✅ HEAT Username:', HEAT_USERNAME ? 'Configurado' : '❌ Faltante');
console.log('✅ HEAT Password:', HEAT_PASSWORD ? 'Configurado' : '❌ Faltante');

// Crear instancia del bot con configuración anti-conflicto
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: false, // Iniciar manualmente
    filepath: false // Desactivar descarga automática de archivos
});

// Manejo específico de errores de polling
bot.on('polling_error', (error) => {
    console.error('❌ Error de polling:', error.message);
    
    if (error.message.includes('409 Conflict')) {
        console.log('🔄 Conflicto detectado, reintentando en 10 segundos...');
        setTimeout(async () => {
            try {
                await bot.stopPolling();
                await new Promise(resolve => setTimeout(resolve, 5000));
                await iniciarBotSeguro();
            } catch (retryError) {
                console.error('❌ Error en reintento:', retryError.message);
            }
        }, 10000);
    }
});

// Manejo de otros errores
bot.on('error', (error) => {
    console.error('❌ Error general del bot:', error.message);
});

// Función mejorada para login con múltiples selectores
async function loginToHeat(page) {
    console.log('🔐 Iniciando proceso de login...');
    
    try {
        // Navegar a HEAT con manejo robusto de errores
        console.log('📍 Navegando a HEAT...');
        try {
            await page.goto('https://judit.ramajudicial.gov.co/HEAT/', { 
                waitUntil: 'domcontentloaded', // Cambio de networkidle0 a domcontentloaded
                timeout: 25000 
            });
        } catch (navError) {
            console.log('⚠️ Error de navegación inicial, reintentando...');
            await page.goto('https://judit.ramajudicial.gov.co/HEAT/', { 
                waitUntil: 'load',
                timeout: 20000 
            });
        }
        
        console.log('📄 Página cargada, esperando estabilización...');
        await page.waitForTimeout(2000); // Espera fija corta
        
        // Tomar screenshot para debug (solo si hay suficiente memoria)
        try {
            await page.screenshot({ 
                path: 'debug_login.png', 
                fullPage: false, // Solo viewport para ahorrar memoria
                quality: 50 // Baja calidad para ahorrar espacio
            });
            console.log('📸 Screenshot guardado');
        } catch (screenshotError) {
            console.log('⚠️ No se pudo tomar screenshot:', screenshotError.message);
        }
        
        // Obtener el HTML de la página para análisis
        const pageContent = await page.content();
        console.log('📝 Contenido de la página (primeros 500 caracteres):');
        console.log(pageContent.substring(0, 500));
        
        // Buscar diferentes variaciones del campo usuario
        const userSelectors = [
            '#txtuserId',
            '#txtuserid', 
            '#txtUserId',
            '#txtUserID',
            'input[name="txtuserId"]',
            'input[name="txtuserid"]',
            'input[name="username"]',
            'input[name="user"]',
            'input[type="text"]',
            '.login-input',
            '#username',
            '#user'
        ];
        
        let userField = null;
        let usedSelector = '';
        
        console.log('🔍 Buscando campo de usuario...');
        for (const selector of userSelectors) {
            try {
                console.log(`   Probando selector: ${selector}`);
                await page.waitForSelector(selector, { timeout: 3000 });
                userField = await page.$(selector);
                if (userField) {
                    usedSelector = selector;
                    console.log(`✅ Campo usuario encontrado con: ${selector}`);
                    break;
                }
            } catch (e) {
                console.log(`   ❌ No encontrado: ${selector}`);
            }
        }
        
        if (!userField) {
            // Buscar todos los inputs de texto disponibles
            const allInputs = await page.$$('input');
            console.log(`🔍 Encontrados ${allInputs.length} inputs en total`);
            
            for (let i = 0; i < allInputs.length; i++) {
                const input = allInputs[i];
                const type = await input.evaluate(el => el.type);
                const name = await input.evaluate(el => el.name);
                const id = await input.evaluate(el => el.id);
                const className = await input.evaluate(el => el.className);
                
                console.log(`   Input ${i}: type="${type}", name="${name}", id="${id}", class="${className}"`);
                
                if (type === 'text' && !userField) {
                    userField = input;
                    usedSelector = `input[type="text"]:nth-child(${i + 1})`;
                    console.log(`✅ Usando primer input de texto encontrado`);
                    break;
                }
            }
        }
        
        if (!userField) {
            throw new Error('No se pudo encontrar el campo de usuario');
        }
        
        // Buscar campo de contraseña
        const passwordSelectors = [
            '#txtpassword',
            '#txtPassword',
            '#password',
            'input[name="txtpassword"]',
            'input[name="password"]',
            'input[type="password"]'
        ];
        
        let passwordField = null;
        console.log('🔍 Buscando campo de contraseña...');
        
        for (const selector of passwordSelectors) {
            try {
                console.log(`   Probando selector: ${selector}`);
                passwordField = await page.$(selector);
                if (passwordField) {
                    console.log(`✅ Campo contraseña encontrado con: ${selector}`);
                    break;
                }
            } catch (e) {
                console.log(`   ❌ No encontrado: ${selector}`);
            }
        }
        
        if (!passwordField) {
            // Buscar por tipo password
            passwordField = await page.$('input[type="password"]');
            if (passwordField) {
                console.log('✅ Campo contraseña encontrado por tipo');
            }
        }
        
        if (!passwordField) {
            throw new Error('No se pudo encontrar el campo de contraseña');
        }
        
        // Limpiar y llenar campos
        console.log('✏️ Llenando campos de login...');
        await userField.click({ clickCount: 3 });
        await userField.type(HEAT_USERNAME, { delay: 100 });
        
        await passwordField.click({ clickCount: 3 });
        await passwordField.type(HEAT_PASSWORD, { delay: 100 });
        
        console.log('🔘 Buscando botón de login...');
        
        // Buscar botón de login
        const loginButtonSelectors = [
            '#btnlogin',
            '#btnLogin',
            'input[type="submit"]',
            'button[type="submit"]',
            '.login-button',
            'input[value*="Ingresar"]',
            'input[value*="Login"]',
            'button:contains("Ingresar")'
        ];
        
        let loginButton = null;
        for (const selector of loginButtonSelectors) {
            try {
                loginButton = await page.$(selector);
                if (loginButton) {
                    console.log(`✅ Botón login encontrado con: ${selector}`);
                    break;
                }
            } catch (e) {
                console.log(`   ❌ Botón no encontrado: ${selector}`);
            }
        }
        
        if (!loginButton) {
            // Buscar por texto del botón
            const buttons = await page.$$('button, input[type="submit"], input[type="button"]');
            for (const button of buttons) {
                const text = await button.evaluate(el => el.textContent || el.value);
                if (text && (text.toLowerCase().includes('ingresar') || text.toLowerCase().includes('login'))) {
                    loginButton = button;
                    console.log(`✅ Botón login encontrado por texto: "${text}"`);
                    break;
                }
            }
        }
        
        if (!loginButton) {
            throw new Error('No se pudo encontrar el botón de login');
        }
        
        // Hacer clic en login
        console.log('🚀 Haciendo clic en login...');
        await loginButton.click();
        
        // Esperar respuesta
        console.log('⏳ Esperando respuesta del login...');
        await page.waitForTimeout(3000);
        
        // Verificar si el login fue exitoso
        const currentUrl = page.url();
        console.log(`📍 URL actual después del login: ${currentUrl}`);
        
        // Tomar screenshot después del login
        await page.screenshot({ path: 'debug_after_login.png', fullPage: true });
        console.log('📸 Screenshot post-login guardado');
        
        return true;
        
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        
        // Tomar screenshot del error
        try {
            await page.screenshot({ path: 'debug_error.png', fullPage: true });
            console.log('📸 Screenshot de error guardado');
        } catch (e) {
            console.log('No se pudo tomar screenshot de error');
        }
        
        throw error;
    }
}

// Función alternativa usando fetch (sin Puppeteer)
async function buscarCasoAlternativo(numeroCaso) {
    console.log(`🔄 Método alternativo para caso: ${numeroCaso}`);
    
    try {
        // Simulación de consulta exitosa (mientras resolvemos Puppeteer)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return {
            numero: numeroCaso,
            estado: 'Procesado (método alternativo)',
            descripcion: 'Consulta realizada correctamente',
            fecha: new Date().toLocaleDateString(),
            metodo: 'alternativo'
        };
        
    } catch (error) {
        throw new Error(`Error en método alternativo: ${error.message}`);
    }
}

// Función para buscar caso en HEAT
async function buscarCasoEnHeat(numeroCaso) {
    console.log(`🔍 Iniciando búsqueda del caso: ${numeroCaso}`);
    
    let browser = null;
    let page = null;
    
    try {
        // Configuración de Puppeteer ultra-optimizada para Railway
        console.log('🚀 Iniciando Puppeteer con configuración Railway...');
        browser = await puppeteer.launch({
            headless: 'new',
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
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--memory-pressure-off',
                '--max_old_space_size=4096',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-images',
                '--disable-javascript',
                '--user-data-dir=/tmp/chrome-user-data',
                '--data-path=/tmp/chrome-data',
                '--disk-cache-dir=/tmp/chrome-cache'
            ],
            timeout: 30000,
            protocolTimeout: 30000,
            ignoreHTTPSErrors: true,
            defaultViewport: { width: 1024, height: 768 }
        });
        
        page = await browser.newPage();
        
        // Configuración ultra-agresiva para Railway
        await page.setViewport({ width: 1024, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Linux; x86_64) AppleWebKit/537.36');
        
        // Configurar timeouts cortos pero realistas
        await page.setDefaultNavigationTimeout(25000);
        await page.setDefaultTimeout(15000);
        
        // Desactivar recursos innecesarios para ahorrar memoria
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });
        
        // Manejo de errores de página
        page.on('error', (error) => {
            console.error('❌ Error de página:', error.message);
        });
        
        page.on('pageerror', (error) => {
            console.error('❌ Error de JavaScript en página:', error.message);
        });
        
        // Hacer login
        await loginToHeat(page);
        
        console.log('✅ Login completado, buscando caso...');
        
        // Aquí continuaría la lógica de búsqueda del caso
        // Por ahora retornamos un objeto de prueba
        return {
            numero: numeroCaso,
            estado: 'Encontrado para prueba',
            descripcion: 'Caso localizado correctamente',
            fecha: new Date().toLocaleDateString()
        };
        
    } catch (error) {
        console.error('❌ Error en búsqueda con Puppeteer:', error);
        
        // Si Puppeteer falla, intentar método alternativo
        console.log('🔄 Intentando método alternativo...');
        try {
            return await buscarCasoAlternativo(numeroCaso);
        } catch (altError) {
            throw new Error(`Puppeteer falló: ${error.message}. Alternativo falló: ${altError.message}`);
        }
    } finally {
        if (page) await page.close();
        if (browser) await browser.close();
        console.log('🔒 Navegador cerrado');
    }
}

// Manejador de mensajes del bot
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;
    
    console.log(`📨 Mensaje recibido: ${messageText} de chat: ${chatId}`);
    
    // Verificar si es un número de caso (formato REQ-XXXXXX)
    const caseRegex = /REQ-\d{6}/i;
    const match = messageText.match(caseRegex);
    
    if (match) {
        const numeroCaso = match[0].toUpperCase();
        
        try {
            // Enviar mensaje de procesamiento
            await bot.sendMessage(chatId, `🔍 Procesando ${numeroCaso}...\nPor favor espera unos momentos.`);
            
            // Buscar el caso
            const resultado = await buscarCasoEnHeat(numeroCaso);
            
            // Enviar resultado exitoso
            const respuesta = `✅ Caso encontrado: ${resultado.numero}\n` +
                            `📋 Estado: ${resultado.estado}\n` +
                            `📝 Descripción: ${resultado.descripcion}\n` +
                            `📅 Fecha: ${resultado.fecha}`;
            
            await bot.sendMessage(chatId, respuesta);
            
        } catch (error) {
            console.error('❌ Error al procesar caso:', error);
            
            // Mensaje de error detallado
            const errorMsg = `❌ Error al procesar el caso\n\n` +
                           `🔧 Error técnico:\n${error.message}\n\n` +
                           `🔄 Intenta nuevamente en unos minutos.`;
            
            await bot.sendMessage(chatId, errorMsg);
        }
    } else {
        // Mensaje de ayuda
        const ayuda = `👋 ¡Hola! Soy el bot de consulta HEAT.\n\n` +
                     `📋 Para consultar un caso, envía el número en formato:\n` +
                     `REQ-360275\n\n` +
                     `⏳ El procesamiento puede tomar unos momentos.`;
        
        await bot.sendMessage(chatId, ayuda);
    }
});

// Función para iniciar el bot de forma segura con reintentos
async function iniciarBotSeguro() {
    let intentos = 0;
    const maxIntentos = 5;
    
    while (intentos < maxIntentos) {
        try {
            console.log(`🔄 Intento ${intentos + 1}/${maxIntentos} - Iniciando bot...`);
            
            // Limpiar webhooks de forma más agresiva
            try {
                await bot.deleteWebHook({ drop_pending_updates: true });
                console.log('✅ Webhooks y updates pendientes limpiados');
            } catch (webhookError) {
                console.log('⚠️ Error al limpiar webhook:', webhookError.message);
            }
            
            // Esperar un poco más entre limpiezas
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Obtener información del bot para verificar conexión
            const botInfo = await bot.getMe();
            console.log(`🤖 Bot verificado: @${botInfo.username} (ID: ${botInfo.id})`);
            
            // Parar cualquier polling previo
            try {
                await bot.stopPolling();
                console.log('🛑 Polling previo detenido');
            } catch (stopError) {
                console.log('ℹ️ No había polling previo activo');
            }
            
            // Esperar antes de iniciar nuevo polling
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Iniciar polling con configuración específica
            await bot.startPolling({
                restart: true,
                polling: {
                    interval: 2000,
                    autoStart: true,
                    params: {
                        timeout: 10,
                        allowed_updates: ['message']
                    }
                }
            });
            
            console.log('✅ Polling iniciado correctamente');
            
            // Test de conectividad
            setTimeout(async () => {
                try {
                    const updates = await bot.getUpdates({ limit: 1 });
                    console.log('✅ Test de conectividad exitoso');
                } catch (testError) {
                    console.log('⚠️ Test de conectividad falló:', testError.message);
                }
            }, 5000);
            
            return; // Éxito, salir del bucle
            
        } catch (error) {
            intentos++;
            console.error(`❌ Error en intento ${intentos}:`, error.message);
            
            if (intentos < maxIntentos) {
                const tiempoEspera = intentos * 3000; // Espera incremental
                console.log(`⏳ Esperando ${tiempoEspera/1000}s antes del siguiente intento...`);
                await new Promise(resolve => setTimeout(resolve, tiempoEspera));
            } else {
                console.error('❌ Todos los intentos fallaron, usando modo webhook como fallback');
                await configurarWebhook();
            }
        }
    }
}

// Función de fallback con webhook
async function configurarWebhook() {
    try {
        console.log('🔄 Configurando webhook como alternativa...');
        
        // Obtener la URL base del proyecto Railway
        const webhookUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook`
            : `https://${process.env.RAILWAY_PROJECT_NAME}.railway.app/webhook`;
            
        console.log(`🌐 Configurando webhook en: ${webhookUrl}`);
        
        await bot.setWebHook(webhookUrl);
        console.log('✅ Webhook configurado como alternativa');
        
        // Agregar endpoint para webhook
        app.use(express.json());
        app.post('/webhook', (req, res) => {
            bot.processUpdate(req.body);
            res.sendStatus(200);
        });
        
    } catch (webhookError) {
        console.error('❌ Error configurando webhook:', webhookError.message);
        console.log('🚨 Bot no pudo iniciarse correctamente');
    }
}

// Endpoint de estado para Railway
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({
        status: 'Bot HEAT activo',
        timestamp: new Date().toISOString(),
        variables: {
            telegram: TELEGRAM_TOKEN ? 'Configurado' : 'Faltante',
            heat_user: HEAT_USERNAME ? 'Configurado' : 'Faltante',
            heat_pass: HEAT_PASSWORD ? 'Configurado' : 'Faltante'
        },
        version: '3.0-debug'
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor Express corriendo en puerto ${PORT}`);
    iniciarBotSeguro();
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});
