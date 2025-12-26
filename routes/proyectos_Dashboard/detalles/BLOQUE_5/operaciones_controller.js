/**
 * BLOQUE 5: CONTROLADOR DE OPERACIONES Y RIESGOS
 */
const fetcher = require('./operaciones_fetcher');
const orquestador = require('./orquestador_operativo');

module.exports = {
    // Maneja el POST de nuevas partidas
    agregarPartida: async (req, res, pool) => {
        const data = { 
            ...req.body, 
            proyectoId: req.params.id, 
            archivoPath: req.file ? `/uploads/cotizaciones/${req.file.filename}` : null 
        };
        try {
            await fetcher.insertarPartida(pool, data);
            res.redirect(`/app/proyectos/${req.params.id}/presupuesto/distribucion`);
        } catch (err) { res.status(500).send("Error en Registro."); }
    },

    // Maneja el archivado lógico
    archivar: async (req, res, pool) => {
        try {
            await fetcher.actualizarEstadoArchivado(pool, req.params.id);
            res.redirect('/app/proyectos');
        } catch (e) { res.status(500).send("Error al archivar."); }
    },

    // Maneja las vistas de Riesgos (Matriz/AMEF)
    renderRiesgos: async (req, res, pool) => {
        const { id, tipo } = req.params;
        try {
            const data = await orquestador.prepararVistaRiesgos(pool, id);
            if (!data.p) return res.status(404).send("No encontrado.");

            const vista = tipo === 'amef' ? 'app_detalle_riesgos_amef' : 'app_detalle_riesgos_matriz';
            res.render('proyecto_carpeta_pugs/detalles/BLOQUE_5/app_detalle_riesgos_amef', { 
                p: data.p, 
                riesgos: data.riesgos, 
                usuario: req.session.nombreUsuario,
                title: `${tipo.toUpperCase()} | ${data.p.codigo}`
            });
        // SUSTITUYE EL CATCH FINAL POR ESTE:
        } catch (e) { 
            console.error("--- ERROR EN RENDER RIESGOS ---");
            console.error(e); // Esto imprimirá el error real en tu consola negra
            res.status(500).send(`Error en el motor de riesgos: ${e.message}`); 
        }
    }
};