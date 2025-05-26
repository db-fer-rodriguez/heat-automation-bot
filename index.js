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

// Crear instancia del bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { 
    polling: {
        interval: 1000,
        autoStart: false,
        params: { timeout: 10 }
    }
});

// Función mejorada para login con múltiples selectores
async function loginToHeat(page) {
    console.log('🔐 Iniciando proceso de login...');
    
    try {
        // Navegar a HEAT
        console.log('📍 Navegando a HEAT...');
        await page.goto('https://judit.ramajudicial.gov.co/HEAT/', { 
            waitUntil: 'networkidle0',
            timeout: 60000 
        });
        
        console.log('📄 Página cargada, esperando formulario de login...');
        
        // Tomar screenshot para debug
        await page.screenshot({ path: 'debug_login.png', fullPage: true });
        console.log('📸 Screenshot guardado como debug_login.png');
        
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

// Función para buscar caso en HEAT
async function buscarCasoEnHeat(numeroCaso) {
    console.log(`🔍 Iniciando búsqueda del caso: ${numeroCaso}`);
    
    let browser = null;
    let page = null;
    
    try {
        // Configuración de Puppeteer optimizada para Railway
        console.log('🚀 Iniciando Puppeteer...');
        browser = await puppeteer.launch({
            headless: true,
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
                '--disable-renderer-backgrounding'
            ],
            timeout: 60000
        });
        
        page = await browser.newPage();
        
        // Configurar viewport y user agent
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Configurar timeouts más largos
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(30000);
        
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
        console.error('❌ Error en búsqueda:', error);
        throw error;
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

// Función para iniciar el bot de forma segura
async function iniciarBotSeguro() {
    try {
        console.log('🔄 Limpiando instancias previas...');
        
        // Limpiar webhooks
        await bot.deleteWebHook();
        console.log('✅ Webhooks limpiados');
        
        // Obtener información del bot
        const botInfo = await bot.getMe();
        console.log(`🤖 Bot iniciado: @${botInfo.username}`);
        
        // Iniciar polling
        await bot.startPolling();
        console.log('✅ Polling iniciado correctamente');
        
    } catch (error) {
        console.error('❌ Error al iniciar bot:', error);
        process.exit(1);
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
