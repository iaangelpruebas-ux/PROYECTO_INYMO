const fetcher = require('./operaciones_fetcher');

module.exports = {
    prepararVistaRiesgos: async (pool, id) => {
        let client;
        try {
            client = await pool.connect();
            const data = await fetcher.obtenerProyectoYRiesgos(client, id);
            return data;
        } finally {
            if (client) client.release();
        }
    }
};