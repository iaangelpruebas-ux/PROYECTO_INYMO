var express = require('express');
var router = express.Router();

// 1. IMPORTAMOS EL MÓDULO DE REPOSITORIO
var repositorioRouter = require('./repositorio');
var inventarioRouter = require('./inventario');
// 🔌 CONFIGURACIÓN DE BASE DE DATOS (NEON)
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/* --- MIDDLEWARE DE SEGURIDAD (El Guardia) --- */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
    next();
  } else {
    res.redirect('/login');
  }
};

/* ==========================================
   1. MUNDO PÚBLICO (Sin seguridad)
   ========================================== */

router.get('/', function(req, res, next) {
  res.render('intro'); 
});

router.get('/lobby', function(req, res, next) {
  res.render('lobby'); 
});

router.get('/login', function(req, res, next) {
  if (req.session.usuarioLogueado) {
    res.redirect('/app/dashboard');
  } else {
    res.render('login');
  }
});

router.post('/login', function(req, res, next) {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'inymo123') {
    req.session.usuarioLogueado = true;
    req.session.nombreUsuario = 'Ángel Velasco';
    res.redirect('/app/dashboard');
  } else {
    res.render('login', { error: 'Datos incorrectos 🚫' });
  }
});

/* ==========================================
   2. MUNDO PRIVADO / WORKSPACE (Protegido)
   ========================================== */

router.get('/app/dashboard', verificarSesion, function(req, res, next) {
  res.render('app_dashboard'); 
});

// --- RUTA DEL REPOSITORIO CONECTADA ---
// Al entrar a /app/repositorio, se usa la lógica de routes/repositorio.js
router.use('/app/repositorio', verificarSesion, repositorioRouter);
router.use('/app/inventario', verificarSesion, inventarioRouter);

// ¡IMPORTANTE! 
// Las rutas /app/proyectos/* están en routes/proyectos.js
// Las rutas /app/bitacora/* están en routes/bitacora.js
// Las rutas /app/proyectos/:id/* (detalle) están en routes/proyectos_detalle.js

// --- OTRAS RUTAS PENDIENTES DE MOVER ---

/* L. VISTA DE CALENDARIO/EVENTOS (Timeline Unificado) */
router.get('/app/eventos', verificarSesion, async function(req, res, next) {
    try {
        const client = await pool.connect();
        
        // 1. OBTENER REGISTROS DE BITÁCORA
        const resultBitacora = await client.query('SELECT proyecto_id, titulo, descripcion, tipo_registro AS tipo, fecha_registro AS fecha, autor FROM bitacora');
        const eventosBitacora = resultBitacora.rows.map(e => ({
            ...e,
            fecha: new Date(e.fecha), 
            proyecto_codigo: `P-${e.proyecto_id}`,
            isHito: false
        }));

        // 2. OBTENER HITOS DE PROYECTOS
        const resultProyectos = await client.query(`SELECT id, nombre, codigo, fecha_fin FROM proyectos WHERE salud <> 'Archivado' AND fecha_fin IS NOT NULL`);
        
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
        
        // 3. EVENTOS FIJOS
        const hoy = new Date();
        const manana = new Date(hoy);
        manana.setDate(hoy.getDate() + 1);

        const eventosFijos = [
            { titulo: 'Reunión Semanal de Portafolio', descripcion: 'Sincronización PMs y Socios', tipo: 'Reunión', fecha: manana, proyecto_codigo: 'INYMO', autor: 'Sistema', isHito: false },
            { titulo: 'Día Festivo - Aniversario', descripcion: 'Día no laboral para todo el equipo.', tipo: 'Festivo', fecha: new Date('2026-03-21'), proyecto_codigo: 'HR', autor: 'Sistema', isHito: false }
        ];

        // 4. UNIFICAR Y ORDENAR
        let eventosUnificados = eventosBitacora.concat(eventosHitos).concat(eventosFijos);
        
        eventosUnificados.sort((a, b) => b.fecha - a.fecha); 

        client.release();

        res.render('app_eventos', {
            title: 'Calendario de Eventos | INYMO',
            eventos: eventosUnificados
        });

    } catch (err) {
        console.error("Error al cargar la vista de eventos:", err);
        res.send("Error de base de datos al cargar eventos: " + err);
    }
});

router.get('/app/finanzas', verificarSesion, (req, res) => {
  res.send("<h1>💰 Finanzas y Cotizaciones</h1>");
});

router.get('/app/personal', verificarSesion, (req, res) => {
  res.send("<h1>👥 Recursos Humanos</h1>");
});

router.get('/app/clientes', verificarSesion, (req, res) => {
  res.send("<h1>🤝 CRM de Clientes</h1>");
});

router.get('/app/analytics', verificarSesion, (req, res) => {
  res.send("<h1>📊 Inteligencia de Negocios</h1>");
});

/* ==========================================
   3. SALIDA
   ========================================== */

router.get('/logout', function(req, res, next) {
  req.session.destroy();
  res.redirect('/lobby');
});

module.exports = router;