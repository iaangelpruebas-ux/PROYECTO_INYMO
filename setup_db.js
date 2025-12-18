// setup_db.js (Versión con 2 Tablas: Proyectos y Bitácora)
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function instalarBaseDeDatos() {
  try {
    await client.connect();
    console.log("🔌 Conectado a Neon exitosamente.");

    // --- LIMPIEZA ---
    await client.query(`DROP TABLE IF EXISTS proyectos, bitacora CASCADE;`);
    console.log("🗑️  Tablas anteriores eliminadas.");

    // --- 1. CREAR TABLA PROYECTOS ---
    await client.query(`
      CREATE TABLE proyectos (
        id SERIAL PRIMARY KEY, codigo VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(150) NOT NULL, cliente VARCHAR(100),
        lider VARCHAR(100), tipo_entrega VARCHAR(50), fase VARCHAR(50),
        progreso INT DEFAULT 0, presupuesto DECIMAL(15,2), valor_negocio DECIMAL(15,2),
        riesgo VARCHAR(20), salud VARCHAR(20), fecha_fin DATE, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("🏗️  Tabla 'proyectos' creada.");

    // --- 2. CREAR TABLA BITACORA ---
    await client.query(`
      CREATE TABLE bitacora (
        id SERIAL PRIMARY KEY,
        proyecto_id INT REFERENCES proyectos(id) ON DELETE CASCADE, -- Clave foránea PMBOK: El proyecto pertenece al sistema
        titulo VARCHAR(150) NOT NULL,
        descripcion TEXT,
        tipo_registro VARCHAR(30),
        autor VARCHAR(100),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("🏗️  Tabla 'bitacora' creada.");

    // --- 3. INSERTAR DATOS DE PRUEBA EN PROYECTOS (Proyecto ID 1 y 2) ---
    await client.query(`
      INSERT INTO proyectos (codigo, nombre, cliente, lider, tipo_entrega, fase, progreso, presupuesto, valor_negocio, riesgo, salud, fecha_fin)
      VALUES 
      ('INY-25-001', 'Nave Industrial Aceros S.A.', 'Grupo Aceros', 'Ing. Ángel Velasco', 'Predictivo', 'Ejecución', 75, 4500000, 5200000, 'Bajo', 'En Tiempo', '2025-10-15'),
      ('INY-25-004', 'Automatización Línea 3', 'Tequila Don Julio', 'Ing. Roberto M.', 'Híbrido', 'Planificación', 15, 850000, 1200000, 'Alto', 'Retrasado', '2025-12-20');
    `);
    console.log("🌱 Datos de Proyectos insertados.");



    // Añadir dentro de instalarBaseDeDatos()
    await client.query(`
      CREATE TABLE IF NOT EXISTS rrhh_colaboradores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        puesto VARCHAR(100),
        departamento VARCHAR(100),
        sueldo_mensual DECIMAL(15,2) DEFAULT 0.00,
        costo_hora DECIMAL(15,2) DEFAULT 0.00,
        fecha_ingreso DATE DEFAULT CURRENT_DATE,
        estatus VARCHAR(20) DEFAULT 'Activo'
      );
    `);


    // --- 4. INSERTAR DATOS DE PRUEBA EN BITACORA ---
    await client.query(`
      INSERT INTO bitacora (proyecto_id, titulo, descripcion, tipo_registro, autor)
      VALUES 
      (1, 'Demora en Acero Estructural', 'El proveedor A atrasó la entrega 48 horas. Se logró ajustar el cronograma con horas extra.', 'Incidente', 'Ing. Ángel Velasco'),
      (1, 'Uso de Dron para inspección', 'La inspección semanal con dron redujo el tiempo de revisión de estructura de 4hrs a 45mins.', 'Lección Aprendida', 'Arq. Sofia L.'),
      (2, 'Validación de PLC', 'Se completó la configuración inicial de los PLC Allen-Bradley para la línea de embotellado.', 'Avance', 'Ing. Roberto M.'),
      (2, 'Riesgo de Permisos', 'El permiso municipal para la conexión eléctrica presenta 2 semanas de retraso.', 'Riesgo', 'Ing. Roberto M.');
    `);
    console.log("🌱 Datos de Bitácora insertados.");


  } catch (err) {
    console.error("❌ Error en la instalación:", err);
  } finally {
    await client.end();
    console.log("👋 Conexión cerrada. Base de Datos actualizada.");
  }
}

instalarBaseDeDatos();