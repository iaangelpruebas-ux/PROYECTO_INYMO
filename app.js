/**
 * =========================================================================
 * INYMO CORE ENGINE - SERVER CONFIGURATION
 * =========================================================================
 * Sistema Integral de Gestión para Ingeniería, Proyectos y Capital Humano.
 * Alineado con estándares ISO y metodología PMBOK.
 * Desarrollado para: Ing. Ángel Velasco (Socio Director)
 * Versión: 3.6.8 (Master Fixed: Routing Priority & Stability)
 * =========================================================================
 */

// 1. CONFIGURACIÓN DE ENTORNO Y ZONA HORARIA
process.env.TZ = 'America/Mexico_City'; 
require('dotenv').config();

// Dependencias de Núcleo
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

// 3. INICIALIZACIÓN
var app = express();

// 4. MOTOR DE VISTAS (PUG)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

/**
 * 5. MIDDLEWARES DE PROCESAMIENTO
 */
app.use(logger('dev'));
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * 6. GESTIÓN DE SESIONES (SEGURIDAD INYMO)
 */
app.use(session({
  name: 'inymo.sid',
  secret: process.env.SESSION_SECRET || 'inymo_ultra_secure_vault_2025',
  resave: false,
  saveUninitialized: false, 
  cookie: {
    secure: false, 
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600000 * 8 
  }
}));

/**
 * 6.5 INYECCIÓN DE VARIABLES GLOBALES (FORMATEO)
 */
app.use((req, res, next) => {
  // A. Formateo de Moneda
  res.locals.formatMoney = (amount) => {
    if (isNaN(amount) || amount === null) amount = 0;
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // B. Formateo de Fechas
  res.locals.formatDate = (date) => {
    if (!date) return 'S/F';
    return new Date(date).toLocaleDateString('es-MX', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  };

  // C. Perfil de Usuario
  res.locals.user = req.session.usuarioLogueado ? {
    nombre: req.session.nombreUsuario || 'Usuario INYMO',
    puesto: req.session.puesto || 'Socio Director'
  } : null;

  next();
});

/**
 * 7. MONTAJE DE RUTAS (ORDEN ESTRATÉGICO CORREGIDO)
 * El orden es CRÍTICO para evitar errores 404 en Repositorio y Configuración.
 */

// --- A. Rutas Base y Seguridad ---
app.use('/', require('./routes/index'));
app.use('/users', require('./routes/users'));

// --- B. Repositorio de Planos (PRIORIDAD ALTA) ---
// Debe ir ANTES de cualquier ruta de proyectos para que el botón de carpeta funcione.
app.use('/app/repositorio', require('./routes/repositorio')); 

// --- C. Módulos de Inteligencia (Cerebro Nuevo) ---
// 1. Analítica (Ruta Fija):
//app.use('/app/proyectos/analitica', require('./routes/proyectos_carpeta/detalles/proyectos_analitica'));

// 2. Dashboard Ejecutivo (Detalle 360):
// Atrapa el ID del proyecto solo si no es una ruta administrativa.


// --- D. Operaciones de Proyectos (Router Viejo) ---
// Maneja /nuevo, /editar, /distribucion (Presupuesto) y la lista general.
app.use('/app/proyectos', require('./routes/proyectos'));
app.use('/app/proyectos', require('./routes/proyectos_Dashboard/detalles/presentacion_proyecto'));
// --- E. Resto del Ecosistema INYMO ---
app.use('/app/clientes', require('./routes/clientes'));
app.use('/app/bitacora', require('./routes/bitacora'));

// Talento
app.use('/app/rrhh', require('./routes/rrhh'));
app.use('/app/rrhh', require('./routes/rrhh_parte2'));

// Finanzas
app.use('/app/finanzas', require('./routes/finanzas')); 
app.use('/app/finanzas', require('./routes/cotizacion_nueva'));
app.use('/app/facturas', require('./routes/facturas'));

// Logística e Inteligencia
app.use('/app/inventario', require('./routes/inventario'));
app.use('/app/logistica', require('./routes/logistica'));
app.use('/app/bi', require('./routes/bi'));


app.use('/app/copilot', require('./routes/copilot'));


/**
 * 8. GESTIÓN DE ERRORES
 */
app.use(function(req, res, next) {
  next(createError(404));
});

app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  if (err.status !== 404) {
    console.error(`[CRITICAL ERROR] ${new Date().toISOString()}: ${err.message}`);
  }
  res.status(err.status || 500);
  res.render('error', { title: 'Atención | Sistema INYMO' });
});

module.exports = app;