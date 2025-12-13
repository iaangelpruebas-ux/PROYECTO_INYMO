var express = require('express');
var router = express.Router();
const fs = require('fs');      
const path = require('path');  
const html_to_pdf = require('html-pdf-node'); 
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next(); else res.redirect('/login');
};

/* =========================================================================
   --- RUTAS DE DETALLE (Ficha Técnica, Edición, Reportes) ---
   ========================================================================= */

/* E. DETALLE DE PROYECTO (Ficha Técnica) - CÁLCULO TOTAL INTEGRADO */
router.get('/:id', verificarSesion, async function(req, res, next) {
    const idProyecto = req.params.id;
    if (isNaN(idProyecto)) return next(); 

    try {
        const client = await pool.connect();
        
        // 1. CARGA DE DATOS PRINCIPALES
        const result = await client.query('SELECT * FROM proyectos WHERE id = $1', [idProyecto]);
        const proyecto = result.rows[0];

        if (!proyecto) { 
            client.release(); 
            return res.status(404).send("Proyecto no encontrado"); 
        }

        // 2. CONSULTAS RELACIONADAS
        const resEnt = await client.query('SELECT * FROM entregables WHERE proyecto_id = $1 ORDER BY fecha_entrega ASC', [idProyecto]);
        const resCam = await client.query('SELECT * FROM control_cambios WHERE proyecto_id = $1 ORDER BY fecha_registro DESC', [idProyecto]);
        const resHit = await client.query('SELECT * FROM hitos WHERE proyecto_id = $1 ORDER BY fecha ASC', [idProyecto]);
        const resRie = await client.query('SELECT * FROM riesgos WHERE proyecto_id = $1 ORDER BY id DESC', [idProyecto]);
        const resBit = await client.query(`SELECT titulo, tipo_registro AS tipo, fecha_registro AS fecha FROM bitacora WHERE proyecto_id = $1 ORDER BY fecha_registro DESC`, [idProyecto]);
        const resLecc = await client.query(`SELECT titulo, descripcion FROM bitacora WHERE proyecto_id = $1 AND tipo_registro = 'Lección Aprendida' ORDER BY fecha_registro DESC LIMIT 5`, [idProyecto]);
        
        // --- NUEVO: CONTAR ARCHIVOS EN REPOSITORIO ---
        const resRepo = await client.query('SELECT COUNT(*) as total FROM repositorio_planos WHERE proyecto_id = $1', [idProyecto]);
        const totalPlanos = parseInt(resRepo.rows[0].total) || 0;

        client.release();

        // 3. ASIGNACIONES SEGURAS
        proyecto.entregables = resEnt.rows || [];
        proyecto.controlCambios = resCam.rows || [];
        proyecto.hitos = resHit.rows || [];
        proyecto.riesgos = resRie.rows || [];
        proyecto.leccionesAprendidas = resLecc.rows || [];
        proyecto.totalPlanos = totalPlanos; 
        const registrosBitacora = resBit.rows || [];

        // 4. CÁLCULO DE PROGRESO REAL
        let progresoCalculado = 0;
        if (proyecto.entregables.length > 0) {
            const sumaAvance = proyecto.entregables.reduce((acc, curr) => acc + (curr.progreso || 0), 0);
            progresoCalculado = Math.round(sumaAvance / proyecto.entregables.length);
        } else {
            progresoCalculado = proyecto.progreso || 0; 
        }
        proyecto.progreso = progresoCalculado; 

        // 5. CÁLCULOS EVM AVANZADOS
        let presupuestoExtra = 0;
        let diasExtra = 0; 

        proyecto.controlCambios.forEach(c => { 
            if (c.estatus === 'Aprobado') {
                presupuestoExtra += parseFloat(c.impacto_costo) || 0;
                diasExtra += parseInt(c.impacto_tiempo) || 0;
            }
        });
        
        const bac = (parseFloat(proyecto.presupuesto) || 0) + presupuestoExtra;
        
        const fechaInicio = new Date(proyecto.fecha_registro || new Date());
        let fechaFinOriginal = proyecto.fecha_fin ? new Date(proyecto.fecha_fin) : new Date();
        if (!proyecto.fecha_fin) fechaFinOriginal.setDate(fechaInicio.getDate() + 30);

        const fechaFinAjustada = new Date(fechaFinOriginal);
        fechaFinAjustada.setDate(fechaFinAjustada.getDate() + diasExtra);

        const hoy = new Date();
        const tiempoTotal = fechaFinAjustada - fechaInicio;
        const tiempoTranscurrido = hoy - fechaInicio;
        
        let pctTiempo = 0;
        if (tiempoTotal > 0) {
            pctTiempo = tiempoTranscurrido / tiempoTotal;
            pctTiempo = Math.min(Math.max(pctTiempo, 0), 1); 
        }

        const avancePct = progresoCalculado / 100;
        const ev = bac * avancePct;        
        const pv = bac * pctTiempo;        
        const ac = parseFloat(proyecto.costo_acumulado) || (ev * 0.95); 

        const sv = ev - pv;                    
        const cv = ev - ac;                    
        const spi = (pv > 0) ? (ev / pv) : 1;  
        const cpi = (ac > 0) ? (ev / ac) : 1;  
        const eac = (cpi > 0) ? (bac / cpi) : bac; 

        const formatMXN = (val) => {
            if (val === undefined || val === null || isNaN(val)) return "$0.00";
            return val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });
        };

        proyecto.bac_f = formatMXN(bac);
        proyecto.pv_f = formatMXN(pv);
        proyecto.ev_f = formatMXN(ev);
        proyecto.ac_f = formatMXN(ac);
        proyecto.cv_f = formatMXN(cv); 
        proyecto.eac_f = formatMXN(eac);
        
        proyecto.fecha_fin_ajustada_f = fechaFinAjustada.toLocaleDateString('es-MX', {day: 'numeric', month: 'short', year: 'numeric'});
        proyecto.spi_v = isNaN(spi) ? "1.00" : spi.toFixed(2);
        proyecto.cpi_v = isNaN(cpi) ? "1.00" : cpi.toFixed(2);

        // ============================================================
        // 7. HISTORIAL DIARIO (ESTA ERA LA PARTE QUE FALTABA)
        // ============================================================
        proyecto.historialDiario = [];
        const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        
        for (let i = 0; i < 30; i++) {
            const fechaLoop = new Date();
            fechaLoop.setDate(fechaLoop.getDate() - i);
            const diaSemana = fechaLoop.getDay(); 
            const fechaString = `${fechaLoop.getDate()} ${meses[fechaLoop.getMonth()]}`;
            
            // Buscamos si hubo actividad ese día en la bitácora
            const evento = registrosBitacora.find(r => new Date(r.fecha).toDateString() === fechaLoop.toDateString());
            
            let claseColor = 'vacio';
            if (evento) {
                claseColor = (evento.tipo === 'Incidente') ? 'parado' : (evento.tipo === 'Avance' ? 'avance' : 'normal');
            } else if (diaSemana === 0 || diaSemana === 6) {
                claseColor = 'fin-semana';
            }
            
            proyecto.historialDiario.push({
                displayFecha: fechaString,
                clase: claseColor,
                obs: evento ? evento.titulo : 'Sin actividad'
            });
        }
        // ============================================================

        // RENDERIZADO FINAL
        res.render('app_proyecto_detalle', { 
            title: `Detalle: ${proyecto.nombre} | INYMO`, 
            p: proyecto 
        });

    } catch (err) {
        console.error("Error detalle:", err);
        res.status(500).send("Error interno: " + err.message);
    }
});

/* F. EDITAR PROYECTO (GET) */
router.get('/editar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = req.params.id;
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM proyectos WHERE id = $1', [idProyecto]);
    const proyecto = result.rows[0];
    client.release();

    if (proyecto.fecha_fin) {
      const dateObj = (proyecto.fecha_fin instanceof Date) ? proyecto.fecha_fin : new Date(proyecto.fecha_fin);
      proyecto.fecha_fin_formato = dateObj.toISOString().substring(0, 10);
    } else { proyecto.fecha_fin_formato = ''; }
    
    res.render('app_proyecto_editar', { title: `Editar: ${proyecto.nombre}`, p: proyecto, mensaje: null });
  } catch (err) { res.send("Error DB"); }
});

/* G. ACTUALIZAR PROYECTO (POST) */
router.post('/actualizar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = req.params.id;
  const data = req.body;
  const progreso = parseInt(data.progreso);
  const riesgo = data.riesgo;
  
  let estadoSalud = 'En Tiempo';
  if (progreso < 50 && riesgo === 'Alto') estadoSalud = 'Retrasado';
  else if (progreso === 100 && data.fase === 'Cierre') estadoSalud = 'Finalizado';

  let fechaSQL = null;
  if (data.fecha_fin) {
      const dateObj = new Date(data.fecha_fin);
      if (!isNaN(dateObj)) fechaSQL = dateObj.toISOString().substring(0, 10);
  }

  const updateQuery = `
    UPDATE proyectos SET nombre = $1, cliente = $2, lider = $3, progreso = $4, fase = $5,
      presupuesto = $6, valor_negocio = $7, fecha_fin = $8, riesgo = $9,
      salud = $10, narrativa = $11, metas_proximos_pasos = $12, tipo_entrega = $13 
    WHERE id = $14;`;
  
  const values = [data.nombre, data.cliente, data.lider, progreso, data.fase, parseFloat(data.presupuesto), parseFloat(data.valor_negocio), fechaSQL, data.riesgo, estadoSalud, data.narrativa, data.metas_proximos_pasos, data.tipo_entrega, parseInt(idProyecto)];

  try {
    const client = await pool.connect();
    await client.query(updateQuery, values);
    client.release();
    res.redirect(`/app/proyectos/${idProyecto}`);
  } catch (err) {
    res.render('app_proyecto_editar', { title: 'Error de Edición', p: data, mensaje: { tipo: 'error', texto: `Error al guardar.` } });
  }
});

/* I. ELIMINAR/ARCHIVAR */
router.get('/eliminar/:id', verificarSesion, async function(req, res, next) {
  const idProyecto = parseInt(req.params.id);
  try {
    const client = await pool.connect();
    await client.query("UPDATE proyectos SET salud = 'Archivado', fase = 'Archivado', progreso = 100 WHERE id = $1;", [idProyecto]);
    client.release();
    res.redirect('/app/proyectos'); 
  } catch (err) { res.send("Error DB: " + err); }
});

/* K. RECUPERAR */
router.get('/recuperar/:id', verificarSesion, async function(req, res, next) {
  try {
    const client = await pool.connect();
    await client.query("UPDATE proyectos SET salud = 'En Tiempo', fase = 'Ejecución', progreso = 0, riesgo = 'Bajo' WHERE id = $1;", [req.params.id]);
    client.release();
    res.redirect('/app/proyectos'); 
  } catch (err) { res.send("Error DB: " + err); }
});


/* M. REPORTE PDF (Con Base64) - VERSIÓN FINAL COMPLETA */
router.get('/reporte/:id', verificarSesion, async function(req, res, next) {
    const idProyecto = req.params.id;
    try {
        const client = await pool.connect();
        
        // 1. DATOS GENERALES
        const result = await client.query('SELECT * FROM proyectos WHERE id = $1', [idProyecto]);
        const proyecto = result.rows[0];
        if (!proyecto) { client.release(); return res.status(404).send("No encontrado"); }

        // 2. CONSULTAS DE DETALLE
        const resEnt = await client.query('SELECT * FROM entregables WHERE proyecto_id = $1 ORDER BY fecha_entrega ASC', [idProyecto]);
        const resCam = await client.query('SELECT * FROM control_cambios WHERE proyecto_id = $1 ORDER BY fecha_registro DESC', [idProyecto]);
        const resHit = await client.query('SELECT * FROM hitos WHERE proyecto_id = $1 ORDER BY fecha ASC', [idProyecto]);
        const resRie = await client.query('SELECT * FROM riesgos WHERE proyecto_id = $1 ORDER BY id DESC', [idProyecto]);
        // Traemos bitácora general y lecciones aprendidas por separado
        const resBit = await client.query('SELECT * FROM bitacora WHERE proyecto_id = $1 ORDER BY fecha_registro DESC LIMIT 10', [idProyecto]);
        const resLecc = await client.query(`SELECT titulo, descripcion FROM bitacora WHERE proyecto_id = $1 AND tipo_registro = 'Lección Aprendida' ORDER BY fecha_registro DESC LIMIT 5`, [idProyecto]);
        
        proyecto.entregables = resEnt.rows || [];
        proyecto.controlCambios = resCam.rows || [];
        proyecto.hitos = resHit.rows || [];
        proyecto.riesgos = resRie.rows || [];
        proyecto.bitacora = resBit.rows || [];
        proyecto.leccionesAprendidas = resLecc.rows || [];

        // 3. IMAGEN BASE64
        const imagePath = path.join(__dirname, '../public/images/logo-inymo-white.png');
        let logoBase64 = '';
        try {
            if (fs.existsSync(imagePath)) {
                const bitmap = fs.readFileSync(imagePath);
                logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
            }
        } catch (e) { console.error("Error logo:", e); }

        // 4. CÁLCULOS EVM Y FECHAS (Igual que en la Web)
        let presupuestoExtra = 0;
        let diasExtra = 0;
        proyecto.controlCambios.forEach(c => { 
            if (c.estatus === 'Aprobado') {
                presupuestoExtra += parseFloat(c.impacto_costo) || 0;
                diasExtra += parseInt(c.impacto_tiempo) || 0;
            }
        });

        // A. Costos
        const bac = (parseFloat(proyecto.presupuesto) || 0) + presupuestoExtra;
        
        // B. Progreso
        let progresoCalculado = 0;
        if (proyecto.entregables.length > 0) {
            const sumaAvance = proyecto.entregables.reduce((acc, curr) => acc + (curr.progreso || 0), 0);
            progresoCalculado = Math.round(sumaAvance / proyecto.entregables.length);
        } else {
            progresoCalculado = proyecto.progreso || 0;
        }
        proyecto.progreso = progresoCalculado; // Aseguramos que el PDF tenga el dato real

        // C. Fechas Ajustadas
        const fechaInicio = new Date(proyecto.fecha_registro || new Date());
        let fechaFinOriginal = proyecto.fecha_fin ? new Date(proyecto.fecha_fin) : new Date();
        if (!proyecto.fecha_fin) fechaFinOriginal.setDate(fechaInicio.getDate() + 30);

        const fechaFinAjustada = new Date(fechaFinOriginal);
        fechaFinAjustada.setDate(fechaFinAjustada.getDate() + diasExtra);
        
        // Pasamos la fecha formateada al PDF
        proyecto.fecha_fin_ajustada_f = fechaFinAjustada.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

        // D. Variables EVM
        const avancePct = progresoCalculado / 100;
        const ev = bac * avancePct;
        const ac = parseFloat(proyecto.costo_acumulado) || (ev * 0.95);
        const pv = bac * (avancePct * 1.05); // Estimado simple
        
        const formatMXN = (val) => val.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
        proyecto.bac_f = formatMXN(bac);
        proyecto.ev_f = formatMXN(ev);
        proyecto.ac_f = formatMXN(ac);
        proyecto.spi_v = (pv > 0 ? ev/pv : 1).toFixed(2);
        proyecto.cpi_v = (ac > 0 ? ev/ac : 1).toFixed(2);
        proyecto.eac_f = formatMXN((ac > 0 && ev > 0) ? (bac / (ev/ac)) : bac);
        
        // 5. RENDERIZAR
        const htmlContent = await new Promise((resolve, reject) => {
            res.render('app_reporte_pdf', { p: proyecto, logo: logoBase64, layout: false }, (err, html) => {
                if (err) return reject(err);
                resolve(html);
            });
        });

        const file = { content: htmlContent };
        const options = { format: 'A4', printBackground: true, margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" } };

        const pdfBuffer = await html_to_pdf.generatePdf(file, options);
        const fileName = `Reporte_${proyecto.codigo}_${new Date().toISOString().split('T')[0]}.pdf`;
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(pdfBuffer);
        
        client.release();

    } catch (err) { console.error(err); res.status(500).send("Error PDF: " + err.message); }
});



/* =========================================================================
   --- RUTAS DE ACCIÓN (Guardar Datos) ---
   ========================================================================= */

// 1. NUEVO ENTREGABLE
router.post('/:id/entregable', verificarSesion, async (req, res) => {
    const { nombre, responsable, fecha_entrega, progreso } = req.body;
    try {
        const client = await pool.connect();
        await client.query(
            `INSERT INTO entregables (proyecto_id, nombre, responsable, fecha_entrega, progreso, estado) 
             VALUES ($1, $2, $3, $4, $5, 'Pendiente')`,
            [req.params.id, nombre, responsable, fecha_entrega, parseInt(progreso) || 0]
        );
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { res.send("Error al guardar entregable: " + err.message); }
});

// 2. NUEVO RIESGO
router.post('/:id/riesgo', verificarSesion, async (req, res) => {
    const { descripcion, impacto } = req.body;
    try {
        const client = await pool.connect();
        await client.query(
            `INSERT INTO riesgos (proyecto_id, descripcion, impacto, estado) VALUES ($1, $2, $3, 'Activo')`,
            [req.params.id, descripcion, impacto]
        );
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { res.send("Error al guardar riesgo"); }
});

// 3. NUEVO HITO
router.post('/:id/hito', verificarSesion, async (req, res) => {
    const { nombre, fecha } = req.body;
    try {
        const client = await pool.connect();
        await client.query(
            `INSERT INTO hitos (proyecto_id, nombre, fecha, estado) VALUES ($1, $2, $3, 'Pendiente')`,
            [req.params.id, nombre, fecha]
        );
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { res.send("Error al guardar hito"); }
});

// 4. REGISTRAR BITÁCORA
router.post('/:id/bitacora', verificarSesion, async (req, res) => {
    const { titulo, descripcion, tipo_registro } = req.body;
    try {
        const client = await pool.connect();
        await client.query(
            `INSERT INTO bitacora (proyecto_id, titulo, descripcion, tipo_registro, fecha_registro) 
             VALUES ($1, $2, $3, $4, NOW())`,
            [req.params.id, titulo, descripcion, tipo_registro]
        );
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { res.send("Error al registrar bitácora"); }
});

// 5. NUEVO CONTROL DE CAMBIO
router.post('/:id/cambio', verificarSesion, async (req, res) => {
    const { titulo, descripcion, impacto_costo, impacto_tiempo } = req.body;
    try {
        const client = await pool.connect();
        await client.query(
            `INSERT INTO control_cambios (proyecto_id, titulo, descripcion, impacto_costo, impacto_tiempo, estatus, fecha_registro) 
             VALUES ($1, $2, $3, $4, $5, 'Pendiente', NOW())`,
            [req.params.id, titulo, descripcion, parseFloat(impacto_costo) || 0, parseInt(impacto_tiempo) || 0]
        );
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { 
        console.error(err);
        res.send("Error al registrar cambio: " + err.message); 
    }
});

// 6. APROBAR CAMBIO
router.post('/:id/cambio/:idCambio/aprobar', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query("UPDATE control_cambios SET estatus = 'Aprobado' WHERE id = $1", [req.params.idCambio]);
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { res.send("Error al aprobar cambio: " + err.message); }
});

// 7. RECHAZAR CAMBIO
router.post('/:id/cambio/:idCambio/rechazar', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query("UPDATE control_cambios SET estatus = 'Rechazado' WHERE id = $1", [req.params.idCambio]);
        client.release();
        res.redirect(`/app/proyectos/${req.params.id}`);
    } catch (err) { res.send("Error al rechazar cambio: " + err.message); }
});

// 8. ACTUALIZAR PROGRESO DE ENTREGABLE Y SINCRONIZAR PROYECTO
router.post('/:id/entregable/:idEntregable/actualizar', verificarSesion, async (req, res) => {
    const { nuevo_progreso } = req.body;
    const idProyecto = req.params.id;

    try {
        const client = await pool.connect();
        
        // A. Actualizar el entregable individual
        let estado = 'En Curso';
        const prog = parseInt(nuevo_progreso);
        if (prog === 100) estado = 'Completado';
        else if (prog === 0) estado = 'Pendiente';

        await client.query(
            "UPDATE entregables SET progreso = $1, estado = $2 WHERE id = $3", 
            [prog, estado, req.params.idEntregable]
        );

        // B. MAGIA DE SINCRONIZACIÓN: Recalcular el promedio total del proyecto
        const resultPromedio = await client.query(
            "SELECT AVG(progreso) as promedio FROM entregables WHERE proyecto_id = $1",
            [idProyecto]
        );
        
        const nuevoAvanceTotal = Math.round(resultPromedio.rows[0].promedio || 0);

        // C. Guardar el nuevo total en la tabla principal de proyectos
        await client.query(
            "UPDATE proyectos SET progreso = $1 WHERE id = $2",
            [nuevoAvanceTotal, idProyecto]
        );

        client.release();
        res.redirect(`/app/proyectos/${idProyecto}`);

    } catch (err) { 
        console.error(err);
        res.send("Error al sincronizar progreso: " + err.message); 
    }
});

module.exports = router;