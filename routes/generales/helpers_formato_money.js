/**
 * MÓDULO: HELPERS DE FORMATO (INYMO STANDARDS)
 * Funciones de utilidad para estandarizar la visualización de datos.
 */

/**
 * Formatea valores numéricos a Pesos Mexicanos (MXN)
 * @example 12500.5 -> $12,500.50
 */
const fmtMoney = (amount) => {
    return new Intl.NumberFormat('es-MX', { 
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2 
    }).format(amount || 0);
};

// Aquí podrías agregar más adelante: const fmtFecha = (date) => { ... }

module.exports = { fmtMoney };