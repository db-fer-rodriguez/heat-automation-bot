const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Configuración
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const HEAT_USERNAME = process.env.HEAT_USERNAME;
const HEAT_PASSWORD = process.env.HEAT_PASSWORD;
const PORT = process.env.PORT || 3000;

// Validar variables de entorno
if (!BOT_TOKEN) {
    console.error('❌ Error: TELEGRAM_TOKEN no está configurado');
    process.exit(1);
}

console.log('🚀 Iniciando Bot HEAT - Versión Corregida...');

// Crear bot de Telegram
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Crear servidor Express
const app = express();
app.use(express.json());



// Función mejorada para extraer información de HEAT
async function extraerInformacionHEAT(numeroCaso) {
    let browser = null;
    
    try {
        console.log('🔐 Iniciando navegador para HEAT...');
        
        browser = await puppeteer.launch({
            headless: "new", // Usar nueva versión headless
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        
        // Configurar timeouts más largos
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
        
        console.log('🌐 Navegando a HEAT...');
        
        // URLs posibles de HEAT
        const heatUrls = [
            'https://heat.actas.com.co',
            'https://heat.actas.com.co/login',
            'https://heat.actas.com.co/Login.aspx',
            'http://heat.actas.com.co'
        ];
        
        let loginSuccessful = false;
        
        for (const url of heatUrls) {
            try {
                console.log(`🔗 Probando URL: ${url}`);
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
                
                // Buscar diferentes selectores de login
                const loginSelectors = [
                    '#ctl00_ContentPlaceHolder1_txtUsuario',
                    'input[name*="usuario"]',
                    'input[type="text"]',
                    '#txtUsuario',
                    '.login-input'
                ];
                
                for (const selector of loginSelectors) {
                    try {
                        await page.waitForSelector(selector, { timeout: 5000 });
                        console.log(`✅ Encontrado selector de login: ${selector}`);
                        loginSuccessful = true;
                        break;
                    } catch (e) {
                        continue;
                    }
                }
                
                if (loginSuccessful) break;
                
            } catch (error) {
                console.log(`❌ Error con URL ${url}:`, error.message);
                continue;
            }
        }
        
        if (!loginSuccessful) {
            throw new Error('No se pudo acceder al sistema HEAT');
        }
        
        // Realizar login si tenemos credenciales
        if (HEAT_USERNAME && HEAT_PASSWORD) {
            console.log('🔐 Realizando login...');
            
            // Buscar campos de usuario y contraseña
            const userField = await page.$('input[name*="usuario"], input[type="text"], #txtUsuario');
            const passField = await page.$('input[name*="password"], input[type="password"], #txtPassword');
            
            if (userField && passField) {
                await userField.type(HEAT_USERNAME);
                await passField.type(HEAT_PASSWORD);
                
                // Buscar botón de login
                const loginButton = await page.$('input[type="submit"], button[type="submit"], .login-btn');
                if (loginButton) {
                    await loginButton.click();
                    await page.waitForNavigation({ waitUntil: 'networkidle2' });
                }
            }
        }
        
        // Buscar el caso real en HEAT
        console.log(`🔍 Buscando caso: ${numeroCaso}`);
        
        // Navegar a la página de búsqueda de casos
        const searchUrl = page.url().includes('/Main.aspx') ? page.url() : 
                         page.url().replace(/\/[^\/]*$/, '/Main.aspx');
        
        if (!page.url().includes('Main.aspx')) {
            await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        }
        
        // Buscar campo de búsqueda de casos
        const searchSelectors = [
            'input[name*="search"]',
            'input[placeholder*="caso"]',
            'input[placeholder*="ticket"]',
            '#txtSearch',
            '.search-input'
        ];
        
        let searchField = null;
        for (const selector of searchSelectors) {
            try {
                searchField = await page.$(selector);
                if (searchField) {
                    console.log(`✅ Campo de búsqueda encontrado: ${selector}`);
                    break;
                }
            } catch (e) {
                continue;
            }
        }
        
        if (!searchField) {
            throw new Error('No se encontró el campo de búsqueda en HEAT');
        }
        
        // Limpiar campo y escribir número de caso
        await searchField.click({ clickCount: 3 }); // Seleccionar todo
        await searchField.type(numeroCaso);
        
        // Buscar botón de búsqueda
        const searchButton = await page.$('input[type="submit"][value*="Buscar"], button[type="submit"], .search-btn');
        if (searchButton) {
            await searchButton.click();
        } else {
            await searchField.press('Enter');
        }
        
        // Esperar resultados
        await page.waitForTimeout(3000);
        
        // Buscar el caso en los resultados
        const caseLinks = await page.$('a[href*="ViewCase"], a[href*="Case"], tr td a');
        let caseFound = false;
        
        for (const link of caseLinks) {
            const linkText = await page.evaluate(el => el.textContent, link);
            if (linkText && linkText.includes(numeroCaso)) {
                console.log(`✅ Caso encontrado, abriendo: ${numeroCaso}`);
                await link.click();
                await page.waitForNavigation({ waitUntil: 'networkidle2' });
                caseFound = true;
                break;
            }
        }
        
        if (!caseFound) {
            throw new Error(`Caso ${numeroCaso} no encontrado en el sistema HEAT`);
        }
        
        // Extraer información real del caso
        console.log('📊 Extrayendo datos del caso...');
        
        const datos = await page.evaluate((caseNum) => {
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
                numeroCaso: caseNum,
                cliente: extractText([
                    'input[name*="cliente"]', 
                    'input[name*="customer"]',
                    'span[id*="cliente"]',
                    'td:contains("Cliente") + td',
                    '[data-field="cliente"]'
                ]) || 'No especificado',
                
                ubicacion: extractText([
                    'input[name*="ubicacion"]',
                    'input[name*="location"]', 
                    'input[name*="site"]',
                    'span[id*="ubicacion"]',
                    '[data-field="ubicacion"]'
                ]) || 'No especificado',
                
                equipo: extractText([
                    'input[name*="equipo"]',
                    'input[name*="equipment"]',
                    'textarea[name*="equipo"]',
                    'span[id*="equipo"]',
                    '[data-field="equipo"]'
                ]) || 'No especificado',
                
                modelo: extractText([
                    'input[name*="modelo"]',
                    'input[name*="model"]',
                    'span[id*="modelo"]',
                    '[data-field="modelo"]'
                ]) || 'No especificado',
                
                serie: extractText([
                    'input[name*="serie"]',
                    'input[name*="serial"]',
                    'span[id*="serie"]',
                    '[data-field="serie"]'
                ]) || 'No especificado',
                
                diagnostico: extractText([
                    'textarea[name*="diagnostico"]',
                    'textarea[name*="diagnosis"]',
                    'textarea[name*="descripcion"]',
                    'textarea[name*="description"]',
                    'div[id*="diagnostico"]'
                ]) || 'No especificado',
                
                solucion: extractText([
                    'textarea[name*="solucion"]',
                    'textarea[name*="solution"]',
                    'textarea[name*="resolucion"]',
                    'textarea[name*="resolution"]',
                    'div[id*="solucion"]'
                ]) || 'No especificado',
                
                fecha: extractText([
                    'input[name*="fecha"]',
                    'input[name*="date"]',
                    'span[id*="fecha"]'
                ]) || new Date().toLocaleDateString('es-CO'),
                
                estado: extractText([
                    'select[name*="estado"] option:checked',
                    'input[name*="status"]',
                    'span[id*="estado"]'
                ]) || 'No especificado',
                
                prioridad: extractText([
                    'select[name*="prioridad"] option:checked',
                    'select[name*="priority"] option:checked',
                    'span[id*="prioridad"]'
                ]) || 'No especificado'
            };
        }, numeroCaso);
        
        // Validar que se extrajo información útil
        const camposVacios = Object.entries(datos)
            .filter(([key, value]) => key !== 'numeroCaso' && (value === 'No especificado' || value === ''))
            .length;
            
        if (camposVacios === Object.keys(datos).length - 1) {
            throw new Error('No se pudo extraer información válida del caso. Verificar selectores de HEAT.');
        }
        
        // Agregar información del técnico
        datos.tecnico = 'Fernando Rodríguez Salamanca';
        
        console.log('✅ Información extraída exitosamente:', {
            caso: datos.numeroCaso,
            cliente: datos.cliente.substring(0, 20) + '...',
            camposExtraidos: Object.keys(datos).length
        });
        
        return datos;
        
    } catch (error) {
        console.error('❌ Error en extracción HEAT:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Función para generar documento de texto
async function generarDocumentoWord(datos) {
    try {
        console.log('📄 Generando reporte...');
        
        // Crear contenido del documento
        const contenido = `
═══════════════════════════════════════════════════════════════
                    REPORTE DE DIAGNÓSTICO TÉCNICO
═══════════════════════════════════════════════════════════════

INFORMACIÓN DEL CASO:
─────────────────────────────────────────────────────────────
• Número de Caso: ${datos.numeroCaso}
• Cliente: ${datos.cliente}
• Ubicación: ${datos.ubicacion}
• Fecha del Caso: ${datos.fecha}

INFORMACIÓN DEL EQUIPO:
─────────────────────────────────────────────────────────────
• Equipo: ${datos.equipo}
• Modelo: ${datos.modelo}
• Número de Serie: ${datos.serie}

DIAGNÓSTICO REALIZADO:
─────────────────────────────────────────────────────────────
${datos.diagnostico}

SOLUCIÓN APLICADA:
─────────────────────────────────────────────────────────────
${datos.solucion}

INFORMACIÓN DEL TÉCNICO:
─────────────────────────────────────────────────────────────
• Técnico Responsable: ${datos.tecnico}
• Fecha del Reporte: ${new Date().toLocaleDateString('es-CO')}
• Hora del Reporte: ${new Date().toLocaleTimeString('es-CO')}

═══════════════════════════════════════════════════════════════
Reporte generado automáticamente por Sistema Bot HEAT
Actas On Site - Soporte Técnico Especializado
═══════════════════════════════════════════════════════════════
        `;
        
        // Crear nombre de archivo único
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const nombreArchivo = `Reporte_${datos.numeroCaso}_${timestamp}.txt`;
        
        // Determinar ruta del archivo
        let rutaArchivo;
        try {
            // Intentar usar /tmp primero (común en sistemas Unix/Linux)
            rutaArchivo = path.join('/tmp', nombreArchivo);
            fs.writeFileSync(rutaArchivo, contenido, 'utf8');
        } catch (error) {
            // Si falla, usar directorio actual
            rutaArchivo = path.join(__dirname, nombreArchivo);
            fs.writeFileSync(rutaArchivo, contenido, 'utf8');
        }
        
        console.log('✅ Reporte generado exitosamente:', nombreArchivo);
        return rutaArchivo;
        
    } catch (error) {
        console.error('❌ Error generando reporte:', error);
        throw error;
    }
}

// Función principal para procesar caso
async function procesarCaso(numeroCaso, chatId) {
    try {
        console.log(`🔍 Procesando caso: ${numeroCaso}`);
        
        // Enviar mensaje de procesamiento
        await bot.sendMessage(chatId, '🔍 Extrayendo información del sistema HEAT...');
        
        // Extraer información
        const datos = await extraerInformacionHEAT(numeroCaso);
        
        // Validar que se extrajo información real
        if (!datos || datos.cliente === 'No especificado') {
            throw new Error(`No se pudo extraer información válida para el caso ${numeroCaso}. Verificar que el caso existe en HEAT.`);
        }
        
        // Generar documento
        await bot.sendMessage(chatId, '📄 Generando reporte...');
        const rutaArchivo = await generarDocumentoWord(datos);
        
        // Enviar archivo
        await bot.sendDocument(chatId, rutaArchivo, {
            caption: `📋 Reporte generado para caso: ${numeroCaso}\n🕒 ${new Date().toLocaleString('es-CO')}`
        });
        
        // Limpiar archivo temporal
        try {
            fs.unlinkSync(rutaArchivo);
        } catch (e) {
            console.log('⚠️ No se pudo eliminar archivo temporal:', e.message);
        }
        
        console.log('✅ Caso procesado exitosamente');
        
    } catch (error) {
        console.error('❌ Error procesando caso:', error);
        await bot.sendMessage(chatId, `❌ Error procesando caso ${numeroCaso}: ${error.message}`);
    }
}

// Manejadores de mensajes
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text) return;
    
    console.log(`📨 Mensaje recibido: ${text}`);
    
    // Comando de inicio
    if (text === '/start') {
        await bot.sendMessage(chatId, 
            '🤖 ¡Hola! Soy el Bot HEAT\n\n' +
            '📋 Envíame un número de caso (ej: REQ-361569) y generaré un reporte automáticamente.\n\n' +
            '🔧 Funciones disponibles:\n' +
            '• Extracción de información de HEAT\n' +
            '• Generación de reportes de diagnóstico\n' +
            '• Descarga automática de documentos'
        );
        return;
    }
    
    // Detectar número de caso
    const casePattern = /^(REQ|INC|CHG|PRB)-?\d+$/i;
    if (casePattern.test(text.trim())) {
        const numeroCaso = text.trim().toUpperCase();
        await procesarCaso(numeroCaso, chatId);
        return;
    }
    
    // Mensaje por defecto
    await bot.sendMessage(chatId, 
        '❓ No entiendo tu mensaje.\n\n' +
        '📝 Envía un número de caso válido (ej: REQ-361569)\n' +
        'o usa /start para ver las opciones disponibles.'
    );
});

// Manejo de errores
bot.on('error', (error) => {
    console.error('❌ Error del bot:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Error de polling:', error);
});

// Servidor web para Railway
app.get('/', (req, res) => {
    res.json({
        status: 'Bot HEAT funcionando',
        version: '3.1.0',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🌐 Servidor iniciado en puerto ${PORT}`);
});

// Mensaje de inicio
console.log(`Bot iniciado: @${bot.options.username || 'Actasonsite_bot'}`);
console.log('✅ Polling iniciado correctamente');
console.log('🚀 Bot COMPLETO funcionando correctamente - Versión Corregida');
