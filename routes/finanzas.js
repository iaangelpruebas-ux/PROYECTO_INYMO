var express = require('express');
var router = express.Router();
const { Pool } = require('pg');

// 🔌 CONEXIÓN SEGURA A BASE DE DATOS (NEON)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* --- MIDDLEWARE DE SEGURIDAD (EL GUARDIA) --- */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next();
  else res.redirect('/login');
};

/* ==========================================================================
   RUTA 1: EL HUB CENTRAL / DASHBOARD (/app/finanzas)
   Calcula los KPIs financieros y muestra la actividad reciente.
   ========================================================================== */
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();

    // 1. ANÁLISIS DE INTELIGENCIA COMERCIAL (KPIs)
    // Usamos COALESCE para que si no hay datos, devuelva 0 en lugar de NULL
    const queryKPIs = `
      SELECT 
        COUNT(*) as total,
        -- Conteo por Estados
        COALESCE(SUM(CASE WHEN estado = 'Borrador' THEN 1 ELSE 0 END), 0) as borradores,
        COALESCE(SUM(CASE WHEN estado = 'Pendiente' THEN 1 ELSE 0 END), 0) as activas,
        COALESCE(SUM(CASE WHEN estado = 'Aceptada' THEN 1 ELSE 0 END), 0) as ganadas,
        COALESCE(SUM(CASE WHEN estado = 'Rechazada' THEN 1 ELSE 0 END), 0) as perdidas,
        
        -- Dinero (Flujo de Caja Proyectado)
        COALESCE(SUM(CASE WHEN estado = 'Aceptada' THEN monto_total ELSE 0 END), 0) as dinero_ganado,
        COALESCE(SUM(CASE WHEN estado = 'Pendiente' THEN monto_total ELSE 0 END), 0) as dinero_juego,
        
        -- Eficiencia (Para gráficas)
        COALESCE(AVG(CASE WHEN estado = 'Aceptada' THEN margen_porcentaje ELSE NULL END), 0) as margen_promedio_ganado
      FROM cotizaciones
    `;
    const resStats = await client.query(queryKPIs);
    const stats = resStats.rows[0];

    // 2. ÚLTIMA ACTIVIDAD (RESUMEN EJECUTIVO)
    // Traemos las últimas 5 para el tablero rápido
    const resRecientes = await client.query(`
      SELECT 
        c.id, c.folio, c.fecha_creacion, c.monto_total, c.estado, 
        cl.nombre_comercial 
      FROM cotizaciones c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      ORDER BY c.fecha_creacion DESC 
      LIMIT 6
    `);

    // Renderizamos la vista del HUB con toda la data
    res.render('app_finanzas_hub', {
      title: 'Centro de Finanzas | INYMO',
      usuario: req.session.nombreUsuario,
      kpis: stats,
      recientes: resRecientes.rows
    });

  } catch (err) {
    console.error("❌ Error Crítico en Hub Finanzas:", err);
    res.status(500).render('error', { 
        message: "Error al cargar el panel financiero", 
        error: req.app.get('env') === 'development' ? err : {} 
    });
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   RUTA 2: HISTORIAL AVANZADO (/app/finanzas/historial)
   Tabla maestra con buscador, filtros y cálculos de margen.
   ========================================================================== */
router.get('/historial', verificarSesion, async function(req, res) {
  let client;
  const { q, estado, fecha_inicio, fecha_fin } = req.query; // Filtros recibidos por URL

  try {
    client = await pool.connect();

    // Construcción Dinámica de la Consulta SQL
    let query = `
      SELECT 
        c.id, c.folio, c.fecha_creacion, c.validez_dias, 
        c.monto_total, c.estado, c.utilidad_estimada, c.margen_porcentaje,
        cl.nombre_comercial, cl.contacto,
        -- Calculamos días restantes de validez
        (c.fecha_creacion + make_interval(days => c.validez_dias)) as fecha_vencimiento
      FROM cotizaciones c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      WHERE 1=1
    `;
    
    let params = [];
    let counter = 1;

    // A. Filtro por Texto (Buscador)
    if (q) {
      query += ` AND (c.folio ILIKE $${counter} OR cl.nombre_comercial ILIKE $${counter} OR c.notas ILIKE $${counter})`;
      params.push(`%${q}%`);
      counter++;
    }

    // B. Filtro por Estado
    if (estado && estado !== 'Todos') {
      query += ` AND c.estado = $${counter}`;
      params.push(estado);
      counter++;
    }

    // C. Ordenamiento por defecto (Lo más nuevo arriba)
    query += ` ORDER BY c.fecha_creacion DESC LIMIT 100`;

    const resHistorial = await client.query(query, params);

    res.render('app_finanzas_historial', {
      title: 'Historial de Cotizaciones | INYMO',
      cotizaciones: resHistorial.rows,
      filtros: { q, estado }
    });

  } catch (err) {
    console.error("Error en Historial:", err);
    res.send("Error al cargar historial de cotizaciones.");
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   RUTA 3: VISTA DE DETALLE / EXPEDIENTE (/app/finanzas/detalle/:id)
   Muestra el desglose completo de una cotización ya guardada.
   ========================================================================== */
router.get('/detalle/:id', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        const idCot = req.params.id;

        // 1. Obtener Cabecera (Datos generales)
        const resCabecera = await client.query(`
            SELECT c.*, cl.nombre_comercial, cl.rfc, cl.contacto, cl.correo, cl.telefono
            FROM cotizaciones c
            LEFT JOIN clientes cl ON c.cliente_id = cl.id
            WHERE c.id = $1
        `, [idCot]);

        if (resCabecera.rows.length === 0) {
            return res.redirect('/app/finanzas/historial');
        }

        // 2. Obtener Partidas (El desglose)
        const resPartidas = await client.query(`
            SELECT * FROM cotizaciones_partidas 
            WHERE cotizacion_id = $1 
            ORDER BY id ASC
        `, [idCot]);

        res.render('app_cotizacion_detalle', {
            title: `Detalle ${resCabecera.rows[0].folio}`,
            c: resCabecera.rows[0],
            items: resPartidas.rows
        });

    } catch (e) {
        console.error(e);
        res.send("Error al cargar el detalle.");
    } finally {
        if (client) client.release();
    }
});

/* ==========================================================================
   RUTA 4: API PARA CAMBIAR ESTADO (Aceptar/Rechazar)
   Se llama desde el historial o el detalle para actualizar status.
   ========================================================================== */
router.post('/cambiar-estado', verificarSesion, async function(req, res) {
    const { id, nuevo_estado } = req.body;
    let client;
    try {
        client = await pool.connect();
        
        // Validamos estados permitidos
        const estadosValidos = ['Pendiente', 'Aceptada', 'Rechazada', 'Borrador'];
        if (!estadosValidos.includes(nuevo_estado)) {
            throw new Error("Estado no válido");
        }

        await client.query("UPDATE cotizaciones SET estado = $1 WHERE id = $2", [nuevo_estado, id]);
        
        res.json({ success: true, mensaje: "Estado actualizado correctamente." });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    } finally {
        if (client) client.release();
    }
});


/* ==========================================================================
   RUTA 5: VISTA DE IMPRESIÓN (PDF WEB)
   Renderiza la cotización en formato limpio para imprimir/guardar como PDF.
   ========================================================================== */
router.get('/pdf/:id', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        const idCot = req.params.id;

        // Datos completos
        const resCabecera = await client.query(`
            SELECT c.*, cl.nombre_comercial, cl.rfc, cl.contacto, cl.correo, cl.telefono
            FROM cotizaciones c
            LEFT JOIN clientes cl ON c.cliente_id = cl.id
            WHERE c.id = $1
        `, [idCot]);

        const resPartidas = await client.query(`
            SELECT * FROM cotizaciones_partidas 
            WHERE cotizacion_id = $1 
            ORDER BY id ASC
        `, [idCot]);

        if (resCabecera.rows.length === 0) return res.send("Cotización no encontrada");

        res.render('app_cotizacion_print', {
            layout: false, // No usa el layout principal (sin sidebar ni header)
            c: resCabecera.rows[0],
            items: resPartidas.rows
        });

    } catch (e) {
        res.send("Error al generar PDF");
    } finally {
        if (client) client.release();
    }
});






module.exports = router;