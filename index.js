const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = require('docx');

// Configuración desde variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HEAT_USERNAME = process.env.HEAT_USERNAME;
const HEAT_PASSWORD = process.env.HEAT_PASSWORD;

// Validar variables de entorno
if (!TELEGRAM_TOKEN || !HEAT_USERNAME || !HEAT_PASSWORD) {
    console.error('❌ ERROR: Variables de entorno faltantes');
    console.log('TELEGRAM_TOKEN:', TELEGRAM_TOKEN ? '✅ Configurado' : '❌ Faltante');
    console.log('HEAT_USERNAME:', HEAT_USERNAME ? '✅ Configurado' : '❌ Faltante');
    console.log('HEAT_PASSWORD:', HEAT_PASSWORD ? '✅ Configurado' : '❌ Faltante');
    process.exit(1);
}

console.log('🚀 Iniciando bot con variables configuradas correctamente');

// Crear instancia del bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Función para extraer datos de HEAT con debug mejorado
async function extraerDatosHEAT(numeroCase) {
    let browser;
    let page;
    
    try {
        console.log(`🔍 Iniciando extracción para caso: ${numeroCase}`);
        
        // Configuración de Puppeteer optimizada
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            executablePath: '/usr/bin/chromium-browser'
        });

        page = await browser.newPage();
        
        // Configurar viewport y headers
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log('🌐 Navegando a HEAT...');
        
        // Navegar a HEAT con timeout extendido
        await page.goto('https://judit.ramajudicial.gov.co/HEAT/', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        
        console.log('🔐 Intentando login...');
        
        // Esperar a que aparezcan los campos de login
        await page.waitForSelector('#txtuserId', { timeout: 30000 });
        await page.waitForSelector('#txtpassword', { timeout: 30000 });
        
        // Realizar login
        await page.type('#txtuserId', HEAT_USERNAME, { delay: 100 });
        await page.type('#txtpassword', HEAT_PASSWORD, { delay: 100 });
        
        // Click en botón de login y esperar navegación
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }),
            page.click('#btnlogon')
        ]);
        
        console.log('✅ Login exitoso');
        
        // Verificar si llegamos al dashboard
        const currentUrl = page.url();
        console.log('📍 URL actual:', currentUrl);
        
        if (currentUrl.includes('login') || currentUrl.includes('error')) {
            throw new Error('Login fallido - verificar credenciales');
        }
        
        console.log(`🔎 Buscando caso: ${numeroCase}`);
        
        // Buscar el caso (adaptado a la interfaz de HEAT)
        const searchSelector = 'input[type="text"][placeholder*="buscar"], input[type="search"], #searchBox, .search-input';
        
        try {
            await page.waitForSelector(searchSelector, { timeout: 15000 });
            await page.type(searchSelector, numeroCase, { delay: 100 });
            await page.keyboard.press('Enter');
            
            // Esperar resultados
            await page.waitForTimeout(3000);
            
        } catch (searchError) {
            console.log('⚠️ No se encontró buscador estándar, intentando navegación directa...');
            
            // Intentar navegar directamente al caso
            const directUrl = `https://judit.ramajudicial.gov.co/HEAT/index.cfm?fuseaction=main.case&case_id=${numeroCase}`;
            await page.goto(directUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        }
        
        // Buscar información del caso en la página
        console.log('📄 Extrayendo información del caso...');
        
        const casoInfo = await page.evaluate((numeroCase) => {
            const extractText = (selector) => {
                const element = document.querySelector(selector);
                return element ? element.textContent.trim() : 'No encontrado';
            };
            
            // Buscar información básica del caso
            const info = {
                numero: numeroCase,
                cliente: extractText('[data-field="cliente"], .cliente, #cliente, .customer-name') ||
                        extractText('td:contains("Cliente")').nextSibling?.textContent?.trim() ||
                        'No encontrado',
                estado: extractText('[data-field="estado"], .estado, #estado, .status') ||
                       extractText('td:contains("Estado")').nextSibling?.textContent?.trim() ||
                       'No encontrado',
                descripcion: extractText('[data-field="descripcion"], .descripcion, #descripcion, .description') ||
                           extractText('textarea[name*="descripcion"], textarea[name*="description"]') ||
                           'No encontrado',
                fechaCreacion: extractText('[data-field="fecha"], .fecha, #fecha, .date-created') ||
                              extractText('td:contains("Fecha")').nextSibling?.textContent?.trim() ||
                              'No encontrado',
                asignadoA: extractText('[data-field="asignado"], .asignado, #asignado, .assigned-to') ||
                          extractText('td:contains("Asignado")').nextSibling?.textContent?.trim() ||
                          'No encontrado',
                prioridad: extractText('[data-field="prioridad"], .prioridad, #prioridad, .priority') ||
                          extractText('td:contains("Prioridad")').nextSibling?.textContent?.trim() ||
                          'No encontrado'
            };
            
            return info;
        }, numeroCase);
        
        console.log('📊 Información extraída:', casoInfo);
        
        return casoInfo;
        
    } catch (error) {
        console.error('❌ Error durante extracción:', error.message);
        console.error('Stack:', error.stack);
        
        // Tomar screenshot para debug si es posible
        if (page) {
            try {
                await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
                console.log('📸 Screenshot guardado para debug');
            } catch (screenshotError) {
                console.log('⚠️ No se pudo tomar screenshot');
            }
        }
        
        throw error;
        
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔄 Browser cerrado');
        }
    }
}

// Función para generar documento Word
async function generarDocumentoWord(casoInfo) {
    try {
        console.log('📝 Generando documento Word...');
        
        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "REPORTE DE CASO HEAT",
                                bold: true,
                                size: 32
                            })
                        ]
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: "", break: 2 })]
                    }),
                    new Table({
                        width: {
                            size: 100,
                            type: WidthType.PERCENTAGE,
                        },
                        rows: [
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Número de Caso:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.numero })] })]
                                    })
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Cliente:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.cliente })] })]
                                    })
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Estado:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.estado })] })]
                                    })
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Descripción:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.descripcion })] })]
                                    })
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Fecha Creación:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.fechaCreacion })] })]
                                    })
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Asignado A:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.asignadoA })] })]
                                    })
                                ]
                            }),
                            new TableRow({
                                children: [
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: "Prioridad:", bold: true })] })]
                                    }),
                                    new TableCell({
                                        children: [new Paragraph({ children: [new TextRun({ text: casoInfo.prioridad })] })]
                                    })
                                ]
                            })
                        ]
                    })
                ]
            }]
        });
        
        const buffer = await Packer.toBuffer(doc);
        const fileName = `/tmp/Caso_${casoInfo.numero.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
        
        fs.writeFileSync(fileName, buffer);
        console.log('✅ Documento generado:', fileName);
        
        return fileName;
        
    } catch (error) {
        console.error('❌ Error generando documento:', error);
        throw error;
    }
}

// Validar formato de número de caso
function validarFormatoCase(texto) {
    const formatoValido = /^(INC|REQ)-\d+$/i;
    return formatoValido.test(texto.trim());
}

// Manejadores de mensajes del bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`👋 Usuario ${chatId} inició el bot`);
    
    bot.sendMessage(chatId, 
        '🤖 *Bot HEAT - Reporte de Casos*\n\n' +
        '📋 Envíame el número de un caso en formato:\n' +
        '• INC-123456\n' +
        '• REQ-123456\n\n' +
        '🔄 Procesaré el caso y te enviaré un documento Word con toda la información.',
        { parse_mode: 'Markdown' }
    );
});

// Procesar mensajes de casos
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const texto = msg.text;
    
    // Ignorar comandos y mensajes vacíos
    if (!texto || texto.startsWith('/')) return;
    
    console.log(`📨 Mensaje recibido de ${chatId}: ${texto}`);
    
    // Validar formato
    if (!validarFormatoCase(texto)) {
        bot.sendMessage(chatId,
            '❌ *Formato inválido*\n\n' +
            '✅ Formato correcto:\n' +
            '• INC-123456\n' +
            '• REQ-123456',
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    const numeroCase = texto.trim().toUpperCase();
    
    try {
        // Mensaje de procesamiento
        await bot.sendMessage(chatId, 
            `🔍 Procesando ${numeroCase}...\n` +
            `Por favor espera unos momentos.`,
            { parse_mode: 'Markdown' }
        );
        
        console.log(`🔄 Procesando caso: ${numeroCase}`);
        
        // Extraer datos de HEAT
        const casoInfo = await extraerDatosHEAT(numeroCase);
        
        // Generar documento Word
        const archivoWord = await generarDocumentoWord(casoInfo);
        
        // Enviar documento
        await bot.sendDocument(chatId, archivoWord, {
            caption: `✅ *Reporte generado*\n\n📋 Caso: ${numeroCase}\n👤 Cliente: ${casoInfo.cliente}\n📊 Estado: ${casoInfo.estado}`,
            parse_mode: 'Markdown'
        });
        
        // Limpiar archivo temporal
        fs.unlinkSync(archivoWord);
        console.log(`✅ Caso ${numeroCase} procesado exitosamente`);
        
    } catch (error) {
        console.error(`❌ Error procesando ${numeroCase}:`, error.message);
        
        let mensajeError = '❌ *Error al procesar el caso*\n\n';
        
        if (error.message.includes('Login fallido')) {
            mensajeError += '🔐 Problema de autenticación con HEAT\n• Verificar credenciales\n• Sesión expirada';
        } else if (error.message.includes('timeout')) {
            mensajeError += '⏱️ Tiempo de espera agotado\n• Servidor lento\n• Problema de conexión';
        } else if (error.message.includes('not found')) {
            mensajeError += '🔍 Caso no encontrado\n• Verificar número de caso\n• Caso no existe';
        } else {
            mensajeError += `🔧 Error técnico:\n${error.message}`;
        }
        
        mensajeError += '\n\n🔄 Intenta nuevamente en unos minutos.';
        
        await bot.sendMessage(chatId, mensajeError, { parse_mode: 'Markdown' });
    }
});

// Manejador de errores del bot
bot.on('polling_error', (error) => {
    console.error('❌ Error de polling:', error.message);
});

// Servidor web básico para Railway
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.json({
        status: 'Bot HEAT activo',
        timestamp: new Date().toISOString(),
        variables: {
            telegram: TELEGRAM_TOKEN ? 'Configurado' : 'Faltante',
            heat_user: HEAT_USERNAME ? 'Configurado' : 'Faltante',
            heat_pass: HEAT_PASSWORD ? 'Configurado' : 'Faltante'
        }
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor activo en puerto ${PORT}`);
    console.log('🤖 Bot HEAT iniciado correctamente');
});

// Manejo de cierre graceful
process.on('SIGINT', () => {
    console.log('🛑 Cerrando bot...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Cerrando bot por SIGTERM...');
    bot.stopPolling();
    process.exit(0);
});
