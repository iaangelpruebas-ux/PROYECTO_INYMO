/**
 * =========================================================================
 * INYMO CORE ENGINE - SERVER CONFIGURATION
 * =========================================================================
 * Sistema Integral de Gestión para Ingeniería, Proyectos y Capital Humano.
 * Alineado con estándares ISO y metodología PMBOK.
 * * Desarrollado para: Ing. Ángel Velasco (Socio Director)
 * Versión: 3.5.0 (Full Integration: RRHH, Finanzas & BI)
 * =========================================================================
 */

// 1. CONFIGURACIÓN DE ENTORNO Y ZONA HORARIA
// Forzamos la zona horaria legal de CDMX para reportes y auditoría.
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
 * Los módulos se importan aquí para ser montados en la sección de rutas.
 */

// --- Nivel 0: Núcleo y Seguridad ---
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

// --- Nivel 1: Ingeniería y Operaciones (Campo) ---
var proyectosRouter = require('./routes/proyectos');
var proyectosDetallesRouter = require('./routes/proyectos_detalles');
var proyectosDetallesSeccion2Router = require('./routes/proyectos_detalles_2seccion');
var bitacoraRouter = require('./routes/bitacora');
var repositorioRouter = require('./routes/repositorio');
var clientesRouter = require('./routes/clientes');

// --- Nivel 2: Capital Humano (ISO 30414) ---
var rrhhRouter = require('./routes/rrhh');
const rrhhParte2Router = require('./routes/rrhh_parte2');

// --- Nivel 3: Gestión Comercial y Finanzas ---
var finanzasRouter = require('./routes/finanzas');
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
// Aumentamos el límite para planos pesados y reportes masivos
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());

// Servidor de Archivos Estáticos
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
    secure: false, // Cambiar a true solo con HTTPS
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600000 * 8 // 8 horas de sesión activa
  }
}));

/**
 * 6.5 INYECCIÓN DE VARIABLES GLOBALES (FORMATEO)
 * Especialmente diseñado para moneda mexicana y fechas.
 */
app.use((req, res, next) => {
  // A. Formateo de Moneda (Requisito: Pesos Mexicanos con Comas)
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

  // C. Perfil de Usuario para el Header
  res.locals.user = req.session.usuarioLogueado ? {
    nombre: req.session.nombreUsuario || 'Usuario INYMO',
    puesto: req.session.puesto || 'Socio Director'
  } : null;

  next();
});

/**
 * 7. MONTAJE DE RUTAS (ORDEN ESTRATÉGICO)
 * ¡IMPORTANTE! No mover estas líneas después del paso 8.
 */

// --- Bienvenida ---
app.use('/', indexRouter);
app.use('/users', usersRouter);

// --- Operaciones ---
app.use('/app/proyectos', proyectosRouter);
// IMPORTANTE: El orden importa. Primero las operaciones específicas, luego el detalle general.
//app.use('/app/proyectos', proyectosDetallesSeccion2Router); // Para editar, actualizar, gastos, etc.
app.use('/app/proyectos', proyectosDetallesRouter);         // Para visualizar el detalle
app.use('/app/bitacora', bitacoraRouter);
app.use('/app/repositorio', repositorioRouter);
app.use('/app/clientes', clientesRouter);

// --- Talento ---
app.use('/app/rrhh', rrhhRouter);
app.use('/app/rrhh', rrhhParte2Router);

// --- Finanzas ---
app.use('/app/finanzas', finanzasRouter); 
app.use('/app/finanzas', cotizacionNuevaRouter);
app.use('/app/facturas', facturasRouter);

// --- Logística ---
app.use('/app/inventario', inventarioRouter);
app.use('/app/logistica', logisticaRouter);

// --- Inteligencia Estratégica (BI) ---
app.use('/app/bi', biRouter);

/**
 * 8. GESTIÓN DE ERRORES (EL CAPTURADOR FINAL)
 */

// Error 404 (Ruta no encontrada)
app.use(function(req, res, next) {
  next(createError(404));
});

// Manejo de fallos del servidor (500)
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  if (err.status !== 404) {
    console.error(`[CRITICAL ERROR] ${new Date().toISOString()}: ${err.message}`);
  }

  res.status(err.status || 500);
  res.render('error', { title: 'Atención | Sistema INYMO' });
});

/**
 * 9. EXPORTACIÓN PARA SERVIDOR
 */
module.exports = app;