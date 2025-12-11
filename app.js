
// 1. CARGAR VARIABLES DE ENTORNO (Debe ser la primera línea)
require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var session = require('express-session'); // ✅ Importado bien

var indexRouter = require('./routes/index');
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

// 👇👇👇 AQUÍ ES EL CAMBIO 👇👇👇
// La sesión debe ir ANTES de las rutas para que 'req.session' exista cuando entres a ellas.
app.use(session({
  // 👇 AQUÍ ESTÁ EL CAMBIO: Usamos process.env
  secret: process.env.SESSION_SECRET || 'palabra_secreta_respaldo',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // false por ahora porque estamos en localhost (http)
}));
// 👆👆👆 ----------------------- 👆👆👆

// Rutas (Ahora sí, ya traen el brazalete puesto)
app.use('/', indexRouter);
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