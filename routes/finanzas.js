var express = require('express');
var router = express.Router();
const { Pool } = require('pg');

// Pool (igual que tus otros módulos)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware de sesión (igual que inventario/logistica)
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next();
  else res.redirect('/login');
};

// Helper: calcula totales
function calcularTotales(subtotal, ivaPorc) {
  const st = Number(subtotal || 0);
  const iva = st * (Number(ivaPorc || 0) / 100);
  const total = st + iva;
  return { subtotal: st, iva, total };
}

/* ==========================================================================
   GET: DASHBOARD COTIZACIONES
   - Lista + KPIs
   - Si no existe tabla aún, usa mock para “probar UI”
   ========================================================================== */
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();

    // Intento: traer cotizaciones reales (si ya existe la tabla)
    const q = await client.query(`
      SELECT id, folio, cliente, concepto, subtotal, iva, total, estatus, fecha_creacion
      FROM cotizaciones
      ORDER BY fecha_creacion DESC
      LIMIT 50
    `);

    const cotizaciones = q.rows;

    // KPIs simples
    const totalMes = cotizaciones
      .filter(c => c.estatus === 'Aprobada')
      .reduce((acc, cur) => acc + Number(cur.total || 0), 0);

    res.render('app_cotizaciones', {
      title: 'Cotizaciones | INYMO',
      cotizaciones,
      kpis: {
        aprobadas: cotizaciones.filter(c => c.estatus === 'Aprobada').length,
        enviadas: cotizaciones.filter(c => c.estatus === 'Enviada').length,
        borradores: cotizaciones.filter(c => c.estatus === 'Borrador').length,
        totalMes
      }
    });

  } catch (err) {
    // Si la tabla no existe todavía, no te freno: te muestro UI con mock
    const tablaNoExiste = (err && err.code === '42P01'); // undefined_table en Postgres
    console.error("Cotizaciones | Error:", err.message);

    const cotizacionesMock = [
      { id: 1, folio: 'COT-0001', cliente: 'Cliente Demo', concepto: 'Estructura nave 300 m²', subtotal: 125000, iva: 20000, total: 145000, estatus: 'Borrador', fecha_creacion: new Date() },
      { id: 2, folio: 'COT-0002', cliente: 'Constructora X', concepto: 'Suministro IPR + montaje', subtotal: 280000, iva: 44800, total: 324800, estatus: 'Enviada', fecha_creacion: new Date() },
      { id: 3, folio: 'COT-0003', cliente: 'Parque Industrial Y', concepto: 'Proyecto ejecutivo + memoria', subtotal: 90000, iva: 14400, total: 104400, estatus: 'Aprobada', fecha_creacion: new Date() }
    ];

    res.render('app_cotizaciones', {
      title: 'Cotizaciones | INYMO',
      cotizaciones: cotizacionesMock,
      kpis: {
        aprobadas: cotizacionesMock.filter(c => c.estatus === 'Aprobada').length,
        enviadas: cotizacionesMock.filter(c => c.estatus === 'Enviada').length,
        borradores: cotizacionesMock.filter(c => c.estatus === 'Borrador').length,
        totalMes: cotizacionesMock.filter(c => c.estatus === 'Aprobada').reduce((a, b) => a + b.total, 0)
      },
      modoDemo: tablaNoExiste
    });

  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   POST: CREAR COTIZACIÓN
   - Si existe tabla, inserta
   - Si no, redirige (UI demo)
   ========================================================================== */
router.post('/crear', verificarSesion, async function(req, res) {
  const { cliente, concepto, subtotal, iva_porcentaje, estatus } = req.body;
  const { subtotal: st, iva, total } = calcularTotales(subtotal, iva_porcentaje);

  let client;
  try {
    client = await pool.connect();

    // Genera folio simple (puedes reemplazarlo por secuencia)
    const folio = `COT-${String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0')}`;

    await client.query(`
      INSERT INTO cotizaciones (folio, cliente, concepto, subtotal, iva, total, estatus, fecha_creacion)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    `, [folio, cliente, concepto, st, iva, total, estatus || 'Borrador']);

    res.redirect('/app/finanzas');

  } catch (err) {
    console.error("Crear cotización | Error:", err.message);

    // Si aún no creaste tabla, no rompas: regresa con alert y listo
    res.send(`<script>alert("No se pudo guardar (probablemente falta crear tabla 'cotizaciones'). Se mostró UI demo.\\n\\nDetalle: ${err.message}"); window.location.href="/app/finanzas";</script>`);
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   GET: DETALLE (placeholder)
   ========================================================================== */
router.get('/:id', verificarSesion, async function(req, res) {
  const id = parseInt(req.params.id);
  let client;

  try {
    client = await pool.connect();
    const q = await client.query(`
      SELECT id, folio, cliente, concepto, subtotal, iva, total, estatus, fecha_creacion
      FROM cotizaciones WHERE id = $1
    `, [id]);

    if (!q.rows.length) return res.status(404).send("Cotización no encontrada");

    res.render('app_cotizacion_detalle', {
      title: 'Detalle de cotización | INYMO',
      cotizacion: q.rows[0]
    });

  } catch (err) {
    console.error("Detalle cotización | Error:", err.message);
    res.send(`<script>alert("No se pudo abrir detalle. (Si no existe tabla, es normal en modo demo)."); window.location.href="/app/finanzas";</script>`);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
