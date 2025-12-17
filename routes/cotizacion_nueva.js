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

const safeFloat = (val) => { const n = parseFloat(val); return isNaN(n) ? 0 : n; };
const safeInt = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

// GET: Formulario de Creación
router.get('/crear', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    
    // Traemos RFC para mostrarlo en el select
    const resClientes = await client.query("SELECT id, nombre_comercial, rfc FROM clientes WHERE activo = true ORDER BY nombre_comercial ASC");
    const resProductos = await client.query("SELECT id, nombre, precio_base, costo_base, unidad FROM productos_catalogo WHERE activo = true ORDER BY nombre ASC");
    
    const resFolio = await client.query("SELECT COUNT(*) FROM cotizaciones");
    const sigFolio = parseInt(resFolio.rows[0].count) + 1;
    const folioSugerido = `COT-${new Date().getFullYear().toString().slice(-2)}-${sigFolio.toString().padStart(3, '0')}`;

    res.render('app_cotizacion_crear', {
      title: 'Nueva Cotización | INYMO',
      folio: folioSugerido,
      clientes: resClientes.rows,
      productos: resProductos.rows
    });
  } catch (err) {
    res.send("Error al cargar formulario: " + err.message);
  } finally {
    if (client) client.release();
  }
});

// POST: Guardar Cotización
router.post('/guardar-nueva', verificarSesion, async function(req, res) {
  const { 
    cliente_id, 
    // Campos nuevos para alta
    cliente_nuevo_nombre, cliente_nuevo_rfc, cliente_nuevo_contacto, cliente_nuevo_telefono, cliente_nuevo_correo,
    fecha_emision, vigencia_dias, 
    notas_publicas, notas_privadas, 
    items 
  } = req.body;

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. GESTIÓN DE CLIENTE
    let idClienteFinal = safeInt(cliente_id);

    // Si es cliente nuevo
    if (!idClienteFinal && cliente_nuevo_nombre) {
      // Verificar duplicado por Nombre o RFC
      const check = await client.query("SELECT id FROM clientes WHERE nombre_comercial ILIKE $1 OR (rfc = $2 AND rfc IS NOT NULL)", [cliente_nuevo_nombre.trim(), cliente_nuevo_rfc]);
      
      if (check.rows.length > 0) {
        idClienteFinal = check.rows[0].id;
      } else {
        // Insertamos con los nuevos campos
        const nuevo = await client.query(`
          INSERT INTO clientes (nombre_comercial, rfc, contacto, telefono, correo, fecha_registro, activo) 
          VALUES ($1, $2, $3, $4, $5, NOW(), true) RETURNING id`, 
          [
            cliente_nuevo_nombre.trim(), 
            cliente_nuevo_rfc || 'XAXX010101000', 
            cliente_nuevo_contacto, 
            cliente_nuevo_telefono || null, // Opcional
            cliente_nuevo_correo || null    // Opcional
          ]);
        idClienteFinal = nuevo.rows[0].id;
      }
    }

    if (!idClienteFinal) throw new Error("Cliente inválido o no seleccionado.");

    // 2. PROCESAR PARTIDAS
    const partidas = JSON.parse(items);
    let subtotal = 0, costoTotal = 0, descuentoTotal = 0;

    const partidasProcesadas = partidas.map(p => {
      const cant = safeFloat(p.cantidad);
      const precio = safeFloat(p.precio);
      const costo = safeFloat(p.costo);
      const descPorc = safeFloat(p.descuento);

      const importeBruto = cant * precio;
      const montoDesc = importeBruto * (descPorc / 100);
      const importeNeto = importeBruto - montoDesc;

      subtotal += importeNeto;
      descuentoTotal += montoDesc;
      costoTotal += (cant * costo);

      return { ...p, cant, precio, costo, descPorc, importeNeto };
    });

    const iva = subtotal * 0.16;
    const total = subtotal + iva;
    const utilidad = subtotal - costoTotal;
    const margen = subtotal > 0 ? ((utilidad / subtotal) * 100) : 0;

    // 3. GENERAR FOLIO
    const resCount = await client.query("SELECT COUNT(*) FROM cotizaciones");
    const folioFinal = `COT-${new Date().getFullYear().toString().slice(-2)}-${(parseInt(resCount.rows[0].count) + 1).toString().padStart(3, '0')}`;

    // 4. INSERTAR CABECERA
    const resCab = await client.query(`
      INSERT INTO cotizaciones 
      (folio, cliente_id, fecha_creacion, validez_dias, notas, notas_internas, 
       subtotal, descuento, iva, monto_total, costo_estimado, utilidad_estimada, margen_porcentaje, estado)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Borrador')
      RETURNING id
    `, [folioFinal, idClienteFinal, fecha_emision || new Date(), safeInt(vigencia_dias) || 15, notas_publicas, notas_privadas,
        subtotal, descuentoTotal, iva, total, costoTotal, utilidad, margen]);

    const cotId = resCab.rows[0].id;

    // 5. INSERTAR DETALLES
    for (let p of partidasProcesadas) {
      let prodId = safeInt(p.id_producto);
      
      // Guardar en catálogo si es nuevo y se pidió
      if (!prodId && p.guardar_en_catalogo && p.descripcion) {
         const nuevoProd = await client.query(`
            INSERT INTO productos_catalogo (nombre, unidad, precio_base, costo_base, activo)
            VALUES ($1, $2, $3, $4, true) RETURNING id`, 
            [p.descripcion.trim(), p.unidad, p.precio, p.costo]);
         prodId = nuevoProd.rows[0].id;
      }

      await client.query(`
        INSERT INTO cotizaciones_partidas 
        (cotizacion_id, producto_id, descripcion, cantidad, unidad, precio_unitario, costo_unitario, descuento_porcentaje, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [cotId, prodId, p.descripcion, p.cant, p.unidad, p.precio, p.costo, p.descPorc, p.importeNeto]);
    }

    await client.query('COMMIT');
    
    // REDIRECCIÓN CORRECTA
    res.json({ success: true, redirect: '/app/finanzas' });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;