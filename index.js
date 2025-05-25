const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = require('docx');
const express = require('express');

// Configuración
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const HEAT_USERNAME = process.env.HEAT_USERNAME;
const HEAT_PASSWORD = process.env.HEAT_PASSWORD;
const PORT = process.env.PORT || 3000;

// Express para mantener el servicio activo
const app = express();
app.get('/', (req, res) => res.send('Bot HEAT funcionando'));
app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));

// Bot de Telegram
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('🤖 Bot HEAT iniciado correctamente');

// Comando /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    '¡Hola! 👋\n\n' +
    'Soy tu asistente para automatizar reportes HEAT.\n\n' +
    '📝 Para generar un reporte, envíame:\n' +
    '• Número de incidente: INC-123456\n' +
    '• Número de solicitud: REQ-123456\n\n' +
    '⏱️ El proceso toma unos segundos...'
  );
});

// Procesar números de caso
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignorar comandos
  if (text.startsWith('/')) return;

  // Validar formato
  const incidenteMatch = text.match(/INC-(\d+)/i);
  const solicitudMatch = text.match(/REQ-(\d+)/i);

  if (!incidenteMatch && !solicitudMatch) {
    bot.sendMessage(chatId, 
      '❌ Formato inválido\n\n' +
      'Envía el número en formato:\n' +
      '• INC-123456 (para incidentes)\n' +
      '• REQ-123456 (para solicitudes)'
    );
    return;
  }

  const numeroCaso = incidenteMatch ? incidenteMatch[0] : solicitudMatch[0];
  const tipoTicket = incidenteMatch ? 'incidente' : 'solicitud';

  bot.sendMessage(chatId, `🔍 Procesando ${numeroCaso}...\nPor favor espera unos momentos.`);

  try {
    const datos = await extraerDatosHEAT(numeroCaso, tipoTicket);
    const docBuffer = await generarDocumento(datos, numeroCaso);
    
    await bot.sendDocument(chatId, docBuffer, {}, {
      filename: `Reporte_${numeroCaso}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    bot.sendMessage(chatId, '✅ Reporte generado exitosamente!');
    
  } catch (error) {
    console.error('Error:', error);
    bot.sendMessage(chatId, 
      '❌ Error al procesar el caso\n\n' +
      'Posibles causas:\n' +
      '• Número de caso no existe\n' +
      '• Problema de conexión\n' +
      '• Sesión expirada\n\n' +
      'Intenta nuevamente en unos minutos.'
    );
  }
});

// Función para extraer datos de HEAT
async function extraerDatosHEAT(numeroCaso, tipoTicket) {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setDefaultTimeout(30000);
    
    console.log(`🌐 Accediendo a HEAT para caso: ${numeroCaso}`);

    // 1. Ir a la página de login
    await page.goto('https://judit.ramajudicial.gov.co/HEAT/', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // 2. Login
    await page.waitForSelector('input[name="username"], #username', { timeout: 10000 });
    await page.type('input[name="username"], #username', HEAT_USERNAME);
    await page.type('input[name="password"], #password', HEAT_PASSWORD);
    
    // Buscar botón de login
    const loginButton = await page.$('input[type="submit"], button[type="submit"], .btn-login');
    if (loginButton) {
      await loginButton.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 });
    console.log('✅ Login exitoso');

    // 3. Seleccionar rol "Analista N2 SS"
    await page.waitForSelector('text=Analista N2 SS, a[title*="Analista"], .role-selector', { timeout: 10000 });
    
    const roleLink = await page.$('text=Analista N2 SS') || 
                     await page.$('a[title*="Analista N2 SS"]') ||
                     await page.$('.role-item:contains("Analista N2 SS")');
    
    if (roleLink) {
      await roleLink.click();
      await page.waitForNavigation({ waitUntil: 'networkidle0' });
    }
    
    console.log('✅ Rol seleccionado');

    // 4. Navegar según tipo de ticket
    if (tipoTicket === 'incidente') {
      await page.waitForSelector('text=INCIDENTE, .tab-incidente, a[href*="incident"]');
      const incidentTab = await page.$('text=INCIDENTE') || 
                         await page.$('.tab-incidente') ||
                         await page.$('a[href*="incident"]');
      if (incidentTab) await incidentTab.click();
    } else {
      await page.waitForSelector('text=SOLICITUD DE SERVICIO, .tab-solicitud, a[href*="request"]');
      const requestTab = await page.$('text=SOLICITUD DE SERVICIO') || 
                        await page.$('.tab-solicitud') ||
                        await page.$('a[href*="request"]');
      if (requestTab) await requestTab.click();
    }

    await page.waitForTimeout(2000);
    console.log(`✅ Navegando en sección: ${tipoTicket}`);

    // 5. Buscar el caso
    const searchInput = await page.$('input[type="search"], .search-input, #search') ||
                       await page.$('input[placeholder*="buscar"], input[placeholder*="search"]');
    
    if (searchInput) {
      await searchInput.clear();
      await searchInput.type(numeroCaso);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }

    // 6. Hacer clic en el caso
    const caseLink = await page.$(`text=${numeroCaso}`) ||
                    await page.$(`a[href*="${numeroCaso}"]`) ||
                    await page.$(`[title*="${numeroCaso}"]`);
    
    if (caseLink) {
      await caseLink.click();
      await page.waitForTimeout(3000);
    }

    console.log('✅ Caso abierto, extrayendo datos...');

    // 7. Extraer datos
    const datos = await page.evaluate(() => {
      const extraerTexto = (selector) => {
        const elemento = document.querySelector(selector);
        return elemento ? elemento.textContent.trim() : '';
      };

      const extraerTextoMultiple = (selectores) => {
        for (const selector of selectores) {
          const texto = extraerTexto(selector);
          if (texto) return texto;
        }
        return '';
      };

      return {
        cliente: extraerTextoMultiple([
          '#cliente', '.cliente', '[data-field="cliente"]',
          'td:contains("Cliente") + td', 'span:contains("Cliente")',
          '.contact-name', '[title*="cliente"]'
        ]),
        correo: extraerTextoMultiple([
          '#correo', '#email', '.email', '[data-field="email"]',
          'td:contains("Correo") + td', 'td:contains("Email") + td',
          'a[href^="mailto:"]', '.contact-email'
        ]),
        telefono: extraerTextoMultiple([
          '#telefono', '#phone', '.telefono', '[data-field="telefono"]',
          'td:contains("Teléfono") + td', 'td:contains("Tel") + td',
          '.contact-phone', '[title*="telefono"]'
        ]),
        seccional: extraerTextoMultiple([
          '#seccional', '.seccional', '[data-field="seccional"]',
          'td:contains("Seccional") + td', '.location',
          '[title*="seccional"]'
        ]),
        despacho: extraerTextoMultiple([
          '#despacho', '#oficina', '.despacho', '[data-field="despacho"]',
          'td:contains("Despacho") + td', 'td:contains("Oficina") + td',
          '.office', '[title*="despacho"]'
        ]),
        direccion: extraerTextoMultiple([
          '#direccion', '#address', '.direccion', '[data-field="direccion"]',
          'td:contains("Dirección") + td', '.address',
          '[title*="direccion"]'
        ])
      };
    });

    console.log('✅ Datos extraídos:', datos);
    return { ...datos, numeroCaso, tipoTicket };

  } catch (error) {
    console.error('❌ Error en extracción:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Función para generar documento Word
async function generarDocumento(datos, numeroCaso) {
  const doc = new Document({
    sections: [{
      children: [
        // Título
        new Paragraph({
          children: [
            new TextRun({
              text: "FORMATO REPORTE DE DIAGNÓSTICO",
              bold: true,
              size: 24
            })
          ],
          alignment: 'center'
        }),
        
        new Paragraph({ text: "" }), // Espacio

        // Tabla de datos
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Nombre de Contacto:")] }),
                new TableCell({ children: [new Paragraph(datos.cliente || 'N/A')] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Correo Electrónico:")] }),
                new TableCell({ children: [new Paragraph(datos.correo || 'N/A')] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Teléfono/Celular:")] }),
                new TableCell({ children: [new Paragraph(datos.telefono || 'N/A')] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Seccional:")] }),
                new TableCell({ children: [new Paragraph(datos.seccional || 'Bucaramanga')] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Oficina o Juzgado:")] }),
                new TableCell({ children: [new Paragraph(datos.despacho || 'N/A')] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("Dirección:")] }),
                new TableCell({ children: [new Paragraph(datos.direccion || 'N/A')] })
              ]
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph("No. Caso Diagnóstico:")] }),
                new TableCell({ children: [new Paragraph(numeroCaso)] })
              ]
            })
          ]
        }),

        new Paragraph({ text: "" }), // Espacio

        // Secciones adicionales del formato
        new Paragraph({
          children: [new TextRun({ text: "DESCRIPCIÓN DEL PROBLEMA:", bold: true })]
        }),
        new Paragraph({ text: "_".repeat(80) }),
        new Paragraph({ text: "_".repeat(80) }),
        
        new Paragraph({ text: "" }),
        
        new Paragraph({
          children: [new TextRun({ text: "DIAGNÓSTICO:", bold: true })]
        }),
        new Paragraph({ text: "_".repeat(80) }),
        new Paragraph({ text: "_".repeat(80) }),
        
        new Paragraph({ text: "" }),
        
        new Paragraph({
          children: [new TextRun({ text: "SOLUCIÓN APLICADA:", bold: true })]
        }),
        new Paragraph({ text: "_".repeat(80) }),
        new Paragraph({ text: "_".repeat(80) })
      ]
    }]
  });

  return await Packer.toBuffer(doc);
}

// Manejo de errores global
process.on('unhandledRejection', (error) => {
  console.error('Error no manejado:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Excepción no capturada:', error);
});
