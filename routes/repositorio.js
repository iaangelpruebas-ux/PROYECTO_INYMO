var express = require('express');
var router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Configuración de Subida (Igual que antes)
const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

/* ==========================================
   RUTAS INTELIGENTES
   ========================================== */

/* 1. VISTA GENERAL: Muestra CARPETAS (Proyectos Activos) */
router.get('/', async function(req, res) {
  try {
    const client = await pool.connect();
    // Traemos proyectos activos y contamos cuántos planos tiene cada uno
    const resultado = await client.query(`
      SELECT p.id, p.nombre, p.codigo, p.cliente, 
      (SELECT COUNT(*) FROM repositorio_planos WHERE proyecto_id = p.id) as total_planos
      FROM proyectos p 
      WHERE p.salud != 'Archivado'
      ORDER BY p.id DESC 
    `); // <--- ¡AQUÍ ESTÁ EL ARREGLO! Cambiamos fecha_inicio por id
    
    client.release();

    res.render('app_repositorio_folders', { 
      title: 'Repositorio Central',
      proyectos: resultado.rows 
    });
  } catch (err) {
    console.error(err);
    // Usamos el render de error que ya arreglaste
    res.render('error', { message: 'Error cargando carpetas del repositorio', error: err });
  }
});

/* 2. VISTA DETALLADA: Muestra PLANOS de un Proyecto */
router.get('/proyecto/:id', async function(req, res) {
  try {
    const { id } = req.params;
    const client = await pool.connect();

    // Información del Proyecto
    const proyecto = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
    
    // Planos del Proyecto
    const planos = await client.query(`
      SELECT * FROM repositorio_planos 
      WHERE proyecto_id = $1 
      ORDER BY fecha_subida DESC
    `, [id]);
    
    client.release();

    // Validamos que el proyecto exista antes de renderizar
    if (proyecto.rows.length > 0) {
        res.render('app_repositorio_archivos', { 
          title: `Planos: ${proyecto.rows[0].nombre}`,
          proyecto: proyecto.rows[0],
          planos: planos.rows
        });
    } else {
        res.render('error', { message: 'Proyecto no encontrado', error: { status: 404 } });
    }

  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Error cargando archivos del proyecto', error: err });
  }
});

/* 3. SUBIR PLANO (Vinculado al Proyecto) */
router.post('/subir', upload.single('archivo_plano'), async function(req, res) {
  try {
    const { proyecto_id, titulo, disciplina, version, subido_por } = req.body;
    const archivo = req.file;

    if (!archivo) throw new Error("Falta el archivo");

    const client = await pool.connect();
    const rutaArchivo = '/uploads/' + archivo.filename;

    await client.query(`
      INSERT INTO repositorio_planos 
      (proyecto_id, titulo, disciplina, version, estatus, url_archivo, subido_por)
      VALUES ($1, $2, $3, $4, 'revision', $5, $6)
    `, [proyecto_id, titulo, disciplina, version, rutaArchivo, subido_por]);
    
    client.release();
    res.redirect(`/app/repositorio/proyecto/${proyecto_id}`);

  } catch (err) {
    console.error(err);
    res.render('error', { message: 'Error al subir el plano', error: err });
  }
});

module.exports = router;