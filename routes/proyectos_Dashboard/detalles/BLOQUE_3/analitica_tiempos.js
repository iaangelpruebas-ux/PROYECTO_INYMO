/**
 * MINIPROGRAMA: ANALÍTICA DE TIEMPOS
 * Proyecta desviaciones temporales y duraciones.
 */
module.exports = {
    proyectar: (pBD, schedule_variance) => {
        const bac = parseFloat(pBD.presupuesto) || 0;
        const fFin = new Date(pBD.fecha_fin);
        const fIni = new Date(pBD.fecha_inicio);
        
        const duracionTotal = (fFin - fIni) / (1000 * 60 * 60 * 24);
        const dias_atraso = (schedule_variance !== 0 && bac !== 0) 
            ? Math.round((schedule_variance / bac) * duracionTotal) 
            : 0;

        return {
            dias_atraso,
            duracionTotal,
            fecha_entrega_f: pBD.fecha_fin ? new Date(pBD.fecha_fin).toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' }) : "S/F"
        };
    }
};