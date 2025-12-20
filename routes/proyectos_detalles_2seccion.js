/**
 * ====================================================================================================
 * * I N Y M O   E N T E R P R I S E   S Y S T E M S
 * * MÓDULO 2: MOTOR OPERATIVO Y TRANSACCIONAL (WRITE & UPDATE ENGINE)
 * ====================================================================================================
 * @file        routes/proyectos_detalles_2seccion.js
 * @description 
 * Este archivo gestiona la OPERACIÓN DEL PROYECTO. Se encarga de:
 * 1. Registrar Gastos (Bitácora Financiera).
 * 2. Administrar el WBS (Entregables y Avance).
 * 3. Gestión de Riesgos, Hitos y Control de Cambios.
 * 4. Configuración y Edición de parámetros del proyecto.
 * * CADA ACCIÓN DISPARA UNA RECALIBRACIÓN DEL SPI/CPI.
 * ====================================================================================================
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// 🔌 CONEXIÓN TRANSACCIONAL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware de Seguridad
const verificarSesion = (req, res, next) => {
    if (req.session.usuarioLogueado) {
        req.session.touch();
        next();
    } else {
        res.redirect('/login');
    }
};

/**
 * MOTOR DE SINCRONIZACIÓN (Duplicado intencionalmente para independencia de módulo)
 * Recalcula SPI/CPI tras cada operación de escritura.
 */
const sincronizarIndicadores = async (proyectoId) => {
    let client;
    try {
        client = await pool.connect();
        const queryData = `
            SELECT p.*,
            (SELECT COALESCE(SUM(monto_relacionado), 0) FROM bitacora WHERE proyecto_id = p.id AND tipo_registro = 'Gasto') as total_gastos,
            (SELECT COALESCE(SUM(impacto_costo), 0) FROM control_cambios WHERE proyecto_id = p.id AND estatus = 'Aprobado') as aditivas_costo,
            (SELECT COALESCE(SUM(impacto_tiempo), 0) FROM control_cambios WHERE proyecto_id = p.id AND estatus = 'Aprobado') as aditivas_tiempo
            FROM proyectos p WHERE p.id = $1
        `;
        const res = await client.query(queryData, [proyectoId]);
        const p = res.rows[0];
        if (!p) return;

        const BAC = parseFloat(p.presupuesto) + parseFloat(p.aditivas_costo);
        const AC = parseFloat(p.total_gastos) + (parseFloat(p.costo_acumulado) || 0);
        const Avance = (parseFloat(p.progreso) || 0) / 100;
        const EV = BAC * Avance; 

        const fInicio = p.fecha_inicio ? new Date(p.fecha_inicio) : new Date(p.created_at);
        const fFin = new Date(p.fecha_fin);
        fFin.setDate(fFin.getDate() + parseInt(p.aditivas_tiempo));

        const hoy = new Date();
        const duracion = fFin - fInicio;
        const transcurrido = hoy - fInicio;
        let pctTiempo = duracion > 0 ? Math.min(Math.max(transcurrido / duracion, 0), 1) : 0;
        const PV = BAC * pctTiempo;

        let spi = (PV > 0) ? (EV / PV) : 1.00;
        let cpi = (AC > 0) ? (EV / AC) : 1.00;

        if (p.progreso === 0) { spi = 1.00; cpi = 1.00; }
        else if (AC === 0 && p.progreso > 0) { cpi = 1.00; }

        await client.query("UPDATE proyectos SET spi = $1, cpi = $2 WHERE id = $3", [spi.toFixed(2), cpi.toFixed(2), proyectoId]);
        console.log(`[SYNC-OP] Proyecto ${p.codigo} actualizado.`);
    } catch (err) {
        console.error("[SYNC-OP ERROR]", err);
    } finally {
        if (client) client.release();
    }
};

/* ====================================================================================================
 * A. RUTAS DE CONFIGURACIÓN Y EDICIÓN (SOLUCIÓN ERROR 404)
 * ==================================================================================================== */

// GET: Mostrar Formulario de Edición
router.get('/:id/editar', verificarSesion, async function(req, res) {
    const id = req.params.id;
    let client;
    try {
        client = await pool.connect();
        const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
        const p = resP.rows[0];

        if (!p) {
            client.release();
            return res.status(404).send("Proyecto no encontrado.");
        }
        client.release();

        res.render('app_proyecto_editar', { 
            title: `Configurar ${p.codigo}`,
            p: p,
            usuario: req.session.nombreUsuario
        });
    } catch (err) {
        if (client) client.release();
        console.error(err);
        res.status(500).send("Error al cargar configuración.");
    }
});

// POST: Guardar Cambios de Configuración
router.post('/actualizar/:id', verificarSesion, async function(req, res) {
    const id = req.params.id;
    const d = req.body;
    try {
        await pool.query(
            `UPDATE proyectos SET 
                nombre = $1, cliente = $2, lider = $3, progreso = $4, 
                fase = $5, tipo_entrega = $6, narrativa = $7, 
                metas_proximos_pasos = $8, presupuesto = $9, 
                valor_negocio = $10, fecha_fin = $11, riesgo = $12
            WHERE id = $13`,
            [
                d.nombre, d.cliente, d.lider, parseInt(d.progreso), 
                d.fase, d.tipo_entrega, d.narrativa, 
                d.metas_proximos_pasos, parseFloat(d.presupuesto), 
                parseFloat(d.valor_negocio), d.fecha_fin, d.riesgo, id
            ]
        );
        await sincronizarIndicadores(id);
        res.redirect(`/app/proyectos/${id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error al actualizar proyecto.");
    }
});

/* ====================================================================================================
 * B. GESTIÓN FINANCIERA (BITÁCORA DE GASTOS)
 * ==================================================================================================== */

router.post('/:id/gasto', verificarSesion, async (req, res) => {
    const { concepto, monto, fecha } = req.body;
    try {
        await pool.query('BEGIN');
        await pool.query(
            "INSERT INTO bitacora (proyecto_id, titulo, descripcion, tipo_registro, monto_relacionado, fecha_registro) VALUES ($1, $2, 'Gasto Operativo', 'Gasto', $3, $4)",
            [req.params.id, 'Gasto: ' + concepto, parseFloat(monto), fecha || new Date()]
        );
        // Actualizamos acumulado manual
        await pool.query("UPDATE proyectos SET costo_acumulado = COALESCE(costo_acumulado,0) + $1 WHERE id = $2", [parseFloat(monto), req.params.id]);
        await pool.query('COMMIT');
        
        await sincronizarIndicadores(req.params.id);
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (e) {
        await pool.query('ROLLBACK');
        res.status(500).send("Error al registrar gasto.");
    }
});

/* ====================================================================================================
 * C. GESTIÓN DEL ALCANCE (WBS / ENTREGABLES)
 * ==================================================================================================== */

router.post('/:id/entregable', verificarSesion, async (req, res) => {
    const { nombre, responsable, fecha_entrega } = req.body;
    await pool.query(
        "INSERT INTO entregables (proyecto_id, nombre, responsable, fecha_entrega, progreso, estado) VALUES ($1, $2, $3, $4, 0, 'Pendiente')",
        [req.params.id, nombre, responsable, fecha_entrega]
    );
    await sincronizarIndicadores(req.params.id);
    res.redirect(`/app/proyectos/${req.params.id}#wbs`);
});

router.post('/:id/entregable/:eid/actualizar', verificarSesion, async (req, res) => {
    const { nuevo_progreso } = req.body;
    const prog = parseInt(nuevo_progreso);
    const estado = prog === 100 ? 'Completado' : (prog > 0 ? 'En Curso' : 'Pendiente');
    
    await pool.query("UPDATE entregables SET progreso = $1, estado = $2 WHERE id = $3", [prog, estado, req.params.eid]);
    
    // Recalcular promedio de avance automático
    const resAvg = await pool.query("SELECT AVG(progreso) FROM entregables WHERE proyecto_id = $1", [req.params.id]);
    const avgVal = Math.round(resAvg.rows[0].avg || 0);
    await pool.query("UPDATE proyectos SET progreso = $1 WHERE id = $2", [avgVal, req.params.id]);
    
    await sincronizarIndicadores(req.params.id);
    res.redirect(`/app/proyectos/${req.params.id}#wbs`);
});

router.get('/:id/entregable/eliminar/:eid', verificarSesion, async (req, res) => {
    await pool.query("DELETE FROM entregables WHERE id = $1", [req.params.eid]);
    await sincronizarIndicadores(req.params.id);
    res.redirect(`/app/proyectos/${req.params.id}#wbs`);
});

/* ====================================================================================================
 * D. GESTIÓN DE RIESGOS Y CALIDAD
 * ==================================================================================================== */

router.post('/:id/riesgo', verificarSesion, async (req, res) => {
    const { descripcion, impacto } = req.body;
    await pool.query("INSERT INTO riesgos (proyecto_id, descripcion, impacto, estado) VALUES ($1, $2, $3, 'Activo')", 
        [req.params.id, descripcion, impacto]);
    res.redirect(`/app/proyectos/${req.params.id}#riesgos`);
});

router.get('/:id/riesgo/eliminar/:rid', verificarSesion, async (req, res) => {
    await pool.query("DELETE FROM riesgos WHERE id = $1", [req.params.rid]);
    res.redirect(`/app/proyectos/${req.params.id}#riesgos`);
});

/* ====================================================================================================
 * E. GESTIÓN DE CRONOGRAMA (HITOS)
 * ==================================================================================================== */

router.post('/:id/hito', verificarSesion, async (req, res) => {
    const { nombre, fecha } = req.body;
    await pool.query("INSERT INTO hitos (proyecto_id, nombre, fecha, estado) VALUES ($1, $2, $3, 'Pendiente')", 
        [req.params.id, nombre, fecha]);
    res.redirect(`/app/proyectos/${req.params.id}#cronograma`);
});

router.get('/:id/hito/eliminar/:hid', verificarSesion, async (req, res) => {
    await pool.query("DELETE FROM hitos WHERE id = $1", [req.params.hid]);
    res.redirect(`/app/proyectos/${req.params.id}#cronograma`);
});

/* ====================================================================================================
 * F. GESTIÓN DE COMUNICACIONES (BITÁCORA GENERAL)
 * ==================================================================================================== */

router.post('/:id/bitacora', verificarSesion, async (req, res) => {
    const { titulo, descripcion, tipo_registro } = req.body;
    await pool.query(
        "INSERT INTO bitacora (proyecto_id, titulo, descripcion, tipo_registro, fecha_registro) VALUES ($1, $2, $3, $4, NOW())",
        [req.params.id, titulo, descripcion, tipo_registro]
    );
    res.redirect(`/app/proyectos/${req.params.id}#bitacora`);
});

router.get('/:id/bitacora/eliminar/:bid', verificarSesion, async (req, res) => {
    await pool.query("DELETE FROM bitacora WHERE id = $1", [req.params.bid]);
    res.redirect(`/app/proyectos/${req.params.id}#bitacora`);
});

/* ====================================================================================================
 * G. GESTIÓN DE CAMBIOS (CHANGE CONTROL)
 * ==================================================================================================== */

router.post('/:id/cambio', verificarSesion, async (req, res) => {
    const { titulo, descripcion, impacto_costo, impacto_tiempo } = req.body;
    await pool.query(
        "INSERT INTO control_cambios (proyecto_id, titulo, descripcion, impacto_costo, impacto_tiempo, estatus, fecha_registro) VALUES ($1, $2, $3, $4, $5, 'Pendiente', NOW())",
        [req.params.id, titulo, descripcion, parseFloat(impacto_costo)||0, parseInt(impacto_tiempo)||0]
    );
    res.redirect(`/app/proyectos/${req.params.id}#cambios`);
});

router.post('/:id/cambio/:cid/aprobar', verificarSesion, async (req, res) => {
    await pool.query("UPDATE control_cambios SET estatus = 'Aprobado' WHERE id = $1", [req.params.cid]);
    await sincronizarIndicadores(req.params.id);
    res.redirect(`/app/proyectos/${req.params.id}#cambios`);
});

router.post('/:id/cambio/:cid/rechazar', verificarSesion, async (req, res) => {
    await pool.query("UPDATE control_cambios SET estatus = 'Rechazado' WHERE id = $1", [req.params.cid]);
    res.redirect(`/app/proyectos/${req.params.id}#cambios`);
});

router.get('/:id/cambio/eliminar/:cid', verificarSesion, async (req, res) => {
    await pool.query("DELETE FROM control_cambios WHERE id = $1", [req.params.cid]);
    res.redirect(`/app/proyectos/${req.params.id}#cambios`);
});

/* ====================================================================================================
 * H. GESTIÓN DE CICLO DE VIDA (ARCHIVAR/ELIMINAR)
 * ==================================================================================================== */

router.get('/eliminar/:id', verificarSesion, async (req, res) => {
    try {
        await pool.query("UPDATE proyectos SET salud = 'Archivado' WHERE id = $1", [req.params.id]);
        res.redirect('/app/proyectos');
    } catch (e) {
        res.status(500).send("Fallo al archivar proyecto.");
    }
});

module.exports = router;