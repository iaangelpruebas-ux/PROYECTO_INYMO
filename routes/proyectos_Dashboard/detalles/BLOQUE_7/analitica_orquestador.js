/**
 * BLOQUE 7: ORQUESTADOR ANALÍTICO (CURVA S & PERFORMANCE)
 * @description: Limpia y formatea los datos históricos para Chart.js.
 */
module.exports = {
    procesarTendencias: (historicos) => {
        // Aseguramos que si no hay datos, no truene la gráfica
        if (!historicos || !Array.isArray(historicos)) {
            return { labels: [], pv: [], ev: [], ac: [], desviacion: [], spi: [], cpi: [] };
        }

        return {
            // 1. Formateamos las etiquetas de fecha (ej. "26 dic") para el eje X
            labels: historicos.map(h => 
                new Date(h.fecha_corte).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
            ),

            // 2. Convertimos a Float para evitar el error de NaN en las gráficas
            pv: historicos.map(h => parseFloat(h.pv_acumulado || 0)), // PV Planeado
            ev: historicos.map(h => parseFloat(h.ev_acumulado || 0)), // Valor Ganado
            ac: historicos.map(h => parseFloat(h.ac_acumulado || 0)), // Costo Real
            
            // 3. Punto 7: Desviación Acumulada
            desviacion: historicos.map(h => parseFloat(h.desviacion || 0)),
            
            // 4. Índices de eficiencia
            spi: historicos.map(h => parseFloat(h.spi_historico || 0)),
            cpi: historicos.map(h => parseFloat(h.cpi_historico || 0))
        };
    }
};