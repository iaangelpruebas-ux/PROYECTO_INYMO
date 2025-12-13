// 1. CARGAR VARIABLES DE ENTORNO (Debe ser la primera línea)
require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var session = require('express-session');

// 👇 1. IMPORTAR EL NUEVO MÓDULO DE PROYECTOS
var indexRouter = require('./routes/index');
var proyectosRouter = require('./routes/proyectos');
var proyectosDetalleRouter = require('./routes/proyectos_detalles'); // <--- NUEVO
var bitacoraRouter = require('./routes/bitacora'); // <--- 1. AGREGAR ESTO
var repositorioRouter = require('./routes/repositorio');
var usersRouter = require('./routes/users');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Sesión
app.use(session({
  secret: process.env.SESSION_SECRET || 'palabra_secreta_respaldo',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Rutas (Ahora sí, ya traen el brazalete puesto)
app.use('/', indexRouter); // Maneja /, /login, /app/dashboard, /app/bitacora, /app/eventos, etc.

// 👇 2. MONTAR EL NUEVO ROUTER DE PROYECTOS
// Todas las peticiones que empiecen por /app/proyectos se irán a proyectosRouter
app.use('/app/proyectos', proyectosRouter);
app.use('/app/proyectos', proyectosDetalleRouter); // <--- NUEVO
app.use('/app/bitacora', bitacoraRouter); // <--- 2. AGREGAR ESTO
app.use('/app/repositorio', repositorioRouter);

app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;