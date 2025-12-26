const generator = require('./reporte_generator');

module.exports = {
    generarReporte: async (req, res, pool, html_to_pdf) => {
        const { tipo, id } = req.params;
        let client;
        try {
            client = await pool.connect();
            const resP = await client.query('SELECT * FROM proyectos WHERE id = $1', [id]);
            const p = resP.rows[0];

            if (!p) return res.status(404).send("Proyecto no localizado.");

            const templates = {
                'general': 'app_reporte_pdf',
                'financiero': 'app_reporte_financiero_pdf',
                'ejecutivo': 'app_reporte_ejecutivo_pdf'
            };

            const view = templates[tipo] || templates.general;

            // Renderizamos sin layout para que el CSS del PDF sea limpio
            res.render(view, { p, layout: false }, async (err, html) => {
                if (err) return res.status(500).send("Fallo en Renderizado PDF.");
                
                const pdfBuffer = await generator.convertir(html_to_pdf, html);
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename=${tipo}_${p.codigo}.pdf`);
                res.send(pdfBuffer);
            });

        } catch (e) {
            console.error("[PDF ERROR]", e);
            res.status(500).send("Error en Servidor de Documentos.");
        } finally {
            if (client) client.release();
        }
    }
};