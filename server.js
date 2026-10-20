const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar almacenamiento de imágenes con Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos y la carpeta de fotos cargadas
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Inicializar Base de Datos SQLite
const db = new sqlite3.Database(path.join(__dirname, 'kornnex.db'), (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
  }
});

// Crear tablas si no existen
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT,
    email TEXT UNIQUE,
    password TEXT,
    rol TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS negocios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nombre TEXT,
    categoria TEXT,
    descripcion TEXT,
    direccion TEXT,
    telefono TEXT,
    imagen TEXT,
    adquirido INTEGER DEFAULT 0,
    destacado INTEGER DEFAULT 0,
    plan TEXT DEFAULT 'basico',
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);
});

// Configuración de Mercado Pago
const client = new MercadoPagoConfig({ 
  accessToken: process.env.MP_ACCESS_TOKEN || 'TU_ACCESS_TOKEN_AQUI' 
});

// Autenticación de Admin con credenciales fijas
const ADMIN_USER = '94903173';
const ADMIN_PASS = 'bancoballenavoley';

app.post('/api/admin/login', (req, res) => {
  const { usuario, password } = req.body;
  if (usuario === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ success: true, token: 'admin-auth-token-kornnex-2026' });
  } else {
    res.status(401).json({ success: false, message: 'Usuario o contraseña de administrador incorrectos' });
  }
});

// Obtener todos los negocios para el directorio
app.get('/api/negocios', (req, res) => {
  db.all(`SELECT * FROM negocios ORDER BY destacado DESC, adquirido DESC, id DESC`, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Crear un nuevo negocio (con soporte para subida de imagen local o URL)
app.post('/api/negocios', upload.single('imagenArchivo'), (req, res) => {
  const { usuario_id, nombre, categoria, descripcion, direccion, telefono, imagenUrl, destacado } = req.body;
  
  let imagen = '/uploads/default.jpg';
  if (req.file) {
    imagen = '/uploads/' + req.file.filename;
  } else if (imagenUrl && imagenUrl.trim() !== '') {
    imagen = imagenUrl;
  }

  const query = `INSERT INTO negocios (usuario_id, nombre, categoria, descripcion, direccion, telefono, imagen, adquirido, destacado, plan) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'basico')`;
  
  db.run(query, [usuario_id || 1, nombre, categoria, descripcion, direccion, telefono, imagen, destacado ? 1 : 0], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ success: true, id: this.lastID, imagen });
  });
});

// Actualizar estado 'adquirido' / 'destacado' desde el Panel de Admin
app.put('/api/admin/negocios/:id', (req, res) => {
  const { adquirido, destacado, plan } = req.body;
  const { id } = req.params;

  db.run(
    `UPDATE negocios SET adquirido = ?, destacado = ?, plan = ? WHERE id = ?`,
    [adquirido ? 1 : 0, destacado ? 1 : 0, plan || 'basico', id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, changes: this.changes });
    }
  );
});

// Eliminar negocio desde Admin
app.delete('/api/admin/negocios/:id', (req, res) => {
  const { id } = req.params;
  db.run(`DELETE FROM negocios WHERE id = ?`, [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ success: true, changes: this.changes });
  });
});

// Crear preferencia de pago Mercado Pago
app.post('/api/crear-preferencia-pago', async (req, res) => {
  try {
    const { emprendimiento_id, tipo_pago, precio, titulo } = req.body;
    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            title: titulo || 'Publicación en Kornnex',
            quantity: 1,
            unit_price: Number(precio),
            currency_id: 'ARS'
          }
        ],
        external_reference: `${emprendimiento_id}:${tipo_pago}`,
        back_urls: {
          success: 'https://kornnex.online/dashboard.html?pago=exitoso',
          failure: 'https://kornnex.online/dashboard.html?pago=fallido',
          pending: 'https://kornnex.online/dashboard.html?pago=pendiente'
        },
        auto_return: 'approved'
      }
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error('Error al crear preferencia MP:', error);
    res.status(500).json({ error: 'Error al procesar el pago' });
  }
});

// Servir la página principal por defecto
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});