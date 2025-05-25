const { Telegraf } = require('telegraf');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType } = require('docx');

// Configuración desde variables de entorno
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HEAT_USERNAME = process.env.HEAT_USERNAME;
const HEAT_PASSWORD = process.env.HEAT_PASSWORD;

// Crear bot de Telegram
const bot = new Telegraf(TELEGRAM_TOKEN);

// Función principal para extraer datos de HEAT
async function extraerDatosHEAT(numeroCaso) {
    let browser = null;
    
    try {
        console.log(`🔍 Iniciando extracción para caso: ${numeroCaso}`);
        
        // Determinar tipo de caso
        const tipoTicket = numeroCaso.startsWith('INC-') ? 'incidente' : 'solicitud';
        console.log(`📋 Tipo detectado: ${tipoTicket}`);
        
        // Lanzar navegador
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
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        console.log('🌐 Navegando a HEAT...');
        await page.goto('https://judit.ramajudicial.gov.co/HEAT/', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });
        
        // Hacer login
        console.log('🔐 Realizando login...');
        await page.waitForSelector('input[name="username"], #username, input[type="text"]', { timeout: 30000 });
        
        // Buscar campo de usuario (probando diferentes selectores)
        const usernameField = await page.$('input[name="username"]') || 
                             await page.$('#username') || 
                             await page.$('input[type="text"]');
        
        const passwordField = await page.$('input[name="password"]') || 
                             await page.$('#password') || 
                             await page.$('input[type="password"]');
        
        if (!usernameField || !passwordField) {
            throw new Error('No se encontraron los campos de login');
        }
        
        await usernameField.type(HEAT_USERNAME);
        await passwordField.type(HEAT_PASSWORD);
        
        // Buscar botón de login
        const loginButton = await page.$('button[type="submit"]') || 
                           await page.$('input[type="submit"]') ||
                           await page.$('button:contains("Ingresar")') ||
                           await page.$('button:contains("Login")');
        
        if (loginButton) {
            await loginButton.click();
        } else {
            await page.keyboard.press('Enter');
        }
        
        console.log('⏳ Esperando carga después del login...');
        await page.waitForTimeout(5000);
        
        // Seleccionar rol "Analista N2 SS"
        console.log('👤 Seleccionando rol...');
        await page.waitForTimeout(3000);
        
        // Buscar y hacer click en el rol (probando diferentes selectores)
        const roleSelectors = [
            'text=Analista N2 SS',
            '[data-role="Analista N2 SS"]',
            'option:contains("Analista N2 SS")',
            'li:contains("Analista N2 SS")',
            '.role-item:contains("Analista N2 SS")'
        ];
        
        let roleSelected = false;
        for (const selector of roleSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.click(selector);
                roleSelected = true;
                break;
            } catch (e) {
                continue;
            }
        }
        
        if (!roleSelected) {
            // Intentar con XPath
            const [roleElement] = await page.$x("//text()[contains(., 'Analista N2 SS')]/parent::*");
            if (roleElement) {
                await roleElement.click();
                roleSelected = true;
            }
        }
        
        await page.waitForTimeout(3000);
        
        // Navegar según tipo de ticket
        console.log(`📑 Navegando a sección ${tipoTicket}...`);
        
        if (tipoTicket === 'incidente') {
            const incidenteSelectors = [
                'text=INCIDENTE',
                '[data-tab="incidente"]',
                'a:contains("INCIDENTE")',
                '.tab:contains("INCIDENTE")'
            ];
            
            for (const selector of incidenteSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    await page.click(selector);
                    break;
                } catch (e) {
                    continue;
                }
            }
        } else {
            const solicitudSelectors = [
                'text=SOLICITUD DE SERVICIO',
                '[data-tab="solicitud"]',
                'a:contains("SOLICITUD")',
                '.tab:contains("SOLICITUD")'
            ];
            
            for (const selector of solicitudSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    await page.click(selector);
                    break;
                } catch (e) {
                    continue;
                }
            }
        }
        
        await page.waitForTimeout(3000);
        
        // Buscar el caso
        console.log(`🔍 Buscando caso ${numeroCaso}...`);
        
        // Intentar buscar el número de caso en la tabla
        const casoEncontrado = await page.evaluate((numero) => {
            // Buscar en todas las celdas de la tabla
            const cells = document.querySelectorAll('td, .grid-cell, .table-cell');
            for (let cell of cells) {
                if (cell.textContent.includes(numero)) {
                    cell.click();
                    return true;
                }
            }
            
            // Buscar enlaces que contengan el número
            const links = document.querySelectorAll('a');
            for (let link of links) {
                if (link.textContent.includes(numero)) {
                    link.click();
                    return true;
                }
            }
            
            return false;
        }, numeroCaso);
        
        if (!casoEncontrado) {
            throw new Error(`No se encontró el caso ${numeroCaso}`);
        }
        
        console.log('📖 Caso encontrado, extrayendo datos...');
        await page.waitForTimeout(5000);
        
        // Extraer datos del caso
        const datosExtraidos = await page.evaluate(() => {
            const datos = {};
            
            // Función auxiliar para buscar datos
            function buscarDato(etiquetas) {
                for (let etiqueta of etiquetas) {
                    // Buscar por texto de label
                    const labels = document.querySelectorAll('label, .label, .field-label, td, th, span');
                    for (let label of labels) {
                        if (label.textContent.toLowerCase().includes(etiqueta.toLowerCase())) {
                            // Buscar el valor en el siguiente elemento o celda
                            let valor = '';
                            
                            if (label.nextElementSibling) {
                                valor = label.nextElementSibling.textContent.trim();
                            } else if (label.parentElement && label.parentElement.nextElementSibling) {
                                valor = label.parentElement.nextElementSibling.textContent.trim();
                            } else if (label.closest('tr')) {
                                const cells = label.closest('tr').querySelectorAll('td');
                                if (cells.length > 1) {
                                    valor = cells[1].textContent.trim();
                                }
                            }
                            
                            if (valor && valor !== '' && valor !== '-') {
                                return valor;
                            }
                        }
                    }
                }
                return '';
            }
            
            // Extraer datos específicos
            datos.cliente = buscarDato(['cliente', 'solicitante', 'usuario', 'nombre', 'contacto']);
            datos.correo = buscarDato(['correo', 'email', 'e-mail', 'electronico']);
            datos.telefono = buscarDato(['telefono', 'teléfono', 'celular', 'móvil', 'movil']);
            datos.seccional = buscarDato(['seccional', 'sede', 'ubicacion', 'ubicación']);
            datos.despacho = buscarDato(['despacho', 'oficina', 'juzgado', 'dependencia']);
            datos.direccion = buscarDato(['direccion', 'dirección', 'address']);
            
            return datos;
        });
        
        console.log('✅ Datos extraídos:', datosExtraidos);
        
        await browser.close();
        return datosExtraidos;
        
    } catch (error) {
        console.error('❌ Error en extracción:', error);
        if (browser) {
            await browser.close();
        }
        throw error;
    }
}

// Función para generar documento Word
async function generarDocumentoWord(datos, numeroCaso) {
    console.log('📄 Generando documento Word...');
    
    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "FORMATO REPORTE DE DIAGNÓSTICO",
                            bold: true,
                            size: 28
                        })
                    ],
                    alignment: "center"
                }),
                
                new Paragraph({ text: "" }), // Espacio
                
                // Tabla con los datos
                new Table({
                    width: {
                        size: 100,
                        type: WidthType.PERCENTAGE,
                    },
                    rows: [
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("No. Caso Diagnóstico:")],
                                    width: { size: 30, type: WidthType.PERCENTAGE }
                                }),
                                new TableCell({
                                    children: [new Paragraph(numeroCaso || "")],
                                    width: { size: 70, type: WidthType.PERCENTAGE }
                                })
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("Nombre de Contacto:")],
                                }),
                                new TableCell({
                                    children: [new Paragraph(datos.cliente || "")],
                                })
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("Correo Electrónico:")],
                                }),
                                new TableCell({
                                    children: [new Paragraph(datos.correo || "")],
                                })
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("Teléfono/Celular:")],
                                }),
                                new TableCell({
                                    children: [new Paragraph(datos.telefono || "")],
                                })
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("Seccional:")],
                                }),
                                new TableCell({
                                    children: [new Paragraph(datos.seccional || "Bucaramanga")],
                                })
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("Oficina o Juzgado:")],
                                }),
                                new TableCell({
                                    children: [new Paragraph(datos.despacho || "")],
                                })
                            ]
                        }),
                        new TableRow({
                            children: [
                                new TableCell({
                                    children: [new Paragraph("Dirección:")],
                                }),
                                new TableCell({
                                    children: [new Paragraph(datos.direccion || "")],
                                })
                            ]
                        })
                    ]
                })
            ]
        }]
    });
    
    const buffer = await Packer.toBuffer(doc);
    return buffer;
}

// Comandos del bot
bot.command('start', (ctx) => {
    ctx.reply(`¡Hola! 👋

Soy tu asistente para automatizar la extracción de datos de HEAT.

Para usar el bot, simplemente envía el número de caso:
• Para incidentes: INC-123456
• Para solicitudes: REQ-123456

Ejemplo: \`INC-209102\`

El bot extraerá automáticamente los datos y te enviará el documento listo.`);
});

bot.command('caso', (ctx) => {
    ctx.reply('Por favor envía el número de caso que quieres procesar.\n\nEjemplo: INC-209102 o REQ-123456');
});

// Procesamiento de mensajes con números de caso
bot.on('text', async (ctx) => {
    const mensaje = ctx.message.text.trim().toUpperCase();
    
    // Verificar si es un número de caso válido
    if (!/^(INC-|REQ-)\d+$/.test(mensaje)) {
        ctx.reply('❌ Formato de caso inválido.\n\nFormatos válidos:\n• INC-123456 (para incidentes)\n• REQ-123456 (para solicitudes)');
        return;
    }
    
    try {
        ctx.reply(`🔄 Procesando caso ${mensaje}...\nEsto puede tomar unos minutos.`);
        
        // Extraer datos
        const datos = await extraerDatosHEAT(mensaje);
        
        // Generar documento
        const documentoBuffer = await generarDocumentoWord(datos, mensaje);
        
        // Enviar documento
        await ctx.replyWithDocument({
            source: documentoBuffer,
            filename: `Reporte_${mensaje}_${new Date().toISOString().split('T')[0]}.docx`
        }, {
            caption: `✅ Reporte generado para caso: ${mensaje}\n\n📋 Datos extraídos:\n• Cliente: ${datos.cliente}\n• Correo: ${datos.correo}\n• Teléfono: ${datos.telefono}\n• Despacho: ${datos.despacho}`
        });
        
    } catch (error) {
        console.error('Error procesando caso:', error);
        ctx.reply(`❌ Error procesando el caso ${mensaje}:\n\n${error.message}\n\nPor favor verifica:\n• Que el caso exista en HEAT\n• Que tengas permisos para verlo\n• Que las credenciales sean correctas`);
    }
});

// Manejo de errores
bot.catch((err, ctx) => {
    console.error('Error en bot:', err);
    ctx.reply('❌ Ocurrió un error inesperado. Por favor intenta de nuevo más tarde.');
});

// Iniciar bot
if (!TELEGRAM_TOKEN || !HEAT_USERNAME || !HEAT_PASSWORD) {
    console.error('❌ Faltan variables de entorno necesarias');
    process.exit(1);
}

bot.launch().then(() => {
    console.log('🤖 Bot iniciado correctamente');
}).catch(err => {
    console.error('❌ Error iniciando bot:', err);
});

// Manejo de cierre graceful
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
