/**
 * BLOQUE 4: PRESUPUESTO FETCHER
 * Centraliza las consultas de partidas, proveedores y stock.
 */
module.exports = {
    obtenerTodoFinanzas: async (client, proyectoId) => {
        // 1. Datos Maestros del Proyecto
        const resP = await client.query("SELECT * FROM proyectos WHERE id = $1", [proyectoId]);
        const pBD = resP.rows[0];

        if (!pBD) return null;

        // 2. Partidas del Presupuesto (con Join a Proveedores)
        const resPartidas = await client.query(
            "SELECT pd.*, prov.nombre_empresa as proveedor_nombre FROM presupuesto_desglose pd LEFT JOIN proveedores prov ON pd.proveedor_id = prov.id WHERE pd.proyecto_id = $1 ORDER BY pd.id DESC", 
            [proyectoId]
        );

        // 3. Catálogo de Proveedores Activos
        const resProv = await client.query("SELECT * FROM proveedores WHERE activo = true ORDER BY nombre_empresa ASC");

        // 4. Stock disponible en Inventario
        const resStock = await client.query(`
            SELECT s.id, s.cantidad, s.ubicacion, s.articulo_id 
            FROM inventario_stock s 
            WHERE s.cantidad > 0 ORDER BY s.fecha_entrada DESC`);

        return {
            pBD,
            partidas: resPartidas.rows || [],
            proveedores: resProv.rows || [],
            stock: resStock.rows || []
        };
    }
};