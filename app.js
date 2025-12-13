// 1. CARGAR VARIABLES DE ENTORNO
require('dotenv').config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

// 2. IMPORTACIÓN DE ROUTERS
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var proyectosRouter = require('./routes/proyectos');
var proyectosDetalleRouter = require('./routes/proyectos_detalles');
var bitacoraRouter = require('./routes/bitacora');
var repositorioRouter = require('./routes/repositorio');

// Módulos de Inventario y Logística (Separados)
var inventarioRouter = require('./routes/inventario'); // Logística y Distribución en Obras
var logisticaRouter = require('./routes/logistica');   // Transferencias específicas

var app = express();

// 3. CONFIGURACIÓN DEL MOTOR DE VISTAS
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// 4. MIDDLEWARES GENERALES
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 5. CONFIGURACIÓN DE SESIÓN
app.use(session({
  secret: process.env.SESSION_SECRET || 'inymo_secret_key_2025',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Cambiar a true si usas HTTPS en producción
}));

// 6. DEFINICIÓN DE RUTAS (MONTADO)

// Rutas base y de autenticación
app.use('/', indexRouter); 
app.use('/users', usersRouter);

// Operativo: Gestión de Proyectos
app.use('/app/proyectos', proyectosRouter);
app.use('/app/proyectos', proyectosDetalleRouter); 

// Operativo: Bitácora y Planos
app.use('/app/bitacora', bitacoraRouter);
app.use('/app/repositorio', repositorioRouter);

// Logística y Almacén (Ordenados por jerarquía)
app.use('/app/inventario', inventarioRouter); // Dashboard de Distribución/Obras
app.use('/app/logistica', logisticaRouter);   // Centro de Transferencias

// 7. MANEJO DE ERRORES (404)
app.use(function(req, res, next) {
  next(createError(404));
});

// 8. MANEJO DE ERRORES GENERALES
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;