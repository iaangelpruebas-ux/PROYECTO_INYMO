const { fmtMoney } = require('../../../generales/helpers_formato_money');

module.exports = {
    prepararFinanzas: (pBD) => {
        const presupuesto = parseFloat(pBD.presupuesto) || 0;
        const costoReal = parseFloat(pBD.costo_real) || 0;

        return {
            ...pBD,
            bac_f: fmtMoney(presupuesto),
            ac_f: fmtMoney(costoReal),
            pv_f: fmtMoney(parseFloat(pBD.valor_negocio) || 0),
            isOverBudget: (costoReal > presupuesto)
        };
    }
};