const { Pool, multer, fs } = require('../proyectos_Dashboard/detalles/subcodigos_presentacion/requiers_presentacion.js');

// CONFIGURACIÓN CENTRAL DE BASE DE DATOS 
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// GESTIÓN DE EVIDENCIAS Y COTIZACIONES 
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/uploads/cotizaciones/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `COT-${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`);
    }
});

const upload = multer({ storage: storage });

module.exports = { pool, upload };