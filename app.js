// 1. CARGAR VARIABLES DE ENTORNO (Debe ser la primera línea)
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');


// 2. IMPORTACIÓN DE ROUTERS (JERARQUÍA MAESTRA)

// A. Módulos de Núcleo y Autenticación
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

// B. Módulos Operativos (Gestión de Campo)
var proyectosRouter = require('./routes/proyectos');
var proyectosDetalleRouter = require('./routes/proyectos_detalles');
var bitacoraRouter = require('./routes/bitacora');
var repositorioRouter = require('./routes/repositorio');
var clientesRouter = require('./routes/clientes');


// C. Módulos Financieros (Estructura PMBOK - Inteligencia Comercial)
var finanzasRouter = require('./routes/finanzas');         // Maneja Hub e Historial
var cotizacionNuevaRouter = require('./routes/cotizacion_nueva'); // Maneja la Creación (del mensaje anterior)
// D. Módulos de Almacén y Suministros (Logística de Materiales)
var inventarioRouter = require('./routes/inventario'); // Operación/Obras
var logisticaRouter = require('./routes/logistica');   // Administración/Bodega

// 3. INICIALIZACIÓN DE LA APLICACIÓN
var app = express();

// 4. CONFIGURACIÓN DEL MOTOR DE VISTAS (PUG Engine)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// 5. MIDDLEWARES GENERALES
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 6. CONFIGURACIÓN DE SESIÓN (Seguridad del Workspace INYMO)
app.use(session({
  secret: process.env.SESSION_SECRET || 'inymo_secret_key_2025_secure_vault',
  resave: false,
  saveUninitialized: false, 
  cookie: {
    secure: false,          // Cambiar a true solo si se implementa SSL/HTTPS
    httpOnly: true,         // Protege contra ataques XSS
    sameSite: 'lax',        // Equilibrio entre seguridad y usabilidad
    maxAge: 3600000         // Tiempo de vida de la sesión: 1 hora
  }
}));

// 7. DEFINICIÓN Y MONTAJE DE RUTAS (CONTROL DE TRÁFICO)

// Nivel 0: Rutas Base y Lobby
app.use('/', indexRouter);
app.use('/users', usersRouter);

// Nivel 1: Operaciones (Gestión de Proyectos y Bitácoras Digitales)
app.use('/app/proyectos', proyectosRouter);
app.use('/app/proyectos', proyectosDetalleRouter); 
app.use('/app/bitacora', bitacoraRouter);
app.use('/app/repositorio', repositorioRouter);
app.use('/app/clientes', clientesRouter);
// RUTAS FINANCIERAS
app.use('/app/finanzas', finanzasRouter); 
// Esto habilita:
// -> /app/finanzas/ (El Hub)
// -> /app/finanzas/historial (La Tabla)

app.use('/app/finanzas', cotizacionNuevaRouter);
// Nivel 3: Logística (Control de Inventarios y Suministros)
app.use('/app/inventario', inventarioRouter);  // Vista Obras
app.use('/app/logistica', logisticaRouter);    // Vista Bodega Central

// 8. MANEJO DE ERROR 404 (Captura de rutas inexistentes)
app.use(function(req, res, next) {
  next(createError(404));
});

// 9. MANEJO DE ERRORES GENERALES (Sistema de Alertas del Servidor)
app.use(function(err, req, res, next) {
  // Configuración de locales para desarrollo
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // Renderizado de la página de error personalizada
  res.status(err.status || 500);
  res.render('error');
});

// 10. EXPORTACIÓN DEL MÓDULO PARA BIN/WWW
module.exports = app;