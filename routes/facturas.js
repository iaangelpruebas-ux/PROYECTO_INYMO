/**
 * =========================================================================
 * INYMO - SISTEMA DE INTELIGENCIA COMERCIAL (MÓDULO DE FACTURACIÓN)
 * =========================================================================
 * Archivo: routes/facturas.js
 * Versión: 1.0.0 - Edición "Control de Flujo de Efectivo"
 * * DESCRIPCIÓN: 
 * Controlador financiero encargado de la emisión, seguimiento y cobranza
 * de facturas fiscales. Incluye lógica de cálculo de IVA, retenciones y
 * alertas de cartera vencida.
 * * * REGLAS DE NEGOCIO:
 * 1. Moneda Base: MXN (Pesos Mexicanos).
 * 2. IVA: Cálculo automático al 16% sobre base gravable.
 * 3. Alertas: Facturas con (fecha_actual > fecha_vencimiento) pasan a 'Vencida'.
 * 4. Integridad: No se pueden eliminar facturas con pagos asociados.
 * =========================================================================
 */

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * 🔌 CONFIGURACIÓN DE CONEXIÓN (POOL)
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * 🛡️ MIDDLEWARES DE SEGURIDAD
 */
const verificarSesion = (req, res, next) => {
  if (req.session.usuarioLogueado) next();
  else res.redirect('/login');
};

/**
 * 🛠️ UTILIDADES FINANCIERAS
 */
const toMXN = (val) => {
    const num = parseFloat(val) || 0;
    return new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    }).format(num);
};

/* ==========================================================================
   01. DASHBOARD DE FACTURACIÓN (PANEL DE CONTROL)
   ========================================================================== */

/**
 * GET: Vista Principal de Facturas
 * Muestra KPIs financieros, gráfico de flujo y listado reciente.
 */
router.get('/', verificarSesion, async function(req, res) {
  let client;
  try {
    client = await pool.connect();

    // 1. Actualización automática de Estatus (Vencidas)
    // Si hoy es mayor al vencimiento y no está pagada, marca como Vencida.
    await client.query(`
        UPDATE comercial_facturas 
        SET estatus = 'Vencida' 
        WHERE fecha_vencimiento < CURRENT_DATE 
        AND estatus IN ('Emitida', 'Parcial')
    `);

    // 2. KPIs Financieros Maestros (Cobranza y Venta)
    const resKPIs = await client.query(`
        SELECT 
            COUNT(*) as total_facturas,
            COALESCE(SUM(total), 0) as venta_bruta_total,
            COALESCE(SUM(CASE WHEN estatus = 'Pagada' THEN total ELSE 0 END), 0) as cobrado_total,
            COALESCE(SUM(saldo_pendiente), 0) as cartera_vencida_total
        FROM comercial_facturas
    `);

    // 3. Desglose por Estatus (Para gráficas)
    const resEstatus = await client.query(`
        SELECT estatus, COUNT(*) as cantidad, SUM(total) as monto
        FROM comercial_facturas
        GROUP BY estatus
    `);

    // 4. Listado de Facturas (Con datos de cliente)
    // Limitado a las últimas 50 para rendimiento del dashboard
    const resFacturas = await client.query(`
        SELECT f.*, c.razon_social, c.rfc
        FROM comercial_facturas f
        LEFT JOIN comercial_clientes c ON f.cliente_id = c.id
        ORDER BY 
            CASE WHEN f.estatus = 'Vencida' THEN 1 
                 WHEN f.estatus = 'Emitida' THEN 2 
                 ELSE 3 END ASC,
            f.fecha_vencimiento ASC
        LIMIT 50
    `);

    // 5. Top Clientes (Pareto 80/20)
    const resTopClientes = await client.query(`
        SELECT c.razon_social, SUM(f.total) as total_comprado
        FROM comercial_facturas f
        JOIN comercial_clientes c ON f.cliente_id = c.id
        GROUP BY c.razon_social
        ORDER BY total_comprado DESC
        LIMIT 5
    `);

    const kpis = resKPIs.rows[0];

    // Renderizado Blindado
    res.render('app_comercial_facturas', { 
        title: 'Inteligencia Comercial | Facturación',
        
        // Datos Financieros (Shield Logic applied)
        stats: {
            venta_total: toMXN(kpis.venta_bruta_total),
            cobrado: toMXN(kpis.cobrado_total),
            por_cobrar: toMXN(kpis.cartera_vencida_total), // Dinero en la calle
            efectividad_cobro: kpis.venta_bruta_total > 0 
                ? Math.round((kpis.cobrado_total / kpis.venta_bruta_total) * 100) 
                : 0
        },

        // Tablas y Listas
        facturas: resFacturas.rows || [],
        top_clientes: resTopClientes.rows || [],
        
        // Helpers
        formatMoney: toMXN,
        user: req.session.nombreUsuario
    });

  } catch (err) {
    console.error("[ERROR CRÍTICO FACTURACIÓN]:", err);
    res.status(500).render('error', { 
        message: "Error de conexión con el módulo financiero. Intente más tarde." 
    });
  } finally {
    if (client) client.release();
  }
});

/* ==========================================================================
   02. GESTIÓN DE EMISIÓN (CRUD)
   ========================================================================== */

/**
 * GET: Formulario de Nueva Factura
 * Carga clientes activos para el dropdown.
 */
router.get('/nueva', verificarSesion, async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const clientes = await client.query("SELECT id, razon_social FROM comercial_clientes WHERE estatus = 'Activo' ORDER BY razon_social ASC");
        
        res.render('app_comercial_factura_nueva', { 
            title: 'Emitir Factura | INYMO',
            clientes: clientes.rows
        });
    } catch (e) {
        res.status(500).send("Error cargando formulario de facturación.");
    } finally {
        if(client) client.release();
    }
});

/**
 * POST: Registrar Factura en Base de Datos
 * Recibe JSON de items, calcula totales y guarda.
 */
router.post('/create', verificarSesion, async (req, res) => {
    const { cliente_id, folio, fecha, dias_credito, items_json } = req.body;
    let client;
    
    try {
        client = await pool.connect();
        
        // 1. Parsing de items (vienen como string JSON desde el frontend)
        const items = JSON.parse(items_json || '[]');
        
        // 2. Cálculo de Totales (Backend Validation)
        let subtotal = 0;
        items.forEach(item => {
            subtotal += (parseFloat(item.cantidad) * parseFloat(item.precio_unitario));
        });
        
        const iva = subtotal * 0.16; // Regla de negocio: 16% IVA
        const total = subtotal + iva;

        // 3. Cálculo de Vencimiento
        // Postgres permite sumar enteros a fechas directamente en la query, 
        // pero lo haremos aquí para control.
        const fechaEmision = new Date(fecha);
        const fechaVenc = new Date(fechaEmision);
        fechaVenc.setDate(fechaEmision.getDate() + parseInt(dias_credito));

        // 4. Inserción
        await client.query(`
            INSERT INTO comercial_facturas 
            (folio_fiscal, cliente_id, fecha_emision, fecha_vencimiento, subtotal, iva, total, saldo_pendiente, estatus, items_json)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Emitida', $9)
        `, [
            folio, 
            cliente_id, 
            fecha, 
            fechaVenc.toISOString().split('T')[0], // Formato YYYY-MM-DD
            subtotal, 
            iva, 
            total, 
            total, // Saldo inicial es igual al total
            JSON.stringify(items)
        ]);

        res.redirect('/app/facturas');

    } catch (e) {
        console.error("Error creando factura:", e);
        res.status(500).send("Error al emitir la factura. Verifique los datos.");
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   03. GESTIÓN DE PAGOS (TESORERÍA)
   ========================================================================== */

/**
 * POST: Registrar Pago (Complemento)
 * Actualiza el saldo de la factura y cambia estatus si se liquida.
 */
router.post('/pagar', verificarSesion, async (req, res) => {
    const { factura_id, monto, metodo, referencia } = req.body;
    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN'); // Inicio de Transacción

        // 1. Obtener saldo actual
        const resFactura = await client.query('SELECT saldo_pendiente, total FROM comercial_facturas WHERE id = $1', [factura_id]);
        const factura = resFactura.rows[0];
        
        const pago = parseFloat(monto);
        const nuevoSaldo = parseFloat(factura.saldo_pendiente) - pago;

        // Validación básica
        if (nuevoSaldo < -1) { // Tolerancia de 1 peso por redondeo
            throw new Error("El pago excede el saldo pendiente.");
        }

        // 2. Registrar el pago en historial
        await client.query(`
            INSERT INTO comercial_pagos (factura_id, monto_pago, metodo_pago, referencia, registrado_por)
            VALUES ($1, $2, $3, $4, $5)
        `, [factura_id, pago, metodo, referencia, req.session.nombreUsuario]);

        // 3. Actualizar Factura Maestra
        let nuevoEstatus = nuevoSaldo <= 0.5 ? 'Pagada' : 'Parcial'; // Tolerancia de 50 centavos
        
        await client.query(`
            UPDATE comercial_facturas 
            SET saldo_pendiente = $1, estatus = $2, ultima_actualizacion = CURRENT_TIMESTAMP
            WHERE id = $3
        `, [nuevoSaldo < 0 ? 0 : nuevoSaldo, nuevoEstatus, factura_id]);

        await client.query('COMMIT'); // Confirmar cambios
        res.json({ success: true, nuevo_saldo: toMXN(nuevoSaldo), estatus: nuevoEstatus });

    } catch (e) {
        if(client) await client.query('ROLLBACK'); // Revertir si hay error
        console.error("Error en pago:", e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        if(client) client.release();
    }
});

/* ==========================================================================
   04. API INTERNA PARA GRÁFICOS
   ========================================================================== */

/**
 * GET: Datos JSON para gráficos de Chart.js en el Dashboard
 */
router.get('/api/chart-data', verificarSesion, async (req, res) => {
    try {
        const client = await pool.connect();
        
        // Flujo de efectivo mensual (Últimos 6 meses)
        const resFlujo = await client.query(`
            SELECT 
                TO_CHAR(fecha_emision, 'Mon') as mes,
                SUM(total) as facturado,
                SUM(total - saldo_pendiente) as cobrado
            FROM comercial_facturas
            WHERE fecha_emision > CURRENT_DATE - INTERVAL '6 months'
            GROUP BY TO_CHAR(fecha_emision, 'Mon'), date_part('month', fecha_emision)
            ORDER BY date_part('month', fecha_emision)
        `);
        
        client.release();
        res.json(resFlujo.rows);
    } catch (e) {
        res.status(500).json({ error: "Error de analítica" });
    }
});

/**
 * 🚀 EXPORTACIÓN DEL MÓDULO
 */
module.exports = router;