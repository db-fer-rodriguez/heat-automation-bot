const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const puppeteer = require('puppeteer');

// Configuración
const token = process.env.TELEGRAM_BOT_TOKEN;
const username = process.env.HEAT_USERNAME;
const password = process.env.HEAT_PASSWORD;

if (!token || !username || !password) {
    console.error('❌ Faltan variables de entorno');
    process.exit(1);
}

// Crear bot
const bot = new TelegramBot(token, { polling: true });

// Crear servidor express para health check
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({ status: 'Bot activo', timestamp: new Date() });
});

app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en puerto ${port}`);
});

// Configuración de Puppeteer para Railway
const browserConfig = {
    headless: 'new',
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
};

// Función para hacer login en HEAT
async function loginHeat() {
    let browser;
    try {
        console.log('🔄 Iniciando navegador...');
        browser = await puppeteer.launch(browserConfig);
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log('🔄 Navegando a HEAT...');
        await page.goto('https://heat.uptc.edu.co/', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        console.log('🔄 Realizando login...');
        await page.type('#username', username);
        await page.type('#password', password);
        await page.click('button[type="submit"]');
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        
        console.log('✅ Login exitoso');
        return { browser, page };
        
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        if (browser) await browser.close();
        throw error;
    }
}

// Función para consultar ticket
async function consultarTicket(ticketId) {
    let browser;
    try {
        const { browser: br, page } = await loginHeat();
        browser = br;
        
        console.log(`🔍 Consultando ticket ${ticketId}...`);
        
        // Navegar a la sección de tickets
        await page.goto('https://heat.uptc.edu.co/tickets/', { 
            waitUntil: 'networkidle2',
            timeout: 15000 
        });
        
        // Buscar el ticket
        await page.type('input[name="search"]', ticketId);
        await page.click('button[type="submit"]');
        
        await page.waitForTimeout(3000);
        
        // Extraer información del ticket
        const ticketInfo = await page.evaluate(() => {
            const elements = document.querySelectorAll('.ticket-info, .ticket-details, [class*="ticket"]');
            let info = '';
            elements.forEach(el => {
                if (el.textContent.trim()) {
                    info += el.textContent.trim() + '\n';
                }
            });
            return info || 'No se encontró información del ticket';
        });
        
        await browser.close();
        return ticketInfo;
        
    } catch (error) {
        console.error('❌ Error consultando ticket:', error.message);
        if (browser) await browser.close();
        return `Error al consultar ticket: ${error.message}`;
    }
}

// Comandos del bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
🤖 *Bot HEAT Activo*

Comandos disponibles:
• /consultar [número] - Consultar ticket
• /estado - Ver estado del bot

Ejemplo: /consultar 12345
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/estado/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
✅ *Bot HEAT - Estado*

🟢 Bot activo y funcionando
📊 Memoria: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB
⏰ Uptime: ${Math.round(process.uptime())} segundos
    `, { parse_mode: 'Markdown' });
});

bot.onText(/\/consultar (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const ticketId = match[1];
    
    if (!ticketId || ticketId.length < 3) {
        bot.sendMessage(chatId, '❌ Por favor proporciona un número de ticket válido');
        return;
    }
    
    bot.sendMessage(chatId, `🔄 Consultando ticket ${ticketId}...`);
    
    try {
        const resultado = await consultarTicket(ticketId);
        bot.sendMessage(chatId, `
📋 *Ticket ${ticketId}*

${resultado}
        `, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// Manejo de errores
bot.on('error', (error) => {
    console.error('❌ Error del bot:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Error no manejado:', error);
});

console.log('🤖 Bot HEAT iniciado correctamente');
