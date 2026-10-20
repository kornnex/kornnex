const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const PORT = 3000;

// Configurar carpeta de subidas (Uploads)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configurar Multer para guardar imágenes en el disco
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'img-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB por imagen
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (PNG, JPG, WEBP, etc.)'));
    }
  }
});

// Configurar Mercado Pago (Reemplazar con tu Access Token real)
const mpClient = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || 'APP_USR-8517266101490407-101918-f1ceeba0479e57656060b2d23f59de49-1068687773' 
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Hacer pública la carpeta de fotos

// 1. BASE DE DATOS
const db = new sqlite3.Database('./kornnex.db', (err) => {
  if (err) console.error('Error al conectar con la base de datos:', err.message);
  else console.log('⚡ Base de datos SQLite conectada correctamente.');
});

// 2. TABLAS
db.run(`
  CREATE TABLE IF NOT EXISTS emprendimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE,
    nombre TEXT,
    rubro TEXT,
    instagram TEXT,
    imagen TEXT,
    descripcion TEXT,
    whatsapp TEXT,
    verificado INTEGER DEFAULT 0,
    codigo_verificacion TEXT,
    password TEXT,
    ediciones_realizadas INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'gratis',
    destacado INTEGER DEFAULT 0
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emprendimiento_id INTEGER,
    nombre TEXT,
    precio REAL,
    descripcion TEXT,
    imagen TEXT,
    FOREIGN KEY(emprendimiento_id) REFERENCES emprendimientos(id)
  )
`);

// 3. RUTA ESPECIAL PARA SUBIR IMÁGENES DESDE LA GALERÍA / ARCHIVOS
app.post('/api/upload', upload.single('imagen'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se seleccionó ningún archivo de imagen." });
  }
  const urlImagen = `/uploads/${req.file.filename}`;
  res.json({ url: urlImagen });
});

// 4. RUTAS DE LA API

app.get('/api/emprendimientos', (req, res) => {
  db.all("SELECT * FROM emprendimientos ORDER BY destacado DESC, id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/local/:id', (req, res) => {
  db.get("SELECT * FROM emprendimientos WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "Local no encontrado." });
    res.json(row);
  });
});

app.post('/api/login', (req, res) => {
  let { instagram, password } = req.body;
  const igConAt = instagram.startsWith('@') ? instagram : '@' + instagram;
  const igSinAt = instagram.replace('@', '');

  const query = `
    SELECT * FROM emprendimientos 
    WHERE (instagram = ? OR instagram = ? OR nombre = ?) 
    AND password = ?
  `;

  db.get(query, [igConAt, igSinAt, instagram, password], (err, local) => {
    if (err || !local) return res.status(401).json({ error: "Instagram o contraseña incorrectos." });
    res.json({ exito: true, local });
  });
});

app.put('/api/local/:id', (req, res) => {
  const { id } = req.params;
  const { whatsapp, imagen, descripcion } = req.body;

  db.get("SELECT * FROM emprendimientos WHERE id = ?", [id], (err, local) => {
    if (err || !local) return res.status(404).json({ error: "Local no encontrado." });

    if (local.plan === 'gratis' && local.ediciones_realizadas >= 1) {
      return res.status(403).json({ error: "Alcanzaste el límite de ediciones gratuitas. Activa tu suscripción para continuar." });
    }

    const nuevasEdiciones = local.ediciones_realizadas + 1;
    const query = `UPDATE emprendimientos SET whatsapp = ?, imagen = ?, descripcion = ?, ediciones_realizadas = ? WHERE id = ?`;

    db.run(query, [whatsapp, imagen, descripcion, nuevasEdiciones, id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ exito: true, mensaje: "Perfil actualizado." });
    });
  });
});

// RUTAS DE PRODUCTOS
app.get('/api/productos/:emprendimiento_id', (req, res) => {
  db.all("SELECT * FROM productos WHERE emprendimiento_id = ?", [req.params.emprendimiento_id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/productos', (req, res) => {
  const { emprendimiento_id, nombre, precio, descripcion, imagen } = req.body;
  const query = `INSERT INTO productos (emprendimiento_id, nombre, precio, descripcion, imagen) VALUES (?, ?, ?, ?, ?)`;

  db.run(query, [emprendimiento_id, nombre, precio, descripcion || '', imagen || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exito: true, id: this.lastID });
  });
});

app.delete('/api/productos/:id', (req, res) => {
  db.run("DELETE FROM productos WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exito: true });
  });
});

// MERCADO PAGO
app.post('/api/crear-preferencia-pago', async (req, res) => {
  const { emprendimiento_id, tipo_pago } = req.body;

  try {
    const preference = new Preference(mpClient);

    let titulo = "Anuncio Semanal Destacado - Kornnex";
    let precio = 2500;

    if (tipo_pago === 'suscripcion') {
      titulo = "Suscripción Mensual Pro - Kornnex";
      precio = 3500;
    }

    const result = await preference.create({
      body: {
        items: [
          {
            title: titulo,
            quantity: 1,
            unit_price: precio,
            currency_id: 'ARS'
          }
        ],
        external_reference: `${emprendimiento_id}:${tipo_pago}`,
        back_urls: {
          success: 'https://kornnex.online/dashboard.html?pago=exitoso',
          failure: 'https://kornnex.online/dashboard.html?pago=fallido',
          pending: 'https://kornnex.online/dashboard.html?pago=pendiente'
        }
      }
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error('Error detallado de MP:', error.cause || error);
    res.status(500).json({ error: "Error al generar el pago con Mercado Pago." });
  }
});

app.post('/api/webhook-mercadopago', async (req, res) => {
  const { query } = req;
  const topic = query.topic || query.type;

  try {
    if (topic === 'payment') {
      const paymentId = query['data.id'] || query.id;
      const payment = new Payment(mpClient);
      const data = await payment.get({ id: paymentId });

      if (data.status === 'approved') {
        const [emprendimientoId, tipoPago] = data.external_reference.split(':');

        if (tipoPago === 'destacado') {
          db.run("UPDATE emprendimientos SET destacado = 1 WHERE id = ?", [emprendimientoId]);
        } else if (tipoPago === 'suscripcion') {
          db.run("UPDATE emprendimientos SET plan = 'premium' WHERE id = ?", [emprendimientoId]);
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Error en Webhook MP:', error);
    res.sendStatus(500);
  }
});

// ADMIN ROUTES
app.get('/api/admin/emprendimientos', (req, res) => {
  db.all("SELECT * FROM emprendimientos ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put('/api/admin/editar/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, rubro, instagram, whatsapp, imagen, descripcion, verificado, destacado, plan } = req.body;

  const query = `
    UPDATE emprendimientos 
    SET nombre = ?, rubro = ?, instagram = ?, whatsapp = ?, imagen = ?, descripcion = ?, verificado = ?, destacado = ?, plan = ?
    WHERE id = ?
  `;

  db.run(query, [nombre, rubro, instagram, whatsapp, imagen, descripcion, verificado, destacado, plan, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exito: true });
  });
});

app.post('/api/admin/crear', (req, res) => {
  const { nombre, rubro, instagram, whatsapp, imagen, descripcion, verificado, destacado, plan } = req.body;
  const slug = nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

  const query = `
    INSERT INTO emprendimientos (slug, nombre, rubro, instagram, whatsapp, imagen, descripcion, verificado, destacado, plan, password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '123456')
  `;

  db.run(query, [slug, nombre, rubro, instagram || '', whatsapp || '', imagen || '', descripcion || '', verificado ? 1 : 0, destacado ? 1 : 0, plan || 'gratis'], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exito: true, id: this.lastID });
  });
});

app.put('/api/admin/destacar/:id', (req, res) => {
  const { id } = req.params;
  const { destacado } = req.body;

  db.run("UPDATE emprendimientos SET destacado = ? WHERE id = ?", [destacado, id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exito: true });
  });
});

app.delete('/api/admin/eliminar/:id', (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM emprendimientos WHERE id = ?", [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exito: true });
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor de Kornnex corriendo en http://localhost:${PORT}`);
});