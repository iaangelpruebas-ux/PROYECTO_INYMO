/**
 * ORQUESTADOR MAESTRO: INYMO PLATINUM CORE (V.11.0)
 * @description: Centraliza la lógica, procesa finanzas reales y prepara gráficas.
 * Desarrollado para: Ing. Ángel Velasco
 */

// 1. IMPORTACIÓN DE MICROCODIGOS
const dataFetcher = require('./data_fetcher');
const motorEVM = require('./motor_evm');
const motorTiempos = require('./analitica_tiempos');
const ensamblador = require('./ensamblador_p');
const analiticaFetcher = require('../BLOQUE_7/analitica_data_fetcher');

module.exports = {
    ejecutarTodo: async (pool, proyectoId) => {
        let client;
        try {
            client = await pool.connect(); 
            
            // A. RECOLECCIÓN BASE
            const { pBD, riesgos } = await dataFetcher.obtenerTodo(client, proyectoId);
            if (!pBD) return null;

            // B. RECOLECCIÓN FINANCIERA REAL (BLOQUE 7)
            const finanzasReales = await analiticaFetcher.obtenerAnaliticaCompleta(client, proyectoId);

            // C. PROCESAMIENTO DE INDICADORES (EVM)
            // Usamos el BAC de la tabla real, si no existe, usamos el presupuesto del proyecto
            const presupuestoReferencia = finanzasReales.presupuestoBase || pBD.presupuesto || 0;
            const costoRealReferencia = finanzasReales.costoRealAcumulado || 0;

            const evm = motorEVM.ejecutar({
                ...pBD,
                presupuesto: presupuestoReferencia,
                costo_real: costoRealReferencia
            });

            const tiempos = motorTiempos.proyectar(pBD, evm.schedule_variance);

            // D. PROCESAMIENTO DE DATOS PARA GRÁFICAS
            const historico = finanzasReales.historicoGraficas;
            const datosGraficos = {
                labels: historico.map(h => new Date(h.fecha_corte).toLocaleDateString('es-MX')),
                pv: historico.map(h => parseFloat(h.pv_acumulado)),
                ev: historico.map(h => parseFloat(h.ev_acumulado)),
                ac: historico.map(h => parseFloat(h.ac_acumulado)),
                spi: historico.map(h => parseFloat(h.spi_historico || 0)),
                cpi: historico.map(h => parseFloat(h.cpi_historico || 0))
            };

            // E. SINCRONIZACIÓN DE ÍNDICES EN BD
            await dataFetcher.sincronizarIndices(client, proyectoId, evm.cpi.toFixed(2), evm.spi.toFixed(2));
            
            // F. ENSAMBLADO FINAL CON FORMATO DE MONEDA MEXICANA [2025-12-12]
            const objetoEnsamblado = ensamblador.prepararObjeto(pBD, riesgos, evm, tiempos);

            return {
                ...objetoEnsamblado,
                // Agregamos valores financieros reales formateados
                bac_real_f: presupuestoReferencia.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
                ac_real_f: costoRealReferencia.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
                ev_real_f: (presupuestoReferencia * (pBD.progreso / 100)).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }),
                graficos: datosGraficos
            };

        } catch (err) {
            console.error("[ORQUESTADOR CRITICAL ERROR]", err);
            throw err;
        } finally {
            if (client) client.release(); 
        }
    },

    obtenerEdicionRapida: async (pool, id) => {
        let client;
        try {
            client = await pool.connect();
            const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
            return resP.rows[0] || null;
        } catch (err) {
            console.error("[ORQUESTADOR EDIT ERROR]", err);
            throw err;
        } finally {
            if (client) client.release(); 
        }
    }
};