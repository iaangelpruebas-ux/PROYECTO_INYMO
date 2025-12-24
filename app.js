/**
 * =========================================================================
 * INYMO CORE ENGINE - SERVER CONFIGURATION
 * =========================================================================
 * Sistema Integral de Gestión para Ingeniería, Proyectos y Capital Humano.
 * Alineado con estándares ISO y metodología PMBOK.
 * Desarrollado para: Ing. Ángel Velasco (Socio Director)
 * Versión: 3.5.2 (Full Integration: Finanzas Proyecto)
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

/**
 * 2. IMPORTACIÓN DE ROUTERS (JERARQUÍA MAESTRA)
 */

// --- Nivel 0: Núcleo y Seguridad ---
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

// --- Nivel 1: Ingeniería y Operaciones (Campo) ---
var proyectosRouter = require('./routes/proyectos');
var proyectosDetallesSeccion2Router = require('./routes/proyectos_detalles_2seccion');
var bitacoraRouter = require('./routes/bitacora');
var repositorioRouter = require('./routes/repositorio');
var clientesRouter = require('./routes/clientes');

// --- MÓDULOS DE INTELIGENCIA INYMO (RUTAS CORREGIDAS) ---
const presentacionProyectoRouter = require('./routes/proyectos_carpeta/detalles/presentacion_proyecto');
// IMPORTANTE: Ruta exacta a la subcarpeta detalles

// --- Nivel 2: Capital Humano (ISO 30414) ---
var rrhhRouter = require('./routes/rrhh');
const rrhhParte2Router = require('./routes/rrhh_parte2');

// --- Nivel 3: Gestión Comercial y Finanzas ---
//var finanzasGeneralRouter = require('./routes/finanzas'); // Renombrado para evitar SyntaxError
var cotizacionNuevaRouter = require('./routes/cotizacion_nueva');
const facturasRouter = require('./routes/facturas');

// --- Nivel 4: Logística y Almacén ---
var inventarioRouter = require('./routes/inventario');
var logisticaRouter = require('./routes/logistica');

// --- Nivel 5: Inteligencia de Negocios (BI) ---
const biRouter = require('./routes/bi');

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
  // A. Formateo de Moneda (Pesos Mexicanos con Comas)
  res.locals.formatMoney = (amount) => {
    if (isNaN(amount) || amount === null) amount = 0;
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2
    }).format(amount);
  };

  // B. Formateo de Fechas (CDMX)
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
 * 7. MONTAJE DE RUTAS (ORDEN ESTRATÉGICO)
 */

// --- Bienvenida ---
app.use('/', indexRouter);
app.use('/users', usersRouter);

// --- Operaciones ---
app.use('/app/proyectos', proyectosRouter);
app.use('/app/bitacora', bitacoraRouter);
app.use('/app/repositorio', repositorioRouter);
app.use('/app/clientes', clientesRouter);

// --- LO NUEVO EN PROYECTOS (ESTA ES LA PARTE CLAVE) ---
// Montamos la presentación ejecutiva
app.use('/app/proyectos', presentacionProyectoRouter);
// Montamos las finanzas bajo la misma ruta base de proyectos

// --- Talento ---
app.use('/app/rrhh', rrhhRouter);
app.use('/app/rrhh', rrhhParte2Router);

// --- Finanzas ---
//app.use('/app/finanzas', finanzasGeneralRouter); 
//app.use('/app/finanzas', cotizacionNuevaRouter);
//app.use('/app/facturas', facturasRouter);

// --- Logística e Inteligencia ---
app.use('/app/inventario', inventarioRouter);
app.use('/app/logistica', logisticaRouter);
app.use('/app/bi', biRouter);
app.use('/app/proyectos/analitica', require('./routes/proyectos_carpeta/detalles/proyectos_analitica'));
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