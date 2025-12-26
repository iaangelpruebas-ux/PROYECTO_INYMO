/**
 * BLOQUE 5: OPERACIONES FETCHER
 * Centraliza las consultas y escrituras del módulo operativo.
 */

// 1. Definición de funciones como constantes para mayor claridad
const insertarPartida = async (pool, data) => {
    const { proyectoId, concepto, categoria, cantidad, precio, proveedor_id, archivoPath } = data;
    await pool.query(
        `INSERT INTO presupuesto_desglose (proyecto_id, concepto, categoria, cantidad, precio_unitario, proveedor_id, archivo_evidencia_url) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [proyectoId, concepto, categoria, cantidad || 1, precio || 0, proveedor_id, archivoPath]
    );
};

const actualizarEstadoArchivado = async (pool, id) => {
    await pool.query("UPDATE proyectos SET salud = 'Archivado' WHERE id = $1", [id]);
};

const obtenerProyectoYRiesgos = async (client, id) => {
    // Consulta de datos del proyecto
    const resP = await client.query("SELECT * FROM proyectos WHERE id = $1", [id]);
    // Consulta de riesgos asociados
    const resRie = await client.query('SELECT * FROM riesgos WHERE proyecto_id = $1 ORDER BY id DESC', [id]);
    
    return { 
        p: resP.rows[0], 
        riesgos: resRie.rows || [] 
    };
};

// 2. Exportación única y clara para evitar el error "is not a function"
module.exports = {
    insertarPartida,
    actualizarEstadoArchivado,
    obtenerProyectoYRiesgos
};