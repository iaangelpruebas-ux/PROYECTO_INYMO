var express = require('express');
var router = express.Router();
const { Pool } = require('pg');

// 🔌 CONFIGURACIÓN DE BASE DE DATOS
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* --- MIDDLEWARE DE SEGURIDAD --- */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next();
  else res.redirect('/login');
};

/* =========================================================================
   --- GESTIÓN DE PORTAFOLIO (LISTA GENERAL) ---
   ========================================================================= */

/* B. PORTAFOLIO - LISTA PRINCIPAL */
router.get('/', verificarSesion, async function(req, res, next) {
  const searchTerm = req.query.q;
  const filter = req.query.filter; // 'todos', 'archivados', 'en-tiempo', etc.
  
  // 1. CONSTRUCCIÓN DINÁMICA DE LA CONSULTA
  let query = "SELECT * FROM proyectos";
  let conditions = []; 
  let queryParams = [];

  // 2. LÓGICA DE FILTROS INTELIGENTE
  if (filter === 'archivados') {
      // Si el usuario pide archivados, SOLO mostramos esos
      conditions.push("salud = 'Archivado'");
  } else {
      // Si NO pide archivados, ocultamos los archivados por defecto
      conditions.push("salud <> 'Archivado'");

      // Filtros adicionales (solo aplican a proyectos activos)
      if (filter === 'en-tiempo') conditions.push("salud ILIKE 'En Tiempo'");
      if (filter === 'retrasados') conditions.push("salud ILIKE 'Retrasado'");
      if (filter === 'en-riesgo') conditions.push("riesgo = 'Alto' AND salud <> 'Finalizado'");
      
      if (filter === 'predictivos' || filter === 'agiles' || filter === 'hibrido') {
          let tipo = filter.replace('agiles', 'Ágil').replace('predictivos', 'Predictivo').replace('hibrido', 'Híbrido');
          conditions.push(`tipo_entrega ILIKE '${tipo}'`);
      }
  }

  // 3. BUSCADOR (Aplica sobre lo filtrado)
  if (searchTerm) {
    conditions.push(`(nombre ILIKE $${queryParams.length + 1} OR codigo ILIKE $${queryParams.length + 1})`);
    queryParams.push(`%${searchTerm}%`);
  }

  // Unimos condiciones
  if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
  }
  
  query += ' ORDER BY id ASC';

  try {
    const client = await pool.connect();
    const result = await client.query(query, queryParams);
    const proyectosListados = result.rows; 
    
    // --- LÓGICA DE GOBERNANZA (KPIs) ---
    let acumuladoBAC = 0; let acumuladoEV = 0; let acumuladoAC = 0; let proyectosEnRiesgo = 0;

    proyectosListados.forEach(p => {
        const bac = parseFloat(p.presupuesto) || 0;
        const progreso = (p.progreso || 0) / 100;
        acumuladoBAC += bac;
        acumuladoEV += (bac * progreso);
        acumuladoAC += (bac * (progreso > 0 ? progreso * 1.05 : 0.05)); 
        if (p.riesgo === 'Alto' && p.salud !== 'Finalizado') proyectosEnRiesgo++;
    });

    const spiGlobal = acumuladoBAC > 0 ? (acumuladoEV / (acumuladoBAC * 0.5)) : 0; 
    const cpiGlobal = acumuladoAC > 0 ? (acumuladoEV / acumuladoAC) : 0;

    client.release(); 

    // Formato MXN (Pesos Mexicanos)
    const formatMXN = (val) => val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
    const formattedValorTotal = (acumuladoBAC / 1000000).toFixed(2) + 'M';

    res.render('app_proyectos', { 
      title: 'Gestión de Portafolio | INYMO',
      proyectos: proyectosListados,
      searchTerm: searchTerm,
      activeFilter: filter || 'todos',
      totalValorNegocio: formattedValorTotal,
      stats: {
        spi: spiGlobal > 0 ? spiGlobal.toFixed(2) : "0.00",
        cpi: cpiGlobal > 0 ? cpiGlobal.toFixed(2) : "0.00",
        riesgo: proyectosListados.length > 0 ? ((proyectosEnRiesgo / proyectosListados.length) * 100).toFixed(0) : "0",
        evTotal: formatMXN(acumuladoEV)
      }
    });

  } catch (err) {
    console.error("Error en Portafolio:", err);
    res.render('error', { message: 'Error cargando portafolio', error: err });
  }
});

/* C. CREAR NUEVO (Formulario) */
router.get('/nuevo', verificarSesion, function(req, res, next) {
  res.render('app_proyecto_nuevo', { title: 'Crear Proyecto | INYMO', mensaje: null });
});

/* D. GUARDAR NUEVO (POST) */
router.post('/crear', verificarSesion, async function(req, res, next) {
  const data = req.body;
  
  const insertQuery = `
    INSERT INTO proyectos (nombre, cliente, lider, codigo, tipo_entrega, valor_negocio, presupuesto, fecha_fin, riesgo, fase, progreso, salud)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'En Tiempo') RETURNING id;
  `;
  const values = [data.nombre, data.cliente, data.lider, data.codigo, data.tipo_entrega, data.valor_negocio, data.presupuesto, data.fecha_fin, data.riesgo, data.fase];

  try {
    const client = await pool.connect();
    await client.query(insertQuery, values);
    client.release();
    res.redirect('/app/proyectos'); 
  } catch (err) {
    console.error(err);
    res.render('app_proyecto_nuevo', { 
        title: 'Crear Proyecto | INYMO', 
        mensaje: { tipo: 'error', texto: `Error: Revisa que el código no esté duplicado o falten datos.` }, 
        data: data 
    });
  }
});

/* ¡IMPORTANTE!
   He eliminado la ruta `router.get('/:id')` de este archivo.
   
   La lógica de DETALLES (/:id) debe vivir ÚNICAMENTE en tu archivo 
   `routes/proyectos_detalle.js` (o donde pegaste el código largo anterior).
   
   Si la dejamos aquí, bloqueará la otra y causará el error de "undefined length".
*/

module.exports = router;