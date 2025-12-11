var express = require('express');
var router = express.Router();

/* --- MIDDLEWARE DE SEGURIDAD (El Guardia) --- */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
    next(); // Tiene brazalete, pase usted
  } else {
    res.redirect('/login'); // No tiene brazalete, vaya a la fila
  }
};

/* ==========================================
   1. MUNDO PÚBLICO (Sin seguridad)
   ========================================== */

/* A. INTRO CINEMATOGRÁFICA (Raíz) */
router.get('/', function(req, res, next) {
  // Renderiza la vista del video full screen
  res.render('intro'); 
});

/* B. LOBBY / LANDING (La recepción elegante) */
router.get('/lobby', function(req, res, next) {
  res.render('lobby'); 
});

/* C. LOGIN (La Puerta de Acceso) */
router.get('/login', function(req, res, next) {
  // Si ya tiene sesión, lo mandamos directo al Dashboard interno
  if (req.session.usuarioLogueado) {
    res.redirect('/app/dashboard');
  } else {
    res.render('login');
  }
});

/* D. PROCESAR LOGIN (POST) */
router.post('/login', function(req, res, next) {
  const { username, password } = req.body;

  // Validación (Hardcoded por ahora)
  if (username === 'admin' && password === 'inymo123') {
    req.session.usuarioLogueado = true;
    req.session.nombreUsuario = 'Ángel Velasco';
    
    // CAMBIO IMPORTANTE: Ahora redirige a /app/dashboard (no solo /dashboard)
    res.redirect('/app/dashboard');
  } else {
    res.render('login', { error: 'Datos incorrectos 🚫' });
  }
});

/* ==========================================
   2. MUNDO PRIVADO / WORKSPACE (Protegido)
   ========================================== */

/* A. DASHBOARD PRINCIPAL */
router.get('/app/dashboard', verificarSesion, function(req, res, next) {
  // Renderiza la vista que extiende del layout complejo (layout_app)
  res.render('app_dashboard'); 
});

/* B. RUTAS DEL SIDEBAR (Placeholders por ahora) */
// Aquí conectaremos tus futuros módulos. Por ahora solo mostramos texto.

router.get('/app/proyectos', verificarSesion, (req, res) => {
  res.send("<h1>🏗️ Módulo de Gestión de Proyectos</h1><p>Aquí irá el Kanban y Gantt.</p>");
});

router.get('/app/bitacora', verificarSesion, (req, res) => {
  res.send("<h1>📝 Bitácora de Obra Digital</h1>");
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


/* 5. LOGOUT (Cortar el brazalete) */
router.get('/logout', function(req, res, next) {
  req.session.destroy(); // Destruye la sesión de seguridad
  res.redirect('/lobby'); // Nos manda a la recepción elegante
});

module.exports = router;