/**
 * MINIPROGRAMA: MOTOR EVM (EARNED VALUE MANAGEMENT)
 * Calcula los índices de desempeño financiero del proyecto.
 */
module.exports = {
    ejecutar: (pBD) => {
        const bac = parseFloat(pBD.presupuesto) || 0;
        const pv = parseFloat(pBD.valor_negocio) || 0;
        const ac = parseFloat(pBD.costo_real) || 0;
        const progreso = (parseFloat(pBD.progreso) || 0) / 100;

        // Valor Ganado (EV) y Variaciones
        let ev = (ac > bac) ? (pv - ac) : (pv - bac); 
        const cpi = ac > 0 ? (ev / ac) : 1.00;
        const spi = pv > 0 ? (ev / pv) : 1.00;
        const cost_variance = ev - ac;
        const schedule_variance = ev - pv;

        return {
            bac, pv, ac, ev,
            cpi, spi,
            cost_variance,
            schedule_variance
        };
    }
};