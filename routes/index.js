var express = require('express');
var router = express.Router();

// 🔌 CONFIGURACIÓN DE BASE DE DATOS (NEON)
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* --- MIDDLEWARE DE SEGURIDAD (El Guardia) --- */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next();
  else res.redirect('/login');
};

/* ==========================================
   1. MUNDO PÚBLICO
   ========================================== */

router.get('/', function(req, res) {
  res.render('intro');
});

router.get('/lobby', function(req, res) {
  res.render('lobby');
});

router.get('/login', function(req, res) {
  if (req.session.usuarioLogueado) return res.redirect('/app/dashboard');
  res.render('login');
});

router.post('/login', function(req, res) {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'inymo123') {
    req.session.usuarioLogueado = true;
    req.session.nombreUsuario = 'Ángel Velasco';
    return res.redirect('/app/dashboard');
  }
  res.render('login', { error: 'Datos incorrectos 🚫' });
});

/* ==========================================
   2. MUNDO PRIVADO / WORKSPACE
   ========================================== */

router.get('/app/dashboard', verificarSesion, function(req, res) {
  res.render('app_dashboard');
});


// --- RUTA: CENTRO DE COMANDO IA (COPILOT) ---
router.get('/app/copilot', verificarSesion, (req, res) => {
    // La ruta del render debe coincidir con tu estructura de carpetas:
    res.render('COPILOT/provisional/app_copilot_hub', { 
        title: 'INYMO Neural Engine | Copilot',
        usuario: req.session.nombreUsuario
    });
});


/* L. VISTA DE CALENDARIO/EVENTOS (Timeline Unificado) */
router.get('/app/eventos', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();

    // Consultar eventos de bitácora
    const resultBitacora = await client.query(
      'SELECT proyecto_id, titulo, descripcion, tipo_registro AS tipo, fecha_registro AS fecha, autor FROM bitacora'
    );

    const eventosBitacora = resultBitacora.rows.map(e => ({
      ...e,
      fecha: new Date(e.fecha),
      proyecto_codigo: `P-${e.proyecto_id}`,
      isHito: false
    }));

    // Consultar hitos de proyectos (Fechas de entrega)
    const resultProyectos = await client.query(
      `SELECT id, nombre, codigo, fecha_fin FROM proyectos WHERE salud <> 'Archivado' AND fecha_fin IS NOT NULL`
    );

    const eventosHitos = resultProyectos.rows.map(p => ({
      proyecto_id: p.id,
      titulo: `HITO: Entrega Final de ${p.nombre}`,
      descripcion: `Fecha de finalización y cierre de ${p.codigo}.`,
      tipo: 'Hito',
      fecha: new Date(p.fecha_fin),
      proyecto_codigo: p.codigo,
      autor: 'Sistema',
      isHito: true
    }));

    // Eventos corporativos fijos
    const hoy = new Date();
    const manana = new Date(hoy);
    manana.setDate(hoy.getDate() + 1);

    const eventosFijos = [
      { titulo: 'Reunión Semanal de Portafolio', descripcion: 'Sincronización PMs y Socios', tipo: 'Reunión', fecha: manana, proyecto_codigo: 'INYMO', autor: 'Sistema', isHito: false },
      { titulo: 'Día Festivo - Aniversario', descripcion: 'Día no laboral para todo el equipo.', tipo: 'Festivo', fecha: new Date('2026-03-21'), proyecto_codigo: 'HR', autor: 'Sistema', isHito: false }
    ];

    // Unificación y ordenamiento cronológico inverso (Más reciente arriba)
    let eventosUnificados = eventosBitacora.concat(eventosHitos).concat(eventosFijos);
    eventosUnificados.sort((a, b) => b.fecha - a.fecha);

    res.render('app_eventos', {
      title: 'Calendario de Eventos | INYMO',
      eventos: eventosUnificados
    });

  } catch (err) {
    console.error("Error al cargar eventos:", err);
    res.status(500).send("Error de base de datos al cargar eventos: " + err);
  } finally {
    if (client) client.release();
  }
});

/* ==========================================
   3. SALIDA
   ========================================= */

router.get('/logout', function(req, res) {
  req.session.destroy(() => {
    res.redirect('/lobby');
  });
});

module.exports = router;