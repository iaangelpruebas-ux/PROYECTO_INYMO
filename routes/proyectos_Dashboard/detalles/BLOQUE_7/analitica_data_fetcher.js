/**
 * BLOQUE 7: ANALÍTICA DATA FETCHER (VERSIÓN INTEGRAL)
 * @description: Recupera histórico, presupuesto base y gastos reales para el motor financiero.
 * Desarrollado para: Ing. Ángel Velasco
 */

module.exports = {
    /**
     * Obtiene toda la información financiera necesaria para el Dashboard de un proyecto.
     */
    obtenerAnaliticaCompleta: async (client, proyectoId, filtros = {}) => {
        const { fechaInicio, fechaFin } = filtros;

        try {
            // 1. OBTENER PRESUPUESTO BASE (BAC)
            const resPresupuesto = await client.query(
                `SELECT monto_total_contrato 
                 FROM proyecto_presupuesto_base 
                 WHERE proyecto_id = $1 
                 LIMIT 1`, 
                [proyectoId]
            );

            // 2. OBTENER SUMATORIA DE GASTOS REALES (AC)
            const resGastos = await client.query(
                `SELECT COALESCE(SUM(monto), 0) as costo_real_total 
                 FROM proyecto_gastos_reales 
                 WHERE proyecto_id = $1`, 
                [proyectoId]
            );

            // 3. OBTENER HISTÓRICO PARA GRÁFICAS (PV, EV, AC Tendencia)
            let queryHistorico = `
                SELECT 
                    fecha_corte,
                    pv_acumulado, 
                    ev_acumulado, 
                    ac_acumulado,
                    desviacion
                FROM proyecto_historico_finanzas 
                WHERE proyecto_id = $1
            `;
            
            const params = [proyectoId];
            if (fechaInicio && fechaFin) {
                queryHistorico += ` AND fecha_corte BETWEEN $2 AND $3`;
                params.push(fechaInicio, fechaFin);
            }
            queryHistorico += ` ORDER BY fecha_corte ASC`;

            const resHistorico = await client.query(queryHistorico, params);

            // 4. ESTRUCTURA DE RESPUESTA UNIFICADA
            return {
                presupuestoBase: parseFloat(resPresupuesto.rows[0]?.monto_total_contrato || 0),
                costoRealAcumulado: parseFloat(resGastos.rows[0]?.costo_real_total || 0),
                historicoGraficas: resHistorico.rows || []
            };

        } catch (error) {
            console.error("[BLOQUE 7 FETCHER ERROR]:", error);
            throw error;
        }
    },

    /**
     * Recupera la distribución detallada (Punto 6 de la organización)
     */
    obtenerDistribucionCostosIA: async (client, proyectoId) => {
        const query = `
            SELECT 
                periodo_nombre,
                costo_planeado,
                costo_real,
                desviacion_acumulada
            FROM proyecto_distribucion_ia
            WHERE proyecto_id = $1
            ORDER BY periodo_index ASC
        `;
        try {
            const res = await client.query(query, [proyectoId]);
            return res.rows;
        } catch (error) {
            console.error("[BLOQUE 7 DISTRIBUCION ERROR]:", error);
            return [];
        }
    }
};