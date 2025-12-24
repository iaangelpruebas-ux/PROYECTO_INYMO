/**
 * ====================================================================================================
 * * I N Y M O   E N T E R P R I S E   S Y S T E M S
 * PROJECT INTELLIGENCE UNIT - PHASE 5: RESOURCE PLANNING & TOTAL PROCUREMENT
 * ====================================================================================================
 * @file        routes/presentacion_proyecto.js
 * @version     75.0.0 "The Inventory & Financial Monolith"
 * @description 
 * Núcleo de gestión de 360 grados para el control operativo y financiero de proyectos INYMO.
 * * CAPACIDADES INTEGRADAS:
 * 1. Identidad: Dashboard de salud, liderazgo y cronograma.
 * 2. Finanzas: Cálculos PMBOK (BAC, AC, PV, EV) con formato de moneda mexicana.
 * 3. Compras: CRUD de partidas presupuestarias con soporte documental (Multer/PDF).
 * 4. Proveedores: Registro y blindaje contra duplicados.
 * 5. Inventario: Reserva y retorno de material sobrante (Stock Libre).
 * ====================================================================================================
 */

/* ----------------------------------------------------------------------------------------------------
 * 1. IMPORTACIÓN DE MÓDULOS Y DEPENDENCIAS
 * ---------------------------------------------------------------------------------------------------- */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const html_to_pdf = require('html-pdf-node');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

/* ----------------------------------------------------------------------------------------------------
 * 2. CONFIGURACIÓN DE INFRAESTRUCTURA DE DATOS
 * ---------------------------------------------------------------------------------------------------- */

// Configuración de acceso a PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

/**
 * CONFIGURACIÓN DE ALMACENAMIENTO (MULTER)
 * Gestiona la carga de evidencias PDF para auditoría contable.
 */
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './public/uploads/cotizaciones/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        // Genera un nombre de archivo único para evitar colisiones
        cb(null, `COT-${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/pdf") {
            cb(null, true);
        } else {
            cb(new Error("INYMO Error: Solo se permiten archivos en formato PDF."), false);
        }
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 3. FUNCIONES AUXILIARES Y MIDDLEWARES
 * ---------------------------------------------------------------------------------------------------- */

/**
 * Middleware: verificarSesion
 * Blindaje de seguridad para proteger información estratégica del proyecto.
 */
const verificarSesion = (req, res, next) => {
    if (req.session.usuarioLogueado) {
        req.session.touch(); 
        next();
    } else {
        console.warn(`[SECURITY ALERT] Intento de acceso denegado. IP: ${req.ip}`);
        res.redirect('/login');
    }
};

/**
 * Helper: fmtMoney
 * Formatea valores numéricos a Pesos Mexicanos (MXN).
 * Formato: $10,000.00
 */
const fmtMoney = (amount) => {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency', 
        currency: 'MXN', 
        minimumFractionDigits: 2
    }).format(amount || 0);
};

/* ----------------------------------------------------------------------------------------------------
 * 4. MOTOR DE PRESENTACIÓN (DASHBOARD EJECUTIVO)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * RUTA: GET /:id
 * Genera la vista unificada de Identidad y Finanzas Maestras.
 */
router.get('/:id', verificarSesion, async function(req, res) {
    const proyectoId = req.params.id;
    if (isNaN(proyectoId)) return res.redirect('/app/proyectos');

    let client;
    try {
        client = await pool.connect();
        
        // Consulta Robusta: Identidad + Datos Base
        const queryProyecto = `
            SELECT p.*, 
            (SELECT COUNT(*) FROM repositorio_planos WHERE proyecto_id = p.id) as total_planos
            FROM proyectos p WHERE p.id = $1
        `;
        const resP = await client.query(queryProyecto, [proyectoId]);
        const pBD = resP.rows[0];

        if (!pBD) {
            return res.status(404).render('error', { message: "Error 404: Proyecto no encontrado en la red INYMO." });
        }

        // CÁLCULO DE MÉTRICAS FINANCIERAS (PMBOK)
        const bac = parseFloat(pBD.presupuesto) || 0;     // Budget at Completion
        const pv = parseFloat(pBD.valor_negocio) || 0;    // Planned Value
        const ac = parseFloat(pBD.costo_real) || 0;       // Actual Cost

        // Lógica de Valor Ganado (EV) personalizada por Ángel Velasco
        let ev = (ac > bac) ? (pv - ac) : (pv - bac);

        // Preparación del objeto de renderizado
        const p = {
            ...pBD,
            fecha_entrega: pBD.fecha_fin ? new Date(pBD.fecha_fin).toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' }) : "No definida",
            isArchivado: pBD.salud === 'Archivado',
            metodologia: pBD.tipo_entrega,
            bac_f: fmtMoney(bac),
            pv_f: fmtMoney(pv),
            ac_f: fmtMoney(ac),
            ev_f: fmtMoney(ev),
            isOverBudget: ac > bac
        };

        res.render('proyecto_carpeta_pugs/detalles/app_detalle_layout_presentacion', { 
            p, 
            usuario: req.session.nombreUsuario, 
            title: `${p.codigo} | INYMO Systems`
        });

    } catch (err) {
        console.error("[CRITICAL SYSTEM ERROR]", err);
        res.status(500).send("Fallo masivo en el motor de presentación ejecutiva.");
    } finally { 
        if (client) client.release(); 
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 5. MÓDULO DE ADQUISICIONES (DISTRIBUCIÓN Y GOBERNANZA)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * RUTA: GET /:id/presupuesto/distribucion
 * Carga el panel de compras, catálogo de proveedores e inventario libre.
 */
router.get('/:id/presupuesto/distribucion', verificarSesion, async (req, res) => {
    const proyectoId = req.params.id;
    let client;
    try {
        client = await pool.connect();
        
        // 1. Datos Maestros
        const resP = await client.query("SELECT * FROM proyectos WHERE id = $1", [proyectoId]);
        const p = resP.rows[0];

        // 2. Partidas del Proyecto (Audit Trail)
        const queryPartidas = `
            SELECT pd.*, prov.nombre_empresa as proveedor_nombre 
            FROM presupuesto_desglose pd 
            LEFT JOIN proveedores prov ON pd.proveedor_id = prov.id 
            WHERE pd.proyecto_id = $1 ORDER BY pd.id DESC`;
        const resPartidas = await client.query(queryPartidas, [proyectoId]);

        // 3. Catálogo Central de Proveedores
        const resProv = await client.query("SELECT * FROM proveedores WHERE activo = true ORDER BY nombre_empresa ASC");

        // 4. Inventario Sobrante (Stock Libre)
        const resStock = await client.query(`
            SELECT s.id, s.cantidad, s.ubicacion, s.articulo_id 
            FROM inventario_stock s 
            WHERE s.cantidad > 0 ORDER BY s.fecha_entrada DESC`);

        res.render('proyecto_carpeta_pugs/detalles/app_detalle_presupuesto_desglose', { 
            p, 
            partidas: resPartidas.rows, 
            proveedores: resProv.rows,
            stock: resStock.rows,
            usuario: req.session.nombreUsuario, 
            title: `Gobernanza Financiera | ${p.codigo}`
        });

    } catch (e) {
        console.error("[DISTRIBUTION ERROR]", e);
        res.redirect(`/app/proyectos/${proyectoId}`);
    } finally { 
        if (client) client.release(); 
    }
});

/**
 * ACCIÓN: POST /:id/proveedor/rapido
 * Registra un proveedor nuevo con blindaje contra duplicidad de nombres.
 */
router.post('/:id/proveedor/rapido', verificarSesion, async (req, res) => {
    const { nombre_empresa, contacto_nombre, telefono } = req.body;
    const proyectoId = req.params.id;
    let client;
    try {
        client = await pool.connect();
        
        // VALIDACIÓN DE DUPLICADOS (Case Insensitive)
        const checkDuplicado = await client.query(
            "SELECT id FROM proveedores WHERE LOWER(nombre_empresa) = LOWER($1)", 
            [nombre_empresa.trim()]
        );

        if (checkDuplicado.rows.length > 0) {
            console.warn(`[DATA INTEGRITY] Intento de duplicar proveedor: ${nombre_empresa}`);
            return res.redirect(`/app/proyectos/${proyectoId}/presupuesto/distribucion?error=proveedor_existente`);
        }

        // Registro de Nuevo Proveedor
        await client.query(
            "INSERT INTO proveedores (nombre_empresa, contacto_nombre, telefono, activo) VALUES ($1, $2, $3, true)", 
            [nombre_empresa.trim(), contacto_nombre, telefono]
        );
        
        console.log(`[SUCCESS] Nuevo proveedor registrado: ${nombre_empresa}`);
        res.redirect(`/app/proyectos/${proyectoId}/presupuesto/distribucion?success=proveedor_creado`);

    } catch (e) {
        res.status(500).send("Fallo al registrar proveedor.");
    } finally { 
        if (client) client.release(); 
    }
});

/**
 * ACCIÓN: POST /:id/presupuesto/asignar-stock
 * Gestiona el apartado de material desde el inventario global al proyecto.
 */
router.post('/:id/presupuesto/asignar-stock', verificarSesion, async (req, res) => {
    const proyectoId = req.params.id;
    const { stock_id, cantidad_a_usar, precio_unitario, notas } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Validación de Existencia en Stock
        const resStock = await client.query("SELECT * FROM inventario_stock WHERE id = $1 FOR UPDATE", [stock_id]);
        const s = resStock.rows[0];

        if (!s || parseFloat(s.cantidad) < parseFloat(cantidad_a_usar)) {
            throw new Error("INYMO Stock Error: Cantidad insuficiente para la operación.");
        }

        // 2. Registro en Desglose de Presupuesto (Identificado como Recuperado)
        const conceptoInterno = `REUSO ESTRATÉGICO: Articulo ${s.articulo_id} (Origen: ${s.ubicacion})`;
        await client.query(
            `INSERT INTO presupuesto_desglose 
            (proyecto_id, concepto, categoria, cantidad, precio_unitario, es_recuperado, stock_referencia_id, notas) 
            VALUES ($1, $2, 'Material Recuperado', $3, $4, true, $5, $6)`,
            [proyectoId, conceptoInterno, cantidad_a_usar, precio_unitario, stock_id, notas]
        );

        // 3. Actualización de Inventario Global (Deducción)
        await client.query(
            "UPDATE inventario_stock SET cantidad = cantidad - $1 WHERE id = $2",
            [cantidad_a_usar, stock_id]
        );

        await client.query('COMMIT');
        console.log(`[STOCK ASYNC] Apartado exitoso: ${cantidad_a_usar} unidades de ID:${stock_id}`);
        res.redirect(`/app/proyectos/${proyectoId}/presupuesto/distribucion`);

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        console.error("[STOCK FAILURE]", e);
        res.status(500).send(e.message);
    } finally { 
        if (client) client.release(); 
    }
});

/**
 * ACCIÓN: GET /:id/presupuesto/eliminar/:partidaId
 * Elimina una partida. Si es material de stock, lo regresa automáticamente al inventario.
 */
router.get('/:id/presupuesto/eliminar/:partidaId', verificarSesion, async (req, res) => {
    const proyectoId = req.params.id;
    const { partidaId } = req.params;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Identificar naturaleza de la partida
        const resPartida = await client.query("SELECT * FROM presupuesto_desglose WHERE id = $1", [partidaId]);
        const p = resPartida.rows[0];

        if (!p) throw new Error("Partida no localizada.");

        // LOGICA DE RETORNO: Si es stock recuperado, regresa al inventario global
        if (p.es_recuperado && p.stock_referencia_id) {
            await client.query(
                "UPDATE inventario_stock SET cantidad = cantidad + $1 WHERE id = $2",
                [p.cantidad, p.stock_referencia_id]
            );
            console.log(`[STOCK RETURN] Reintegrando ${p.cantidad} unidades al Stock ID:${p.stock_referencia_id}`);
        }

        // Eliminación física
        await client.query("DELETE FROM presupuesto_desglose WHERE id = $1", [partidaId]);
        
        await client.query('COMMIT');
        res.redirect(`/app/proyectos/${proyectoId}/presupuesto/distribucion`);

    } catch (e) {
        if (client) await client.query('ROLLBACK');
        res.status(500).send("Fallo en la reversión financiera.");
    } finally { 
        if (client) client.release(); 
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 6. ADMINISTRACIÓN DEL CICLO DE VIDA (ARCHIVOS Y REPORTES)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * RUTA: GET /reporte/financiero/:id
 * Genera el estado financiero del proyecto en PDF.
 */
router.get('/reporte/financiero/:id', verificarSesion, async function(req, res) {
    const proyectoId = req.params.id;
    let client;
    try {
        client = await pool.connect();
        const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [proyectoId]);
        const p = resP.rows[0];

        if (!p) return res.status(404).send("Data missing.");

        res.render('app_reporte_financiero_pdf', { p, layout: false }, async (err, html) => {
            if (err) return res.status(500).send("Layout Error.");
            
            const pdfBuffer = await html_to_pdf.generatePdf(
                { content: html }, 
                { format: 'A4', printBackground: true }
            );
            
            console.log(`[AUDIT] Reporte Financiero generado para proyecto: ${p.codigo}`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=Finanzas_${p.codigo}.pdf`);
            res.send(pdfBuffer);
        });
    } catch (e) {
        res.status(500).send("Error en servidor de documentos.");
    } finally { 
        if (client) client.release(); 
    }
});

/**
 * RUTA: GET /:id/archivar
 * Cambia el estado del proyecto para auditoría histórica.
 */
router.get('/:id/archivar', verificarSesion, async (req, res) => {
    try {
        await pool.query("UPDATE proyectos SET salud = 'Archivado' WHERE id = $1", [req.params.id]);
        res.redirect('/app/proyectos');
    } catch (e) { 
        res.status(500).send("Archive Failure."); 
    }
});

module.exports = router;