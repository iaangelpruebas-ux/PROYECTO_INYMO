/**
 * BLOQUE 6: GENERADOR TÉCNICO PDF
 */
module.exports = {
    convertir: async (html_to_pdf, html) => {
        // Configuramos el formato industrial (A4 con fondos)
        return await html_to_pdf.generatePdf(
            { content: html }, 
            { format: 'A4', printBackground: true }
        );
    }
};