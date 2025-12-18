/**
 * =========================================================================
 * INYMO - MÓDULO DE ESTRATEGIA E INTELIGENCIA DE NEGOCIOS (BI)
 * =========================================================================
 * Archivo: routes/bi.js
 * Versión: 1.5.0 - Edición "Zero Dependencies"
 * * DESCRIPCIÓN: 
 * Controlador de alto nivel (C-Level) encargado de cruzar datos de RRHH,
 * Finanzas y Operaciones para generar tableros de decisión estratégica.
 * * * CORRECCIÓN APLICADA:
 * 1. Eliminación total de 'moment' para corregir el error "Cannot find module".
 * 2. Uso de Intl.DateTimeFormat nativo para fechas en español.
 * 3. Optimización de consultas SQL para agrupar fechas desde la base de datos.
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// Configuración de Base de Datos
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ==========================================================================
   🛠️ UTILIDADES Y MIDDLEWARES DEL SISTEMA
   ========================================================================== */

/**
 * Middleware: Verificación de Sesión Activa
 */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
    next();
  } else {
    res.redirect('/login');
  }
};

/**
 * Middleware: Seguridad de Alto Nivel (Socio Director)
 */
const verificarAccesoDirectivo = (req, res, next) => {
    const user = req.session.nombreUsuario;
    const esSocio = user === 'Ángel Velasco' || req.session.rol === 'Socio';
    
    if (esSocio) {
        next();
    } else {
        console.warn(`[BI SECURITY ALERT] Intento de acceso no autorizado IP: ${req.ip} - User: ${user}`);
        res.status(403).render('error', { 
            message: "ACCESO DENEGADO: El Módulo de Inteligencia de Negocios es exclusivo para la Dirección General.",
            error: { status: 403 }
        });
    }
};

/**
 * Helper: Formato de Moneda MXN
 */
const toMXN = (val) => {
    const num = parseFloat(val) || 0;
    return new Intl.NumberFormat('es-MX', {
        style: 'currency', 
        currency: 'MXN', 
        minimumFractionDigits: 2
    }).format(num);
};

/* ==========================================================================
   01. DASHBOARD ESTRATÉGICO (WAR ROOM)
   ========================================================================== */

router.get('/', verificarSesion, verificarAccesoDirectivo, async function(req, res) {
  let client;
  try {
    client = await pool.connect();

    // 1. Obtener Ingresos Totales del Año Actual (Facturas Pagadas)
    // Usamos SQL nativo (date_part) para filtrar el año sin usar librerías externas
    const resIngresos = await client.query(`
        SELECT COALESCE(SUM(total), 0) as total_cobrado
        FROM comercial_facturas
        WHERE estatus = 'Pagada' 
        AND date_part('year', fecha_emision) = date_part('year', CURRENT_DATE)
    `);

    // 2. Obtener Costos Fijos de Personal (Nómina + Carga Social FSR)
    const resCostos = await client.query(`
        SELECT 
            COALESCE(SUM(sueldo_mensual * 1.35), 0) as nomina_mensual_fsr,
            COUNT(*) as head_count
        FROM rrhh_colaboradores
        WHERE estatus = 'Activo'
    `);

    // 3. Crear tabla de Metas si no existe (Auto-Fix) y obtener datos
    await client.query(`
        CREATE TABLE IF NOT EXISTS estrategia_metas_anuales (
            anio INT PRIMARY KEY,
            meta_ventas DECIMAL(15,2),
            meta_margen DECIMAL(5,2),
            actualizado_por VARCHAR(100),
            actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    const resMetas = await client.query(`
        SELECT meta_ventas, meta_margen 
        FROM estrategia_metas_anuales 
        WHERE anio = date_part('year', CURRENT_DATE)::int
    `);
    
    // Valores por defecto para evitar errores si la tabla está vacía
    const metas = resMetas.rows[0] || { meta_ventas: 1000000, meta_margen: 20 };

    // --- CÁLCULOS FINANCIEROS (LÓGICA DE NEGOCIO) ---
    const ingresosAnuales = parseFloat(resIngresos.rows[0].total_cobrado);
    const costoNominaMensual = parseFloat(resCostos.rows[0].nomina_mensual_fsr);
    
    // Proyección: Costo nómina constante x 12 meses
    const costoNominaAnual = costoNominaMensual * 12; 
    
    // Utilidad Bruta Operativa (EBITDA Simplificado)
    const utilidadBruta = ingresosAnuales - costoNominaAnual;
    
    // Margen Operativo (%)
    const margenOperativo = ingresosAnuales > 0 
        ? ((utilidadBruta / ingresosAnuales) * 100) 
        : 0;

    // Revenue Per Head (Eficiencia de Talento)
    const empleados = parseInt(resCostos.rows[0].head_count) || 1;
    const ingresoPorEmpleado = ingresosAnuales / empleados;

    // 4. Análisis de Riesgo de Clientes (Pareto 80/20)
    const resPareto = await client.query(`
        SELECT 
            c.razon_social, 
            SUM(f.total) as volumen, 
            ROUND((SUM(f.total) / NULLIF((SELECT SUM(total) FROM comercial_facturas), 0) * 100), 1) as share
        FROM comercial_facturas f
        JOIN comercial_clientes c ON f.cliente_id = c.id
        GROUP BY c.razon_social
        ORDER BY volumen DESC
        LIMIT 5
    `);

    // Renderizado PUG
    res.render('app_bi_dashboard', { 
        title: 'Inteligencia de Negocios | INYMO',
        
        // Objeto de KPIs Maestros
        kpis: {
            ingresos_ytd: toMXN(ingresosAnuales),
            costo_nomina_proyectado: toMXN(costoNominaAnual),
            utilidad_operativa: toMXN(utilidadBruta),
            margen_porcentaje: margenOperativo.toFixed(1),
            revenue_per_head: toMXN(ingresoPorEmpleado),
            headcount: empleados,
            meta_ventas: toMXN(metas.meta_ventas)
        },
        
        // Datos para tablas
        riesgo_clientes: resPareto.rows || [],
        
        // Variables de entorno visual
        periodo: `Ejercicio Fiscal ${new Date().getFullYear()}`,
        alerta_margen: margenOperativo < parseFloat(metas.meta_margen),
        usuario: req.session.nombreUsuario
    });

  } catch (err) {
    console.error("[ERROR CRÍTICO BI CORE]:", err);
    // Renderizamos una página de error amigable en lugar de tronar la app
    res.render('error', { 
        message: "Error al calcular inteligencia de negocios. Verifique la conexión a base de datos.",
        error: { status: 500, stack: err.stack } 
    });
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   02. API DE DATOS PARA GRÁFICOS (CHART.JS BACKEND)
   ========================================================================== */

router.get('/api/finanzas-anuales', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        
        // Query Avanzada: Agrupación mensual usando PostgreSQL nativo (sin JS dates)
        // Genera formato 'YYYY-MM' directamente desde la BD
        const ingresos = await client.query(`
            SELECT 
                TO_CHAR(fecha_emision, 'YYYY-MM') as mes_anio,
                SUM(total) as monto
            FROM comercial_facturas
            WHERE fecha_emision >= DATE_TRUNC('year', CURRENT_DATE)
            GROUP BY 1 
            ORDER BY 1 ASC
        `);

        // Obtener costo fijo actual para proyección
        const nominaActual = await client.query('SELECT SUM(sueldo_mensual * 1.35) as total FROM rrhh_colaboradores WHERE estatus = $1', ['Activo']);
        const costoFijo = parseFloat(nominaActual.rows[0]?.total || 0);

        // Construcción de Arrays para el Frontend (Ene-Dic)
        const labels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const dataIngresos = new Array(12).fill(0);
        const dataEgresos = new Array(12).fill(costoFijo); 

        // Mapeo de datos SQL a los índices del array
        if (ingresos.rows.length > 0) {
            ingresos.rows.forEach(row => {
                // row.mes_anio viene como '2025-01' -> split -> tomamos '01'
                const partes = row.mes_anio.split('-');
                if(partes.length === 2) {
                    // Restamos 1 porque los arrays inician en índice 0
                    const mesIndex = parseInt(partes[1]) - 1;
                    if(mesIndex >= 0 && mesIndex < 12) {
                        dataIngresos[mesIndex] = parseFloat(row.monto);
                    }
                }
            });
        }

        res.json({
            labels: labels,
            datasets: [
                { 
                    label: 'Ingresos Facturados', 
                    data: dataIngresos, 
                    type: 'line' 
                },
                { 
                    label: 'Costo Operativo (Nómina FSR)', 
                    data: dataEgresos, 
                    type: 'bar' 
                }
            ]
        });

    } catch (e) {
        console.error("[ERROR API BI]:", e);
        res.status(500).json({ error: "Fallo en cálculo de tendencias financieras" });
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   03. CONFIGURACIÓN ESTRATÉGICA (TARGET SETTING)
   ========================================================================== */

router.post('/metas/set', verificarSesion, verificarAccesoDirectivo, async (req, res) => {
    const { anio, meta_ventas, meta_margen } = req.body;
    let client;
    
    try {
        client = await pool.connect();
        
        // Upsert (Insertar o Actualizar si ya existe)
        await client.query(`
            INSERT INTO estrategia_metas_anuales (anio, meta_ventas, meta_margen, actualizado_por)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (anio) 
            DO UPDATE SET 
                meta_ventas = EXCLUDED.meta_ventas,
                meta_margen = EXCLUDED.meta_margen,
                actualizado_en = CURRENT_TIMESTAMP
        `, [
            anio, 
            parseFloat(meta_ventas) || 0, 
            parseFloat(meta_margen) || 0, 
            req.session.nombreUsuario
        ]);

        res.redirect('/app/bi');

    } catch (e) {
        console.error("Error guardando metas:", e);
        res.status(500).send("No se pudieron guardar las metas estratégicas.");
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   04. UTILIDADES DE EXPORTACIÓN (BACKUP JSON)
   ========================================================================== */

router.get('/export/master-json', verificarSesion, verificarAccesoDirectivo, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        
        // Ejecución paralela
        const [rh, com, hse] = await Promise.all([
            client.query("SELECT id, nombre_completo, puesto_id, departamento_id, fecha_ingreso, estatus FROM rrhh_colaboradores"),
            client.query("SELECT * FROM comercial_facturas ORDER BY fecha_emision DESC"),
            client.query("SELECT * FROM rrhh_hse_incidentes")
        ]);
        
        const dataDump = {
            generado_el: new Date(),
            autor: req.session.nombreUsuario,
            sistema: "INYMO ERP v9.0",
            modulos: {
                capital_humano: rh.rows,
                comercial: com.rows,
                seguridad_hse: hse.rows
            }
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=INYMO_Master_Intelligence.json');
        res.send(JSON.stringify(dataDump, null, 2));

    } catch (e) {
        res.status(500).send("Error generando exportación de datos.");
    } finally {
        if(client) client.release();
    }
});

module.exports = router;