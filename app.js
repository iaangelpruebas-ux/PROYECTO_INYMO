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

var finanzasRouter = require('./routes/finanzas');

var inventarioRouter = require('./routes/inventario');
var logisticaRouter = require('./routes/logistica');

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
  saveUninitialized: false, // ✅ mejor práctica (no crea sesión vacía)
  cookie: {
    secure: false,          // true solo con HTTPS
    httpOnly: true,         // ✅ más seguro
    sameSite: 'lax'         // ✅ recomendado
  }
}));

// 6. DEFINICIÓN DE RUTAS (MONTADO)

// Base / auth
app.use('/', indexRouter);
app.use('/users', usersRouter);

// ✅ Módulos /app (específicos)
app.use('/app/proyectos', proyectosRouter);
app.use('/app/proyectos', proyectosDetalleRouter);

app.use('/app/bitacora', bitacoraRouter);
app.use('/app/repositorio', repositorioRouter);

app.use('/app/finanzas', finanzasRouter);

app.use('/app/inventario', inventarioRouter);
app.use('/app/logistica', logisticaRouter);

// 7. 404
app.use(function(req, res, next) {
  next(createError(404));
});

// 8. ERRORES GENERALES
app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
