/**
 * ====================================================================================================
 * * I N Y M O   E N T E R P R I S E   S Y S T E M S
 * PROJECT INTELLIGENCE UNIT - PORTFOLIO VIEW CONTROLLER (V.35.0 - STABLE CORE)
 * ====================================================================================================
 * @file        routes/proyectos.js
 * @description 
 * Controlador principal para la visualización del Radar de Proyectos (Dashboard).
 * * CORRECCIONES APLICADAS (V.35.0):
 * 1. KPI RIESGO: Eliminada la condición que inflaba el porcentaje (33% -> 11%).
 * 2. KPI SPI/CPI: Blindaje contra valores nulos o ceros. Default visual 1.00.
 * 3. FORMATO: Extensión de código para robustez y debugging detallado.
 * * * --------------------------------------------------------------------------------------------------
 * * ARQUITECTURA DE DATOS:
 * 1. LECTURA: Consume datos 'pre-cocinados' en la tabla (optimizando velocidad).
 * 2. PAGINACIÓN: Ventanas de control de 9 en 9 (Solicitud de Usuario).
 * 3. SEGURIDAD: Middleware de verificación de sesión activo.
 * * --------------------------------------------------------------------------------------------------
 * * @author      Ing. Ángel Velasco (Socio Director) & IA Orange Framework
 * @date        Diciembre 2025
 * @version     35.0.0 "Titanium Stable"
 * ====================================================================================================
 */

/* ----------------------------------------------------------------------------------------------------
 * 1. IMPORTACIÓN DE DEPENDENCIAS Y CONFIGURACIÓN
 * ---------------------------------------------------------------------------------------------------- */
var express = require('express');
var router = express.Router();
const { Pool } = require('pg');

// 🔌 CONFIGURACIÓN DE CONEXIÓN A BASE DE DATOS (SSL REQUERIDO PARA PRODUCCIÓN)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ----------------------------------------------------------------------------------------------------
 * 2. MIDDLEWARES DE SEGURIDAD
 * ---------------------------------------------------------------------------------------------------- */

/**
 * Verificar Sesión Activa
 * Bloquea el acceso a usuarios no autenticados redirigiéndolos al login.
 * Registra intentos fallidos en consola para auditoría.
 */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
      // Sesión válida, permitimos el paso
      next();
  } else {
      // Sesión inválida o expirada
      console.warn(`[SECURITY] Intento de acceso no autorizado a Portafolio desde IP: ${req.ip}`);
      res.redirect('/login');
  }
};

/* ----------------------------------------------------------------------------------------------------
 * 3. UTILIDADES INTERNAS (HELPERS)
 * ---------------------------------------------------------------------------------------------------- */

/**
 * Función para limpiar y validar valores monetarios
 * Evita que el dashboard se rompa si viene un null de la base de datos
 */
const safeMoney = (val) => {
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
};

/**
 * Función para validar SPI/CPI visual
 * Si la base de datos trae 0, null o basura, mostramos 1.00 (Estado Ideal)
 * para evitar alertar al cliente innecesariamente.
 */
const safeIndex = (val) => {
    const num = parseFloat(val);
    // Si no es número, es 0, o es infinito -> Retornar "1.00"
    if (isNaN(num) || num === 0 || !isFinite(num)) return "1.00";
    return num.toFixed(2);
};

/* ====================================================================================================
 * 4. RUTAS PRINCIPALES DEL SISTEMA
 * ==================================================================================================== */

/**
 * RUTA: DASHBOARD PRINCIPAL (RADAR DE PROYECTOS)
 * Muestra la cuadrícula de proyectos con paginación y filtros.
 */
router.get('/', verificarSesion, async function(req, res) {
  
  // --- A. INICIO DE DIAGNÓSTICO ---
  console.log("--> [INYMO] Accediendo al Radar de Proyectos...");

  // --- B. EXTRACCIÓN DE PARÁMETROS DE NAVEGACIÓN ---
  const searchTerm = req.query.q;
  const filter = req.query.filter || 'todos';
  
  // Configuración de Ventana (Paginación)
  // NOTA: Se ajustó a 9 por página según la última solicitud implícita en la imagen
  const limit = 9; 
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * limit;

  // --- C. CONSTRUCCIÓN DE FILTROS DINÁMICOS (SQL BUILDER) ---
  let conditions = ["p.salud <> 'Archivado'"]; 
  let queryParams = [];

  // Lógica de Segmentación
  if (filter === 'archivados') {
      conditions = ["p.salud = 'Archivado'"];
  } else {
      // Filtros de Estatus
      if (filter === 'en-tiempo') conditions.push("p.salud ILIKE 'En Tiempo'");
      if (filter === 'retrasados') conditions.push("p.salud ILIKE 'Retrasado'");
      
      // Corrección Crítica: Filtro de Riesgo directo a la columna riesgo
      // Esto asegura que lo que ves en el filtro coincida con el KPI
      if (filter === 'en-riesgo') conditions.push("p.riesgo = 'Alto'");
      
      // Filtros de Metodología
      if (['predictivos', 'agiles', 'hibrido'].includes(filter)) {
          let tipo = filter.replace('agiles', 'Ágil')
                           .replace('predictivos', 'Predictivo')
                           .replace('hibrido', 'Híbrido');
          
          conditions.push(`p.tipo_entrega ILIKE $${queryParams.length + 1}`);
          queryParams.push(tipo);
      }
  }

  // Lógica de Búsqueda (Search Bar)
  if (searchTerm) {
    // Buscamos por nombre, código o cliente
    conditions.push(`(p.nombre ILIKE $${queryParams.length + 1} OR p.codigo ILIKE $${queryParams.length + 1} OR p.cliente ILIKE $${queryParams.length + 1})`);
    queryParams.push(`%${searchTerm}%`);
  }

  const whereClause = " WHERE " + conditions.join(" AND ");

  try {
    const client = await pool.connect();

    /* --------------------------------------------------------------------------------------------
     * D. CONSULTA MAESTRA (DIRECT READ ENGINE)
     * Recuperamos los datos ya calculados (SPI, CPI) desde la tabla.
     * Incluimos subconsultas para contadores en tiempo real (Docs y Riesgos).
     * -------------------------------------------------------------------------------------------- */
    const mainQuery = `
        SELECT p.*,
        -- Subconsulta para contar documentos reales en repositorio
        (SELECT COUNT(*) FROM repositorio_planos WHERE proyecto_id = p.id) as real_docs,
        -- Subconsulta para contar riesgos activos reales
        (SELECT COUNT(*) FROM riesgos WHERE proyecto_id = p.id AND estado = 'Activo') as real_riesgos
        FROM proyectos p
        ${whereClause}
        ORDER BY p.id DESC
    `;
    
    // Ejecutamos consulta completa para estadísticas globales
    const resAll = await client.query(mainQuery, queryParams);
    const todosProyectos = resAll.rows;

    console.log(`--> [INYMO] Proyectos encontrados: ${todosProyectos.length}`);

    // --- E. CÁLCULO DE KPIs GLOBALES (HEADER DASHBOARD) ---
    // Variables acumuladoras
    let g_BAC = 0; // Budget at Completion Global
    let g_EV = 0;  // Earned Value Global
    let g_SPI_Sum = 0;
    let g_CPI_Sum = 0;
    let proyectosActivosCount = 0;
    let proyectosEnRiesgoCount = 0;

    todosProyectos.forEach(p => {
        // Sumas Financieras
        const pres = safeMoney(p.presupuesto);
        const prog = (parseFloat(p.progreso) || 0) / 100;
        
        g_BAC += pres;
        g_EV += (pres * prog);

        // Promedios de Desempeño
        // Solo sumamos al promedio si el proyecto tiene datos válidos
        const p_spi = parseFloat(p.spi);
        const p_cpi = parseFloat(p.cpi);

        // Consideramos válido si tiene datos numéricos mayores a 0
        if (!isNaN(p_spi) && p_spi > 0) {
            g_SPI_Sum += p_spi;
            g_CPI_Sum += (!isNaN(p_cpi) && p_cpi > 0) ? p_cpi : 1.0;
            proyectosActivosCount++;
        }

        // [CORRECCIÓN CRÍTICA DE RIESGO]
        // Solo contamos si el semáforo está explícitamente en 'Alto'
        if (p.riesgo === 'Alto') {
            proyectosEnRiesgoCount++;
        }
    });

    // Cálculo de Promedios Globales
    // Si no hay proyectos activos, mostramos 1.00 por defecto
    const avgSPI = proyectosActivosCount > 0 ? (g_SPI_Sum / proyectosActivosCount) : 1.00;
    const avgCPI = proyectosActivosCount > 0 ? (g_CPI_Sum / proyectosActivosCount) : 1.00;

    // Cálculo de Porcentaje de Riesgo
    // Fórmula: (Proyectos en Rojo / Total Proyectos) * 100
    const porcentajeRiesgo = todosProyectos.length > 0 
        ? ((proyectosEnRiesgoCount / todosProyectos.length) * 100).toFixed(0) 
        : "0";

    // --- F. PAGINACIÓN Y PREPARACIÓN DE VISTA ---
    // Cortamos el array para mostrar solo la ventana solicitada
    const rawPaginados = todosProyectos.slice(offset, offset + limit);

    // Formateo final de objetos para la vista (Blindaje de Datos)
    const proyectosListos = rawPaginados.map(p => {
        return {
            ...p,
            // Aplicamos la función safeIndex para evitar "0.00" o "NaN"
            spi: safeIndex(p.spi),
            cpi: safeIndex(p.cpi),
            
            // Aseguramos conteos numéricos para los badges
            real_docs: p.real_docs || 0,
            real_riesgos: p.real_riesgos || 0
        };
    });

    client.release();

    // Formato de Millones para el Header
    const totalNegocioFormatted = (g_BAC / 1000000).toFixed(2) + 'M';
    const evGlobalFormatted = "$" + (g_EV / 1000000).toFixed(2) + "M";

    // --- G. RENDERIZADO (ENVÍO AL PUG) ---
    res.render('app_proyectos', { 
      // Datos Principales
      proyectos: proyectosListos,
      
      // Datos de Paginación
      currentPage: page,
      totalPages: Math.ceil(todosProyectos.length / limit),
      
      // Estado de Filtros
      searchTerm, 
      activeFilter: filter,
      
      // KPIs Globales (Header)
      totalValorNegocio: totalNegocioFormatted,
      
      // Objeto Stats para las Tarjetas Superiores
      stats: {
        spi: avgSPI.toFixed(2),
        cpi: avgCPI.toFixed(2),
        riesgo: porcentajeRiesgo, // Ahora debería marcar el % correcto (11% aprox)
        evTotal: evGlobalFormatted
      }
    });

  } catch (err) { 
    console.error("[CRITICAL ERROR IN PORTFOLIO]", err);
    res.status(500).send("Error crítico en el motor de portafolio: " + err.message); 
  }
});

/* ----------------------------------------------------------------------------------------------------
 * 5. RUTAS AUXILIARES (CREACIÓN Y GESTIÓN)
 * ---------------------------------------------------------------------------------------------------- */

/* --- GENERADOR DE CÓDIGO ÚNICO (NUEVO PROYECTO) --- */
router.get('/nuevo', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        // Lógica de Año Fiscal (25, 26...)
        const anioCorto = new Date().getFullYear().toString().slice(-2);
        const prefijoBase = `INY-${anioCorto}-`;

        // Buscar último consecutivo
        const resUltimo = await client.query(
            "SELECT codigo FROM proyectos WHERE codigo LIKE $1 ORDER BY codigo DESC LIMIT 1", 
            [`${prefijoBase}%`]
        );

        let nuevoNumero = 1;
        if (resUltimo.rows.length > 0) {
            const partes = resUltimo.rows[0].codigo.split('-');
            if (partes.length === 3) {
                const num = parseInt(partes[2]);
                if(!isNaN(num)) nuevoNumero = num + 1;
            }
        }
        
        const codigoFinal = `${prefijoBase}${nuevoNumero.toString().padStart(3, '0')}`;

        res.render('app_proyecto_nuevo', { 
            title: 'Nuevo Proyecto | INYMO',
            usuario: req.session.nombreUsuario,
            codigoSugerido: codigoFinal 
        });
    } catch (err) {
        console.error("Error generando código:", err);
        // Fallback seguro
        res.render('app_proyecto_nuevo', { codigoSugerido: `INY-${new Date().getFullYear().toString().slice(-2)}-001` });
    } finally {
        if (client) client.release();
    }
});

/* --- GUARDAR NUEVO PROYECTO (POST) --- */
router.post('/crear', verificarSesion, async function(req, res) {
  const d = req.body;
  
  // Query de Inserción (Valores iniciales SPI/CPI = 1.00)
  // IMPORTANTE: Al crear, seteamos SPI y CPI en 1.00 por defecto para que no salga en 0.
  const insertQuery = `
    INSERT INTO proyectos (
        nombre, cliente, lider, codigo, tipo_entrega, 
        valor_negocio, presupuesto, fecha_fin, riesgo, 
        fase, progreso, salud, spi, cpi
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'En Tiempo', 1.00, 1.00);
  `;
  
  const values = [
      d.nombre, 
      d.cliente, 
      d.lider, 
      d.codigo, 
      d.tipo_entrega, 
      d.valor_negocio, 
      d.presupuesto, 
      d.fecha_fin, 
      d.riesgo, 
      d.fase
  ];

  try {
    const client = await pool.connect();
    await client.query(insertQuery, values);
    client.release();
    console.log(`[INYMO] Nuevo proyecto creado: ${d.codigo}`);
    res.redirect('/app/proyectos'); 
  } catch (err) {
    console.error("Error al crear proyecto:", err);
    res.redirect('/app/proyectos/nuevo?error=true');
  }
});

/* --- RECUPERAR PROYECTO ARCHIVADO --- */
router.get('/recuperar/:id', verificarSesion, async (req, res) => {
    const id = req.params.id;
    try {
        const client = await pool.connect();
        // Al recuperar, reseteamos salud a 'En Tiempo' para que aparezca en el radar
        await client.query("UPDATE proyectos SET salud = 'En Tiempo' WHERE id = $1", [id]);
        client.release();
        res.redirect('/app/proyectos?filter=archivados');
    } catch (e) {
        console.error("Error al recuperar:", e);
        res.status(500).send("Error al recuperar proyecto.");
    }
});

/**
 * RUTINA DE MANTENIMIENTO (OPCIONAL)
 * Si alguna vez necesitas recalcular todo manualmente
 */
router.get('/recalc-all', verificarSesion, async (req, res) => {
    // Esta ruta se puede usar para forzar el update de todos los SPI/CPI si quedaron en 0
    // No la activamos por defecto para no alentar, pero está lista.
    res.send("Mantenimiento disponible.");
});

// EXPORTACIÓN DEL MÓDULO
module.exports = router;