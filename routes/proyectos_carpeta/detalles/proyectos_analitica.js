/**
 * ====================================================================================================
 * * I N Y M O   A N A L Y T I C S   E N G I N E
 * ====================================================================================================
 */
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- HELPERS DE MATEMÁTICA FINANCIERA ---
const toMXN = (val) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val || 0);

const procesarAnaliticaEVM = (p, bitacora) => {
    // Aquí movemos la lógica de Curva S que tenías en el código anterior
    // Para no saturar este bloque, asumimos que devuelve un objeto 'graficos'
    // con labels, dataPV, dataEV, dataAC, etc.
    return {
        labels: ["Inicio", "Actual", "Fin"],
        pv: [0, p.valor_negocio / 2, p.valor_negocio],
        ac: [0, p.costo_real, null],
        ev: [0, (p.presupuesto * (p.progreso/100)), null]
    };
};

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    let client;
    try {
        client = await pool.connect();
        
        // 1. DATA MAESTRA
        const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
        const p = resP.rows[0];

        // 2. DATA OPERATIVA (Bitácora, Riesgos, etc)
        const [resBit, resRie] = await Promise.all([
            client.query('SELECT * FROM bitacora WHERE proyecto_id = $1 ORDER BY fecha_registro DESC', [id]),
            client.query('SELECT * FROM riesgos WHERE proyecto_id = $1', [id])
        ]);

        // 3. PROCESAMIENTO
        const analitica = procesarAnaliticaEVM(p, resBit.rows);

        res.render('analitica/master_analitica', {
            p: p,
            bitacora: resBit.rows,
            riesgos: resRie.rows,
            analitica: analitica,
            fmt: { toMXN },
            usuario: req.session.nombreUsuario
        });
    } catch (e) {
        res.status(500).send("Error en el motor de analítica.");
    } finally { if(client) client.release(); }
});

module.exports = router;