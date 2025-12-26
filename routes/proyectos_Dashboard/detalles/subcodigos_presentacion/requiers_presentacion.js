// routes/proyectos_carpeta/detalles/subcodigos_presentacion.js/requieres_presentacion.js

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const html_to_pdf = require('html-pdf-node');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Exportamos todas las piezas para que el archivo maestro las reciba
module.exports = {
    express,
    router,
    Pool,
    html_to_pdf,
    multer,
    fs,
    path
};