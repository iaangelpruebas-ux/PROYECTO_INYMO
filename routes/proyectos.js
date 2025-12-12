var express = require('express');
var router = express.Router(); // Nuevo router para el módulo de proyectos

// --- LIBRERÍAS NUEVAS PARA ARREGLAR IMÁGENES EN PDF ---
const fs = require('fs');      
const path = require('path');  
// ------------------------------------------------------

// 🔌 CONFIGURACIÓN DE BASE DE DATOS (NEON)
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 📦 Requerimos librerías externas para Reporte PDF
const html_to_pdf = require('html-pdf-node'); 

/* --- MIDDLEWARE DE SEGURIDAD (El Guardia) --- */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) {
    next();
  } else {
    res.redirect('/login');
  }
};


/* =========================================================================
   --- RUTAS DE GESTIÓN DE PROYECTOS (PREFIJO: /app/proyectos) ---
   ========================================================================= */

/* B. GESTIÓN DE PROYECTOS (Portafolio - Lista) */
router.get('/', verificarSesion, async function(req, res, next) {
  const searchTerm = req.query.q;
  const filter = req.query.filter;
  
  let query = "SELECT * FROM proyectos WHERE salud <> 'Archivado'";
  const queryParams = [];

  if (filter && filter !== 'todos') {
    let filterCondition = '';
    
    if (filter === 'en-tiempo' || filter === 'retrasados') {
        filterCondition = ` AND salud ILIKE '${filter === 'en-tiempo' ? 'En Tiempo' : 'Retrasado'}'`;
    } 
    else if (filter === 'en-riesgo') {
        filterCondition = ` AND riesgo = 'Alto' AND salud <> 'Finalizado'`;
    }
    else if (filter === 'predictivos' || filter === 'agiles' || filter === 'hibrido') {
        let tipo = filter.replace('agiles', 'Ágil').replace('predictivos', 'Predictivo').replace('hibrido', 'Híbrido');
        filterCondition = ` AND tipo_entrega ILIKE '${tipo}'`; 
    }
    
    query += filterCondition;
  }
  
  if (searchTerm) {
    query += ` AND (nombre ILIKE $1 OR codigo ILIKE $1)`;
    queryParams.push(`%${searchTerm}%`);
  }
  
  query += ' ORDER BY id ASC';

  try {
    const client = await pool.connect();
    const result = await client.query(query, queryParams);
    const proyectosActivos = result.rows; 
    
    let totalValorNegocio = 0;
    for(const p of proyectosActivos) {
        totalValorNegocio += parseFloat(p.valor_negocio) || 0;
    }
    
    client.release(); 
    
    const formattedValor = (totalValorNegocio / 1000000).toFixed(2) + 'M';

    res.render('app_proyectos', { 
      title: 'Gestión de Proyectos | INYMO',
      proyectos: proyectosActivos,
      searchTerm: searchTerm,
      activeFilter: filter || 'todos',
      totalValorNegocio: formattedValor
    });

  } catch (err) {
    console.error(err);
    res.send("Error al conectar con la base de datos: " + err);
  }
});


/* C. CREAR NUEVO PROYECTO (Formulario GET) */
router.get('/nuevo', verificarSesion, function(req, res, next) {
  res.render('app_proyecto_nuevo', {
    title: 'Crear Proyecto | INYMO',
    mensaje: null
  });
});

/* D. GUARDAR PROYECTO (Acción POST) */
router.post('/crear', verificarSesion, async function(req, res, next) {
  const data = req.body;
  
  const insertQuery = `
    INSERT INTO proyectos (nombre, cliente, lider, codigo, tipo_entrega, valor_negocio, presupuesto, fecha_fin, riesgo, fase, progreso, salud)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'En Tiempo') 
    RETURNING id;
  `;
  
  const values = [
    data.nombre, data.cliente, data.lider, data.codigo, data.tipo_entrega, 
    data.valor_negocio, data.presupuesto, data.fecha_fin, data.riesgo, data.fase
  ];

  try {
    const client = await pool.connect();
    await client.query(insertQuery, values);
    client.release();

    res.redirect('/app/proyectos'); 

  } catch (err) {
    console.error("Error al insertar proyecto:", err);
    res.render('app_proyecto_nuevo', {
      title: 'Crear Proyecto | INYMO',
      mensaje: { tipo: 'error', texto: `Error: El código ${data.codigo} ya existe o faltan datos.` },
      data: data
    });
  }
});


/* F. EDICIÓN DE PROYECTO (Formulario GET) */
router.get('/editar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = req.params.id;
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM proyectos WHERE id = $1', [idProyecto]);
    const proyecto = result.rows[0];
    client.release();

    if (!proyecto) {
      return res.status(404).send("Proyecto no encontrado para editar.");
    }

    if (proyecto.fecha_fin) {
      const dateObj = (proyecto.fecha_fin instanceof Date) ? proyecto.fecha_fin : new Date(proyecto.fecha_fin);
      proyecto.fecha_fin_formato = dateObj.toISOString().substring(0, 10);
    } else {
      proyecto.fecha_fin_formato = '';
    }
    
    res.render('app_proyecto_editar', {
      title: `Editar: ${proyecto.nombre}`,
      p: proyecto,
      mensaje: null
    });

  } catch (err) {
    console.error("Error al cargar formulario de edición:", err);
    res.send("Error de base de datos.");
  }
});


/* G. ACTUALIZAR PROYECTO (Acción POST) */
router.post('/actualizar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = req.params.id;
  const data = req.body;
  
  const progreso = parseInt(data.progreso);
  const riesgo = data.riesgo;
  
  let estadoSalud = 'En Tiempo';
  if (progreso < 50 && riesgo === 'Alto') {
      estadoSalud = 'Retrasado';
  } else if (progreso === 100 && data.fase === 'Cierre') {
      estadoSalud = 'Finalizado';
  }

  let fechaSQL = null;
  try {
      if (data.fecha_fin) {
          const dateObj = new Date(data.fecha_fin);
          if (!isNaN(dateObj)) {
              fechaSQL = dateObj.toISOString().substring(0, 10);
          }
      }
  } catch (e) {
      fechaSQL = null;
  }

  const updateQuery = `
    UPDATE proyectos 
    SET 
      nombre = $1, cliente = $2, lider = $3, progreso = $4, fase = $5,
      presupuesto = $6, valor_negocio = $7, fecha_fin = $8, riesgo = $9,
      salud = $10, narrativa = $11, metas_proximos_pasos = $12, tipo_entrega = $13 
    WHERE id = $14;
  `;
  
  const values = [
    data.nombre, 
    data.cliente, 
    data.lider, 
    progreso, 
    data.fase,
    parseFloat(data.presupuesto), 
    parseFloat(data.valor_negocio), 
    fechaSQL, 
    data.riesgo, 
    estadoSalud,
    data.narrativa,
    data.metas_proximos_pasos,
    data.tipo_entrega,
    parseInt(idProyecto)
  ];

  try {
    const client = await pool.connect();
    await client.query(updateQuery, values);
    client.release();

    res.redirect(`/app/proyectos/${idProyecto}`);

  } catch (err) {
    console.error("❌ ERROR CRÍTICO DE SQL (POST FINAL):", err.message);
    res.render('app_proyecto_editar', {
      title: 'Error de Edición',
      p: data,
      mensaje: { tipo: 'error', texto: `Error al guardar los cambios.` }
    });
  }
});


/* I. ARCHIVAR/ELIMINAR PROYECTO (Acción GET/UPDATE) */
router.get('/eliminar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = parseInt(req.params.id);

  try {
    const client = await pool.connect();
    const updateQuery = `
      UPDATE proyectos 
      SET salud = 'Archivado', fase = 'Archivado', progreso = 100
      WHERE id = $1;
    `;
    await client.query(updateQuery, [idProyecto]);
    client.release();

    res.redirect('/app/proyectos'); 

  } catch (err) {
    console.error("Error al archivar proyecto:", err);
    res.send("Error de base de datos al archivar proyecto: " + err);
  }
});

/* J. LISTA DE PROYECTOS ARCHIVADOS (GET con Buscador) */
router.get('/archivados', verificarSesion, async function(req, res, next) {
  const searchTerm = req.query.q;
  let query = "SELECT * FROM proyectos WHERE salud = 'Archivado'";
  const queryParams = [];

  if (searchTerm) {
    query += ' AND (nombre ILIKE $1 OR codigo ILIKE $1)'; 
    queryParams.push(`%${searchTerm}%`);
  }
  query += ' ORDER BY id DESC';

  try {
    const client = await pool.connect();
    const result = await client.query(query, queryParams);
    const proyectosArchivados = result.rows; 
    client.release();

    res.render('app_proyectos_archivados', { 
      title: 'Proyectos Archivados | INYMO',
      proyectosArchivados: proyectosArchivados,
      searchTerm: searchTerm
    });

  } catch (err) {
    console.error(err);
    res.send("Error al cargar archivados: " + err);
  }
});

/* K. RECUPERAR PROYECTO (Desarchivar - UPDATE) */
router.get('/recuperar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = parseInt(req.params.id);

  try {
    const client = await pool.connect();
    const updateQuery = `
      UPDATE proyectos 
      SET salud = 'En Tiempo', fase = 'Ejecución', progreso = 0, riesgo = 'Bajo'
      WHERE id = $1;
    `;
    await client.query(updateQuery, [idProyecto]);
    client.release();

    res.redirect('/app/proyectos'); 

  } catch (err) {
    console.error("Error al recuperar proyecto:", err);
    res.send("Error de base de datos al recuperar proyecto: " + err);
  }
});


/* M. GENERAR REPORTE PDF (Acción GET/Descarga) - CORREGIDO Y ACTUALIZADO */
router.get('/reporte/:id', verificarSesion, async function(req, res, next) {
    const idProyecto = req.params.id;

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM proyectos WHERE id = $1', [idProyecto]);
        const proyecto = result.rows[0];

        if (!proyecto) {
            client.release();
            return res.status(404).send("Proyecto no encontrado para reporte.");
        }

        // OBTENER LECCIONES APRENDIDAS
        const resultLecciones = await client.query(
            `SELECT titulo, descripcion FROM bitacora 
             WHERE proyecto_id = $1 AND tipo_registro = 'Lección Aprendida' 
             ORDER BY fecha_registro DESC LIMIT 5`, 
            [idProyecto]
        );
        proyecto.leccionesAprendidas = resultLecciones.rows;
        
        client.release();
        
        // --- CÁLCULOS CRÍTICOS EVM ---
        const presupuestoTotal = parseFloat(proyecto.presupuesto) || 1; 
        const progresoActual = proyecto.progreso / 100;
        
        const valorPlaneado_PV = presupuestoTotal * 0.75; 
        const costoReal_AC = presupuestoTotal * 0.7; 
        const valorGanado_EV = presupuestoTotal * progresoActual; 

        // Validaciones para evitar NaN
        const spi = (valorPlaneado_PV > 0) ? (valorGanado_EV / valorPlaneado_PV) : 0;
        const cpi = (costoReal_AC > 0) ? (valorGanado_EV / costoReal_AC) : 0;
        
        const variacionCosto_CV = valorGanado_EV - costoReal_AC;
        const estimacionAlFinal_EAC = (cpi > 0) ? (presupuestoTotal / cpi) : presupuestoTotal;

        // FORMATEO DE MONEDA SEGURO
        proyecto.eac = estimacionAlFinal_EAC.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
        proyecto.cpi = (cpi > 0) ? cpi.toFixed(2) : 'N/A';
        proyecto.spi = (spi > 0) ? spi.toFixed(2) : 'N/A';
        proyecto.cv = variacionCosto_CV.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
        proyecto.ac = costoReal_AC.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

        // HITOS SIMULADOS
        proyecto.hitos = [
            { nombre: 'Inicio y Planificación', fecha: '2025-01-10', estado: 'completado' },
            { nombre: 'Ejecución Fase 1', fecha: '2025-03-15', estado: proyecto.progreso > 30 ? 'completado' : 'en-curso' },
            { nombre: 'Entrega Final', fecha: proyecto.fecha_fin ? new Date(proyecto.fecha_fin).toISOString().split('T')[0] : 'Pendiente', estado: 'pendiente' }
        ];
        
        // RIESGOS SIMULADOS
        proyecto.riesgos = [];
        if(proyecto.riesgo === 'Alto') {
            proyecto.riesgos.push({ descripcion: 'Posible retraso en suministros', impacto: 'Alto' });
        } else {
            proyecto.riesgos.push({ descripcion: 'Riesgos operativos menores', impacto: 'Bajo' });
        }

        // ==============================================================
        //  SOLUCIÓN PARA EL ERROR DE URL INVÁLIDA (CARGA IMAGEN BASE64)
        // ==============================================================
        
        // 1. Construimos la ruta segura al logo
        const imagePath = path.join(__dirname, '../public/images/logo-inymo-white.png');
        
        // 2. Convertimos a Base64
        let logoBase64 = '';
        try {
            if (fs.existsSync(imagePath)) {
                const bitmap = fs.readFileSync(imagePath);
                logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
            } else {
                console.warn("⚠️ Advertencia: No se encontró la imagen del logo en", imagePath);
            }
        } catch (e) {
            console.error("Error al cargar imagen para PDF:", e);
        }

        // 3. Renderizamos pasando la variable 'logo'
        const htmlContent = await new Promise((resolve, reject) => {
            res.render('app_reporte_pdf', { 
                p: proyecto, 
                logo: logoBase64,  // <--- AQUÍ SE PASA LA IMAGEN
                layout: false 
            }, (err, html) => {
                if (err) return reject(err);
                resolve(html);
            });
        });

        const file = { content: htmlContent };
        const options = { 
            format: 'A4', 
            printBackground: true,
            margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" } // Márgenes seguros
        };

        const pdfBuffer = await html_to_pdf.generatePdf(file, options);
        const fileName = `Reporte_${proyecto.codigo}_${new Date().toLocaleDateString('es-ES').replace(/\//g, '-')}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);

    } catch (err) {
        console.error("Error al generar PDF:", err);
        res.status(500).send("Error interno al generar el reporte: " + err.message);
    }
});


/* E. DETALLE DE PROYECTO (Ficha Técnica) */
router.get('/:id', verificarSesion, async function(req, res, next) {
    const idProyecto = req.params.id;

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT * FROM proyectos WHERE id = $1', [idProyecto]);
        const proyecto = result.rows[0];

        if (!proyecto) {
            client.release();
            return res.status(404).send("Proyecto no encontrado");
        }

        // 2. OBTENER REGISTROS DE BITÁCORA
        const resultBitacora = await client.query(
            `SELECT titulo, tipo_registro AS tipo, fecha_registro AS fecha 
             FROM bitacora 
             WHERE proyecto_id = $1 
             ORDER BY fecha_registro DESC`, 
            [idProyecto]
        );
        const registrosBitacora = resultBitacora.rows;

        // OBTENER LECCIONES APRENDIDAS
        const resultLecciones = await client.query(
            `SELECT titulo, descripcion FROM bitacora 
             WHERE proyecto_id = $1 AND tipo_registro = 'Lección Aprendida' 
             ORDER BY fecha_registro DESC LIMIT 5`, 
            [idProyecto]
        );
        proyecto.leccionesAprendidas = resultLecciones.rows;
        
        client.release();

        // --- CÁLCULOS DE VALOR Y DESEMPEÑO (Corrección EVM) ---
        const presupuestoTotal = parseFloat(proyecto.presupuesto) || 1; 
        const progresoActual = proyecto.progreso / 100;
        
        const valorPlaneado_PV = presupuestoTotal * 0.75; 
        const costoReal_AC = presupuestoTotal * 0.7; 
        const valorGanado_EV = presupuestoTotal * progresoActual; 

        // Validaciones para evitar NaN
        const spi = (valorPlaneado_PV > 0) ? (valorGanado_EV / valorPlaneado_PV) : 0;
        const cpi = (costoReal_AC > 0) ? (valorGanado_EV / costoReal_AC) : 0;
        
        const variacionCosto_CV = valorGanado_EV - costoReal_AC;
        const estimacionAlFinal_EAC = (cpi > 0) ? (presupuestoTotal / cpi) : presupuestoTotal;

        // FORMATO DE MONEDA SEGURO ($ USD)
        proyecto.gasto_actual = costoReal_AC; // Variable cruda para lógica interna
        proyecto.progreso_financiero = Math.round((costoReal_AC / presupuestoTotal) * 100);
        
        // Variables formateadas para la vista
        proyecto.ac = costoReal_AC.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
        proyecto.cv = variacionCosto_CV.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
        proyecto.eac = estimacionAlFinal_EAC.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
        proyecto.spi = (spi > 0) ? spi.toFixed(2) : 'N/A';
        proyecto.cpi = (cpi > 0) ? cpi.toFixed(2) : 'N/A';
        
        // 3. CREAR LA MATRIZ DE HISTORIAL DIARIO (Últimos 30 días)
        proyecto.historialDiario = [];
        const hoy = new Date();
        
        for (let i = 0; i < 30; i++) {
            const fecha = new Date(hoy);
            fecha.setDate(hoy.getDate() - i);
            const diaSemana = fecha.getDay(); 

            let color = '#f1f5f9';
            let progresoDia = 0;
            let estado = 'Normal';

            if (diaSemana === 0 || diaSemana === 6) {
                color = '#a855f7';
                estado = 'Fin de Semana';
            } else {
                progresoDia = Math.floor(Math.random() * 10) + (i < 5 ? 5 : 0);
                
                if (progresoDia > 12) {
                    color = `hsl(120, 70%, ${90 - progresoDia * 3}%)`;
                    estado = 'Trabajo Fuerte';
                } else if (progresoDia > 5) {
                    color = '#dcfce7';
                    estado = 'Trabajo Regular';
                } else if (progresoDia === 0 && i < 20) {
                    color = '#ef4444';
                    estado = 'Parado/Problema';
                }
            }
            
            const eventoDelDia = registrosBitacora.find(r => 
                new Date(r.fecha).toDateString() === fecha.toDateString()
            );
            
            proyecto.historialDiario.push({
                fecha: fecha.toISOString().substring(0, 10),
                displayFecha: fecha.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }),
                color: eventoDelDia && eventoDelDia.tipo === 'Incidente' ? '#ef4444' : color, 
                progreso: progresoDia,
                estado: eventoDelDia ? eventoDelDia.titulo : estado
            });
        }

        // 4. Hitos Simulados 
        proyecto.hitos = [
            { nombre: 'Inicio y Planificación', fecha: '2025-01-10', estado: 'completado' },
            { nombre: 'Ejecución Fase 1', fecha: '2025-03-15', estado: proyecto.progreso > 30 ? 'completado' : 'en-curso' },
            { nombre: 'Entrega Final', fecha: proyecto.fecha_fin ? new Date(proyecto.fecha_fin).toISOString().split('T')[0] : 'Pendiente', estado: 'pendiente' }
        ];

        // Simulamos riesgos
        proyecto.riesgos = [];
        if(proyecto.riesgo === 'Alto') {
            proyecto.riesgos.push({ descripcion: 'Posible retraso en suministros', impacto: 'Alto' });
        } else {
            proyecto.riesgos.push({ descripcion: 'Riesgos operativos menores', impacto: 'Bajo' });
        }
        
        res.render('app_proyecto_detalle', { 
            title: `Detalle: ${proyecto.nombre} | INYMO`,
            p: proyecto
        });

    } catch (err) {
        console.error(err);
        res.send("Error de base de datos: " + err);
    }
});

module.exports = router;