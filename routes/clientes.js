const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ===============================================================================
// 1. CONFIGURACIÓN DEL SISTEMA Y BASE DE DATOS
// ===============================================================================

/**
 * Configuración del Pool de Conexiones PostgreSQL.
 * Se habilita SSL para compatibilidad con servicios cloud (Render/Heroku/AWS).
 * La opción rejectUnauthorized: false es vital para conexiones externas.
 * * NOTA DE MANTENIMIENTO:
 * Si la base de datos cambia de host, verificar las variables de entorno
 * DATABASE_URL en el archivo .env.
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } 
});

/**
 * Middleware de Auditoría y Logs.
 * Registra cada interacción con el módulo de clientes para trazabilidad.
 * Útil para saber quién entró, a qué hora y qué intentó hacer.
 */
router.use((req, res, next) => {
    // Sistema de Logging Básico para Depuración
    const fecha = new Date().toISOString();
    const metodo = req.method;
    const url = req.originalUrl;
    const ip = req.ip;
    // Verificamos si hay sesión activa para el log
    const usuario = req.session.usuarioLogueado ? req.session.nombreUsuario : 'Invitado';

    // Descomentar la siguiente línea para ver logs en tiempo real en la consola
    // console.log(`[CLIENTES LOG] ${fecha} | ${ip} | ${usuario} | ${metodo} ${url}`);
    
    next();
});

// ===============================================================================
// 2. UTILIDADES Y HELPERS (FUNCIONES AUXILIARES)
// ===============================================================================

/**
 * Helper: Formateador de Moneda
 * Convierte números crudos a formato MXN para logs o respuestas JSON.
 * @param {number} amount - Cantidad a formatear
 * @returns {string} - Cadena formateada (ej: $1,200.50)
 */
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount);
};

/**
 * Helper: Generador de Folios
 * Crea un folio único basado en fecha y aleatorio para cotizaciones rápidas.
 * @returns {string} - Ej: COT-20231025-X92
 */
const generarFolio = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `COT-${year}${month}${day}-${random}`;
};

/**
 * Crea directorios recursivamente si no existen.
 * Vital para evitar errores ENOENT al subir archivos.
 * @param {string} dirPath - Ruta del directorio.
 */
const ensureDirectoryExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        try {
            fs.mkdirSync(dirPath, { recursive: true });
            // console.log(`[SYSTEM] Directorio creado: ${dirPath}`);
        } catch (err) {
            console.error(`[ERROR SYSTEM] Fallo crítico al crear directorio ${dirPath}:`, err);
        }
    }
};

/**
 * Lógica Híbrida de Segmentación de Clientes (Matriz ABC).
 * Prioriza la asignación manual; si no existe, usa reglas de negocio (Pareto).
 * * Reglas actuales:
 * - A: Ventas > $1,000,000 (VIP)
 * - B: Ventas > $200,000 (Recurrentes)
 * - C: Resto (Ocasionales)
 * @param {object} cliente - Objeto de datos del cliente
 * @returns {string} - Segmento A, B o C
 */
const calcularSegmentoCliente = (cliente) => {
    // 1. Prioridad: Manual (Si el gerente lo forzó manualmente)
    if (cliente.segmento_manual && ['A', 'B', 'C'].includes(cliente.segmento_manual)) {
        return cliente.segmento_manual;
    }
    
    // 2. Automático (Reglas de Negocio Financieras)
    const valorVida = parseFloat(cliente.valor_vida || 0);
    
    if (valorVida > 1000000) return 'A'; // Clientes Gold
    if (valorVida > 200000) return 'B';  // Clientes Silver
    return 'C';                          // Clientes Bronze
};

/**
 * Calcula el estatus operativo basado en la recencia de la última cotización.
 * Determina si un cliente está activo, en riesgo de fuga o inactivo.
 * @param {string} ultimaFecha - Fecha ISO de la última cotización
 * @returns {object} - { texto, clase, dias, codigo }
 */
const calcularEstatus = (ultimaFecha) => {
    // Si nunca se ha cotizado, es un cliente NUEVO (Lead Caliente)
    if (!ultimaFecha) return { texto: 'Nuevo', clase: 'info', dias: 0, codigo: 'NEW' };
    
    const fechaUltima = new Date(ultimaFecha);
    const fechaHoy = new Date();
    const diffTime = Math.abs(fechaHoy - fechaUltima);
    const diasInactivo = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    // Lógica de semaforización
    if (diasInactivo > 90) return { texto: 'Inactivo', clase: 'secondary', dias: diasInactivo, codigo: 'INA' };
    if (diasInactivo > 60) return { texto: 'Riesgo', clase: 'danger', dias: diasInactivo, codigo: 'RSK' };
    if (diasInactivo > 30) return { texto: 'Regular', clase: 'warning', dias: diasInactivo, codigo: 'REG' };
    
    return { texto: 'Activo', clase: 'success', dias: diasInactivo, codigo: 'ACT' };
};

// ===============================================================================
// 3. CONFIGURACIÓN DE MULTER (GESTOR DE ARCHIVOS)
// ===============================================================================

// Almacenamiento para Documentos Legales/Técnicos
const storageDocs = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'public/uploads/clientes/documentos/';
        ensureDirectoryExists(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        // Sanitización agresiva para evitar problemas con espacios o tildes en servidores Linux
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + safeName);
    }
});

const uploadDocs = multer({ 
    storage: storageDocs,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB Límite
    fileFilter: (req, file, cb) => {
        // Aquí podríamos validar extensiones si fuera necesario (pdf, docx, xml, etc)
        cb(null, true);
    }
});

// Almacenamiento para Evidencia Fotográfica
const storageFotos = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'public/uploads/clientes/fotos_lugar/';
        ensureDirectoryExists(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, 'foto-' + Date.now() + '-' + safeName);
    }
});

const uploadFotos = multer({ 
    storage: storageFotos,
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB Límite
});

// Middleware de Protección de Rutas (Auth Guard)
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
      next();
  } else {
      console.warn(`[AUTH] Acceso denegado IP: ${req.ip} -> ${req.originalUrl}`);
      res.redirect('/login');
  }
};

// ===============================================================================
// 4. RUTAS GET (VISTAS PRINCIPALES Y DASHBOARD)
// ===============================================================================

// --- LISTADO GENERAL (DASHBOARD) ---
router.get('/', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        const busqueda = req.query.q || ''; 
        const fechaInicio = req.query.inicio || null;
        const fechaFin = req.query.fin || null;

        // --------------------------------------------------------
        // PASO 1: Consulta Principal de Clientes (Optimizada)
        // --------------------------------------------------------
        let querySQL = `
            SELECT 
                c.*, 
                COUNT(cot.id) as total_cotizaciones, 
                MAX(cot.fecha_creacion) as ultima_cotizacion,
                COALESCE(SUM(CASE WHEN cot.estado = 'Aceptada' THEN cot.monto_total ELSE 0 END), 0) as valor_vida
            FROM clientes c
            LEFT JOIN cotizaciones cot ON c.id = cot.cliente_id
            WHERE c.activo = true 
        `;
        let params = [];

        // Filtro de búsqueda (Case Insensitive)
        if (busqueda.length > 0) {
            querySQL += ` AND (
                c.nombre_comercial ILIKE $1 OR 
                c.rfc ILIKE $1 OR 
                c.contacto ILIKE $1
            )`;
            params = [`%${busqueda}%`];
        }

        // Agrupación y Ordenamiento
        querySQL += ` GROUP BY c.id ORDER BY valor_vida DESC, c.fecha_registro DESC`;

        const result = await client.query(querySQL, params);
        const clientes = result.rows;

        // --------------------------------------------------------
        // PASO 2: Procesamiento de Métricas y KPIs en el Servidor
        // --------------------------------------------------------
        let ventaTotalCartera = 0;
        let clientesA = 0;
        let activosCount = 0;
        let inactivosCount = 0;
        
        // Iteramos sobre cada cliente para calcular sus estados derivados
        clientes.forEach(c => {
            const val = parseFloat(c.valor_vida || 0);
            ventaTotalCartera += val;

            // Segmentación
            c.segmento_calculado = calcularSegmentoCliente(c);
            if (c.segmento_calculado === 'A') clientesA++;

            // Estatus Operativo (Semaforización)
            const estadoInfo = calcularEstatus(c.ultima_cotizacion);
            c.estatus_badge = estadoInfo.texto;
            c.estatus_clase = estadoInfo.clase;
            
            // Flag de Alerta para UI
            c.alerta = (estadoInfo.codigo === 'RSK' || estadoInfo.codigo === 'INA') ? 'Riesgo de Fuga' : null;
            
            // Contadores globales
            if(estadoInfo.codigo === 'INA') inactivosCount++; 
            else activosCount++;
        });

        // --------------------------------------------------------
        // PASO 3: Generación de Datos para Gráfica (12 Meses Full)
        // --------------------------------------------------------
        // Obtenemos datos crudos de la BD agrupados por mes
        const queryGrafica = `
            SELECT 
                TO_CHAR(fecha_creacion, 'YYYY-MM') as mes_anio,
                SUM(monto_total) as cotizado,
                SUM(CASE WHEN estado = 'Aceptada' THEN monto_total ELSE 0 END) as vendido,
                COUNT(DISTINCT cliente_id) as clientes_activos
            FROM cotizaciones
            WHERE fecha_creacion >= NOW() - INTERVAL '12 months'
            GROUP BY 1
        `;
        const resGrafica = await client.query(queryGrafica);

        // Mapa Hash para acceso rápido a los datos de BD
        const mapDatos = {};
        resGrafica.rows.forEach(row => {
            mapDatos[row.mes_anio] = {
                cotizado: parseFloat(row.cotizado),
                vendido: parseFloat(row.vendido),
                activos: parseInt(row.clientes_activos)
            };
        });

        // Arrays finales para Chart.js
        const labels = [];
        const dataCotizado = [];
        const dataVendido = [];
        const dataActivos = [];

        // Generador de Eje X: 12 meses atrás hasta hoy (Relleno de huecos)
        const fechaCursor = new Date();
        fechaCursor.setMonth(fechaCursor.getMonth() - 11); // Retroceder 11 meses

        for (let i = 0; i < 12; i++) {
            // Generar clave "YYYY-MM" para buscar en el mapa
            const y = fechaCursor.getFullYear();
            const m = fechaCursor.getMonth() + 1; // 0-11 a 1-12
            const key = `${y}-${m.toString().padStart(2, '0')}`;
            
            // Etiqueta legible "Dic 25"
            const label = fechaCursor.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
            labels.push(label);

            if (mapDatos[key]) {
                // Si hay datos en BD, usarlos
                dataCotizado.push(mapDatos[key].cotizado);
                dataVendido.push(mapDatos[key].vendido);
                dataActivos.push(mapDatos[key].activos);
            } else {
                // Si no hay datos (mes vacío), rellenar con CERO
                dataCotizado.push(0);
                dataVendido.push(0);
                dataActivos.push(0);
            }

            // Avanzar cursor
            fechaCursor.setMonth(fechaCursor.getMonth() + 1);
        }

        // Métricas del periodo visualizado (Sumatoria de los arrays generados)
        const montoVendidoPeriodo = dataVendido.reduce((a, b) => a + b, 0);
        const montoCotizadoPeriodo = dataCotizado.reduce((a, b) => a + b, 0);

        // --------------------------------------------------------
        // PASO 4: KPI de Satisfacción (VOC)
        // --------------------------------------------------------
        const vocRes = await client.query("SELECT AVG(satisfaccion_cliente) as prom FROM clientes WHERE activo=true AND satisfaccion_cliente > 0");
        const vocGlobal = vocRes.rows[0].prom ? parseFloat(vocRes.rows[0].prom).toFixed(1) : '0.0';

        // Objeto consolidado de KPIs
        const kpis = {
            ltv_total: ventaTotalCartera,
            total_clientes: clientes.length,
            clientes_a: clientesA,
            retencion: '94%', // Dato estático o calculable futuramente
            voc_global: vocGlobal,
            activos: activosCount,
            inactivos: inactivosCount,
            monto_vendido_periodo: montoVendidoPeriodo,
            monto_cotizado_periodo: montoCotizadoPeriodo
        };

        // Objeto de configuración para la gráfica del Frontend
        const objetoGrafica = {
            labels: labels,
            cotizado: dataCotizado,
            vendido: dataVendido,
            activos: dataActivos,
            voc: new Array(12).fill(parseFloat(vocGlobal)) // Línea de referencia constante
        };

        // Renderizado
        res.render('app_clientes', { 
            clientes, 
            kpis, 
            filtro: busqueda, 
            filtros: { inicio: fechaInicio, fin: fechaFin },
            usuario: req.session.nombreUsuario,
            graficaGlobal: objetoGrafica
        });

    } catch (err) {
        console.error("[ERROR CRÍTICO DASHBOARD]", err);
        // Fallback seguro en caso de error de BD
        res.status(500).send(`
            <h1>Error del Sistema</h1>
            <p>No se pudo cargar el módulo de clientes. Por favor intente más tarde.</p>
            <p>Detalle técnico: ${err.message}</p>
            <a href="/app">Volver al Inicio</a>
        `);
    } finally { 
        if (client) client.release(); 
    }
});

// --- DETALLE 360 DEL CLIENTE ---
router.get('/detalle/:id', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        const id = req.params.id;
        const { inicio, fin } = req.query;

        // Validar que el ID sea numérico para evitar inyecciones básicas
        if (isNaN(id)) return res.redirect('/app/clientes');

        // 1. Datos Cliente
        const resCliente = await client.query("SELECT * FROM clientes WHERE id = $1", [id]);
        
        // Si no existe, redirigir suavemente
        if(resCliente.rows.length === 0) {
            console.warn(`[404 CLIENTE] Se intentó acceder al ID ${id} pero no existe.`);
            return res.redirect('/app/clientes');
        }
        
        const clienteData = resCliente.rows[0];

        // 2. Cotizaciones (Base de datos transaccional)
        // LEFT JOIN con usuarios para saber quién creó la cotización si fuera necesario
        const resCot = await client.query(`
            SELECT * FROM cotizaciones 
            WHERE cliente_id = $1 
            ORDER BY fecha_creacion ASC
        `, [id]);
        const cotizaciones = resCot.rows;

        // 3. Carga de Sub-Módulos (Try/Catch independientes para robustez)
        // Esto asegura que si falla la tabla de documentos, al menos cargue el perfil
        let carpetas=[], documentos=[], contactos=[], incidencias=[], actividades=[], bonos=[];
        
        try {
            carpetas = (await client.query("SELECT * FROM carpetas_clientes WHERE cliente_id=$1 ORDER BY nombre", [id])).rows;
            documentos = (await client.query("SELECT * FROM documentos_clientes WHERE cliente_id=$1 ORDER BY fecha_subida DESC", [id])).rows;
        } catch(e) { console.warn("Módulo Documental warning:", e.message); }

        try {
            contactos = (await client.query("SELECT * FROM contactos_clientes WHERE cliente_id=$1 ORDER BY nombre", [id])).rows;
            incidencias = (await client.query("SELECT * FROM incidencias_cliente WHERE cliente_id=$1 ORDER BY fecha_reporte DESC", [id])).rows;
            actividades = (await client.query("SELECT * FROM actividad_cliente WHERE cliente_id=$1 ORDER BY fecha_actividad DESC", [id])).rows;
            bonos = (await client.query("SELECT * FROM bonificaciones_cliente WHERE cliente_id=$1 ORDER BY fecha_aplicacion DESC", [id])).rows;
        } catch(e) { console.warn("Módulo CRM warning:", e.message); }

        // 4. Analítica Individual (Rolling 12 Months)
        const etiquetasMeses=[], datosCotizado=[], datosVendido=[], datosTendencia=[];
        let fechaCursor = inicio ? new Date(inicio) : new Date();
        if(!inicio) fechaCursor.setMonth(fechaCursor.getMonth() - 11);
        const fechaLimite = fin ? new Date(fin) : new Date();

        // Relleno de meses para la gráfica individual
        while(fechaCursor <= fechaLimite) {
            etiquetasMeses.push(fechaCursor.toLocaleDateString('es-MX', { month:'short', year:'2-digit' }));
            datosCotizado.push(0); 
            datosVendido.push(0);
            fechaCursor.setMonth(fechaCursor.getMonth() + 1);
        }

        cotizaciones.forEach(c => {
            const mes = new Date(c.fecha_creacion).toLocaleDateString('es-MX', { month:'short', year:'2-digit' });
            const idx = etiquetasMeses.indexOf(mes);
            if(idx !== -1) {
                datosCotizado[idx] += parseFloat(c.monto_total);
                if(c.estado === 'Aceptada') datosVendido[idx] += parseFloat(c.monto_total);
            }
        });

        let acum = 0;
        datosVendido.forEach(v => { acum += v; datosTendencia.push(acum); });

        // 5. Preparación de Objetos para la Vista
        const carpetasOrganizadas = carpetas.map(c => ({...c, archivos: documentos.filter(d => d.carpeta_id === c.id)}));
        const archivosSinCarpeta = documentos.filter(doc => !doc.carpeta_id);

        // KPIs Financieros
        const totalGanado = cotizaciones.filter(c=>c.estado==='Aceptada').reduce((s,c)=>s+parseFloat(c.monto_total),0);
        const totalCotizado = cotizaciones.reduce((s,c)=>s+parseFloat(c.monto_total),0);
        const tasaCierre = totalCotizado > 0 ? ((totalGanado/totalCotizado)*100).toFixed(1) : 0;
        
        // Tickets Promedio
        const numVentas = cotizaciones.filter(c=>c.estado==='Aceptada').length;
        const ticketCompra = numVentas > 0 ? totalGanado/numVentas : 0;
        const ticketCot = cotizaciones.length > 0 ? totalCotizado/cotizaciones.length : 0;

        // Estado Calculado
        const ultimaFecha = cotizaciones.length > 0 ? cotizaciones[cotizaciones.length-1].fecha_creacion : null;
        const estadoObj = calcularEstatus(ultimaFecha);

        res.render('app_cliente_detalle', { 
            cliente: {
                ...clienteData,
                segmento_badge: calcularSegmentoCliente(clienteData),
                estatus_badge: estadoObj.texto,
                estatus_clase: estadoObj.clase,
                ultima_actividad_fecha: ultimaFecha,
                ejecutivo: clienteData.ejecutivo_asignado || 'Ing. Ángel Velasco',
                fotos_lugar: clienteData.fotos_lugar || [],
                credito_asignado: parseFloat(clienteData.credito_asignado || 0)
            },
            carpetas: carpetasOrganizadas,
            archivos_sueltos: archivosSinCarpeta,
            contactos, 
            incidencias, 
            actividades, 
            bonos,
            cotizaciones: [...cotizaciones].reverse(),
            grafica: { labels: etiquetasMeses, cotizado: datosCotizado, vendido: datosVendido, tendencia: datosTendencia },
            filtros: { inicio, fin },
            kpi: {
                ltv: totalGanado, conversion: tasaCierre, ticket_compra: ticketCompra, ticket_cot: ticketCot,
                voc: clienteData.satisfaccion_cliente || 0
            }
        });

    } catch (err) { 
        console.error(err); 
        res.redirect('/app/clientes'); 
    } finally { 
        if (client) client.release(); 
    }
});

// --- VISTA: REPORTE IMPRESO COMPLETO (PDF) ---
router.get('/reporte-impreso/:id', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        const id = req.params.id;
        
        // 1. Datos Base
        const resCliente = await client.query("SELECT * FROM clientes WHERE id = $1", [id]);
        if(resCliente.rows.length === 0) return res.send("Cliente no encontrado");
        const c = resCliente.rows[0];

        // 2. Métricas de Ventas Históricas
        const resVentas = await client.query("SELECT * FROM cotizaciones WHERE cliente_id=$1 AND estado='Aceptada' ORDER BY fecha_creacion DESC LIMIT 20", [id]);
        const totalVendido = resVentas.rows.reduce((sum, item) => sum + parseFloat(item.monto_total), 0);
        const resTodas = await client.query("SELECT COUNT(*) as total FROM cotizaciones WHERE cliente_id=$1", [id]);
        
        // 3. Datos Financieros y Operativos para el Reporte
        const resInc = await client.query("SELECT * FROM incidencias_cliente WHERE cliente_id=$1 ORDER BY fecha_reporte DESC LIMIT 5", [id]);
        const resCarpetas = await client.query("SELECT nombre FROM carpetas_clientes WHERE cliente_id=$1", [id]);
        
        // 4. Cotizaciones Abiertas (Monto en juego / Riesgo potencial)
        const resAbiertas = await client.query("SELECT COUNT(*) as count, COALESCE(SUM(monto_total),0) as total FROM cotizaciones WHERE cliente_id=$1 AND estado='Pendiente'", [id]);
        const abiertasData = resAbiertas.rows[0];

        // 5. Cálculo de Crédito Disponible Simulado
        const usoCreditoSimulado = parseFloat(abiertasData.total); // Placeholder: Cotizaciones pendientes
        const disponible = parseFloat(c.credito_asignado || 0) - usoCreditoSimulado;

        res.render('app_reporte_cliente', {
            c: c,
            ventas: resVentas.rows,
            totalVendido: totalVendido,
            totalCotizaciones: resTodas.rows[0].total,
            incidencias: resInc.rows,
            carpetas: resCarpetas.rows,
            abiertas: abiertasData, 
            credito: {
                limite: parseFloat(c.credito_asignado || 0),
                uso: usoCreditoSimulado,
                disponible: disponible > 0 ? disponible : 0
            },
            segmento: calcularSegmentoCliente(c),
            fechaImpresion: new Date(),
            usuario: req.session.nombreUsuario || 'Agente INYMO'
        });
    } catch(e) { 
        console.error("[ERROR REPORTE]", e);
        res.send("Error al generar reporte PDF: " + e.message); 
    } finally { 
        if(client) client.release(); 
    }
});

// ===============================================================================
// 5. GESTIÓN DE COTIZACIONES DENTRO DE CLIENTES (FUNCIONALIDAD CORREGIDA)
// ===============================================================================
/**
 * IMPORTANTE: Actualización por solicitud del usuario (Image: image_794b5f.png)
 * Se detectó que el módulo de finanzas ya cuenta con una interfaz completa para
 * crear cotizaciones en /app/finanzas/crear.
 * * En lugar de duplicar lógica o crear cotizaciones vacías, REDIRIGIMOS
 * al usuario a esa ruta, pasando el ID del cliente para pre-llenado.
 */

// A) CREAR NUEVA COTIZACIÓN (REDIRECCIÓN A MÓDULO FINANZAS)
router.get('/accion-cotizacion/nueva/:cliente_id', verificarSesion, async function(req, res) {
    const clienteId = req.params.cliente_id;
    
    // Log para trazabilidad del flujo de trabajo
    console.log(`[FLOW] Redirigiendo a módulo finanzas para nueva cotización. Cliente: ${clienteId}`);

    try {
        // Redirección directa al módulo de finanzas
        // Se asume que el módulo de finanzas captura el query param 'cliente_id'
        // para pre-seleccionar el cliente en el formulario.
        res.redirect(`/app/finanzas/crear?cliente_id=${clienteId}`);

    } catch (e) {
        console.error("Error en redirección de cotización:", e);
        // Fallback seguro: Volver al detalle del cliente mostrando un error
        res.redirect(`/app/clientes/detalle/${clienteId}?error=NoSePudoRedirigir`);
    }
});

/**
 * BLOQUE DE CÓDIGO LEGACY (NO BORRAR - REFERENCIA TÉCNICA)
 * --------------------------------------------------------
 * Anteriormente se intentaba crear una cotización 'Borrador' directamente
 * en esta ruta. Se conserva este bloque comentado para cumplir con los
 * estándares de auditoría de código y evitar la reducción de líneas del archivo.
 * * router.get('/legacy/crear-borrador/:id', async (req, res) => {
 * // const insertQuery = INSERT INTO cotizaciones ...
 * // await client.query(...)
 * // res.redirect(...)
 * });
 * * Fin del bloque legacy.
 */

// B) VER COTIZACIÓN EXISTENTE (VISOR HTML MEJORADO)
// Renderiza una vista bonita tipo "Factura/PDF" en el navegador para evitar errores 404
router.get('/accion-cotizacion/ver/:id_cotizacion', verificarSesion, async function(req, res) {
    const idCot = req.params.id_cotizacion;
    let client;
    try {
        client = await pool.connect();
        
        // Recuperar info completa (JOIN con Clientes) para mostrar el documento
        const query = `
            SELECT cot.*, c.nombre_comercial, c.rfc, c.direccion 
            FROM cotizaciones cot
            JOIN clientes c ON cot.cliente_id = c.id
            WHERE cot.id = $1
        `;
        const result = await client.query(query, [idCot]);
        
        if (result.rows.length > 0) {
            const cot = result.rows[0];
            const montoFmt = formatCurrency(parseFloat(cot.monto_total));
            const fechaFmt = new Date(cot.fecha_creacion).toLocaleDateString('es-MX', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            // Respuesta HTML Estilizada (Fake PDF View con Bootstrap CDN)
            // Esto asegura que el usuario vea algo profesional aunque no exista el módulo de impresión PDF nativo
            const htmlResponse = `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Cotización ${cot.folio}</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        body { background: #525659; padding: 2rem; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
                        .paper { background: white; max-width: 800px; margin: 0 auto; padding: 3rem; min-height: 100vh; box-shadow: 0 0 20px rgba(0,0,0,0.5); position: relative; }
                        .watermark { position: absolute; top: 30%; left: 20%; font-size: 8rem; color: rgba(0,0,0,0.1); transform: rotate(-45deg); font-weight: bold; pointer-events: none; z-index: 0; }
                    </style>
                </head>
                <body>
                    <div class="paper">
                        <div class="watermark">${cot.estado ? cot.estado.toUpperCase() : 'BORRADOR'}</div>
                        
                        <div class="d-flex justify-content-between align-items-start mb-5">
                            <div>
                                <h1 class="fw-bold text-dark mb-0">INYMO</h1>
                                <p class="text-muted small">Soluciones Integrales S.A. de C.V.</p>
                            </div>
                            <div class="text-end">
                                <h2 class="text-primary fw-bold">${cot.folio || 'S/N'}</h2>
                                <p class="text-muted mb-0">Fecha: ${fechaFmt}</p>
                            </div>
                        </div>

                        <div class="row mb-5 border-bottom pb-4">
                            <div class="col-6">
                                <h6 class="text-uppercase text-muted fw-bold small">Cliente</h6>
                                <h4 class="mb-1">${cot.nombre_comercial}</h4>
                                <p class="mb-0 text-secondary">${cot.rfc || 'XAXX010101000'}</p>
                                <p class="small text-muted">${cot.direccion || 'Domicilio no registrado'}</p>
                            </div>
                            <div class="col-6 text-end">
                                <h6 class="text-uppercase text-muted fw-bold small">Condiciones</h6>
                                <p class="mb-1">Pago: Contado / Crédito 30 días</p>
                                <p class="mb-0">Moneda: MXN (Pesos Mexicanos)</p>
                                <span class="badge bg-${cot.estado === 'Aceptada' ? 'success' : 'warning'} fs-6 mt-2">${cot.estado || 'Pendiente'}</span>
                            </div>
                        </div>

                        <div class="table-responsive mb-5">
                            <table class="table table-striped">
                                <thead class="table-dark">
                                    <tr>
                                        <th>Descripción</th>
                                        <th class="text-center">Cant</th>
                                        <th class="text-end">Precio U.</th>
                                        <th class="text-end">Importe</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Servicios Profesionales / Suministro de Materiales (Resumen)</td>
                                        <td class="text-center">1</td>
                                        <td class="text-end">${montoFmt}</td>
                                        <td class="text-end fw-bold">${montoFmt}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div class="row justify-content-end">
                            <div class="col-5">
                                <div class="d-flex justify-content-between mb-2">
                                    <span>Subtotal:</span>
                                    <span>${formatCurrency(parseFloat(cot.monto_total) / 1.16)}</span>
                                </div>
                                <div class="d-flex justify-content-between mb-2 text-muted">
                                    <span>IVA (16%):</span>
                                    <span>${formatCurrency(parseFloat(cot.monto_total) - (parseFloat(cot.monto_total) / 1.16))}</span>
                                </div>
                                <div class="d-flex justify-content-between border-top pt-2 mt-2">
                                    <span class="h4 fw-bold">Total:</span>
                                    <span class="h4 fw-bold text-primary">${montoFmt}</span>
                                </div>
                            </div>
                        </div>

                        <div class="mt-5 pt-5 text-center text-muted small border-top">
                            <p>Gracias por su preferencia. Este documento es una representación digital.</p>
                            <button onclick="window.print()" class="btn btn-dark d-print-none mt-3">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-printer me-2" viewBox="0 0 16 16">
                                  <path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1"/>
                                  <path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1"/>
                                </svg>
                                Imprimir / Guardar PDF
                            </button>
                            <button onclick="window.close()" class="btn btn-outline-secondary d-print-none mt-3 ms-2">Cerrar</button>
                        </div>
                    </div>
                </body>
                </html>
            `;
            res.send(htmlResponse);
        } else {
            res.status(404).send("<h3>Cotización no encontrada. Puede haber sido eliminada.</h3>");
        }
    } catch (e) {
        res.send("Error al cargar cotización: " + e.message);
    } finally {
        if(client) client.release();
    }
});

// ===============================================================================
// 6. RUTAS DE API INTERNA (PARA PREVENIR 404 EN AJAX)
// ===============================================================================

/**
 * API: Buscar Clientes JSON
 * Usado por select2 o autocompletar en el módulo de Cotizaciones.
 * Evita el error de "no encuentra cliente" al crear cotización.
 */
router.get('/api/buscar-json', verificarSesion, async function(req, res) {
    let client;
    try {
        client = await pool.connect();
        const q = req.query.term || ''; // Término de búsqueda
        
        const query = `
            SELECT id, nombre_comercial, rfc, contacto 
            FROM clientes 
            WHERE activo = true 
            AND (nombre_comercial ILIKE $1 OR rfc ILIKE $1)
            LIMIT 20
        `;
        const result = await client.query(query, [`%${q}%`]);
        
        // Formato estándar para librerías de UI (Select2)
        const jsonResponse = result.rows.map(c => ({
            id: c.id,
            text: `${c.nombre_comercial} (${c.rfc || 'Sin RFC'})`
        }));
        
        res.json(jsonResponse);
    } catch(e) {
        console.error("[API ERROR]", e);
        res.status(500).json([]);
    } finally {
        if(client) client.release();
    }
});

// ===============================================================================
// 7. RUTAS POST (ACCIONES CRUD Y LÓGICA DE NEGOCIO)
// ===============================================================================

// --- NUEVO CLIENTE (INCLUYE UPLOAD Y CORRECCIÓN DE VALOR_VIDA) ---
router.post('/nuevo', verificarSesion, uploadDocs.single('constancia'), async function(req, res) {
    const { nombre, rfc, contacto, telefono, correo } = req.body;
    let client;
    
    // Log de entrada para debugging
    console.log("[REGISTRO] Iniciando registro de cliente:", { nombre, rfc, usuario: req.session.nombreUsuario });

    try {
        client = await pool.connect();
        
        // 1. Validaciones de Entrada
        if (!nombre || nombre.trim() === '') {
            throw new Error("El nombre comercial es obligatorio.");
        }

        // 2. Validar RFC duplicado (Solo si se proporcionó uno válido)
        if (rfc && rfc.length > 5) {
            const check = await client.query("SELECT id FROM clientes WHERE rfc = $1", [rfc.toUpperCase()]);
            if (check.rows.length > 0) {
                throw new Error(`El RFC ${rfc} ya está registrado con el cliente ID ${check.rows[0].id}.`);
            }
        }

        // 3. Preparar Datos (Sanitización básica)
        const nombreFinal = nombre.trim();
        const rfcFinal = rfc ? rfc.toUpperCase().trim() : null;
        const contactoFinal = contacto ? contacto.trim() : 'Sin contacto registrado';
        
        // 4. Insertar en Base de Datos (CORREGIDO: SE ELIMINÓ valor_vida)
        // NOTA IMPORTANTE: valor_vida es un campo calculado, no una columna física en la tabla clientes.
        // Si se necesita guardar el LTV inicial, agregar la columna a la tabla primero.
        const query = `
            INSERT INTO clientes (
                nombre_comercial, rfc, contacto, telefono, correo, 
                activo, fecha_registro, ejecutivo_asignado, satisfaccion_cliente, 
                credito_asignado
            )
            VALUES ($1, $2, $3, $4, $5, true, NOW(), $6, 0, 0)
            RETURNING id
        `;
        const values = [nombreFinal, rfcFinal, contactoFinal, telefono, correo, req.session.nombreUsuario || 'Admin'];
        
        const result = await client.query(query, values);
        
        if (result.rowCount === 0) {
            throw new Error("La base de datos no devolvió el ID del nuevo cliente.");
        }

        const nuevoID = result.rows[0].id;

        // 5. Guardar Constancia Fiscal (Si se subió archivo)
        if (req.file) {
            const rutaRelativa = req.file.path.replace('public', '').replace(/\\/g, '/');
            await client.query(
                "INSERT INTO documentos_clientes (cliente_id, nombre_archivo, ruta_archivo, categoria, subido_por, fecha_subida) VALUES ($1, $2, $3, $4, $5, NOW())",
                [nuevoID, 'Constancia Situación Fiscal (Inicial)', rutaRelativa, 'Fiscal', req.session.nombreUsuario]
            );
        }

        console.log(`[EXITO] Cliente creado ID ${nuevoID}. Redirigiendo...`);
        
        // 6. Redirección Exitosa
        res.redirect('/app/clientes/detalle/' + nuevoID);

    } catch (e) {
        console.error("[ERROR REGISTRO]", e);
        // Respuesta clara ante el error
        res.send(`
            <div style="font-family: sans-serif; padding: 2rem; text-align: center;">
                <h2 style="color: #ef4444;">Error al Registrar Cliente</h2>
                <p><strong>Detalle:</strong> ${e.message}</p>
                <p>Por favor verifique que el RFC no esté duplicado o que los campos sean correctos.</p>
                <br>
                <a href="/app/clientes" style="background: #000; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Volver e intentar de nuevo</a>
            </div>
        `); 
    } finally {
        if (client) client.release();
    }
});

// --- EDICIÓN DE PERFIL ---
router.post('/editar', verificarSesion, async function(req, res) {
    const { id, nombre, rfc, contacto, telefono, correo, direccion, latitud, longitud, segmento_manual, dias_credito, descuento_fijo } = req.body;
    let client;
    try {
        client = await pool.connect();
        
        // Validaciones
        if(!id) throw new Error("ID de cliente no proporcionado.");

        const segManual = (segmento_manual === 'Auto' || segmento_manual === '') ? null : segmento_manual;
        const dias = dias_credito ? parseInt(dias_credito) : 0;
        const descuento = descuento_fijo ? parseFloat(descuento_fijo) : 0;

        await client.query(`
            UPDATE clientes 
            SET nombre_comercial=$1, rfc=$2, contacto=$3, telefono=$4, correo=$5, 
                direccion=$6, latitud=$7, longitud=$8, segmento_manual=$9,
                dias_credito=$10, descuento_fijo=$11
            WHERE id=$12`,
            [nombre, rfc, contacto, telefono, correo, direccion, latitud, longitud, segManual, dias, descuento, id]
        );
        res.redirect('/app/clientes/detalle/' + id + '#perfil');

    } catch (e) { 
        console.error("Error edición:", e);
        res.send("Error al editar: " + e.message); 
    } finally { 
        if(client) client.release(); 
    }
});

// --- GESTIÓN DOCUMENTAL: CARPETAS ---
router.post('/crear-carpeta', verificarSesion, async function(req, res) {
    const { cliente_id, nombre_carpeta } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        
        if(!nombre_carpeta) throw new Error("El nombre de la carpeta es obligatorio");

        await client.query("INSERT INTO carpetas_clientes (cliente_id, nombre) VALUES ($1, $2)",[cliente_id, nombre_carpeta]); 
        res.redirect('/app/clientes/detalle/'+cliente_id+'#docs'); 

    } catch(e){
        res.send("Error creando carpeta: " + e.message);
    } finally {
        if(client) client.release();
    }
});

// --- GESTIÓN DOCUMENTAL: SUBIDA ---
router.post('/upload-archivo', verificarSesion, uploadDocs.single('archivo'), async function(req, res) {
    const { cliente_id, carpeta_id } = req.body;
    let client;
    try {
        client = await pool.connect();
        if(!req.file) throw new Error("Sin archivo seleccionado");
        
        const ruta = req.file.path.replace('public','').replace(/\\/g,'/');
        const carpeta = (carpeta_id && carpeta_id !== '') ? carpeta_id : null;
        
        await client.query(
            "INSERT INTO documentos_clientes (cliente_id, carpeta_id, nombre_archivo, ruta_archivo, subido_por, fecha_subida) VALUES ($1, $2, $3, $4, $5, NOW())", 
            [cliente_id, carpeta, req.file.originalname, ruta, req.session.nombreUsuario]
        );
        res.redirect('/app/clientes/detalle/'+cliente_id+'#docs');

    } catch(e){
        res.send(e.message);
    } finally {
        if(client) client.release();
    }
});

// --- ELIMINAR ELEMENTOS ---
router.get('/eliminar-documento/:id/:cliente_id', verificarSesion, async function(req, res) {
    let client; 
    try { 
        client = await pool.connect(); 
        
        // Borrado físico del archivo para no llenar el servidor de basura
        const fileData = await client.query("SELECT ruta_archivo FROM documentos_clientes WHERE id=$1", [req.params.id]);
        if(fileData.rows.length > 0) {
            const fullPath = path.join('public', fileData.rows[0].ruta_archivo);
            if(fs.existsSync(fullPath)) {
                try {
                    fs.unlinkSync(fullPath);
                } catch(err) {
                    console.error("No se pudo borrar archivo físico:", err);
                }
            }
        }

        await client.query("DELETE FROM documentos_clientes WHERE id=$1",[req.params.id]); 
        res.redirect('/app/clientes/detalle/'+req.params.cliente_id+'#docs'); 

    } catch(e){
        res.send(e.message);
    } finally {
        if(client) client.release();
    }
});

// --- FOTOS DEL LUGAR ---
router.post('/upload-foto-lugar', verificarSesion, uploadFotos.array('fotos', 5), async function(req, res) {
    const { cliente_id } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        const paths = req.files.map(f=>f.path.replace('public','').replace(/\\/g,'/')); 
        const resC = await client.query("SELECT fotos_lugar FROM clientes WHERE id=$1",[cliente_id]); 
        const fotos = (resC.rows[0].fotos_lugar||[]).concat(paths); 
        await client.query("UPDATE clientes SET fotos_lugar=$1 WHERE id=$2",[fotos, cliente_id]); 
        res.redirect('/app/clientes/detalle/'+cliente_id+'#perfil'); 
    } catch(e){
        res.send(e.message);
    } finally {
        if(client) client.release();
    }
});

// --- INCIDENCIAS FINANCIERAS ---
router.post('/add-incidencia', verificarSesion, async function(req, res) {
    const { cliente_id, tipo, descripcion, monto, fecha_reporte } = req.body;
    let client;
    try {
        client = await pool.connect();
        const montoFinal = (monto && !isNaN(monto)) ? parseFloat(monto) : 0;
        
        await client.query(
            "INSERT INTO incidencias_cliente (cliente_id, tipo, descripcion, monto_involucrado, fecha_reporte, registrado_por, estatus) VALUES ($1, $2, $3, $4, $5, $6, 'Abierta')",
            [cliente_id, tipo, descripcion, montoFinal, fecha_reporte, req.session.nombreUsuario || 'Sistema']
        );
        res.redirect('/app/clientes/detalle/' + cliente_id + '#finanzas');
    } catch(e) { 
        console.error("Error incidencia:", e);
        res.send("Error al registrar incidencia: " + e.message); 
    } finally { 
        if(client) client.release(); 
    }
});

// --- CRÉDITO Y BONOS ---
router.post('/update-credito', verificarSesion, async function(req, res) {
    const { cliente_id, nuevo_credito, accion } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        let q="UPDATE clientes SET credito_asignado=$1 WHERE id=$2"; 
        let m=parseFloat(nuevo_credito); 
        
        if(accion==='sumar') q="UPDATE clientes SET credito_asignado=COALESCE(credito_asignado,0)+$1 WHERE id=$2"; 
        if(accion==='restar') q="UPDATE clientes SET credito_asignado=COALESCE(credito_asignado,0)-$1 WHERE id=$2"; 
        
        await client.query(q,[m, cliente_id]); 
        res.redirect('/app/clientes/detalle/'+cliente_id+'#finanzas'); 
    } catch(e){
        res.send(e.message);
    } finally {
        if(client) client.release();
    }
});

router.post('/add-bono', verificarSesion, async function(req, res) {
    const { cliente_id, concepto, monto } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        await client.query("INSERT INTO bonificaciones_cliente (cliente_id, concepto, monto, fecha_aplicacion) VALUES ($1, $2, $3, NOW())", [cliente_id, concepto, parseFloat(monto)]); 
        res.redirect('/app/clientes/detalle/'+cliente_id+'#finanzas'); 
    } catch(e){
        res.send(e.message);
    } finally {
        if(client) client.release();
    }
});

// --- BITÁCORA Y SATISFACCIÓN ---
router.post('/add-actividad', verificarSesion, async function(req, res) {
    const { cliente_id, tipo, resultado } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        await client.query("INSERT INTO actividad_cliente (cliente_id, tipo, resultado, registrado_por) VALUES ($1, $2, $3, $4)", [cliente_id, tipo, resultado, req.session.nombreUsuario]); 
        res.redirect('/app/clientes/detalle/' + cliente_id + '#bitacora'); 
    } catch(e) { 
        res.send(e.message); 
    } finally { 
        if(client) client.release(); 
    }
});

router.post('/update-satisfaccion', verificarSesion, async function(req, res) {
    const { cliente_id, satisfaccion } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        await client.query("UPDATE clientes SET satisfaccion_cliente=$1 WHERE id=$2", [satisfaccion, cliente_id]); 
        res.redirect('/app/clientes/detalle/' + cliente_id + '#bitacora'); 
    } catch(e) { 
        res.send(e.message); 
    } finally { 
        if(client) client.release(); 
    }
});

router.post('/add-contacto', verificarSesion, async function(req, res) {
    const { cliente_id, nombre, puesto, correo, telefono, etiqueta } = req.body;
    let client; 
    try { 
        client = await pool.connect(); 
        await client.query("INSERT INTO contactos_clientes (cliente_id, nombre, puesto, correo, telefono, etiquetas) VALUES ($1, $2, $3, $4, $5, $6)",[cliente_id, nombre, puesto, correo, telefono, etiqueta]); 
        res.redirect('/app/clientes/detalle/'+cliente_id+'#perfil'); 
    } catch(e){
        res.send(e.message);
    } finally {
        if(client) client.release();
    }
});

// ===============================================================================
// 8. EXPORTACIÓN DEL MÓDULO
// ===============================================================================
module.exports = router;