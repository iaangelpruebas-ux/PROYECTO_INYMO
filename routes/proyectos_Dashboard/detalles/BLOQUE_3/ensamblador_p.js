const { fmtMoney } = require('../../../generales/helpers_formato_money');

module.exports = {
    prepararObjeto: (pBD, riesgos, evm, tiempos) => {
        return {
            ...pBD,
            metodologia: pBD.tipo_entrega || pBD.metodologia || 'Predictivo',
            lider: pBD.lider || "Ing. Sin Asignar",
            fecha_entrega: tiempos.fecha_entrega_f,
            isArchivado: pBD.salud === 'Archivado',
            riesgos: riesgos || [],
            
            kpi: {
                bac_f: fmtMoney(evm.bac),
                pv_f: fmtMoney(evm.pv),
                ac_f: fmtMoney(evm.ac),
                ev_f: fmtMoney(evm.ev),
                cv_f: fmtMoney(evm.cost_variance),
                cpi_v: evm.cpi.toFixed(2),
                spi_v: evm.spi.toFixed(2),
                dias_desviacion: tiempos.dias_atraso,
                cpi_color: evm.cpi < 0.9 ? 'text-danger' : (evm.cpi > 1.05 ? 'text-success' : 'text-warning'),
                spi_color: evm.spi < 0.9 ? 'text-danger' : (evm.spi > 1.05 ? 'text-success' : 'text-warning'),
                cv_color: evm.cost_variance < 0 ? 'text-danger' : 'text-success',
                diagnostico: evm.cpi >= 1 && evm.spi >= 1 ? "ESTRATEGIA ÓPTIMA" : "REVISIÓN NECESARIA"
            },
            
            graficos: {
                labels: JSON.stringify(["Inicio", "Hoy", "Meta"]),
                pv: JSON.stringify([0, evm.pv/2, evm.pv]),
                ac: JSON.stringify([0, evm.ac, null]),
                ev: JSON.stringify([0, evm.ev, null])
            }
        };
    }
};