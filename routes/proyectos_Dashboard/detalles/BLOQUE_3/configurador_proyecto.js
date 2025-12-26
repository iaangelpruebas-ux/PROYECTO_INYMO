/**
 * MINIPROGRAMA: CONFIGURADOR DE PROYECTO
 * Se encarga de extraer la data necesaria para la pantalla de edición.
 */
module.exports = {
    obtenerParaEditar: async (client, id) => {
        try {
            // Consulta simple para traer los datos que se van a editar
            const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
            const p = resP.rows[0];

            if (!p) return null;

            // Retornamos el objeto listo
            return p;
        } catch (err) {
            console.error("[CONFIGURADOR ERROR]", err);
            throw err;
        }
    }
};