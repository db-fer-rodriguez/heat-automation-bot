const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuración del bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Configuración del servidor Express
const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno para HEAT
const HEAT_URL = process.env.HEAT_URL || 'https://heat.actas.com.co';
const HEAT_USERNAME = process.env.HEAT_USERNAME;
const HEAT_PASSWORD = process.env.HEAT_PASSWORD;

console.log('🤖 Bot iniciado:', bot.options.username || '@Actasonsite_bot');

// Configuración de Puppeteer optimizada para Railway
const getPuppeteerConfig = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    
    const config = {
        headless: 'new', // Usar el nuevo modo headless
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Importante para Railway
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--disable-prompt-on-repost',
            '--disable-hang-monitor',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-domain-reliability'
        ],
        timeout: 60000, // Timeout más largo
        ignoreDefaultArgs: ['--disable-extensions'],
        ignoreHTTPSErrors: true
    };

    // En producción (Railway), usar configuración específica
    if (isProduction) {
        config.executablePath = '/usr/bin/google-chrome-stable';
        config.args.push('--disable-web-security');
        config.args.push('--allow-running-insecure-content');
    }

    return config;
};

// Función mejorada para extraer información de HEAT
async function extraerInformacionHEAT(numeroCaso) {
    let browser = null;
    let page = null;
    
    try {
        console.log('🔐 Iniciando navegador para HEAT...');
        
        // Configuración específica para Railway
        const puppeteerConfig = getPuppeteerConfig();
        
        // Inicializar browser con reintentos
        let browserAttempts = 0;
        const maxBrowserAttempts = 3;
        
        while (browserAttempts < maxBrowserAttempts) {
            try {
                browser = await puppeteer.launch(puppeteerConfig);
                break;
            } catch (error) {
                browserAttempts++;
                console.log(`❌ Intento ${browserAttempts} fallido para iniciar browser:`, error.message);
                
                if (browserAttempts >= maxBrowserAttempts) {
                    throw new Error(`No se pudo inicializar el navegador después de ${maxBrowserAttempts} intentos`);
                }
                
                // Esperar antes del siguiente intento
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log('✅ Navegador iniciado correctamente');
        
        // Crear página con configuración optimizada
        page = await browser.newPage();
        
        // Configurar la página
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Configurar timeouts más largos
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(30000);

        console.log('🌐 Navegando a HEAT...');
        
        // URLs posibles de HEAT
        const possibleUrls = [
            `${HEAT_URL}/login.aspx`,
            `${HEAT_URL}/Login.aspx`,
            `${HEAT_URL}/default.aspx`,
            `${HEAT_URL}/Default.aspx`,
            `${HEAT_URL}/main.aspx`,
            `${HEAT_URL}/Main.aspx`,
            HEAT_URL
        ];

        let loginSuccess = false;
        let currentUrl = '';

        // Intentar cada URL hasta encontrar una que funcione
        for (const url of possibleUrls) {
            try {
                console.log(`🔗 Intentando URL: ${url}`);
                
                const response = await page.goto(url, { 
                    waitUntil: 'networkidle0',
                    timeout: 30000 
                });
                
                if (response && response.ok()) {
                    currentUrl = url;
                    console.log(`✅ Conexión exitosa a: ${url}`);
                    break;
                }
            } catch (error) {
                console.log(`❌ Falló URL ${url}:`, error.message);
                continue;
            }
        }

        if (!currentUrl) {
            throw new Error('No se pudo conectar a ninguna URL de HEAT');
        }

        // Buscar campos de login con múltiples selectores posibles
        const loginSelectors = [
            '#ctl00_ContentPlaceHolder1_txtUsuario',
            '#txtUsuario',
            'input[name*="Usuario"]',
            'input[name*="username"]',
            'input[type="text"]'
        ];

        const passwordSelectors = [
            '#ctl00_ContentPlaceHolder1_txtPassword',
            '#txtPassword',
            'input[name*="Password"]',
            'input[name*="password"]',
            'input[type="password"]'
        ];

        let usernameField = null;
        let passwordField = null;

        // Buscar campo de usuario
        for (const selector of loginSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                usernameField = selector;
                console.log(`✅ Campo usuario encontrado: ${selector}`);
                break;
            } catch (error) {
                continue;
            }
        }

        // Buscar campo de contraseña
        for (const selector of passwordSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                passwordField = selector;
                console.log(`✅ Campo contraseña encontrado: ${selector}`);
                break;
            } catch (error) {
                continue;
            }
        }

        if (!usernameField || !passwordField) {
            // Tomar screenshot para debugging
            await page.screenshot({ path: '/tmp/heat_login_error.png', fullPage: true });
            throw new Error('No se encontraron los campos de login en HEAT');
        }

        console.log('🔐 Iniciando sesión en HEAT...');
        
        // Llenar credenciales
        await page.type(usernameField, HEAT_USERNAME);
        await page.type(passwordField, HEAT_PASSWORD);

        // Buscar botón de login
        const loginButtonSelectors = [
            '#ctl00_ContentPlaceHolder1_btnIngresar',
            '#btnIngresar',
            'input[value*="Ingresar"]',
            'input[value*="Login"]',
            'button[type="submit"]',
            'input[type="submit"]'
        ];

        let loginButton = null;
        for (const selector of loginButtonSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                loginButton = selector;
                console.log(`✅ Botón login encontrado: ${selector}`);
                break;
            } catch (error) {
                continue;
            }
        }

        if (!loginButton) {
            throw new Error('No se encontró el botón de login');
        }

        // Hacer clic en login
        await page.click(loginButton);
        
        // Esperar a que cargue la página principal
        try {
            await page.waitForNavigation({ 
                waitUntil: 'networkidle0', 
                timeout: 30000 
            });
            console.log('✅ Login exitoso');
        } catch (error) {
            console.log('⚠️ Navegación lenta, continuando...');
        }

        // Buscar el caso específico
        console.log(`🔍 Buscando caso: ${numeroCaso}`);
        
        // Buscar campo de búsqueda
        const searchSelectors = [
            'input[name*="search"]',
            'input[name*="caso"]',
            'input[name*="ticket"]',
            'input[placeholder*="buscar"]',
            'input[type="text"]'
        ];

        let searchField = null;
        for (const selector of searchSelectors) {
            try {
                const elements = await page.$$(selector);
                if (elements.length > 0) {
                    searchField = selector;
                    console.log(`✅ Campo búsqueda encontrado: ${selector}`);
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (searchField) {
            await page.type(searchField, numeroCaso);
            await page.keyboard.press('Enter');
            
            // Esperar resultados
            await page.waitForTimeout(3000);
        }

        // Extraer información del caso
        console.log('📊 Extrayendo información del caso...');
        
        const datos = await page.evaluate(() => {
            const extractText = (selectors) => {
                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        return element.textContent?.trim() || element.value?.trim() || '';
                    }
                }
                return '';
            };

            return {
                numero: extractText(['input[name*="numero"]', '[id*="numero"]', '[class*="case-number"]']),
                cliente: extractText(['input[name*="cliente"]', '[id*="cliente"]', '[class*="client"]']),
                ubicacion: extractText(['input[name*="ubicacion"]', '[id*="site"]', '[class*="location"]']),
                equipo: extractText(['input[name*="equipo"]', '[id*="equipment"]', '[class*="device"]']),
                modelo: extractText(['input[name*="modelo"]', '[id*="model"]', '[class*="model"]']),
                serie: extractText(['input[name*="serie"]', '[id*="serial"]', '[class*="serial"]']),
                diagnostico: extractText(['textarea[name*="diagnostico"]', '[id*="diagnosis"]', '[class*="problem"]']),
                solucion: extractText(['textarea[name*="solucion"]', '[id*="solution"]', '[class*="resolution"]']),
                estado: extractText(['select[name*="estado"]', '[id*="status"]', '[class*="status"]']),
                prioridad: extractText(['select[name*="prioridad"]', '[id*="priority"]', '[class*="priority"]']),
                fecha: extractText(['input[name*="fecha"]', '[id*="date"]', '[class*="date"]'])
            };
        });

        // Validar que se extrajo información real
        const camposLlenos = Object.values(datos).filter(valor => valor && valor.length > 0).length;
        
        if (camposLlenos < 3) {
            throw new Error(`Solo se pudieron extraer ${camposLlenos} campos. Caso no encontrado o acceso denegado.`);
        }

        // Asegurar que el número de caso sea el correcto
        datos.numero = numeroCaso;
        datos.fechaExtraccion = new Date().toLocaleString('es-CO');

        console.log(`✅ Información extraída: ${camposLlenos} campos válidos`);
        return datos;

    } catch (error) {
        console.log('❌ Error en extracción HEAT:', error.message);
        throw error;
    } finally {
        // Limpiar recursos
        try {
            if (page) await page.close();
            if (browser) await browser.close();
        } catch (error) {
            console.log('⚠️ Error cerrando navegador:', error.message);
        }
    }
}

// Función para generar reporte
async function generarReporte(datos) {
    try {
        console.log('📄 Generando reporte...');
        
        const contenido = `
═══════════════════════════════════════════════════════════════
                    🔧 REPORTE TÉCNICO ACTAS
═══════════════════════════════════════════════════════════════

📋 INFORMACIÓN DEL CASO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Número de Caso: ${datos.numero || 'N/A'}
Cliente: ${datos.cliente || 'No especificado'}
Ubicación: ${datos.ubicacion || 'No especificada'}
Estado: ${datos.estado || 'N/A'}
Prioridad: ${datos.prioridad || 'N/A'}
Fecha: ${datos.fecha || 'N/A'}

🖥️ INFORMACIÓN DEL EQUIPO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Equipo: ${datos.equipo || 'No especificado'}
Modelo: ${datos.modelo || 'No especificado'}
No. Serie: ${datos.serie || 'No especificado'}

🔍 DIAGNÓSTICO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${datos.diagnostico || 'No especificado'}

✅ SOLUCIÓN APLICADA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${datos.solucion || 'No especificada'}

📊 INFORMACIÓN TÉCNICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Técnico: Sistema Automatizado ACTAS
Fecha Extracción: ${datos.fechaExtraccion}
Sistema: HEAT Service Management

═══════════════════════════════════════════════════════════════
                    ✅ REPORTE GENERADO EXITOSAMENTE
═══════════════════════════════════════════════════════════════
`;

        const fileName = `reporte_${datos.numero}_${Date.now()}.txt`;
        const filePath = `/tmp/${fileName}`;
        
        fs.writeFileSync(filePath, contenido);
        console.log(`✅ Reporte generado: ${fileName}`);
        
        return { filePath, fileName, contenido };
        
    } catch (error) {
        console.log('❌ Error generando reporte:', error.message);
        throw error;
    }
}

// Función principal para procesar caso
async function procesarCaso(numeroCaso, chatId) {
    try {
        console.log(`🚀 Procesando caso: ${numeroCaso}`);
        
        // Extraer información real de HEAT
        const datos = await extraerInformacionHEAT(numeroCaso);
        
        // Validar que se extrajo información real
        if (!datos || Object.keys(datos).length === 0) {
            throw new Error('No se pudo extraer información del caso');
        }

        // Generar reporte
        const reporte = await generarReporte(datos);
        
        // Enviar reporte
        await bot.sendDocument(chatId, reporte.filePath, {
            caption: `📄 Reporte generado para caso: ${numeroCaso}\n✅ Información extraída de HEAT`
        });

        console.log(`✅ Caso ${numeroCaso} procesado exitosamente`);
        return true;
        
    } catch (error) {
        console.log('❌ Error procesando caso:', error.message);
        await bot.sendMessage(chatId, 
            `❌ Error procesando caso ${numeroCaso}:\n${error.message}\n\n` +
            `🔧 Posibles causas:\n` +
            `• Caso no existe en HEAT\n` +
            `• Problemas de conectividad\n` +
            `• Credenciales incorrectas\n` +
            `• Sistema HEAT no disponible`
        );
        throw error;
    }
}

// Manejador de mensajes del bot
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const texto = msg.text;

    try {
        if (texto === '/start') {
            await bot.sendMessage(chatId, 
                '🤖 Bot HEAT ACTAS iniciado\n\n' +
                '📋 Envía un número de caso para generar el reporte\n' +
                'Ejemplo: REQ-123456\n\n' +
                '✅ Solo se procesan casos reales de HEAT'
            );
            return;
        }

        // Validar formato de caso
        const formatoCaso = /^[A-Z]{2,4}-\d{6}$/i;
        if (formatoCaso.test(texto)) {
            const numeroCaso = texto.toUpperCase();
            
            await bot.sendMessage(chatId, `🔍 Procesando caso: ${numeroCaso}\n⏳ Conectando a HEAT...`);
            
            await procesarCaso(numeroCaso, chatId);
        } else {
            await bot.sendMessage(chatId, 
                '❌ Formato de caso inválido\n\n' +
                '📝 Formato correcto: REQ-123456\n' +
                'Ejemplos válidos:\n' +
                '• REQ-123456\n' +
                '• INC-654321\n' +
                '• CHG-789012'
            );
        }
    } catch (error) {
        console.log('❌ Error en mensaje:', error.message);
        await bot.sendMessage(chatId, 
            `❌ Error interno del bot:\n${error.message}`
        );
    }
});

// Configurar servidor Express
app.get('/', (req, res) => {
    res.json({
        status: 'Bot HEAT ACTAS funcionando',
        version: '4.0.0',
        timestamp: new Date().toISOString(),
        features: [
            'Extracción real de HEAT',
            'Configuración optimizada para Railway',
            'Manejo robusto de errores',
            'Generación de reportes'
        ]
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor Express iniciado en puerto ${PORT}`);
    console.log('✅ Polling iniciado correctamente');
    console.log('🚀 Bot COMPLETO funcionando correctamente');
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.log('❌ Uncaught Exception:', error);
});

// Manejo de señales de terminación
process.on('SIGTERM', async () => {
    console.log('🔄 Recibida señal SIGTERM, cerrando bot...');
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Recibida señal SIGINT, cerrando bot...');
    process.exit(0);
});
