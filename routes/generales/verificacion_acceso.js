/**
 * MÓDULO: SEGURIDAD DE ACCESO (BRAZALETE INYMO)
 * Verifica que el usuario tenga una sesión activa antes de permitir el paso.
 */
const verificarSesion = (req, res, next) => {
    if (req.session.usuarioLogueado) {
        // Renovación de la sesión para evitar desconexiones por inactividad
        req.session.touch(); 
        next();
    } else {
        // Si no trae el brazalete, directo al login
        res.redirect('/login');
    }
};

module.exports = { verificarSesion };