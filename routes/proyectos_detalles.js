/**
 * ====================================================================================================
 * * I N Y M O   E N T E R P R I S E   S Y S T E M S
 * PROJECT INTELLIGENCE UNIT - MASTER CORE ENGINE (V.28.0 - RESTORED CONFIG & MATH FIX)
 * ====================================================================================================
 * @file        routes/proyectos_detalles.js
 * @description 
 * Módulo de control de misión para la gestión avanzada de proyectos de ingeniería.
 * Implementa la arquitectura de visualización 360°, vinculando Finanzas, Operaciones,
 * Capital Humano (RH) y Gestión de Riesgos.
 * * * CORRECCIONES V.28:
 * 1. Restauración de rutas de configuración (Editar Proyecto).
 * 2. Ajuste de sensibilidad matemática para SPI/CPI cuando AC=0.
 * 3. Sincronización forzada al cargar la vista.
 * * * --------------------------------------------------------------------------------------------------
 * * LÓGICA FINANCIERA DE NEGOCIO (INYMO STANDARDS):
 * 1. PRESUPUESTO (BAC): Límite máximo de gasto operativo permitido.
 * 2. VALOR PLANEADO (PV): Proyección de venta total al cliente (Ingreso) vs Tiempo.
 * 3. COSTO REAL (AC): Gastos de Materiales + Nómina de Capital Humano + Costos Indirectos.
 * 4. VALOR GANADO (EV): Rentabilidad Real = Valor Planeado - Costo Real Acumulado.
 * * --------------------------------------------------------------------------------------------------
 * * @author      Ing. Ángel Velasco (Socio Director) & IA Orange Framework
 * @date        Diciembre 2025
 * @version     28.0.0 "Platinum Core - Config Restore"
 * ====================================================================================================
 */

/* ----------------------------------------------------------------------------------------------------
 * 1. IMPORTACIÓN DE DEPENDENCIAS CRÍTICAS
 * ---------------------------------------------------------------------------------------------------- */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const html_to_pdf = require('html-pdf-node');
const { Pool } = require('pg');

/**
 * CONFIGURACIÓN DE ACCESO A DATOS (POSTGRESQL)
 * Se utiliza un pool de conexiones optimizado para reporteo masivo.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

/* ----------------------------------------------------------------------------------------------------
 * 2. MIDDLEWARES DE SEGURIDAD Y CONTEXTO
 * ---------------------------------------------------------------------------------------------------- */

/**
 * Auth Guard: Verifica la existencia de una sesión de usuario válida.
 * Si no hay sesión, redirige al portal de acceso y registra el intento fallido.
 */
const verificarSesion = (req, res, next) => {
    if (req.session.usuarioLogueado) {
        // Renovación automática de la cookie para evitar desconexiones en análisis largos
        req.session.touch();
        next();
    } else {
        console.warn(`[SECURITY ALERT] Acceso no autorizado detectado en Proyectos. IP: ${req.ip}`);
        res.redirect('/login');
    }
};

/* ----------------------------------------------------------------------------------------------------
 * 3. MOTORES DE CÁLCULO Y UTILIDADES (BUSINESS LOGIC)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * Formateador Contable MXN
 * @param {number} value - Cantidad numérica cruda
 * @returns {string} Formato estándar: $1,234,567.89
 */
const toMXN = (value) => {
    if (value === undefined || value === null || isNaN(value)) return "$0.00";
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
};

/**
 * Motor de Diagnóstico IA de Eficiencia
 * @param {number} cpi - Índice de desempeño de costos
 * @param {number} spi - Índice de desempeño de cronograma
 * @returns {string} Veredicto ejecutivo
 */
const generarDiagnosticoSalud = (cpi, spi) => {
    const _cpi = parseFloat(cpi);
    const _spi = parseFloat(spi);
    
    if (_cpi >= 1 && _spi >= 1) return "🟢 ESTRATEGIA ÓPTIMA: Rentabilidad y cronograma bajo control.";
    if (_cpi < 0.9 && _spi < 0.9) return "🔴 ALERTA ROJA: Desviación crítica. El proyecto consume más recursos de los planeados.";
    if (_cpi < 1) return "🟡 RIESGO FINANCIERO: El costo operativo actual está reduciendo el margen de utilidad.";
    if (_spi < 1) return "🟡 RETRASO OPERATIVO: El avance físico se encuentra por debajo de la línea base.";
    return "⚪ PROYECTO INICIANDO: Recopilando datos de primera fase.";
};

/**
 * ---------------------------------------------------------------------------------------
 * [MOTOR CRÍTICO] SINCRONIZACIÓN DE SPI/CPI A BASE DE DATOS
 * Esta función es el corazón del cálculo. Se ejecuta al ver o editar el proyecto.
 * ---------------------------------------------------------------------------------------
 */
const sincronizarIndicadores = async (proyectoId) => {
    let client;
    try {
        client = await pool.connect();
        
        // 1. OBTENCIÓN DE DATOS FINANCIEROS Y TEMPORALES
        const queryData = `
            SELECT p.*,
            -- Suma total de gastos registrados en bitácora
            (SELECT COALESCE(SUM(monto_relacionado), 0) FROM bitacora WHERE proyecto_id = p.id AND tipo_registro = 'Gasto') as total_gastos_bitacora,
            -- Costos adicionales aprobados
            (SELECT COALESCE(SUM(impacto_costo), 0) FROM control_cambios WHERE proyecto_id = p.id AND estatus = 'Aprobado') as aditivas_costo,
            -- Tiempo adicional aprobado
            (SELECT COALESCE(SUM(impacto_tiempo), 0) FROM control_cambios WHERE proyecto_id = p.id AND estatus = 'Aprobado') as aditivas_tiempo
            FROM proyectos p WHERE p.id = $1
        `;
        const res = await client.query(queryData, [proyectoId]);
        const p = res.rows[0];

        if (!p) return;

        // 2. DEFINICIÓN DE VARIABLES EVM (EARNED VALUE MANAGEMENT)
        const BAC = parseFloat(p.presupuesto) + parseFloat(p.aditivas_costo);
        
        // AC (Actual Cost): Suma de lo manual en tabla + lo registrado en bitácora
        const AC = parseFloat(p.total_gastos_bitacora) + (parseFloat(p.costo_acumulado) || 0);
        
        const Avance = (parseFloat(p.progreso) || 0) / 100;
        
        // EV (Earned Value): Cuánto dinero "hemos ganado" en base al trabajo físico hecho
        const EV = BAC * Avance; 

        // 3. CÁLCULO DE PV (PLANNED VALUE) - EL RELOJ DEL PROYECTO
        const fInicio = p.fecha_inicio ? new Date(p.fecha_inicio) : new Date(p.created_at);
        const fFinOriginal = new Date(p.fecha_fin);
        const fFin = new Date(fFinOriginal);
        
        // Ajustamos fecha fin si hubo cambios aprobados
        fFin.setDate(fFin.getDate() + parseInt(p.aditivas_tiempo));

        const hoy = new Date();
        const duracionTotal = fFin - fInicio;
        const tiempoPasado = hoy - fInicio;
        
        let pctTiempo = 0;
        if (duracionTotal > 0) {
            pctTiempo = Math.min(Math.max(tiempoPasado / duracionTotal, 0), 1);
        }
        
        // PV: Cuánto deberíamos llevar gastado/avanzado al día de hoy según el calendario
        const PV = BAC * pctTiempo;

        // 4. CÁLCULO DE ÍNDICES (MATEMÁTICA DE INGENIERÍA)
        // SPI (Eficiencia de Tiempo) = EV / PV
        let spi = (PV > 0) ? (EV / PV) : 1.00;
        
        // CPI (Eficiencia de Costo) = EV / AC
        let cpi = (AC > 0) ? (EV / AC) : 1.00;

        // 5. AJUSTES DE BORDES (CASOS ESPECIALES)
        // Si no ha empezado, no penalizamos
        if (p.progreso === 0) { 
            spi = 1.00; 
            cpi = 1.00; 
        } 
        // Si hay avance pero costo 0, la eficiencia es "perfecta" (1.00 para no romper gráfica)
        else if (AC === 0 && p.progreso > 0) {
            cpi = 1.00; 
        }

        // 6. UPDATE ATÓMICO A LA TABLA MAESTRA
        // Esto es lo que arregla que en el Dashboard principal se vea bien
        await client.query(
            "UPDATE proyectos SET spi = $1, cpi = $2 WHERE id = $3",
            [spi.toFixed(2), cpi.toFixed(2), proyectoId]
        );
        
        console.log(`[SYNC-AUTO] Proyecto ${p.codigo} recalibrado -> SPI: ${spi.toFixed(2)}, CPI: ${cpi.toFixed(2)}`);

    } catch (err) {
        console.error("Error crítico en sincronización de indicadores:", err);
    } finally {
        if (client) client.release();
    }
};

/**
 * GENERADOR DE CURVAS S (SEGMENTACIÓN TEMPORAL)
 * Procesa el historial del proyecto día por día para visualización gráfica.
 */
const procesarCurvasEVM = (f_inicio, f_fin, bac, avance, bitacoraGastos, costoNomina, filtros) => {
    const labels = [];
    const dataPV = [];
    const dataEV = [];
    const dataAC = [];
    const dataSPI = [];
    const dataCPI = [];

    const start = new Date(f_inicio);
    const end = new Date(f_fin);
    const today = new Date();
    
    const diffTotal = Math.max(end - start, 1);
    const totalDays = Math.ceil(diffTotal / (1000 * 60 * 60 * 24));
    const daysPassed = Math.min(Math.ceil((today - start) / (1000 * 60 * 60 * 24)), totalDays);

    let loopStart = 0;
    let loopEnd = totalDays;

    if (filtros.start) {
        const dStart = new Date(filtros.start);
        loopStart = Math.max(0, Math.ceil((dStart - start) / (1000 * 60 * 60 * 24)));
    }
    if (filtros.end) {
        const dEnd = new Date(filtros.end);
        loopEnd = Math.min(totalDays, Math.ceil((dEnd - start) / (1000 * 60 * 60 * 24)));
    }

    const step = Math.max(1, Math.ceil((loopEnd - loopStart) / 50));

    for (let i = loopStart; i <= loopEnd; i += step) {
        const fechaPunto = new Date(start.getTime() + (i * 24 * 60 * 60 * 1000));
        labels.push(fechaPunto.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }));

        // Planned Value (Curva S)
        const x = i / totalDays;
        const s_factor = (1 - Math.cos(x * Math.PI)) / 2;
        const pvVal = bac * s_factor;
        dataPV.push(pvVal.toFixed(2));

        // EV y AC (Histórico)
        if (i <= daysPassed) {
            const factorInterp = (avance / 100) * (i / Math.max(daysPassed, 1));
            const evVal = bac * factorInterp;
            dataEV.push(evVal.toFixed(2));

            const gMat = bitacoraGastos
                .filter(g => new Date(g.fecha_registro) <= fechaPunto)
                .reduce((s, g) => s + parseFloat(g.monto_relacionado || 0), 0);
            
            const nProporcional = costoNomina * (i / Math.max(daysPassed, 1));
            const acVal = gMat + nProporcional;
            dataAC.push(acVal.toFixed(2));

            const spi = pvVal > 0 ? evVal / pvVal : 1;
            const cpi = acVal > 0 ? evVal / acVal : 1;
            dataSPI.push(spi.toFixed(2));
            dataCPI.push(cpi.toFixed(2));
        } else {
            dataEV.push(null);
            dataAC.push(null);
            dataSPI.push(null);
            dataCPI.push(null);
        }
    }

    return { labels, dataPV, dataEV, dataAC, dataSPI, dataCPI };
};

/* ----------------------------------------------------------------------------------------------------
 * 4. RUTAS DE VISUALIZACIÓN Y DASHBOARD (GET)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * RUTA: DETALLE DE PROYECTO (DASHBOARD 360)
 * [CORRECCIÓN IMPORTANTE]: Ahora ejecuta 'sincronizarIndicadores' al abrir.
 * Esto asegura que la base de datos siempre tenga el SPI/CPI fresco.
 */
router.get('/:id', verificarSesion, async function(req, res, next) {
    const id = req.params.id;
    const filterS = req.query.start || null;
    const filterE = req.query.end || null;

    if (isNaN(id)) return res.redirect('/app/proyectos');

    let client;
    try {
        // A. RECALIBRACIÓN AUTOMÁTICA
        // Antes de cargar nada, forzamos la actualización de la matemática financiera
        await sincronizarIndicadores(id);

        client = await pool.connect();

        // B. EXTRACCIÓN DE DATOS MAESTROS (Ya actualizados)
        const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
        const p = resP.rows[0];

        if (!p) {
            client.release();
            return res.status(404).render('error', { message: "Proyecto no localizado." });
        }

        // C. INTEGRACIÓN CON CAPITAL HUMANO (RH)
        const resRH = await client.query("SELECT costo_hora FROM rrhh_colaboradores WHERE nombre_completo = $1", [p.lider]);
        const costoHoraPM = resRH.rows.length > 0 ? parseFloat(resRH.rows[0].costo_hora) : 0;

        // D. CARGA DE SUB-MÓDULOS (PARALELO)
        const [resEnt, resCam, resHit, resRie, resBit, resRepo] = await Promise.all([
            client.query('SELECT * FROM entregables WHERE proyecto_id = $1 ORDER BY id ASC', [id]),
            client.query('SELECT * FROM control_cambios WHERE proyecto_id = $1 ORDER BY fecha_registro DESC', [id]),
            client.query('SELECT * FROM hitos WHERE proyecto_id = $1 ORDER BY fecha ASC', [id]),
            client.query('SELECT * FROM riesgos WHERE proyecto_id = $1 ORDER BY id DESC', [id]),
            client.query('SELECT * FROM bitacora WHERE proyecto_id = $1 ORDER BY fecha_registro DESC', [id]),
            client.query('SELECT COUNT(*) as total FROM repositorio_planos WHERE proyecto_id = $1', [id])
        ]);

        // E. LÓGICA DE NEGOCIO PARA VISTA
        const inicio = new Date(p.fecha_inicio || p.creado_en);
        const finOriginal = new Date(p.fecha_fin);
        const hoy = new Date();

        let aditivasDinero = 0;
        let aditivasDias = 0;
        resCam.rows.forEach(c => {
            if (c.estatus === 'Aprobado') {
                aditivasDinero += parseFloat(c.impacto_costo) || 0;
                aditivasDias += parseInt(c.impacto_tiempo) || 0;
            }
        });

        const presupuestoBAC = parseFloat(p.presupuesto) + aditivasDinero;
        const fechaFinAjustada = new Date(finOriginal);
        fechaFinAjustada.setDate(fechaFinAjustada.getDate() + aditivasDias);

        // Nómina
        const diasTranscurridos = Math.max(0, Math.ceil((hoy - inicio) / (1000 * 60 * 60 * 24)));
        const horasLaboradasPM = diasTranscurridos * 8 * 0.75; 
        const costoNominaAcumulada = horasLaboradasPM * costoHoraPM;

        // Costo Real
        const bitacoraGastos = resBit.rows.filter(b => b.tipo_registro === 'Gasto');
        const costoMateriales = bitacoraGastos.reduce((s, g) => s + parseFloat(g.monto_relacionado || 0), 0);
        const acTotal = costoMateriales + costoNominaAcumulada + (parseFloat(p.costo_acumulado) || 0);

        // Utilidad
        const valorVentaNegocio = parseFloat(p.valor_negocio) || 0;
        const utilidadActual = valorVentaNegocio - acTotal;

        // Gráficos
        const analitica = procesarCurvasEVM(
            inicio, fechaFinAjustada, presupuestoBAC, p.progreso, 
            bitacoraGastos, costoNominaAcumulada, { start: filterS, end: filterE }
        );

        // Objeto Dashboard
        const pDashboard = {
            ...p,
            entregables: resEnt.rows,
            controlCambios: resCam.rows,
            hitos: resHit.rows,
            riesgos: resRie.rows,
            bitacora: resBit.rows,
            totalPlanos: parseInt(resRepo.rows[0].total),
            
            fecha_fin_ajustada_f: fechaFinAjustada.toLocaleDateString('es-MX', {day:'numeric', month:'long', year:'numeric'}),
            
            kpi: {
                bac_f: toMXN(presupuestoBAC),
                pv_f: toMXN(valorVentaNegocio),
                ev_f: toMXN(utilidadActual),
                ac_f: toMXN(acTotal),
                
                // Usamos los valores frescos de la base de datos (recién sincronizados)
                cpi_v: parseFloat(p.cpi).toFixed(2),
                spi_v: parseFloat(p.spi).toFixed(2),
                cpi_color: parseFloat(p.cpi) < 0.9 ? 'text-danger' : (parseFloat(p.cpi) > 1.05 ? 'text-success' : 'text-warning'),
                spi_color: parseFloat(p.spi) < 0.9 ? 'text-danger' : (parseFloat(p.spi) > 1.05 ? 'text-success' : 'text-warning'),
                diagnostico: generarDiagnosticoSalud(p.cpi, p.spi)
            },

            graficos: {
                labels: JSON.stringify(analitica.labels),
                pv: JSON.stringify(analitica.dataPV),
                ev: JSON.stringify(analitica.dataEV),
                ac: JSON.stringify(analitica.dataAC),
                spi: JSON.stringify(analitica.dataSPI),
                cpi: JSON.stringify(analitica.dataCPI)
            }
        };

        res.render('app_proyecto_detalle', { 
            p: pDashboard, 
            filtros: { start: filterS, end: filterE },
            usuario: req.session.nombreUsuario 
        });

    } catch (err) {
        console.error("[CRITICAL ERROR]", err);
        res.status(500).send("Fallo en el motor de análisis: " + err.message);
    } finally {
        if (client) client.release();
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 5. RUTAS DE CONFIGURACIÓN Y EDICIÓN (RESTAURADO)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * RUTA: MOSTRAR FORMULARIO DE EDICIÓN
 * Recupera los datos del proyecto para mostrarlos en los inputs.
 */
router.get('/:id/editar', verificarSesion, async function(req, res) {
    const id = req.params.id;
    if (isNaN(id)) return res.redirect('/app/proyectos');

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

        // Renderizamos la vista de edición (Asegúrate de tener 'app_proyecto_editar.pug')
        // Si usas un modal, esta lógica podría cambiar, pero aquí asumimos vista dedicada
        res.render('app_proyecto_editar', { 
            title: `Configurar ${p.codigo}`,
            p: p,
            usuario: req.session.nombreUsuario
        });

    } catch (err) {
        console.error("Error al cargar configuración:", err);
        if (client) client.release();
        res.status(500).send("Error de servidor.");
    }
});

/**
 * RUTA: GUARDAR CAMBIOS DE CONFIGURACIÓN (UPDATE)
 */
router.post('/:id/actualizar', verificarSesion, async function(req, res) {
    const id = req.params.id;
    const { nombre, cliente, lider, presupuesto, valor_negocio, fecha_fin, fase, estatus } = req.body;

    try {
        await pool.query(
            `UPDATE proyectos SET 
                nombre = $1, 
                cliente = $2, 
                lider = $3, 
                presupuesto = $4, 
                valor_negocio = $5, 
                fecha_fin = $6, 
                fase = $7,
                salud = $8 
            WHERE id = $9`,
            [nombre, cliente, lider, parseFloat(presupuesto), parseFloat(valor_negocio), fecha_fin, fase, estatus, id]
        );
        
        // Recalcular indicadores con los nuevos valores financieros
        await sincronizarIndicadores(id);
        
        res.redirect(`/app/proyectos/${id}`);
    } catch (err) {
        console.error("Error actualizando proyecto:", err);
        res.status(500).send("No se pudo actualizar el proyecto.");
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 6. RUTAS DE GENERACIÓN DE DOCUMENTOS (PDF)
 * ---------------------------------------------------------------------------------------------------- */

router.get('/reporte/:id', verificarSesion, async function(req, res) {
    const id = req.params.id;
    let client;
    try {
        client = await pool.connect();
        
        const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
        const p = resP.rows[0];

        if (!p) { client.release(); return res.status(404).send("Proyecto inexistente."); }

        const [resEnt, resCam, resHit, resRie, resBit] = await Promise.all([
            client.query('SELECT * FROM entregables WHERE proyecto_id = $1', [id]),
            client.query('SELECT * FROM control_cambios WHERE proyecto_id = $1', [id]),
            client.query('SELECT * FROM hitos WHERE proyecto_id = $1', [id]),
            client.query('SELECT * FROM riesgos WHERE proyecto_id = $1', [id]),
            client.query('SELECT * FROM bitacora WHERE proyecto_id = $1 ORDER BY fecha_registro DESC LIMIT 15', [id])
        ]);
        client.release();

        const bac = parseFloat(p.presupuesto) || 0;
        const ac = parseFloat(p.costo_acumulado) || 0;
        const ev = bac * ((p.progreso || 0) / 100);
        const cpi = ac > 0 ? ev / ac : 1;

        const pData = {
            ...p,
            entregables: resEnt.rows,
            controlCambios: resCam.rows,
            hitos: resHit.rows,
            riesgos: resRie.rows,
            bitacora: resBit.rows,
            kpi: {
                bac_f: toMXN(bac),
                pv_f: toMXN(parseFloat(p.valor_negocio)),
                ev_f: toMXN(ev),
                ac_f: toMXN(ac),
                cpi_v: cpi.toFixed(2),
                spi_v: "1.00",
                eac_f: toMXN(cpi > 0 ? bac / cpi : bac),
                cv_f: toMXN(ev - ac)
            }
        };

        res.render('app_reporte_pdf', { p: pData, layout: false }, async (err, html) => {
            if (err) {
                console.error("Error al compilar PUG del reporte:", err);
                return res.status(500).send("Error en el diseño del reporte.");
            }

            const options = { 
                format: 'A4', 
                printBackground: true,
                margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" }
            };
            const file = { content: html };

            const pdfBuffer = await html_to_pdf.generatePdf(file, options);
            
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=Reporte_INYMO_${p.codigo}.pdf`);
            res.send(pdfBuffer);
        });

    } catch (e) {
        if (client) client.release();
        res.status(500).send("Error en servidor de reportes.");
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 7. RUTAS DE ACCIÓN OPERATIVA (CRUD)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * REGISTRAR GASTO OPERATIVO
 * [AUTO-SYNC]: Recalcula índices al guardar.
 */
router.post('/:id/gasto', verificarSesion, async (req, res) => {
    const { concepto, monto, fecha } = req.body;
    try {
        await pool.query('BEGIN');
        await pool.query(
            "INSERT INTO bitacora (proyecto_id, titulo, descripcion, tipo_registro, monto_relacionado, fecha_registro) VALUES ($1, $2, 'Imputación de costo real manual.', 'Gasto', $3, $4)",
            [req.params.id, 'Gasto: ' + concepto, parseFloat(monto), fecha || new Date()]
        );
        await pool.query("UPDATE proyectos SET costo_acumulado = COALESCE(costo_acumulado,0) + $1 WHERE id = $2", [parseFloat(monto), req.params.id]);
        await pool.query('COMMIT');
        
        await sincronizarIndicadores(req.params.id);

        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (e) {
        await pool.query('ROLLBACK');
        res.status(500).send("Error al procesar gasto.");
    }
});

/**
 * GESTIÓN DE ENTREGABLES (WBS)
 */
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

/**
 * GESTIÓN DE RIESGOS
 */
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

/**
 * GESTIÓN DE HITOS
 */
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

/**
 * GESTIÓN DE BITÁCORA
 */
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

/**
 * GESTIÓN DE CONTROL DE CAMBIOS (RC)
 */
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

/* ----------------------------------------------------------------------------------------------------
 * 8. GESTIÓN DE CICLO DE VIDA (ARCHIVAR)
 * ---------------------------------------------------------------------------------------------------- */

router.get('/eliminar/:id', verificarSesion, async (req, res) => {
    try {
        await pool.query("UPDATE proyectos SET salud = 'Archivado' WHERE id = $1", [req.params.id]);
        res.redirect('/app/proyectos');
    } catch (e) {
        res.status(500).send("Fallo en el proceso de archivado.");
    }
});

// EXPORTACIÓN DEL CONTROLADOR INTEGRAL
module.exports = router;