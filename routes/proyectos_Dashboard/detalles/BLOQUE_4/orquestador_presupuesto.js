const fetcher = require('./presupuesto_fetcher');
const ensamblador = require('./presupuesto_ensamblador');

module.exports = {
    /**
     * Ejecuta el motor financiero de forma independiente
     */
    ejecutarDistribucion: async (pool, proyectoId) => {
        let client;
        try {
            client = await pool.connect(); // Abre su propia conexión
            const data = await fetcher.obtenerTodoFinanzas(client, proyectoId);
            
            if (!data) return null;

            // Formatea montos a Pesos Mexicanos
            const p = ensamblador.prepararFinanzas(data.pBD);

            return {
                p,
                partidas: data.partidas,
                proveedores: data.proveedores,
                stock: data.stock
            };
        } finally {
            if (client) client.release(); // Cierra su propia conexión
        }
    }
};