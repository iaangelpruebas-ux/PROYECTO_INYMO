var express = require('express');
var router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next();
  else res.redirect('/login');
};

// 1. LISTADO GENERAL DE CLIENTES
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    // Traemos datos básicos y conteo de cotizaciones
    const query = `
      SELECT c.*, COUNT(cot.id) as total_cotizaciones, 
             MAX(cot.fecha_creacion) as ultima_cotizacion
      FROM clientes c
      LEFT JOIN cotizaciones cot ON c.id = cot.cliente_id
      WHERE c.activo = true
      GROUP BY c.id
      ORDER BY c.nombre_comercial ASC
    `;
    const result = await client.query(query);
    res.render('app_clientes', { clientes: result.rows });
  } catch (err) {
    res.send("Error: " + err.message);
  } finally {
    if (client) client.release();
  }
});

// 2. DETALLE DE CLIENTE (HISTORIAL Y EDICIÓN)
router.get('/detalle/:id', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    
    // Datos del Cliente
    const resCliente = await client.query("SELECT * FROM clientes WHERE id = $1", [req.params.id]);
    
    // Historial de Cotizaciones de este cliente
    const resHistorial = await client.query(`
        SELECT id, folio, fecha_creacion, monto_total, estado 
        FROM cotizaciones 
        WHERE cliente_id = $1 
        ORDER BY fecha_creacion DESC`, [req.params.id]);

    res.render('app_cliente_detalle', { 
        cliente: resCliente.rows[0],
        historial: resHistorial.rows
    });
  } catch (err) {
    res.redirect('/app/clientes');
  } finally {
    if (client) client.release();
  }
});

// 3. EDITAR CLIENTE
router.post('/editar', verificarSesion, async function(req, res) {
    const { id, nombre, rfc, contacto, telefono, correo } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query(`
            UPDATE clientes 
            SET nombre_comercial=$1, rfc=$2, contacto=$3, telefono=$4, correo=$5 
            WHERE id=$6`,
            [nombre, rfc, contacto, telefono, correo, id]
        );
        res.redirect('/app/clientes/detalle/' + id);
    } catch (e) {
        res.send("Error al editar");
    } finally { if(client) client.release(); }
});

// 4. ELIMINAR (Soft Delete)
router.get('/eliminar/:id', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        await client.query("UPDATE clientes SET activo = false WHERE id = $1", [req.params.id]);
        res.redirect('/app/clientes');
    } catch (e) { res.send("Error"); } 
    finally { if(client) client.release(); }
});

module.exports = router;