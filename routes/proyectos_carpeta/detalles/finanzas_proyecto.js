/**
 * MÓDULO: LÓGICA FINANCIERA (MODULAR)
 * Este archivo NO es un router, es una librería de cálculo para el proyecto.
 * Se encarga de procesar BAC, PV, AC y EV según tus reglas de negocio.
 */

const formatMoney = (amount) => {
    if (isNaN(amount) || amount === null) amount = 0;
    return new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    }).format(amount);
};

module.exports = {
    procesarFinanzas: (dataBD) => {
        // 1. Obtención de valores crudos
        const bac = parseFloat(dataBD.presupuesto) || 0;     // Presupuesto (BAC)
        const pv = parseFloat(dataBD.valor_negocio) || 0;    // Valor Negocio (PV)
        const ac = parseFloat(dataBD.costo_real) || 0;       // Costo Real (AC)

        // 2. Tu Lógica de Negocio Solicitada
        // "Si costo real supera el presupuesto, el valor ganado es (Valor Negocio - Costo Real).
        //  Si no, es (Valor Negocio - Presupuesto)."
        let ev; // Valor Ganado
        if (ac > bac) {
            ev = pv - ac;
        } else {
            ev = pv - bac;
        }

        // 3. Retornamos el objeto listo para el PUG
        return {
            bac_f: formatMoney(bac),
            pv_f: formatMoney(pv),
            ac_f: formatMoney(ac),
            ev_f: formatMoney(ev),
            isOverBudget: ac > bac // Bandera para poner rojo el texto en el PUG
        };
    }
};