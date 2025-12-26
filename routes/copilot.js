// routes/copilot.js
var express = require('express');
var router = express.Router();

// Middleware de seguridad interno
function verificarSesion(req, res, next) {
    if (req.session && req.session.usuarioLogueado) {
        return next();
    }
    res.redirect('/');
}

// Definición de la ruta raíz del módulo
router.get('/', verificarSesion, function(req, res) {
    res.render('COPILOT/provisional/app_copilot_hub', { 
        title: 'INYMO Neural Engine | Copilot',
        usuario: req.session.nombreUsuario || 'Socio Director'
    });
});

module.exports = router;