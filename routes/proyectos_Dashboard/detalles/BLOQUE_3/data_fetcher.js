/**
 * MINIPROGRAMA: DATA FETCHER (RECOLECTOR MAESTRO)
 * Se encarga de las consultas SQL que ya teníamos en el código original.
 */
module.exports = {
    /**
     * Obtiene la información base del proyecto y sus riesgos
     */
    obtenerTodo: async (client, id) => {
        try {
            // A. Consulta de Datos Maestros (Lo que ya tenías)
            const queryProyecto = `
                SELECT p.*, 
                (SELECT COUNT(*) FROM repositorio_planos WHERE proyecto_id = p.id) as total_planos
                FROM proyectos p WHERE p.id = $1
            `;
            const resP = await client.query(queryProyecto, [id]);
            const pBD = resP.rows[0];

            if (!pBD) return { pBD: null, riesgos: [] };

            // B. Recuperación de Riesgos (Lo que ya tenías para el sidebar)
            const resRiesgos = await client.query(
                'SELECT * FROM riesgos WHERE proyecto_id = $1', 
                [id]
            );

            return {
                pBD,
                riesgos: resRiesgos.rows || []
            };

        } catch (err) {
            console.error("[DATA FETCHER ERROR]", err);
            throw err;
        }
    },

    /**
     * Sincroniza los índices calculados en la tabla de proyectos
     */
    sincronizarIndices: async (client, id, cpi, spi) => {
        await client.query(
            "UPDATE proyectos SET spi = $1, cpi = $2 WHERE id = $3",
            [spi, cpi, id]
        );
    }
};