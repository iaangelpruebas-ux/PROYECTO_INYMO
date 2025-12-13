var express = require('express');
var router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');

// CONFIGURACIÓN DE MULTER (Soporte Multi-Archivo)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    // Limpiamos el nombre original para evitar caracteres raros
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext)
  }
});

const upload = multer({ storage: storage });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next(); else res.redirect('/login');
};

/* GET: Mostrar Bitácora Global */
router.get('/', verificarSesion, async function(req, res, next) {
  const filtroTipo = req.query.tipo;
  const filtroProyecto = req.query.proyecto;
  const busqueda = req.query.q;

  let querySQL = `
    SELECT 
      b.*, 
      p.nombre as proyecto_nombre, 
      p.codigo as proyecto_codigo 
    FROM bitacora b
    JOIN proyectos p ON b.proyecto_id = p.id
    WHERE p.salud <> 'Archivado'
  `;
  
  const params = [];

  if (filtroTipo && filtroTipo !== 'Todos') {
    params.push(filtroTipo);
    querySQL += ` AND b.tipo_registro = $${params.length}`;
  }

  if (filtroProyecto && filtroProyecto !== 'Todos') {
    params.push(filtroProyecto);
    querySQL += ` AND b.proyecto_id = $${params.length}`;
  }

  if (busqueda) {
    params.push(`%${busqueda}%`);
    querySQL += ` AND (b.titulo ILIKE $${params.length} OR b.descripcion ILIKE $${params.length})`;
  }

  querySQL += ` ORDER BY b.fecha_registro DESC LIMIT 50`;

  try {
    const client = await pool.connect();
    const resultBitacora = await client.query(querySQL, params);
    const resultProyectos = await client.query("SELECT id, nombre FROM proyectos WHERE salud <> 'Archivado' ORDER BY nombre ASC");
    client.release();

    const registros = resultBitacora.rows.map(r => {
      const f = new Date(r.fecha_registro);
      
      // Aseguramos que 'evidencias' sea un array (por si viene null de registros viejos)
      let archivos = [];
      if (r.evidencias) {
          // Si es string JSON lo parseamos, si ya es objeto lo usamos directo
          archivos = (typeof r.evidencias === 'string') ? JSON.parse(r.evidencias) : r.evidencias;
      }

      return {
        ...r,
        evidencias: archivos, 
        fecha_formato: f.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
        hora_formato: f.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      };
    });

    res.render('app_bitacora', { 
      title: 'Bitácora Global | INYMO', 
      registros: registros || [],
      listaProyectos: resultProyectos.rows || [],
      filtros: { tipo: filtroTipo, proyecto: filtroProyecto, q: busqueda }
    });

  } catch (err) {
    console.error(err);
    res.send("Error al cargar la bitácora: " + err.message);
  }
});

/* POST: Registrar (SOPORTE MULTI-ARCHIVO) */
// 'evidencias' es el nombre del campo en el formulario, max 10 archivos
router.post('/registrar', verificarSesion, upload.array('evidencias', 10), async function(req, res) {
    const { proyecto_id, titulo, tipo_registro, descripcion } = req.body;
    
    // Procesamos los archivos subidos para crear el JSON
    const listaArchivos = (req.files || []).map(file => {
        let tipoArchivo = 'otro';
        const mime = file.mimetype;

        if (mime.startsWith('image/')) tipoArchivo = 'imagen';
        else if (mime.startsWith('video/')) tipoArchivo = 'video';
        else if (mime === 'application/pdf') tipoArchivo = 'pdf';
        else if (mime.includes('spreadsheet') || mime.includes('excel')) tipoArchivo = 'excel';
        else if (mime.includes('word') || mime.includes('document')) tipoArchivo = 'word';

        return {
            url: `/uploads/${file.filename}`,
            nombre_original: file.originalname,
            mimetype: mime,
            tipo: tipoArchivo
        };
    });

    try {
        const client = await pool.connect();
        
        // Guardamos el array como JSONB
        await client.query(
            `INSERT INTO bitacora (proyecto_id, titulo, tipo_registro, descripcion, evidencias, fecha_registro)
             VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
            [proyecto_id, titulo, tipo_registro, descripcion, JSON.stringify(listaArchivos)]
        );
        
        client.release();
        res.redirect('/app/bitacora');
    } catch (err) {
        console.error(err);
        res.send("Error al guardar registro: " + err.message);
    }
});

/* POST: Editar Registro Existente */
router.post('/editar/:id', verificarSesion, upload.array('evidencias', 10), async function(req, res) {
    const idRegistro = req.params.id;
    const { titulo, tipo_registro, descripcion } = req.body;

    try {
        const client = await pool.connect();
        
        // 1. Obtener el registro actual para no perder las fotos viejas
        const resultOriginal = await client.query('SELECT evidencias FROM bitacora WHERE id = $1', [idRegistro]);
        let evidenciasActuales = resultOriginal.rows[0].evidencias || [];
        
        // Asegurar que sea un array
        if (typeof evidenciasActuales === 'string') evidenciasActuales = JSON.parse(evidenciasActuales);

        // 2. Procesar NUEVOS archivos (si los hay)
        const nuevosArchivos = (req.files || []).map(file => {
            let tipoArchivo = 'otro';
            const mime = file.mimetype;
            if (mime.startsWith('image/')) tipoArchivo = 'imagen';
            else if (mime.startsWith('video/')) tipoArchivo = 'video';
            else if (mime === 'application/pdf') tipoArchivo = 'pdf';
            else if (mime.includes('spreadsheet') || mime.includes('excel')) tipoArchivo = 'excel';
            else if (mime.includes('word') || mime.includes('document')) tipoArchivo = 'word';

            return {
                url: `/uploads/${file.filename}`,
                nombre_original: file.originalname,
                mimetype: mime,
                tipo: tipoArchivo
            };
        });

        // 3. Combinar evidencias (Viejas + Nuevas)
        const evidenciasFinales = evidenciasActuales.concat(nuevosArchivos);

        // 4. Actualizar en BD
        await client.query(
            `UPDATE bitacora 
             SET titulo = $1, tipo_registro = $2, descripcion = $3, evidencias = $4::jsonb 
             WHERE id = $5`,
            [titulo, tipo_registro, descripcion, JSON.stringify(evidenciasFinales), idRegistro]
        );

        client.release();
        res.redirect('/app/bitacora');

    } catch (err) {
        console.error(err);
        res.send("Error al editar: " + err.message);
    }
});

/* POST: Eliminar un archivo específico de un registro */
router.post('/eliminar-archivo/:id', verificarSesion, async function(req, res) {
    const idRegistro = req.params.id;
    const nombreArchivo = req.body.nombre_archivo; // El nombre del archivo a borrar

    try {
        const client = await pool.connect();
        
        // 1. Obtener el registro actual
        const result = await client.query('SELECT evidencias FROM bitacora WHERE id = $1', [idRegistro]);
        let evidencias = result.rows[0].evidencias || [];
        
        if (typeof evidencias === 'string') evidencias = JSON.parse(evidencias);

        // 2. Filtrar para quitar el archivo seleccionado
        const nuevasEvidencias = evidencias.filter(f => f.nombre_original !== nombreArchivo);

        // 3. Actualizar la BD con la nueva lista
        await client.query(
            'UPDATE bitacora SET evidencias = $1::jsonb WHERE id = $2',
            [JSON.stringify(nuevasEvidencias), idRegistro]
        );

        client.release();
        
        // 4. Responder con éxito (para que el frontend sepa que ya se borró)
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET: Eliminar Registro Completo de la Bitácora */
router.get('/eliminar/:id', verificarSesion, async function(req, res) {
    const idRegistro = req.params.id;
    try {
        const client = await pool.connect();
        await client.query('DELETE FROM bitacora WHERE id = $1', [idRegistro]);
        client.release();
        res.redirect('/app/bitacora');
    } catch (err) {
        console.error(err);
        res.send("Error al eliminar el registro: " + err.message);
    }
});




module.exports = router;