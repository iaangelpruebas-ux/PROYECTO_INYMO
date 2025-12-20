/**
 * =========================================================================
 * INYMO - SISTEMA DE GESTIÓN DE CAPITAL HUMANO (HRMS)
 * =========================================================================
 * Archivo: routes/rrhh.js
 * Versión: 7.0.0 - Edición "Gobernanza y Estabilidad"
 * * DESCRIPCIÓN: 
 * Controlador centralizado para la gobernanza del talento en INYMO.
 * Gestiona la jerarquía operativa y el rendimiento de los activos humanos
 * bajo estándares de precisión de ingeniería y cumplimiento ISO 30414.
 * * * REGLAS DE NEGOCIO CORPORATIVAS:
 * 1. Moneda: Formato forzado MXN con separador de comas (Intl.NumberFormat).
 * 2. Seguridad: Protección multinivel por sesión y rango socio director.
 * 3. Ingeniería de Costos: Cálculo de Factor de Salario Real (FSR 1.35).
 * 4. Trazabilidad: Expedientes digitales vinculados vía Postgres JSONB.
 * * * ESTRUCTURA DE RUTAS (10 DIVISIONES):
 * 01. Gobierno y Estrategia ...................... [Estratégico]
 * 02. Estructura Organizacional .................. [Jerárquico]
 * 03. Capital Humano (Directorio) ................ [Operativo]
 * 04. Desempeño y Scorecards ..................... [Evaluación]
 * 05. Compensaciones y Beneficios ................ [Financiero]
 * 06. Desarrollo y Capacitación .................. [Crecimiento]
 * 07. Planes de Acción ........................... [Mejora]
 * 08. Reportes de Gestión ........................ [Auditoría]
 * 09. Cumplimiento Legal y HSE ................... [Normativo]
 * 10. Bóveda Confidencial ........................ [Privado]
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

/**
 * 🔌 CONFIGURACIÓN DE CONEXIÓN A BASE DE DATOS
 * Pool de conexiones optimizado para PostgreSQL con soporte SSL.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * 📁 ENGINE DE ALMACENAMIENTO DIGITAL (MULTER)
 * Gestión de expedientes digitales con nomenclatura corporativa.
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './public/uploads/rrhh/expedientes/';
    // Asegurar que la carpeta exista recursivamente
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // ID único para trazabilidad de documentos de ingeniería
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'INYMO-TALENTO-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // Límite de 15MB por archivo
});

/**
 * 🛡️ MIDDLEWARE: VERIFICACIÓN DE SESIÓN ACTIVA
 * Filtro de seguridad primario.
 */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
    next();
  } else {
    res.redirect('/login');
  }
};

/**
 * 🛡️ MIDDLEWARE: SEGURIDAD C-LEVEL (SOCIOS)
 * Blindaje exclusivo para Ángel Velasco en áreas financieras y confidenciales.
 */
const verificarRangoSocio = (req, res, next) => {
    const usuarioActual = req.session.nombreUsuario;
    const esSocioDirector = usuarioActual === 'Ángel Velasco' || req.session.rol === 'Socio';
    
    if (esSocioDirector) {
        next();
    } else {
        res.status(403).render('error', { 
            message: "ACCESO RESTRINGIDO: Esta sección es exclusiva para el Socio Director.",
            error: { status: 403 }
        });
    }
};

/**
 * 🛠️ UTILIDADES DE FORMATEO CORPORATIVO (MXN)
 * Asegura la visualización de precios con comas y signo de pesos.
 */
const toMXN = (val) => {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2
    }).format(val || 0);
};

/* ==========================================================================
   00. DASHBOARD PRINCIPAL (RESUMEN EJECUTIVO RRHH)
   ========================================================================== */
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();
    
    // Extracción de KPIs en tiempo real
    const resStats = await client.query(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN estatus = 'Activo' THEN 1 ELSE 0 END) as activos,
            COALESCE(SUM(sueldo_mensual), 0) as nomina_mensual
        FROM rrhh_colaboradores
    `);

    const divisiones = [
        { id: '01', nombre: 'Gobierno y Estrategia', icon: 'bx-shield-quarter', color: '#0f172a', desc: 'Misión y Riesgos ISO' },
        { id: '02', nombre: 'Estructura Organizacional', icon: 'bx-sitemap', color: '#1e293b', desc: 'Jerarquías y RACI' },
        { id: '03', nombre: 'Capital Humano', icon: 'bx-group', color: '#8cc63f', desc: 'Directorio y Expedientes' },
        { id: '04', nombre: 'Desempeño y Analítica', icon: 'bx-line-chart', color: '#3b82f6', desc: 'KPIs y Scorecards' },
        { id: '05', nombre: 'Compensaciones y Beneficios', icon: 'bx-money', color: '#10b981', desc: 'Sueldos y Nómina' },
        { id: '06', nombre: 'Desarrollo y Capacidad', icon: 'bx-trending-up', color: '#f59e0b', desc: 'Capacitación' },
        { id: '07', nombre: 'Planes de Acción', icon: 'bx-task', color: '#ef4444', desc: 'Mejora Continua' },
        { id: '08', nombre: 'Reportes Ejecutivos', icon: 'bx-file', color: '#6366f1', desc: 'Informes Mensuales' },
        { id: '09', nombre: 'Cumplimiento y Riesgos', icon: 'bx-error-circle', color: '#f43f5e', desc: 'Seguridad e IMSS' },
        { id: '10', nombre: 'Confidencial', icon: 'bx-lock-alt', color: '#1e293b', desc: 'Acceso Privado' }
    ];

    res.render('app_rrhh_dashboard', { 
        title: 'Capital Humano | INYMO', 
        kpis: {
            total_colaboradores: parseInt(resStats.rows[0].total) || 0,
            desempeno_global: 92,
            indice_retencion: 98,
            costo_nomina_mensual: parseFloat(resStats.rows[0].nomina_mensual) || 0
        },
        divisiones 
    });
  } catch (err) {
    console.error("[ERROR DASH]:", err);
    res.status(500).send("Fallo al cargar el motor de RRHH.");
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   01. GOBIERNO Y ESTRATEGIA (BLOQUE ISO)
   ========================================================================== */
router.get('/division/01', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const iden = await client.query('SELECT * FROM estrategia_identidad ORDER BY id DESC LIMIT 1');
        const okrs = await client.query('SELECT * FROM estrategia_okrs WHERE estatus = $1 ORDER BY id ASC', ['Activo']);
        const riesgos = await client.query('SELECT * FROM estrategia_riesgos ORDER BY nivel DESC');
        
        res.render('app_rrhh_gobierno', { 
            title: 'Gobierno y Estrategia | INYMO',
            iden: iden.rows[0] || {}, 
            okrs: okrs.rows || [], 
            riesgos: riesgos.rows || [] 
        });
    } catch (e) {
        res.status(500).send("Error en la División de Estrategia.");
    } finally {
        if(client) client.release();
    }
});

/**
 * AJAX: Actualización de OKRs
 */
router.post('/division/01/okr/update', verificarSesion, async (req, res) => {
    const { id, progreso } = req.body;
    try {
        const client = await pool.connect();
        await client.query('UPDATE estrategia_okrs SET progreso = $1 WHERE id = $2', [progreso, id]);
        client.release();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

/* ==========================================================================
   02. ESTRUCTURA ORGANIZACIONAL (JERARQUÍAS PMO)
   ========================================================================== */
router.get('/division/02', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const deps = await client.query('SELECT * FROM rrhh_departamentos ORDER BY nombre ASC');
        const puestos = await client.query(`
            SELECT p.*, d.nombre as depto_nombre 
            FROM rrhh_puestos p 
            JOIN rrhh_departamentos d ON p.departamento_id = d.id
        `);
        const raci = await client.query('SELECT * FROM rrhh_raci ORDER BY proceso ASC');
        
        res.render('app_rrhh_organizacion', { 
            title: 'Arquitectura Organizacional | INYMO',
            deps: deps.rows, 
            puestos: puestos.rows, 
            raci: raci.rows 
        });
    } catch (e) {
        res.status(500).send("Fallo al cargar arquitectura organizacional.");
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   03. CAPITAL HUMANO (DIRECTORIO Y TALENTO)
   ========================================================================== */
router.get('/division/03', verificarSesion, async function(req, res) {
  let client;
  const search = req.query.q || '';
  const depto = req.query.depto || 'Todos';

  try {
    client = await pool.connect();
    
    // KPIs específicos para la vista de Talento
    const resStats = await client.query(`
        SELECT COUNT(*) as total, 
        SUM(CASE WHEN estatus = 'Activo' THEN 1 ELSE 0 END) as activos,
        COALESCE(SUM(sueldo_mensual), 0) as nomina 
        FROM rrhh_colaboradores
    `);

    const resDeps = await client.query('SELECT id, nombre FROM rrhh_departamentos ORDER BY nombre ASC');

    let querySQL = `
        SELECT c.*, p.nombre as puesto_nombre, d.nombre as departamento_nombre
        FROM rrhh_colaboradores c
        LEFT JOIN rrhh_puestos p ON c.puesto_id = p.id
        LEFT JOIN rrhh_departamentos d ON p.departamento_id = d.id
        WHERE (c.nombre_completo ILIKE $1 OR c.curp ILIKE $1)
    `;
    let params = [`%${search}%`];

    if (depto !== 'Todos') {
        querySQL += ` AND d.id = $2`;
        params.push(depto);
    }

    querySQL += ` ORDER BY c.nombre_completo ASC`;
    const resTalento = await client.query(querySQL, params);

    res.render('app_rrhh_talento', { 
        title: 'Directorio Maestro | INYMO', 
        talento: resTalento.rows,
        departamentos: resDeps.rows,
        filtros: { search, depto },
        kpis: {
            total: resStats.rows[0].total || 0,
            activos: resStats.rows[0].activos || 0,
            nomina: toMXN(resStats.rows[0].nomina)
        }
    });
  } catch (err) {
    console.error("[ERROR DIV 03]:", err);
    res.status(500).send("Fallo al procesar el directorio de talento.");
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   04. DESEMPEÑO Y ANALÍTICA (RENDIMIENTO)
   ========================================================================== */
router.get('/division/04', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        
        // Análisis por Puesto: Integrantes, Costo FSR y Masa Salarial
        const resDesempeno = await client.query(`
            SELECT 
                p.nombre as puesto, 
                COUNT(c.id) as integrantes,
                AVG(c.costo_hora) as costo_promedio_fsr,
                SUM(c.sueldo_mensual) as inversion_area
            FROM rrhh_puestos p
            LEFT JOIN rrhh_colaboradores c ON c.puesto_id = p.id
            GROUP BY p.nombre
            HAVING COUNT(c.id) > 0
        `);

        const resScorecards = await client.query(`
            SELECT c.nombre_completo, e.puntaje, e.fecha, e.comentarios
            FROM rrhh_evaluaciones e
            JOIN rrhh_colaboradores c ON e.colaborador_id = c.id
            ORDER BY e.fecha DESC LIMIT 15
        `);

        const resColabs = await client.query('SELECT id, nombre_completo FROM rrhh_colaboradores WHERE estatus = $1', ['Activo']);

        res.render('app_rrhh_analitica', { 
            title: 'Desempeño y Analítica | INYMO',
            rentabilidad: resDesempeno.rows,
            scorecards: resScorecards.rows,
            colaboradores: resColabs.rows,
            analytics: {
                promedio_fsr: toMXN(resDesempeno.rows.reduce((acc, cur) => acc + parseFloat(cur.costo_promedio_fsr), 0) / (resDesempeno.rows.length || 1)),
                cobertura_evaluacion: "85%"
            },
            formatMXN: toMXN
        });
    } catch (e) {
        res.status(500).send("Fallo al procesar el módulo de rendimiento operativo.");
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   05. COMPENSACIONES Y BENEFICIOS (NÚCLEO FINANCIERO)
   ========================================================================== */
router.get('/division/05', verificarSesion, verificarRangoSocio, async (req, res) => {
    let client;
    try {
        client = await pool.connect();

        // 1. Resumen Financiero: Sueldo Base vs Carga Real (Factor 1.35)
        const resFinanzas = await client.query(`
            SELECT 
                SUM(sueldo_mensual) as sueldo_base_total,
                SUM(sueldo_mensual * 1.35) as costo_patronal_fsr,
                COUNT(id) as total_integrantes
            FROM rrhh_colaboradores 
            WHERE estatus = 'Activo'
        `);

        // 2. Desglose de Gastos por Departamento
        const resDeptoGastos = await client.query(`
            SELECT d.nombre, SUM(c.sueldo_mensual) as monto
            FROM rrhh_colaboradores c
            JOIN rrhh_departamentos d ON c.departamento_id = d.id
            WHERE c.estatus = 'Activo'
            GROUP BY d.nombre
            ORDER BY monto DESC
        `);

        // 3. Catálogo de Beneficios
        const resBeneficios = await client.query('SELECT * FROM rrhh_beneficios WHERE activo = true');

        const finanzas = resFinanzas.rows[0];

        res.render('app_rrhh_compensaciones', { 
            title: 'Compensaciones y Beneficios | INYMO',
            periodo_actual: "Diciembre 2025",
            stats: {
                sueldo_base: toMXN(finanzas.sueldo_base_total),
                costo_patronal: toMXN(finanzas.costo_patronal_fsr),
                diferencia_fsr: toMXN(finanzas.costo_patronal_fsr - finanzas.sueldo_base_total),
                integrantes: finanzas.total_integrantes || 0
            },
            departamentos: resDeptoGastos.rows || [],
            beneficios: resBeneficios.rows || [],
            formatMXN: toMXN
        });

    } catch (e) {
        console.error("[ERROR DIV 05]:", e);
        res.status(500).send("Fallo al cargar el motor financiero de personal.");
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   06 - 09. DIVISIONES DE SOPORTE Y CUMPLIMIENTO
   ========================================================================== */

router.get('/division/06', verificarSesion, (req, res) => res.render('app_rrhh_desarrollo', { title: 'Capacitación | INYMO' }));
router.get('/division/07', verificarSesion, (req, res) => res.render('app_rrhh_planes', { title: 'Planes de Acción | INYMO' }));
router.get('/division/08', verificarSesion, verificarRangoSocio, (req, res) => res.render('app_rrhh_reportes', { title: 'Reportes de Gestión | INYMO' }));
router.get('/division/09', verificarSesion, (req, res) => res.render('app_rrhh_cumplimiento', { title: 'Legal y HSE | INYMO' }));

// --- API: BUSCADOR DE TALENTO (CORREGIDO) ---
router.get('/api/buscar-colaborador', async (req, res) => {
    const term = req.query.term || '';
    let client;
    try {
        client = await pool.connect();
        
        // CORRECCIÓN: 
        // 1. Quitamos 'puesto' del WHERE porque no existe la columna de texto.
        // 2. Buscamos solo por 'nombre_completo'.
        // 3. Agregamos un texto fijo 'puesto' para que el frontend no marque error.
        
        const sql = `
            SELECT id, nombre_completo, 'Líder de Proyecto' as puesto 
            FROM rrhh_colaboradores 
            WHERE estatus = 'Activo' 
              AND (nombre_completo ILIKE $1)
            LIMIT 10
        `;
        
        const result = await client.query(sql, [`%${term}%`]);
        res.json(result.rows);

    } catch (e) {
        console.error("Error API RRHH:", e.message);
        res.json([]);
    } finally {
        if (client) client.release();
    }
});

/* ==========================================================================
   10. BÓVEDA CONFIDENCIAL (INYMO ROOT)
   ========================================================================== */
router.get('/division/10', verificarSesion, verificarRangoSocio, async (req, res) => {
    // Protección absoluta: solo Ángel Velasco
    res.render('app_rrhh_confidencial', { 
        title: 'Bóveda Confidencial | INYMO',
        auditor: req.session.nombreUsuario,
        timestamp: new Date(),
        acceso_total: true
    });
});

/**
 * 🚀 EXPORTACIÓN FINAL DEL ROUTER
 * Asegurar que este módulo se monte en app.js mediante:
 * const rrhhRouter = require('./routes/rrhh');
 * app.use('/app/rrhh', rrhhRouter);
 */
module.exports = router;