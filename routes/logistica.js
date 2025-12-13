var express = require('express');
var router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next(); else res.redirect('/login');
};

/* ==========================================================================
   1. VISTA PRINCIPAL: BODEGA CENTRAL (ADMINISTRACIÓN)
   ========================================================================== */
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    
    // A. STOCK LIBRE EN BODEGA (Agrupado por material)
    // Solo mostramos lo que NO tiene proyecto asignado (NULL)
    const resStock = await client.query(`
      SELECT ic.id, ic.nombre, ic.categoria, ic.unidad_medida, ic.precio_promedio_mxn,
        SUM(s.cantidad) as cantidad_libre,
        EXTRACT(DAY FROM NOW() - MIN(s.fecha_entrada)) as dias_antiguedad
      FROM inventario_stock s
      JOIN inventario_catalogo ic ON s.articulo_id = ic.id
      WHERE s.cantidad > 0 AND s.proyecto_origen_id IS NULL
      GROUP BY ic.id, ic.nombre, ic.categoria, ic.unidad_medida, ic.precio_promedio_mxn
      ORDER BY ic.nombre ASC
    `);

    // B. CATÁLOGOS PARA MODALES (Solo los marcados como activos)
    const resCat = await client.query(`SELECT * FROM inventario_catalogo WHERE activo = true ORDER BY nombre ASC`);
    const resProv = await client.query(`SELECT * FROM proveedores WHERE activo = true ORDER BY nombre_empresa ASC`);
    const resCategorias = await client.query(`SELECT * FROM inventario_categorias WHERE activo = true ORDER BY nombre ASC`);
    
    // Proyectos activos para entradas directas a obra
    const resProj = await client.query(`SELECT id, nombre FROM proyectos WHERE salud <> 'Archivado' ORDER BY nombre ASC`);

    // C. CÁLCULO FINANCIERO: VALOR TOTAL LIBRE
    let valorBodega = 0;
    resStock.rows.forEach(i => {
        valorBodega += (parseFloat(i.cantidad_libre) * parseFloat(i.precio_promedio_mxn || 0));
    });

    res.render('app_logistica', { 
      title: 'Administración de Suministros | INYMO',
      stock: resStock.rows,
      catalogo: resCat.rows,
      proveedores: resProv.rows,
      listaCategorias: resCategorias.rows,
      proyectos: resProj.rows,
      kpis: { total: valorBodega }
    });

  } catch (err) {
    console.error("Error en Administración Logística:", err);
    res.status(500).send("Error crítico al cargar administración: " + err.message);
  } finally { if (client) client.release(); }
});

/* ==========================================================================
   2. REGISTRO DE COMPRAS Y ENTRADAS (CON LIMPIEZA DE DATOS)
   ========================================================================== */
router.post('/registrar-entrada', verificarSesion, async function(req, res) {
   const { articulo_id, proyecto_id, proveedor_id, tipo_movimiento, cantidad, monto_mxn } = req.body;
   
   // FUNCION DE LIMPIEZA: Evita el error de 'invalid input syntax for type integer: ""'
   const limpiarInt = (v) => (v && v !== "" && !isNaN(v)) ? parseInt(v) : null;
   const limpiarFloat = (v) => (v && v !== "" && !isNaN(v)) ? parseFloat(v) : 0;
   
   const artId = limpiarInt(articulo_id);
   const projId = limpiarInt(proyecto_id); // Convierte "" de Almacén Central en NULL
   const provId = limpiarInt(proveedor_id);
   const cant = limpiarFloat(cantidad);
   const monto = limpiarFloat(monto_mxn);

   let client;
   try {
     client = await pool.connect();
     await client.query('BEGIN');

     // A. Actualizar Precio Promedio en el catálogo si es una COMPRA
     if(tipo_movimiento === 'COMPRA' && monto > 0 && cant > 0) {
         const precioUnitario = monto / cant;
         await client.query(`UPDATE inventario_catalogo SET precio_promedio_mxn = $1 WHERE id = $2`, [precioUnitario, artId]);
     }

     // B. Registrar Movimiento en Historial (Kardex)
     await client.query(`
        INSERT INTO inventario_movimientos (articulo_id, proyecto_id, proveedor_id, tipo_movimiento, cantidad, monto_mxn) 
        VALUES ($1, $2, $3, $4, $5, $6)
     `, [artId, projId, provId, tipo_movimiento, cant, monto]);

     // C. Definir Ubicación de Texto para el Stock
     let ubicacionTexto = 'Almacén Central';
     if(projId) {
        const pRes = await client.query('SELECT nombre FROM proyectos WHERE id = $1', [projId]);
        if(pRes.rows.length > 0) ubicacionTexto = 'Obra: ' + pRes.rows[0].nombre;
     }

     // D. Insertar en Stock Físico
     await client.query(`
        INSERT INTO inventario_stock (articulo_id, proyecto_origen_id, cantidad, ubicacion, fecha_entrada) 
        VALUES ($1, $2, $3, $4, NOW())
     `, [artId, projId, cant, ubicacionTexto]);

     await client.query('COMMIT');
     res.redirect('/app/logistica'); 

   } catch (e) {
     if(client) await client.query('ROLLBACK');
     console.error("Error al registrar entrada:", e);
     res.status(500).send("Error procesando entrada: " + e.message);
   } finally { if (client) client.release(); }
});

/* ==========================================================================
   3. GESTIÓN DE PROVEEDORES (NUEVO, EDITAR, ARCHIVAR)
   ========================================================================== */

router.post('/nuevo-proveedor', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        // Validar Duplicados
        const check = await client.query('SELECT id FROM proveedores WHERE LOWER(nombre_empresa) = LOWER($1)', [req.body.nombre_empresa]);
        if (check.rows.length > 0) {
            client.release();
            return res.send(`<script>alert("⚠️ La empresa '${req.body.nombre_empresa}' ya existe."); window.location.href="/app/logistica";</script>`);
        }
        await client.query(`INSERT INTO proveedores (nombre_empresa, contacto_nombre, telefono, activo) VALUES ($1, $2, $3, true)`, 
            [req.body.nombre_empresa, req.body.contacto, req.body.telefono]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { if(client) client.release(); res.send("Error al crear proveedor."); }
});

router.post('/editar-proveedor/:id', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query(`UPDATE proveedores SET nombre_empresa=$1, contacto_nombre=$2, telefono=$3 WHERE id=$4`, 
            [req.body.nombre_empresa, req.body.contacto, req.body.telefono, req.params.id]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { res.send("Error al editar proveedor."); }
});

router.get('/eliminar-proveedor/:id', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        // ARCHIVADO LÓGICO: Protege el historial de compras
        await client.query(`UPDATE proveedores SET activo = false WHERE id = $1`, [req.params.id]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { res.send("Error al archivar proveedor."); }
});

/* ==========================================================================
   4. GESTIÓN DE CATEGORÍAS (NUEVO, EDITAR, ARCHIVAR)
   ========================================================================== */

router.post('/nueva-categoria', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const check = await client.query('SELECT id FROM inventario_categorias WHERE LOWER(nombre) = LOWER($1)', [req.body.nombre]);
        if (check.rows.length > 0) {
            client.release();
            return res.send(`<script>alert("⚠️ La categoría ya existe."); window.location.href="/app/logistica";</script>`);
        }
        await client.query(`INSERT INTO inventario_categorias (nombre, activo) VALUES ($1, true)`, [req.body.nombre]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { if(client) client.release(); res.send("Error al crear categoría."); }
});

router.post('/editar-categoria/:id', verificarSesion, async (req, res) => {
    const { nuevo_nombre } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const resOld = await client.query('SELECT nombre FROM inventario_categorias WHERE id = $1', [req.params.id]);
        const oldName = resOld.rows[0].nombre;
        
        await client.query('UPDATE inventario_categorias SET nombre = $1 WHERE id = $2', [nuevo_nombre, req.params.id]);
        // Sincronizar catálogo para que no pierdan su categoría
        await client.query('UPDATE inventario_catalogo SET categoria = $1 WHERE categoria = $2', [nuevo_nombre, oldName]);
        
        await client.query('COMMIT');
        res.redirect('/app/logistica');
    } catch (e) { if(client) await client.query('ROLLBACK'); res.send("Error al editar."); } finally { if(client) client.release(); }
});

router.get('/eliminar-categoria/:id', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const catRes = await client.query('SELECT nombre FROM inventario_categorias WHERE id = $1', [req.params.id]);
        if (catRes.rows.length === 0) { client.release(); return res.redirect('/app/logistica'); }
        
        const nombreCat = catRes.rows[0].nombre;
        // VALIDACIÓN: No archivar si hay stock activo
        const stockCheck = await client.query(`
            SELECT s.id FROM inventario_stock s 
            JOIN inventario_catalogo c ON s.articulo_id = c.id 
            WHERE c.categoria = $1 AND s.cantidad > 0 LIMIT 1
        `, [nombreCat]);
        
        if (stockCheck.rows.length > 0) {
            client.release();
            return res.send(`<script>alert("⚠️ IMPOSIBLE ARCHIVAR: Existe stock físico en la categoría '${nombreCat}'."); window.location.href="/app/logistica";</script>`);
        }
        await client.query(`UPDATE inventario_categorias SET activo = false WHERE id = $1`, [req.params.id]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { if(client) client.release(); res.send("Error."); }
});

/* ==========================================================================
   5. GESTIÓN DEL CATÁLOGO (MATERIALES)
   ========================================================================== */

router.post('/nuevo-articulo', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const check = await client.query('SELECT id FROM inventario_catalogo WHERE LOWER(nombre) = LOWER($1)', [req.body.nombre]);
        if (check.rows.length > 0) {
            client.release();
            return res.send(`<script>alert("⚠️ Material ya registrado."); window.location.href="/app/logistica";</script>`);
        }
        await client.query(`INSERT INTO inventario_catalogo (nombre, categoria, unidad_medida, activo) VALUES ($1, $2, $3, true)`, 
            [req.body.nombre, req.body.categoria, req.body.unidad]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { if(client) client.release(); res.send("Error."); }
});

router.get('/eliminar-articulo/:id', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        // Soft Delete del catálogo
        await client.query(`UPDATE inventario_catalogo SET activo = false WHERE id = $1`, [req.params.id]);
        client.release();
        res.redirect('/app/logistica');
    } catch (e) { res.send("Error."); }
});

module.exports = router;