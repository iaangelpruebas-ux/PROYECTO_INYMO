/**
 * ====================================================================================================
 * * I N Y M O   E N T E R P R I S E   S Y S T E M S
 * PROJECT INTELLIGENCE UNIT - MASTER CORE CONTROLLER (V85.0.0)
 * ====================================================================================================
 * @description 
 * Núcleo de gestión 360°: Identidad, Finanzas PMBOK, Compras, Inventario y Reporteo.
 * Ajustado para: Ing. Ángel Velasco
 * ====================================================================================================
 */
// VERIFICACIÓN DE AUTORIZACIÓN
const { verificarSesion } = require('../../generales/verificacion_acceso.js');
// CORRECCIÓN DE RUTAS: BLOQUE_3 está al mismo nivel que subcodigos_presentacion

/* ----------------------------------------------------------------------------------------------------
 * 1. CONFIGURACIÓN DE INFRAESTRUCTURA Y ALMACENAMIENTO
 * ---------------------------------------------------------------------------------------------------- */

const { pool, upload } = require('../../generales/infraestructura_core.js');
const { express, html_to_pdf } = require('./subcodigos_presentacion/requiers_presentacion.js');

/* ----------------------------------------------------------------------------------------------------
 * 2. HELPERS Y MIDDLEWARES DE SISTEMA
 * ---------------------------------------------------------------------------------------------------- */

const { fmtMoney } = require('../../generales/helpers_formato_money.js');


/* ----------------------------------------------------------------------------------------------------
 * 3. MOTOR DASHBOARD: IDENTIDAD + FINANZAS + ANALÍTICA
 * ---------------------------------------------------------------------------------------------------- */
const router = express.Router();
const dataFetcher = require('./BLOQUE_3/data_fetcher.js');
const motorEVM = require('./BLOQUE_3/motor_evm.js');
const motorTiempos = require('./BLOQUE_3/analitica_tiempos.js');
const ensamblador = require('./BLOQUE_3/ensamblador_p.js');
const orquestador = require('./BLOQUE_3/orquestador_dashboard.js');
// MOTORES DE INTELIGENCIA DE NEGOCIO
const orquestadorFinanzas = require('./BLOQUE_4/orquestador_presupuesto.js'); // El nuevo jefe de finanzas

// --- IMPORTACIÓN BLOQUE 7 (ANALÍTICA) ---
const orquestadorGrafico = require('./BLOQUE_7/analitica_orquestador');
const analiticaFetcher = require('./BLOQUE_7/analitica_data_fetcher'); // Sincronizado para evitar el error

router.get('/:id', verificarSesion, async (req, res, next) => {
    const proyectoId = req.params.id;
    if (isNaN(proyectoId)) return next(); 

    let client;
    try {
        client = await pool.connect(); // Usamos una sola conexión para todo el proceso

        // 2. Ejecutas el motor de datos básicos (Bloque 3/4)
        const p = await orquestador.ejecutarTodo(pool, proyectoId);
        
        if (!p) return res.status(404).render('error', { message: "Proyecto no localizado." });

        // 3. INTEGRACIÓN BLOQUE 7: Traemos la analítica completa (PV, EV, AC reales)
        const dataAnalitica = await analiticaFetcher.obtenerAnaliticaCompleta(client, proyectoId);
        
        // 4. Procesamos las tendencias (PV, EV, AC, SPI, CPI) usando el histórico real
        const datosGraficos = orquestadorGrafico.procesarTendencias(dataAnalitica.historicoGraficas);

        // 5. Inyectamos los gráficos al objeto 'p' antes de mandarlo al PUG
        p.graficos = datosGraficos;

        res.render('proyecto_carpeta_pugs/detalles/app_detalle_layout_presentacion', { 
            p, 
            usuario: req.session.nombreUsuario,
            title: `${p.codigo} | INYMO Core`
        });

    } catch (err) {
        console.error("--- ERROR EN EL MOTOR DE PRESENTACIÓN ---", err);
        res.status(500).send("Fallo en el Motor Ejecutivo.");
    } finally {
        if (client) client.release(); // Liberamos la conexión siempre
    }
});


/* ----------------------------------------------------------------------------------------------------
 * 4. GESTIÓN FINANCIERA: DISTRIBUCIÓN Y ADQUISICIONES
 * ---------------------------------------------------------------------------------------------------- */
router.get('/:id/presupuesto/distribucion', verificarSesion, async (req, res) => {
    const proyectoId = req.params.id;
    
    try {
        // Ejecutamos el motor financiero de forma autónoma
        const finanzas = await orquestadorFinanzas.ejecutarDistribucion(pool, proyectoId);

        if (!finanzas) return res.status(404).send("Error: Datos financieros no localizados.");

        // Renderizamos con la data ya procesada y formateada (Pesos MXN y comas) [cite: 2025-12-12]
        res.render('proyecto_carpeta_pugs/detalles/app_detalle_presupuesto_desglose', { 
            p: finanzas.p, 
            partidas: finanzas.partidas,
            proveedores: finanzas.proveedores,
            stock: finanzas.stock,
            usuario: req.session.nombreUsuario,
            title: `Gobernanza Financiera | ${finanzas.p.codigo}`
        });

    } catch (e) {
        console.error("[BUDGET ENGINE ERROR]", e);
        res.redirect(`/app/proyectos/${proyectoId}`);
    }
});

/* ----------------------------------------------------------------------------------------------------
 * 5. ACCIONES OPERATIVAS Y NAVEGACIÓN
 * ---------------------------------------------------------------------------------------------------- */

// --- IMPORTACIÓN DEL CONTROLADOR 5 ---
const ctrlOp = require('./BLOQUE_5/operaciones_controller.js');

// 5.1 Finanzas Operativas (Alimenta el AC del Punto 5)
router.post('/:id/presupuesto/agregar', verificarSesion, upload.single('evidencia_pdf'), (req, res) => ctrlOp.agregarPartida(req, res, pool));

// 5.2 Navegación Directa
router.get('/:id/repositorio', verificarSesion, (req, res) => res.redirect(`/app/repositorio/proyecto/${req.params.id}`));

// 5.3 Ciclo de Vida
router.get('/:id/archivar', verificarSesion, (req, res) => ctrlOp.archivar(req, res, pool));

// 5.4 Riesgos Técnicos (Matriz / AMEF)
router.get('/:id/riesgos/:tipo', verificarSesion, (req, res) => ctrlOp.renderRiesgos(req, res, pool));

// SECCIÓN PARA EDITAR PROYECTO
router.get('/:id/editar', verificarSesion, async (req, res) => {
    const p = await orquestador.obtenerEdicionRapida(pool, req.params.id);
    
    if (!p) return res.status(404).send("Proyecto no encontrado.");

    res.render('app_proyecto_editar', { 
        title: `Configurar ${p.codigo}`, 
        p, 
        usuario: req.session.nombreUsuario 
    });
});


// RUTA PARA FILTRADO DINÁMICO (Punto 2: Filtro por fechas)
router.post('/:id/analitica/filtrar', verificarSesion, async (req, res) => {
    const { fecha_inicio, fecha_fin } = req.body;
    const proyectoId = req.params.id;
    let client;
    
    try {
        client = await pool.connect();
        // Llamamos al fetcher con el rango de fechas para actualizar PV, EV, AC
        const data = await analiticaFetcher.obtenerAnaliticaCompleta(client, proyectoId, {
            fechaInicio: fecha_inicio,
            fechaFin: fecha_fin
        });
        
        // Procesamos con el orquestador de analítica
        const tendenciaLimpia = orquestadorGrafico.procesarTendencias(data.historicoGraficas);
        
        res.json(tendenciaLimpia); // Enviamos los datos a Chart.js
    } catch (err) {
        res.status(500).json({ error: "Error al filtrar analítica" });
    } finally {
        if (client) client.release();
    }
});



/* ----------------------------------------------------------------------------------------------------
 * 6. MOTOR DE REPORTES DINÁMICOS (PDF)
 * ---------------------------------------------------------------------------------------------------- */
// --- IMPORTACIÓN BLOQUE 6 ---
const ctrlReporte = require('./BLOQUE_6/reporte_controller.js');

router.get('/reporte/:tipo/:id', verificarSesion, (req, res) => 
    ctrlReporte.generarReporte(req, res, pool, html_to_pdf)
);


module.exports = router;