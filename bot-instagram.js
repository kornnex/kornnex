const { IgApiClient } = require('instagram-private-api');
const sqlite3 = require('sqlite3').verbose();

// 1. Conexión a la base de datos de Kornnex
const db = new sqlite3.Database('./kornnex.db', (err) => {
  if (err) console.error('Error conectando a la BD en el Bot:', err.message);
  else console.log('🤖 Bot de Instagram conectado a kornnex.db');
});

// 2. Inicialización del cliente de Instagram
const ig = new IgApiClient();

// INGRESA AQUÍ LAS CREDENCIALES DE TU CUENTA @kornnex.online
const IG_USERNAME = process.env.IG_USERNAME || 'kornnex.online';
const IG_PASSWORD = process.env.IG_PASSWORD || 'tu_contraseña_aqui';

async function iniciarBot() {
  try {
    console.log('🤖 Iniciando sesión en Instagram...');
    ig.state.generateDevice(IG_USERNAME);
    
    // Si estás en producción, descomentá esta línea con tus credenciales reales:
    // await ig.account.login(IG_USERNAME, IG_PASSWORD);
    
    console.log('✅ Bot conectado a Instagram. Escuchando DMs en busca de tokens KORN-XXXX...');

    // Ejecutar chequeo de mensajes cada 15 segundos
    setInterval(revisarMensajesDirectos, 15000);

  } catch (error) {
    console.error('❌ Error al iniciar sesión en Instagram:', error.message);
  }
}

// 3. Función para procesar y verificar DMs recibidos
async function revisarMensajesDirectos() {
  try {
    console.log('🔍 Escaneando la bandeja de entrada de DMs...');

    // Obtener los hilos de mensajes directos
    const inboxFeed = ig.feed.directInbox();
    const threads = await inboxFeed.items();

    for (const thread of threads) {
      // Tomar el último mensaje recibido en el chat
      const lastItem = thread.items[0];
      
      if (lastItem && lastItem.item_type === 'text') {
        const texto = lastItem.text.trim().toUpperCase();
        
        // Buscar patrón de código KORN-XXXX (ej: KORN-8492)
        const match = texto.match(/KORN-\d{4}/);

        if (match) {
          const codigoEncontrado = match[0];
          console.log(`📩 Código detectado en DM: ${codigoEncontrado}`);

          // Validar el código en la base de datos SQLite
          verificarPerfilEnBD(codigoEncontrado, thread);
        }
      }
    }
  } catch (error) {
    console.error('Error al revisar DMs:', error.message);
  }
}

// 4. Actualizar la base de datos y responder por DM
function verificarPerfilEnBD(codigo, thread) {
  const querySelect = "SELECT * FROM emprendimientos WHERE codigo_verificacion = ? AND verificado = 0";

  db.get(querySelect, [codigo], async (err, local) => {
    if (err) {
      console.error('Error en consulta SQL:', err.message);
      return;
    }

    if (local) {
      // Marcar como verificado en la base de datos
      const queryUpdate = "UPDATE emprendimientos SET verificado = 1 WHERE id = ?";
      
      db.run(queryUpdate, [local.id], async function(err) {
        if (err) return console.error('Error al actualizar el estado:', err.message);

        console.log(`🎉 ¡Local "${local.nombre}" verificado automáticamente vía Bot!`);

        // Responder automáticamente por Instagram DM
        try {
          const mensajeRespuesta = `¡Hola! 👋 Tu código ${codigo} fue validado correctamente.\n\n` +
            `✅ El perfil de "${local.nombre}" ya está VERIFICADO en Kornnex.\n` +
            `Ya podés gestionar tu catálogo y WhatsApp desde tu panel: http://kornnex.online/login.html`;

          // Enviar respuesta al chat
          const threadEntity = ig.entity.directThread(thread.thread_id);
          await threadEntity.broadcastText(mensajeRespuesta);
          console.log(`📤 Respuesta de confirmación enviada a ${local.instagram}`);

        } catch (e) {
          console.error('No se pudo enviar la respuesta por DM:', e.message);
        }
      });
    } else {
      console.log(`⚠️ El código ${codigo} no fue encontrado o ya estaba verificado.`);
    }
  });
}

// Iniciar el servicio del bot
iniciarBot();