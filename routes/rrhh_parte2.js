/**
 * =========================================================================
 * INYMO - SISTEMA DE GESTIÓN DE CAPITAL HUMANO (PARTE 2)
 * =========================================================================
 * Archivo: routes/rrhh_parte2.js
 * Versión: 4.0.0 - Edición "Compliance & Confidential Vault"
 * * DESCRIPCIÓN: 
 * Controlador de alto nivel para las divisiones estratégicas finales (06-10).
 * Integra gestión académica, planes de acción, auditoría ejecutiva,
 * cumplimiento legal/HSE y seguridad de datos sensibles (Socio Director).
 * * * REGLAS DE NEGOCIO:
 * 1. Formato Moneda: Todo valor financiero se procesa vía toMXN.
 * 2. Trazabilidad: Registro de auditoría para accesos a la División 10.
 * 3. Seguridad: Middleware 'verificarRangoSocio' obligatorio para 08 y 10.
 * 4. Resiliencia: Objetivos blindados con valores por defecto para evitar crashes.
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

/**
 * 🔌 CONFIGURACIÓN DE CONEXIÓN A BASE DE DATOS
 * Pool de conexiones con soporte SSL para entornos de alta seguridad.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * 🛡️ MIDDLEWARES DE SEGURIDAD CORPORATIVA
 */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next(); 
  else res.redirect('/login');
};

/**
 * Middleware: Rango Socio Director
 * Blindaje exclusivo para Ángel Velasco y roles con jerarquía de Socio.
 */
const verificarRangoSocio = (req, res, next) => {
    const user = req.session.nombreUsuario;
    const esSocio = user === 'Ángel Velasco' || req.session.rol === 'Socio';
    
    if (esSocio) {
        next();
    } else {
        // Registro de intento fallido en consola para monitoreo de seguridad
        console.warn(`[SECURITY ALERT] Intento de acceso no autorizado a área restringida por: ${user}`);
        res.status(403).render('error', { 
            message: "ACCESO RESTRINGIDO: Esta sección contiene información patrimonial y legal reservada para la Dirección General.",
            error: { status: 403 }
        });
    }
};

/**
 * 🛠️ UTILIDADES FINANCIERAS (MXN)
 * Asegura que los reportes ejecutivos mantengan el formato de pesos con comas.
 */
const toMXN = (val) => {
    const num = parseFloat(val) || 0;
    return new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    }).format(num);
};

/* ==========================================================================
   06. DIVISIÓN: DESARROLLO Y CAPACIDAD (ACADEMIA INYMO)
   ========================================================================== */
router.get('/division/06', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    const resCursos = await client.query('SELECT * FROM rrhh_cursos ORDER BY nombre ASC');
    const resProgreso = await client.query(`
        SELECT c.nombre_completo, p.nombre as puesto, COUNT(cap.id) as total_cursos,
        SUM(CASE WHEN cap.estatus = 'Completado' THEN 1 ELSE 0 END) as completados
        FROM rrhh_colaboradores c
        JOIN rrhh_puestos p ON c.puesto_id = p.id
        LEFT JOIN rrhh_capacitaciones cap ON c.id = cap.colaborador_id
        WHERE c.estatus = 'Activo'
        GROUP BY c.id, p.nombre ORDER BY total_cursos DESC
    `);
    
    const resInversion = await client.query('SELECT COALESCE(SUM(costo_inscripcion), 0) as total FROM rrhh_cursos');
    const resCerts = await client.query('SELECT COUNT(*) as t FROM rrhh_cursos WHERE es_certificacion = true');
    const colabs = await client.query('SELECT id, nombre_completo FROM rrhh_colaboradores WHERE estatus = $1', ['Activo']);

    res.render('app_rrhh_desarrollo', { 
        title: 'Academia INYMO | Desarrollo', 
        cursos: resCursos.rows || [], 
        progreso: resProgreso.rows || [],
        colaboradores: colabs.rows || [],
        stats: {
            inversion: toMXN(resInversion.rows[0]?.total || 0),
            certificaciones: parseInt(resCerts.rows[0]?.t) || 0,
            horas_formacion: 120 
        },
        formatMoney: toMXN
    });
  } catch (err) { res.status(500).send("Fallo en módulo de capacitación."); }
  finally { if (client) client.release(); }
});

router.post('/division/06/curso/add', verificarSesion, async (req, res) => {
    const { nombre, proveedor, horas, costo, tipo, es_cert } = req.body;
    try {
        const client = await pool.connect();
        await client.query(`
            INSERT INTO rrhh_cursos (nombre, proveedor, duracion_horas, costo_inscripcion, tipo, es_certificacion)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [nombre, proveedor, parseInt(horas) || 0, parseFloat(costo) || 0, tipo, es_cert === 'on']);
        client.release();
        res.redirect('/app/rrhh/division/06');
    } catch (e) { res.status(500).send("Error en registro de curso."); }
});

/* ==========================================================================
   07. DIVISIÓN: PLANES DE ACCIÓN (MEJORA CONTINUA)
   ========================================================================== */
router.get('/division/07', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const resPlanes = await client.query(`
            SELECT pa.*, c.nombre_completo as responsable
            FROM rrhh_planes_accion pa
            LEFT JOIN rrhh_colaboradores c ON pa.responsable_id = c.id
            ORDER BY pa.fecha_limite ASC
        `);
        const resStats = await client.query(`
            SELECT COUNT(*) as total,
            SUM(CASE WHEN estatus = 'Pendiente' THEN 1 ELSE 0 END) as pendientes,
            SUM(CASE WHEN estatus = 'En Proceso' THEN 1 ELSE 0 END) as en_proceso,
            SUM(CASE WHEN estatus = 'Completado' THEN 1 ELSE 0 END) as completados
            FROM rrhh_planes_accion
        `);
        const resColabs = await client.query('SELECT id, nombre_completo FROM rrhh_colaboradores WHERE estatus = $1', ['Activo']);

        res.render('app_rrhh_planes', { 
            title: 'Mejora Continua | INYMO',
            planes: resPlanes.rows || [],
            colaboradores: resColabs.rows || [],
            kpis: {
                total: resStats.rows[0]?.total || 0,
                abiertos: (parseInt(resStats.rows[0]?.pendientes) || 0) + (parseInt(resStats.rows[0]?.en_proceso) || 0),
                completados: resStats.rows[0]?.completados || 0
            }
        });
    } catch (e) { res.status(500).send("Error en planes correctivos."); }
    finally { if(client) client.release(); }
});

/* ==========================================================================
   08. DIVISIÓN: REPORTES EJECUTIVOS (AUDITORÍA)
   ========================================================================== */
router.get('/division/08', verificarSesion, verificarRangoSocio, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const queryNomina = await client.query(`SELECT COUNT(*) as total, COALESCE(SUM(sueldo_mensual), 0) as bruta FROM rrhh_colaboradores WHERE estatus = 'Activo'`);
        const queryPlanes = await client.query(`SELECT COUNT(*) as total, ROUND((SUM(CASE WHEN estatus = 'Completado' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)::float) * 100) as efectividad FROM rrhh_planes_accion`);
        const queryDeptos = await client.query(`SELECT d.nombre, COUNT(c.id) as personal, COALESCE(SUM(c.sueldo_mensual), 0) as inversion FROM rrhh_departamentos d LEFT JOIN rrhh_colaboradores c ON d.id = c.departamento_id AND c.estatus = 'Activo' GROUP BY d.nombre`);

        res.render('app_rrhh_reportes', { 
            title: 'Reporte de Gestión | INYMO',
            auditoria: {
                plantilla: queryNomina.rows[0].total,
                nomina_mxn: toMXN(queryNomina.rows[0].bruta),
                fsr_mxn: toMXN(queryNomina.rows[0].bruta * 1.35),
                efectividad_mejora: queryPlanes.rows[0].efectividad || 0,
                inversion_cursos: toMXN(0),
                kpis_resumen: [
                    { label: 'Retención', value: '98%', status: 'success' },
                    { label: 'HSE Compliance', value: '100%', status: 'primary' }
                ]
            },
            departamentos: queryDeptos.rows,
            formatMoney: toMXN,
            fecha_reporte: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
        });
    } catch (e) { res.status(500).send("Error generando auditoría."); }
    finally { if(client) client.release(); }
});

/* ==========================================================================
   09. DIVISIÓN: CUMPLIMIENTO Y RIESGOS (LEGAL & HSE)
   ========================================================================== */

/**
 * GET: Centro de Cumplimiento Legal e Industrial
 * Monitorea incidentes, multas y vigencia de contratos.
 */
router.get('/division/09', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        
        // 1. Obtener incidentes HSE (Salud, Seguridad y Entorno)
        const resIncidentes = await client.query(`
            SELECT i.*, c.nombre_completo as reportado_por
            FROM rrhh_hse_incidentes i
            LEFT JOIN rrhh_colaboradores c ON i.reporta_id = c.id
            ORDER BY i.fecha_incidente DESC
        `);

        // 2. Estatus de Auditorías de Cumplimiento LFT
        const resCumplimiento = await client.query(`
            SELECT 
                COUNT(*) filter (where tipo = 'Legal') as tramites_legales,
                COUNT(*) filter (where tipo = 'HSE') as tramites_hse,
                SUM(CASE WHEN estatus = 'Vencido' THEN 1 ELSE 0 END) as alertas_vencidas
            FROM rrhh_cumplimiento_legal
        `);

        res.render('app_rrhh_cumplimiento', { 
            title: 'Compliance & HSE | INYMO',
            incidentes: resIncidentes.rows || [],
            stats: resCumplimiento.rows[0] || { tramites_legales: 0, tramites_hse: 0, alertas_vencidas: 0 },
            estatus_legal: 'Auditado Q4 2025'
        });
    } catch (e) {
        console.error("[ERROR DIV 09]:", e.message);
        res.status(500).send("Error en el módulo de cumplimiento legal.");
    } finally {
        if(client) client.release();
    }
});

/**
 * POST: Reportar Incidente de Seguridad (HSE)
 */
router.post('/division/09/hse/reportar', verificarSesion, async (req, res) => {
    const { tipo, descripcion, gravedad, fecha } = req.body;
    try {
        const client = await pool.connect();
        await client.query(`
            INSERT INTO rrhh_hse_incidentes (tipo, descripcion, gravedad, fecha_incidente, reporta_id)
            VALUES ($1, $2, $3, $4, $5)
        `, [tipo, descripcion, gravedad, fecha, req.session.usuarioId]);
        client.release();
        res.redirect('/app/rrhh/division/09');
    } catch (e) { res.status(500).send("No se pudo registrar el incidente."); }
});

/* ==========================================================================
   10. DIVISIÓN: CONFIDENCIAL (SOCIOS & VAULT)
   ========================================================================== */

/**
 * GET: Bóveda de Datos Sensibles
 * Acceso restringido a Ángel Velasco. Incluye log de auditoría.
 */
router.get('/division/10', verificarSesion, verificarRangoSocio, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        
        // 1. Registro automático de acceso a la bóveda (Auditoría interna)
        await client.query(`
            INSERT INTO rrhh_vault_logs (usuario, accion, ip_address)
            VALUES ($1, 'Acceso a Bóveda Confidencial', $2)
        `, [req.session.nombreUsuario, req.ip]);

        // 2. Obtener datos de capital social y socios (Simulado para estructura)
        const resSocios = await client.query('SELECT * FROM rrhh_socios_capital ORDER BY participacion DESC');

        // 3. Obtener logs de los últimos 20 accesos
        const resLogs = await client.query('SELECT * FROM rrhh_vault_logs ORDER BY fecha_acceso DESC LIMIT 20');

        res.render('app_rrhh_confidencial', { 
            title: 'INYMO Confidential Vault',
            socios: resSocios.rows || [],
            logs: resLogs.rows || [],
            auditor: req.session.nombreUsuario,
            timestamp: new Date().toISOString(),
            acceso_nivel: 'ROOT_DIRECTOR'
        });
    } catch (e) {
        res.status(403).send("Error crítico de seguridad en la bóveda.");
    } finally {
        if(client) client.release();
    }
});

/**
 * 🛠️ GESTIÓN DE RUTAS 404 INTERNAS
 */
router.use((req, res) => {
    res.status(404).render('error', { 
        message: "Ruta de Capital Humano no detectada en el Módulo Parte 2.",
        error: { status: 404 }
    });
});

module.exports = router;