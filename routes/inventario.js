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
   GET: DASHBOARD DE LOGÍSTICA Y DISTRIBUCIÓN
   Vista consolidada que separa el material en uso del material libre.
   ========================================================================== */
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    
    // 1. MATERIALES EN OBRA (Mapa detallado por proyecto)
    // Agrupa qué tiene cada obra y cuánto dinero representa esa inversión en campo.
    const resMatProyectos = await client.query(`
      SELECT 
        p.id as proyecto_id, p.nombre as proyecto_nombre,
        JSON_AGG(json_build_object(
            'stock_id', s.id, 'articulo_id', ic.id, 'nombre', ic.nombre,
            'cantidad', s.cantidad, 'unidad', ic.unidad_medida,
            'valor', (s.cantidad * ic.precio_promedio_mxn),
            'fecha_llegada', s.fecha_entrada
        ) ORDER BY ic.nombre) as materiales,
        SUM(s.cantidad * ic.precio_promedio_mxn) as valor_total_proyecto
      FROM inventario_stock s
      JOIN proyectos p ON s.proyecto_origen_id = p.id
      JOIN inventario_catalogo ic ON s.articulo_id = ic.id
      WHERE s.cantidad > 0
      GROUP BY p.id, p.nombre ORDER BY p.nombre ASC
    `);

    // 2. MATERIAL LIBRE EN BODEGA (Para asignación inmediata)
    // Consolida lo disponible en Almacén Central sin importar el lote.
    const resDisponibles = await client.query(`
      SELECT ic.id, ic.nombre, ic.categoria, ic.unidad_medida, 
             SUM(s.cantidad) as libre,
             JSON_AGG(s.id) as stock_ids 
      FROM inventario_stock s
      JOIN inventario_catalogo ic ON s.articulo_id = ic.id
      WHERE s.cantidad > 0 AND s.proyecto_origen_id IS NULL
      GROUP BY ic.id, ic.nombre, ic.categoria, ic.unidad_medida 
      ORDER BY ic.nombre ASC
    `);

    // 3. DATOS PARA GRÁFICAS (Análisis de Inversión y Stock)
    // Top 5 de materiales donde hay más dinero invertido actualmente.
    const resTop = await client.query(`
      SELECT ic.nombre, SUM(s.cantidad * ic.precio_promedio_mxn) as total 
      FROM inventario_stock s 
      JOIN inventario_catalogo ic ON s.articulo_id = ic.id 
      WHERE s.cantidad > 0 
      GROUP BY ic.nombre ORDER BY total DESC LIMIT 5
    `);

    // Distribución porcentual por categorías (Acero, Eléctrico, etc).
    const resCatStats = await client.query(`
      SELECT ic.categoria, SUM(s.cantidad) as volumen 
      FROM inventario_stock s 
      JOIN inventario_catalogo ic ON s.articulo_id = ic.id 
      WHERE s.cantidad > 0 GROUP BY ic.categoria
    `);

    // KPI: Valor monetario total de todo el inventario (Bodega + Obras).
    const resValorGlobal = await client.query(`
      SELECT SUM(s.cantidad * ic.precio_promedio_mxn) as total 
      FROM inventario_stock s 
      JOIN inventario_catalogo ic ON s.articulo_id = ic.id 
      WHERE s.cantidad > 0
    `);

    res.render('app_inventario', { 
      title: 'Logística | INYMO',
      obras: resMatProyectos.rows,
      disponibles: resDisponibles.rows,
      kpis: { total: parseFloat(resValorGlobal.rows[0].total || 0) },
      chartData: {
          topNombres: resTop.rows.map(r => r.nombre),
          topValores: resTop.rows.map(r => r.total),
          catNombres: resCatStats.rows.map(r => r.categoria),
          catVolumen: resCatStats.rows.map(r => r.volumen)
      },
      // Lista de proyectos para el selector del modal de transferencia
      proyectos: (await client.query(`SELECT id, nombre FROM proyectos WHERE salud <> 'Archivado' ORDER BY nombre ASC`)).rows,
      // Lista de categorías activa para filtros en la vista
      listaCategorias: (await client.query(`SELECT nombre FROM inventario_categorias WHERE activo = true ORDER BY nombre ASC`)).rows
    });

  } catch (err) {
    console.error("Error crítico en Dashboard de Logística:", err);
    res.status(500).send("Error interno en el servidor.");
  } finally { if (client) client.release(); }
});

/* ==========================================================================
   POST: TRANSFERENCIA (LÓGICA FIFO INTEGRAL)
   Mueve material entre Bodega y Obras, u Obras entre sí.
   ========================================================================== */
router.post('/transferencia', verificarSesion, async function(req, res) {
    const { stock_origen_id, cantidad, destino_tipo, destino_id_proyecto } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. IDENTIFICACIÓN Y VALIDACIÓN DE ORIGEN
        const info = await client.query(`
            SELECT articulo_id, proyecto_origen_id 
            FROM inventario_stock WHERE id = $1`, [stock_origen_id]);
        
        if (info.rows.length === 0) throw new Error("La referencia de stock ya no es válida.");
        
        const { articulo_id, proyecto_origen_id } = info.rows[0];
        const cantMover = parseFloat(cantidad);

        // 2. LÓGICA DE CONSUMO MULTI-LOTE (FIFO)
        // Buscamos todos los lotes del mismo material en la misma ubicación para poder sumar.
        const lotes = await client.query(`
            SELECT s.id, s.cantidad, ic.precio_promedio_mxn 
            FROM inventario_stock s 
            JOIN inventario_catalogo ic ON s.articulo_id = ic.id
            WHERE s.articulo_id = $1 AND (s.proyecto_origen_id IS NOT DISTINCT FROM $2)
            ORDER BY s.fecha_entrada ASC FOR UPDATE`, [articulo_id, proyecto_origen_id]);

        let disponibleTotal = lotes.rows.reduce((acc, cur) => acc + parseFloat(cur.cantidad), 0);
        
        if (cantMover > disponibleTotal) {
            throw new Error(`Stock insuficiente. Intentas mover ${cantMover} pero solo hay ${disponibleTotal} disponibles.`);
        }

        // 3. DESCUENTO DE STOCK (Borrado o Actualización lote por lote)
        let restante = cantMover;
        for (let lote of lotes.rows) {
            if (restante <= 0) break;
            let cantLote = parseFloat(lote.cantidad);
            let aQuitar = Math.min(cantLote, restante);
            
            if (cantLote === aQuitar) {
                await client.query('DELETE FROM inventario_stock WHERE id = $1', [lote.id]);
            } else {
                await client.query('UPDATE inventario_stock SET cantidad = cantidad - $1 WHERE id = $2', [aQuitar, lote.id]);
            }
            restante -= aQuitar;
        }

        // 4. CREACIÓN EN DESTINO
        let proyDestId = (destino_tipo === 'PROYECTO') ? parseInt(destino_id_proyecto) : null;
        let ubiTexto = 'Almacén Central';
        let tipoMovKardex = destino_tipo; // 'BODEGA', 'PROYECTO' o 'BAJA'

        if (proyDestId) {
            const p = await client.query('SELECT nombre FROM proyectos WHERE id=$1', [proyDestId]);
            ubiTexto = 'Obra: ' + p.rows[0].nombre;
            tipoMovKardex = 'TRANSFERENCIA A OBRA';
        } else if (destino_tipo === 'BODEGA') {
            tipoMovKardex = 'RETORNO A BODEGA';
        }

        // Si no es una baja definitiva (merma), creamos el registro en el nuevo destino
        if (destino_tipo !== 'BAJA') {
            await client.query(`
                INSERT INTO inventario_stock (articulo_id, proyecto_origen_id, cantidad, ubicacion, fecha_entrada) 
                VALUES ($1, $2, $3, $4, NOW())`, 
                [articulo_id, proyDestId, cantMover, ubiTexto]);
        }

        // 5. REGISTRO EN HISTORIAL (Kardex de Auditoría)
        const valorMov = cantMover * parseFloat(lotes.rows[0].precio_promedio_mxn || 0);
        await client.query(`
            INSERT INTO inventario_movimientos (articulo_id, proyecto_id, tipo_movimiento, cantidad, monto_mxn, fecha) 
            VALUES ($1, $2, $3, $4, $5, NOW())`, 
            [articulo_id, proyDestId, tipoMovKardex, cantMover, valorMov]);

        await client.query('COMMIT');
        res.redirect('/app/inventario');

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error("Error en proceso de transferencia:", err.message);
        res.send(`<script>alert("Error: ${err.message}"); window.location.href="/app/inventario";</script>`);
    } finally { if (client) client.release(); }
});

/* ==========================================================================
   POST: ASIGNACIÓN RÁPIDA DESDE BODEGA
   Simplifica el envío de material libre a proyectos específicos.
   ========================================================================== */
router.post('/asignar-desde-bodega', verificarSesion, async function(req, res) {
    const { articulo_id, cantidad, proyecto_destino_id } = req.body;
    let client;
    try {
        client = await pool.connect();
        // Buscamos un lote libre (null) del artículo solicitado
        const lote = await client.query(`
            SELECT id FROM inventario_stock 
            WHERE articulo_id=$1 AND proyecto_origen_id IS NULL AND cantidad > 0 
            LIMIT 1`, [articulo_id]);
        
        if(lote.rows.length === 0) throw new Error("No hay stock libre en bodega para este material.");
        
        // Reutilizamos la lógica de transferencia universal enviando los datos necesarios
        req.body.stock_origen_id = lote.rows[0].id;
        req.body.destino_tipo = 'PROYECTO';
        // El proyecto_destino_id ya viene en el body
        
        // Redirección interna manual a la lógica de transferencia
        return router.handle_post_transferencia(req, res, client); // Función abstracta conceptual
    } catch(e) { res.send(`<script>alert("${e.message}"); window.location.href="/app/inventario";</script>`); }
    finally { if (client) client.release(); }
});

/* ==========================================================================
   GET: ELIMINAR STOCK (CORRECCIÓN MANUAL)
   Permite dar de baja un lote específico por error de captura o pérdida total.
   ========================================================================== */
router.get('/eliminar-stock/:id', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('DELETE FROM inventario_stock WHERE id = $1', [req.params.id]);
        client.release();
        res.redirect('/app/inventario');
    } catch (e) { res.status(500).send("Error al eliminar registro de stock."); }
});

module.exports = router;