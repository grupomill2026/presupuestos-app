import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp } from "firebase/firestore";

// ============================================================
// CONFIGURACIÓN - Reemplazar con tus credenciales
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDmc0iKS0r076XciFI9DLJji7eQysBDjY8",
  authDomain: "presupuestos-app-9dbaf.firebaseapp.com",
  projectId: "presupuestos-app-9dbaf",
  storageBucket: "presupuestos-app-9dbaf.firebasestorage.app",
  messagingSenderId: "303705506875",
  appId: "1:303705506875:web:5ad66a143412e23e57081e",
};

const EMAILJS_CONFIG = {
  serviceId: "service_qmv5crs",
  templateId: "template_ip58pzu",
  publicKey: "QT7vwRMj03dDhnZAj",
};

// ============================================================
// CONSTANTES DEL SISTEMA
// ============================================================
const AREAS = ["CIL", "Consultoría", "Agro", "Marketing"];

const ROLES = {
  LIDER_CIL: "Líder CIL",
  LIDER_CONSULTORIA: "Líder Consultoría",
  LIDER_AGRO: "Líder Agro",
  LIDER_MARKETING: "Líder Marketing",
  GERENTE_GENERAL: "Gerente General",
  GERENTE_SERVICIOS: "Gerente de Servicios",
  ADMINISTRACION: "Administración",
};

const ROLE_AREA_MAP = {
  "Líder CIL": "CIL",
  "Líder Consultoría": "Consultoría",
  "Líder Agro": "Agro",
  "Líder Marketing": "Marketing",
};

const ESTADOS = [
  { id: "solicitado", label: "Solicitado", color: "#EAB308", icon: "🟡", bg: "#FEF9C3" },
  { id: "en_preparacion", label: "En Preparación", color: "#3B82F6", icon: "🔵", bg: "#DBEAFE" },
  { id: "enviado", label: "Enviado al Cliente", color: "#8B5CF6", icon: "🟣", bg: "#EDE9FE" },
  { id: "aceptado", label: "Aceptado", color: "#22C55E", icon: "🟢", bg: "#DCFCE7" },
  { id: "sena_cobrada", label: "Seña Cobrada", color: "#F97316", icon: "🟠", bg: "#FED7AA" },
  { id: "en_ejecucion", label: "En Ejecución", color: "#EF4444", icon: "🔴", bg: "#FEE2E2" },
  { id: "finalizado", label: "Finalizado", color: "#059669", icon: "✅", bg: "#D1FAE5" },
];

const ESTADO_MAP = Object.fromEntries(ESTADOS.map((e) => [e.id, e]));

const DIAS_RECORDATORIO = 3;

// ============================================================
// DEMO DATA (se usa si no hay Firebase configurado)
// ============================================================
const useDemoMode = FIREBASE_CONFIG.apiKey === "TU_API_KEY";

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);

// Email notification system
const TEAM_EMAILS = {
  "Gerente General": "fafrontoni@grupomill.com",
  "Líder CIL": "mbprieto@grupomill.com",
  "Líder Consultoría": "ellanarivera@grupomill.com",
  "Líder Agro": "abueno@grupomill.com",
  "Líder Marketing": "megreco@grupomill.com",
  "Gerente de Servicios": "abueno@grupomill.com",
  "Administración": "administracion@grupomill.com",
};

async function sendEmailNotification({ toEmail, toName, subject, heading, message, clientName, status, area }) {
  if (!EMAILJS_CONFIG.serviceId || EMAILJS_CONFIG.serviceId === "TU_SERVICE_ID") return;
  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.publicKey,
        template_params: {
          to_email: toEmail,
          to_name: toName || toEmail.split("@")[0],
          subject: subject,
          heading: heading || subject,
          message: message,
          client_name: clientName || "",
          status: status || "",
          area: area || "",
        },
      }),
    });
    console.log("Email enviado a", toEmail, response.ok ? "OK" : "Error");
  } catch (err) {
    console.error("Error enviando email:", err);
  }
}

function getNotificationTargets(newState, budget) {
  switch (newState) {
    case "solicitado":
      return [
        { role: "Gerente General", msg: "Se creó una nueva solicitud de presupuesto" },
        { role: "Administración", msg: "Se creó una nueva solicitud de presupuesto" },
      ];
    case "enviado":
      return [
        { email: TEAM_EMAILS[`Líder ${budget.area}`] || "", role: `Líder ${budget.area}`, msg: "El presupuesto fue enviado al cliente" },
      ];
    case "aceptado":
      return [
        { role: "Administración", msg: "El cliente aceptó el presupuesto. Gestionar cobro de seña." },
      ];
    case "sena_cobrada":
      return [
        { role: "Gerente de Servicios", msg: "La seña fue cobrada. Podés iniciar el trabajo." },
      ];
    case "finalizado":
      return [
        { role: "Administración", msg: "El trabajo fue finalizado. Gestionar facturación y cobro final." },
      ];
    default:
      return [];
  }
}

async function notifyByEmail(newState, budget) {
  const targets = getNotificationTargets(newState, budget);
  const estadoLabel = ESTADO_MAP[newState]?.label || newState;
  for (const t of targets) {
    const email = t.email || TEAM_EMAILS[t.role] || "";
    if (!email) continue;
    await sendEmailNotification({
      toEmail: email,
      toName: t.role,
      subject: `${budget.cliente} → ${estadoLabel}`,
      heading: `Presupuesto ${estadoLabel}`,
      message: t.msg,
      clientName: budget.cliente,
      status: estadoLabel,
      area: budget.area,
    });
  }
}

const DEMO_USERS = [
  { uid: "u1", email: "lider.cil@empresa.com", displayName: "María López", role: "Líder CIL" },
  { uid: "u2", email: "lider.consultoria@empresa.com", displayName: "Carlos García", role: "Líder Consultoría" },
  { uid: "u3", email: "lider.agro@empresa.com", displayName: "Ana Torres", role: "Líder Agro" },
  { uid: "u4", email: "lider.marketing@empresa.com", displayName: "Pedro Ruiz", role: "Líder Marketing" },
  { uid: "u5", email: "gerente@empresa.com", displayName: "Roberto Díaz", role: "Gerente General" },
  { uid: "u6", email: "servicios@empresa.com", displayName: "Laura Fernández", role: "Gerente de Servicios" },
  { uid: "u7", email: "admin@empresa.com", displayName: "Sofía Martínez", role: "Administración" },
];

function generateId() {
  return "P-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
}

function formatDate(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTime(d) {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function daysSince(d) {
  if (!d) return 0;
  const date = d instanceof Date ? d : new Date(d);
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function createDemoData() {
  const now = new Date();
  return [
    {
      id: "P-DEMO001", cliente: "Agropecuaria San Martín", area: "Agro",
      descripcion: "Análisis de suelos y recomendación de fertilización para 500 hectáreas de soja",
      estado: "solicitado", monto: 850000,
      items: [{ desc: "Muestreo de suelos", monto: 350000 }, { desc: "Análisis laboratorio", monto: 300000 }, { desc: "Informe técnico", monto: 200000 }],
      validez: new Date(now.getTime() + 15 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
      createdBy: "u3", solicitante: "u3",
      historial: [{ fecha: new Date(now.getTime() - 1 * 86400000).toISOString(), usuario: "Ana Torres", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" }],
      archivos: [],
    },
    {
      id: "P-DEMO002", cliente: "TechCorp Argentina", area: "Consultoría",
      descripcion: "Implementación de sistema de gestión de calidad ISO 9001",
      estado: "en_preparacion", monto: 2400000,
      items: [{ desc: "Diagnóstico inicial", monto: 400000 }, { desc: "Diseño del SGC", monto: 800000 }, { desc: "Implementación", monto: 900000 }, { desc: "Auditoría interna", monto: 300000 }],
      validez: new Date(now.getTime() + 30 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
      createdBy: "u2", solicitante: "u2",
      historial: [
        { fecha: new Date(now.getTime() - 3 * 86400000).toISOString(), usuario: "Carlos García", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" },
        { fecha: new Date(now.getTime() - 2 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Tomó el presupuesto para preparación", estadoAnterior: "solicitado", estadoNuevo: "en_preparacion" },
      ],
      archivos: [],
    },
    {
      id: "P-DEMO003", cliente: "Bodega del Sur", area: "Marketing",
      descripcion: "Campaña de lanzamiento nueva línea de vinos premium",
      estado: "enviado", monto: 1800000,
      items: [{ desc: "Estrategia digital", monto: 600000 }, { desc: "Producción audiovisual", monto: 700000 }, { desc: "Pauta publicitaria", monto: 500000 }],
      validez: new Date(now.getTime() + 20 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
      createdBy: "u4", solicitante: "u4",
      historial: [
        { fecha: new Date(now.getTime() - 5 * 86400000).toISOString(), usuario: "Pedro Ruiz", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" },
        { fecha: new Date(now.getTime() - 4 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Tomó el presupuesto para preparación", estadoAnterior: "solicitado", estadoNuevo: "en_preparacion" },
        { fecha: new Date(now.getTime() - 1 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Presupuesto enviado al cliente", estadoAnterior: "en_preparacion", estadoNuevo: "enviado" },
      ],
      archivos: [{ nombre: "presupuesto_bodega_del_sur.pdf", url: "#", fecha: new Date(now.getTime() - 1 * 86400000).toISOString() }],
    },
    {
      id: "P-DEMO004", cliente: "Municipalidad de Córdoba", area: "CIL",
      descripcion: "Estudio de impacto ambiental para nueva planta industrial",
      estado: "aceptado", monto: 3200000,
      items: [{ desc: "Relevamiento de campo", monto: 800000 }, { desc: "Análisis de laboratorio", monto: 600000 }, { desc: "Modelación ambiental", monto: 1000000 }, { desc: "Informe EIA", monto: 800000 }],
      validez: new Date(now.getTime() + 10 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
      createdBy: "u1", solicitante: "u1",
      historial: [
        { fecha: new Date(now.getTime() - 10 * 86400000).toISOString(), usuario: "María López", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" },
        { fecha: new Date(now.getTime() - 9 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Tomó el presupuesto", estadoAnterior: "solicitado", estadoNuevo: "en_preparacion" },
        { fecha: new Date(now.getTime() - 6 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Enviado al cliente", estadoAnterior: "en_preparacion", estadoNuevo: "enviado" },
        { fecha: new Date(now.getTime() - 2 * 86400000).toISOString(), usuario: "María López", accion: "Cliente aceptó el presupuesto", estadoAnterior: "enviado", estadoNuevo: "aceptado" },
      ],
      archivos: [{ nombre: "presupuesto_EIA_municipalidad.pdf", url: "#", fecha: new Date(now.getTime() - 6 * 86400000).toISOString() }],
    },
    {
      id: "P-DEMO005", cliente: "Granja Los Álamos", area: "Agro",
      descripcion: "Plan de manejo integral para producción orgánica certificada",
      estado: "sena_cobrada", monto: 1500000,
      items: [{ desc: "Diagnóstico productivo", monto: 400000 }, { desc: "Plan de transición", monto: 600000 }, { desc: "Acompañamiento certificación", monto: 500000 }],
      validez: new Date(now.getTime() + 5 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 15 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 1 * 86400000).toISOString(),
      createdBy: "u3", solicitante: "u3",
      historial: [
        { fecha: new Date(now.getTime() - 15 * 86400000).toISOString(), usuario: "Ana Torres", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" },
        { fecha: new Date(now.getTime() - 14 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Tomó el presupuesto", estadoAnterior: "solicitado", estadoNuevo: "en_preparacion" },
        { fecha: new Date(now.getTime() - 10 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Enviado al cliente", estadoAnterior: "en_preparacion", estadoNuevo: "enviado" },
        { fecha: new Date(now.getTime() - 7 * 86400000).toISOString(), usuario: "Ana Torres", accion: "Cliente aceptó", estadoAnterior: "enviado", estadoNuevo: "aceptado" },
        { fecha: new Date(now.getTime() - 1 * 86400000).toISOString(), usuario: "Sofía Martínez", accion: "Seña cobrada", estadoAnterior: "aceptado", estadoNuevo: "sena_cobrada" },
      ],
      archivos: [{ nombre: "presupuesto_granja_alamos.pdf", url: "#", fecha: new Date(now.getTime() - 10 * 86400000).toISOString() }],
    },
    {
      id: "P-DEMO006", cliente: "Cooperativa El Progreso", area: "CIL",
      descripcion: "Auditoría ambiental y plan de remediación",
      estado: "en_ejecucion", monto: 4100000,
      items: [{ desc: "Auditoría de campo", monto: 1200000 }, { desc: "Análisis de muestras", monto: 900000 }, { desc: "Plan de remediación", monto: 1200000 }, { desc: "Seguimiento", monto: 800000 }],
      validez: new Date(now.getTime() - 5 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 25 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
      createdBy: "u1", solicitante: "u1",
      historial: [
        { fecha: new Date(now.getTime() - 25 * 86400000).toISOString(), usuario: "María López", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" },
        { fecha: new Date(now.getTime() - 24 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Tomó el presupuesto", estadoAnterior: "solicitado", estadoNuevo: "en_preparacion" },
        { fecha: new Date(now.getTime() - 20 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Enviado al cliente", estadoAnterior: "en_preparacion", estadoNuevo: "enviado" },
        { fecha: new Date(now.getTime() - 15 * 86400000).toISOString(), usuario: "María López", accion: "Cliente aceptó", estadoAnterior: "enviado", estadoNuevo: "aceptado" },
        { fecha: new Date(now.getTime() - 10 * 86400000).toISOString(), usuario: "Sofía Martínez", accion: "Seña cobrada", estadoAnterior: "aceptado", estadoNuevo: "sena_cobrada" },
        { fecha: new Date(now.getTime() - 3 * 86400000).toISOString(), usuario: "Laura Fernández", accion: "Trabajo iniciado", estadoAnterior: "sena_cobrada", estadoNuevo: "en_ejecucion" },
      ],
      archivos: [{ nombre: "presupuesto_cooperativa.pdf", url: "#", fecha: new Date(now.getTime() - 20 * 86400000).toISOString() }],
    },
    {
      id: "P-DEMO007", cliente: "Estancia La Esperanza", area: "Consultoría",
      descripcion: "Consultoría en eficiencia energética y reducción de costos operativos",
      estado: "finalizado", monto: 1100000,
      items: [{ desc: "Auditoría energética", monto: 400000 }, { desc: "Plan de mejoras", monto: 400000 }, { desc: "Seguimiento 3 meses", monto: 300000 }],
      validez: new Date(now.getTime() - 30 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 45 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
      createdBy: "u2", solicitante: "u2",
      historial: [
        { fecha: new Date(now.getTime() - 45 * 86400000).toISOString(), usuario: "Carlos García", accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" },
        { fecha: new Date(now.getTime() - 44 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Tomó el presupuesto", estadoAnterior: "solicitado", estadoNuevo: "en_preparacion" },
        { fecha: new Date(now.getTime() - 40 * 86400000).toISOString(), usuario: "Roberto Díaz", accion: "Enviado al cliente", estadoAnterior: "en_preparacion", estadoNuevo: "enviado" },
        { fecha: new Date(now.getTime() - 35 * 86400000).toISOString(), usuario: "Carlos García", accion: "Cliente aceptó", estadoAnterior: "enviado", estadoNuevo: "aceptado" },
        { fecha: new Date(now.getTime() - 30 * 86400000).toISOString(), usuario: "Sofía Martínez", accion: "Seña cobrada", estadoAnterior: "aceptado", estadoNuevo: "sena_cobrada" },
        { fecha: new Date(now.getTime() - 25 * 86400000).toISOString(), usuario: "Laura Fernández", accion: "Trabajo iniciado", estadoAnterior: "sena_cobrada", estadoNuevo: "en_ejecucion" },
        { fecha: new Date(now.getTime() - 5 * 86400000).toISOString(), usuario: "Carlos García", accion: "Trabajo finalizado", estadoAnterior: "en_ejecucion", estadoNuevo: "finalizado" },
      ],
      archivos: [{ nombre: "presupuesto_estancia.pdf", url: "#", fecha: new Date(now.getTime() - 40 * 86400000).toISOString() }],
    },
  ];
}

// ============================================================
// STYLES
// ============================================================
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --bg: #0F1117;
  --bg-card: #181A20;
  --bg-elevated: #1F2128;
  --bg-hover: #252830;
  --border: #2A2D37;
  --border-light: #353842;
  --text: #E8E9ED;
  --text-secondary: #9BA1B0;
  --text-muted: #6B7185;
  --accent: #6C5CE7;
  --accent-light: #A29BFE;
  --success: #00B894;
  --warning: #FDCB6E;
  --danger: #E17055;
  --info: #74B9FF;
  --shadow: 0 4px 24px rgba(0,0,0,0.3);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.2);
  --radius: 12px;
  --radius-sm: 8px;
  --radius-xs: 6px;
  --font: 'DM Sans', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.app { min-height: 100vh; display: flex; flex-direction: column; }

/* ---- Sidebar ---- */
.sidebar {
  position: fixed; left: 0; top: 0; bottom: 0; width: 260px;
  background: var(--bg-card); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; z-index: 100;
  transition: transform var(--transition);
}
.sidebar-header {
  padding: 24px 20px; border-bottom: 1px solid var(--border);
}
.sidebar-logo {
  font-size: 20px; font-weight: 700; letter-spacing: -0.5px;
  background: linear-gradient(135deg, var(--accent), var(--accent-light));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.sidebar-subtitle { font-size: 11px; color: var(--text-muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
.sidebar-nav { flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  border-radius: var(--radius-sm); cursor: pointer; transition: all var(--transition);
  color: var(--text-secondary); font-size: 14px; font-weight: 500; border: none; background: none; text-align: left; width: 100%;
}
.nav-item:hover { background: var(--bg-hover); color: var(--text); }
.nav-item.active { background: rgba(108, 92, 231, 0.15); color: var(--accent-light); }
.nav-item svg { width: 18px; height: 18px; flex-shrink: 0; }
.nav-divider { height: 1px; background: var(--border); margin: 12px 0; }

.sidebar-user {
  padding: 16px 20px; border-top: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px;
}
.user-avatar {
  width: 36px; height: 36px; border-radius: 50%; background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: white; flex-shrink: 0;
}
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-role { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- Main ---- */
.main { margin-left: 260px; flex: 1; min-height: 100vh; }
.topbar {
  height: 60px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; border-bottom: 1px solid var(--border);
  background: rgba(15, 17, 23, 0.8); backdrop-filter: blur(12px);
  position: sticky; top: 0; z-index: 50;
}
.topbar-title { font-size: 18px; font-weight: 600; }
.topbar-actions { display: flex; gap: 12px; align-items: center; }
.content { padding: 28px 32px; }

/* ---- Buttons ---- */
.btn {
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px;
  border-radius: var(--radius-sm); font-size: 13px; font-weight: 600;
  border: none; cursor: pointer; transition: all var(--transition);
  font-family: var(--font); white-space: nowrap;
}
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover { background: #5A4BD6; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(108,92,231,0.4); }
.btn-secondary { background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border); }
.btn-secondary:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-light); }
.btn-success { background: var(--success); color: white; }
.btn-success:hover { background: #00A381; }
.btn-warning { background: var(--warning); color: #1a1a2e; }
.btn-danger { background: var(--danger); color: white; }
.btn-danger:hover { background: #D05540; }
.btn-ghost { background: transparent; color: var(--text-secondary); padding: 6px 10px; }
.btn-ghost:hover { background: var(--bg-hover); color: var(--text); }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-lg { padding: 12px 24px; font-size: 15px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ---- Cards ---- */
.card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); overflow: hidden;
}
.card-header {
  padding: 16px 20px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.card-title { font-size: 14px; font-weight: 600; }
.card-body { padding: 20px; }

/* ---- Form ---- */
.form-group { margin-bottom: 18px; }
.form-label { display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
.form-input, .form-select, .form-textarea {
  width: 100%; padding: 10px 14px; background: var(--bg-elevated);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  color: var(--text); font-size: 14px; font-family: var(--font);
  transition: border-color var(--transition);
}
.form-input:focus, .form-select:focus, .form-textarea:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(108, 92, 231, 0.15);
}
.form-textarea { resize: vertical; min-height: 80px; }
.form-select { cursor: pointer; }
.form-select option { background: var(--bg-card); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

/* ---- Kanban ---- */
.kanban { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 16px; min-height: 60vh; }
.kanban-col {
  min-width: 240px; max-width: 280px; flex: 1;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); display: flex; flex-direction: column;
}
.kanban-col-header {
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.kanban-col-title {
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; gap: 8px;
}
.kanban-col-badge {
  display: flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; border-radius: 11px;
  font-size: 11px; font-weight: 700; padding: 0 6px;
}
.kanban-col-body {
  flex: 1; padding: 12px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px;
}

.kanban-card {
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 14px;
  cursor: pointer; transition: all var(--transition);
  position: relative;
}
.kanban-card:hover {
  border-color: var(--border-light); transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}
.kanban-card-alert {
  border-left: 3px solid var(--danger);
}
.kanban-card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.kanban-card-id { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }
.kanban-card-area {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 2px 8px; border-radius: 4px;
}
.kanban-card-cliente { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.kanban-card-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.kanban-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
.kanban-card-monto { font-size: 13px; font-weight: 700; font-family: var(--font-mono); }
.kanban-card-days { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
.kanban-card-days.alert { color: var(--danger); font-weight: 600; }

/* ---- Dashboard ---- */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; position: relative; overflow: hidden;
}
.stat-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
}
.stat-value { font-size: 28px; font-weight: 700; font-family: var(--font-mono); margin-bottom: 4px; }
.stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.stat-change { font-size: 12px; margin-top: 8px; display: flex; align-items: center; gap: 4px; }

.charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
.chart-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; }
.chart-title { font-size: 14px; font-weight: 600; margin-bottom: 16px; }
.bar-chart { display: flex; flex-direction: column; gap: 10px; }
.bar-row { display: flex; align-items: center; gap: 12px; }
.bar-label { width: 100px; font-size: 12px; color: var(--text-secondary); text-align: right; flex-shrink: 0; }
.bar-track { flex: 1; height: 28px; background: var(--bg-elevated); border-radius: 6px; overflow: hidden; position: relative; }
.bar-fill { height: 100%; border-radius: 6px; transition: width 0.6s ease; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px; }
.bar-value { font-size: 11px; font-weight: 700; font-family: var(--font-mono); color: white; }

/* ---- Modal ---- */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(4px);
  animation: fadeIn 0.15s ease;
}
.modal {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); max-width: 680px; width: 95%;
  max-height: 90vh; overflow-y: auto; animation: slideUp 0.2s ease;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}
.modal-header {
  padding: 20px 24px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; background: var(--bg-card); z-index: 1;
}
.modal-title { font-size: 16px; font-weight: 700; }
.modal-close {
  width: 32px; height: 32px; border-radius: 8px; border: none;
  background: var(--bg-elevated); color: var(--text-secondary);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 18px; transition: all var(--transition);
}
.modal-close:hover { background: var(--bg-hover); color: var(--text); }
.modal-body { padding: 24px; }
.modal-footer { padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; }

/* ---- Detail View ---- */
.detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.detail-id { font-size: 13px; font-family: var(--font-mono); color: var(--text-muted); margin-bottom: 4px; }
.detail-cliente { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.detail-meta { display: flex; gap: 16px; flex-wrap: wrap; }
.detail-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
}
.detail-sections { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; }
.detail-section { margin-bottom: 24px; }
.detail-section-title { font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }

.timeline { position: relative; padding-left: 28px; }
.timeline::before { content: ''; position: absolute; left: 8px; top: 4px; bottom: 4px; width: 2px; background: var(--border); }
.timeline-item { position: relative; margin-bottom: 16px; }
.timeline-dot {
  position: absolute; left: -24px; top: 4px; width: 12px; height: 12px;
  border-radius: 50%; border: 2px solid; background: var(--bg-card);
}
.timeline-date { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.timeline-text { font-size: 13px; margin-top: 2px; }
.timeline-user { font-size: 12px; color: var(--text-secondary); }

.items-table { width: 100%; }
.items-table th { text-align: left; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.items-table td { padding: 10px 0; font-size: 13px; border-bottom: 1px solid var(--border); }
.items-table td:last-child { text-align: right; font-family: var(--font-mono); font-weight: 600; }
.items-total { text-align: right; font-size: 15px; font-weight: 700; font-family: var(--font-mono); margin-top: 12px; padding-top: 12px; border-top: 2px solid var(--border); }

/* ---- Notifications ---- */
.notif-panel {
  position: fixed; right: 0; top: 0; bottom: 0; width: 380px;
  background: var(--bg-card); border-left: 1px solid var(--border);
  z-index: 150; transform: translateX(100%); transition: transform 0.3s ease;
  display: flex; flex-direction: column;
}
.notif-panel.open { transform: translateX(0); }
.notif-panel-header { padding: 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.notif-list { flex: 1; overflow-y: auto; padding: 12px; }
.notif-item {
  padding: 14px; border-radius: var(--radius-sm); margin-bottom: 8px;
  background: var(--bg-elevated); border: 1px solid var(--border);
  cursor: pointer; transition: all var(--transition);
}
.notif-item:hover { border-color: var(--border-light); }
.notif-item.unread { border-left: 3px solid var(--accent); }
.notif-time { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.notif-text { font-size: 13px; margin-top: 4px; }

/* ---- Filters ---- */
.filters-bar { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; align-items: center; }
.search-input {
  flex: 1; min-width: 200px; padding: 8px 14px 8px 36px;
  background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text); font-size: 13px;
  font-family: var(--font); position: relative;
}
.search-input:focus { outline: none; border-color: var(--accent); }
.search-wrapper { position: relative; flex: 1; min-width: 200px; }
.search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
.filter-chip {
  padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 600;
  border: 1px solid var(--border); background: var(--bg-elevated);
  color: var(--text-secondary); cursor: pointer; transition: all var(--transition);
}
.filter-chip:hover { border-color: var(--border-light); color: var(--text); }
.filter-chip.active { background: rgba(108,92,231,0.15); border-color: var(--accent); color: var(--accent-light); }

/* ---- Login ---- */
.login-page {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: var(--bg);
  position: relative; overflow: hidden;
}
.login-page::before {
  content: ''; position: absolute; width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(108,92,231,0.15), transparent 70%);
  top: -100px; right: -100px;
}
.login-page::after {
  content: ''; position: absolute; width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(0,184,148,0.1), transparent 70%);
  bottom: -100px; left: -100px;
}
.login-card {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 40px; width: 420px;
  position: relative; z-index: 1; box-shadow: var(--shadow);
}
.login-logo { font-size: 28px; font-weight: 700; text-align: center; margin-bottom: 8px;
  background: linear-gradient(135deg, var(--accent), var(--accent-light));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.login-sub { text-align: center; font-size: 14px; color: var(--text-muted); margin-bottom: 32px; }
.demo-banner {
  background: rgba(108,92,231,0.1); border: 1px solid rgba(108,92,231,0.3);
  border-radius: var(--radius-sm); padding: 14px; margin-bottom: 24px;
  text-align: center;
}
.demo-banner-title { font-size: 13px; font-weight: 600; color: var(--accent-light); margin-bottom: 8px; }
.demo-users-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.demo-user-btn {
  padding: 8px; background: var(--bg-elevated); border: 1px solid var(--border);
  border-radius: var(--radius-xs); cursor: pointer; text-align: left;
  transition: all var(--transition); color: var(--text);
}
.demo-user-btn:hover { border-color: var(--accent); background: rgba(108,92,231,0.1); }
.demo-user-name { font-size: 12px; font-weight: 600; }
.demo-user-role { font-size: 10px; color: var(--text-muted); }

/* ---- Item Editor ---- */
.item-row { display: flex; gap: 10px; margin-bottom: 8px; align-items: center; }
.item-row input { flex: 1; }
.item-row input:last-of-type { max-width: 150px; }
.remove-item { width: 32px; height: 32px; border-radius: 6px; border: none; background: rgba(225,112,85,0.15); color: var(--danger); cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.add-item { display: flex; align-items: center; gap: 6px; color: var(--accent-light); font-size: 13px; cursor: pointer; background: none; border: none; font-family: var(--font); font-weight: 600; padding: 6px 0; }

/* ---- Badge Colors ---- */
.area-cil { background: rgba(116, 185, 255, 0.15); color: #74B9FF; }
.area-consultoria { background: rgba(162, 155, 254, 0.15); color: #A29BFE; }
.area-agro { background: rgba(0, 184, 148, 0.15); color: #00B894; }
.area-marketing { background: rgba(253, 203, 110, 0.15); color: #FDCB6E; }

/* ---- Animations ---- */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

/* ---- Scrollbar ---- */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--border-light); }

/* ---- Responsive ---- */
@media (max-width: 1024px) {
  .sidebar { transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
  .main { margin-left: 0; }
  .detail-sections { grid-template-columns: 1fr; }
  .charts-grid { grid-template-columns: 1fr; }
  .form-row { grid-template-columns: 1fr; }
}

/* ---- Empty state ---- */
.empty-state { text-align: center; padding: 48px 20px; color: var(--text-muted); }
.empty-state-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
.empty-state-text { font-size: 14px; }

/* ---- Tooltip ---- */
.action-group { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }

/* ---- Notification Bell ---- */
.bell-wrapper { position: relative; }
.bell-badge {
  position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px;
  background: var(--danger); border-radius: 9px; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; padding: 0 4px;
  border: 2px solid var(--bg);
}

/* ---- Hamburger ---- */
.hamburger {
  display: none; width: 36px; height: 36px; border-radius: 8px;
  border: none; background: var(--bg-elevated); color: var(--text);
  cursor: pointer; align-items: center; justify-content: center; font-size: 18px;
}
@media (max-width: 1024px) {
  .hamburger { display: flex; }
}
`;

// ============================================================
// ICONS (inline SVG as components)
// ============================================================
const Icons = {
  Dashboard: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>),
  Kanban: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>),
  List: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>),
  Bell: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>),
  Plus: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Search: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  X: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Trash: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>),
  Clock: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>),
  File: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>),
  Logout: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  Menu: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>),
  ArrowRight: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>),
  Settings: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
};

// ============================================================
// AREA COLORS
// ============================================================
function areaClass(area) {
  return "area-" + area.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatMonto(m) {
  return "$" + Number(m || 0).toLocaleString("es-AR");
}

// ============================================================
// MAIN APP COMPONENT
// ============================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [presupuestos, setPresupuestos] = useState([]);
  const [view, setView] = useState("kanban");
  const [notifications, setNotifications] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterArea, setFilterArea] = useState("Todas");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Init data - Firestore real-time or demo
  useEffect(() => {
    if (useDemoMode) {
      setPresupuestos(createDemoData());
      return;
    }
    // Real-time Firestore listener
    const q = query(collection(firestore, "presupuestos"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => {
        const raw = d.data();
        return {
          ...raw,
          id: d.id,
          createdAt: raw.createdAt?.toDate?.()?.toISOString() || raw.createdAt,
          updatedAt: raw.updatedAt?.toDate?.()?.toISOString() || raw.updatedAt,
          validez: raw.validez?.toDate?.()?.toISOString() || raw.validez,
        };
      });
      setPresupuestos(data);
    }, (err) => {
      console.error("Firestore error:", err);
      // Fallback to demo if Firestore fails
      setPresupuestos(createDemoData());
    });
    return () => unsubscribe();
  }, []);

  // Check stale budgets
  const staleAlerts = useMemo(() => {
    return presupuestos.filter(
      (p) => p.estado !== "finalizado" && daysSince(p.updatedAt) >= DIAS_RECORDATORIO
    );
  }, [presupuestos]);

  // Add notification
  const addNotification = useCallback((text, budgetId) => {
    setNotifications((prev) => [
      { id: Date.now(), text, budgetId, time: new Date().toISOString(), read: false },
      ...prev,
    ]);
  }, []);

  // Login handler
  const handleLogin = (u) => {
    setUser(u);
    addNotification(`Bienvenido/a, ${u.displayName}`, null);
    // Check stale on login
    const demoData = createDemoData();
    const stale = demoData.filter(
      (p) => p.estado !== "finalizado" && daysSince(p.updatedAt) >= DIAS_RECORDATORIO
    );
    stale.forEach((p) => {
      addNotification(
        `⚠️ ${p.id} - ${p.cliente} lleva ${daysSince(p.updatedAt)} días sin movimiento`,
        p.id
      );
    });
  };

  // Create budget
  const handleCreate = async (data) => {
    if (useDemoMode) {
      const newBudget = {
        ...data, id: generateId(), estado: "solicitado",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        createdBy: user.uid, solicitante: user.uid,
        historial: [{ fecha: new Date().toISOString(), usuario: user.displayName, accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" }],
        archivos: [],
      };
      setPresupuestos((prev) => [newBudget, ...prev]);
      setShowNewForm(false);
      addNotification(`Nuevo presupuesto ${newBudget.id} para ${newBudget.cliente}`, newBudget.id);
      return;
    }
    try {
      const docRef = await addDoc(collection(firestore, "presupuestos"), {
        ...data,
        estado: "solicitado",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
        solicitante: user.uid,
        solicitanteNombre: user.displayName,
        historial: [{ fecha: new Date().toISOString(), usuario: user.displayName, accion: "Creó la solicitud", estadoAnterior: null, estadoNuevo: "solicitado" }],
        archivos: [],
      });
      setShowNewForm(false);
      addNotification(`Nuevo presupuesto para ${data.cliente}`, docRef.id);
      notifyByEmail("solicitado", { cliente: data.cliente, area: data.area });
    } catch (err) {
      console.error("Error creando presupuesto:", err);
      alert("Error al crear el presupuesto. Intentá de nuevo.");
    }
  };

  // Change state
  const handleChangeState = async (budgetId, newState, comment) => {
    const budget = presupuestos.find((p) => p.id === budgetId);
    if (!budget) return;
    const entry = {
      fecha: new Date().toISOString(),
      usuario: user.displayName,
      accion: comment || `Cambió estado a ${ESTADO_MAP[newState]?.label}`,
      estadoAnterior: budget.estado,
      estadoNuevo: newState,
    };
    if (useDemoMode) {
      setPresupuestos((prev) =>
        prev.map((p) => {
          if (p.id !== budgetId) return p;
          return { ...p, estado: newState, updatedAt: new Date().toISOString(), historial: [...p.historial, entry] };
        })
      );
    } else {
      try {
        await updateDoc(doc(firestore, "presupuestos", budgetId), {
          estado: newState,
          updatedAt: serverTimestamp(),
          historial: [...(budget.historial || []), entry],
        });
      } catch (err) {
        console.error("Error actualizando estado:", err);
        alert("Error al cambiar el estado. Intentá de nuevo.");
        return;
      }
    }
    const label = ESTADO_MAP[newState]?.label;
    addNotification(`${budgetId} → ${label}: ${budget.cliente}`, budgetId);
    notifyByEmail(newState, budget);
  };

  // Filter
  const filtered = useMemo(() => {
    return presupuestos.filter((p) => {
      const matchSearch =
        !searchTerm ||
        p.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.descripcion.toLowerCase().includes(searchTerm.toLowerCase());
      const matchArea = filterArea === "Todas" || p.area === filterArea;
      return matchSearch && matchArea;
    });
  }, [presupuestos, searchTerm, filterArea]);

  // Permissions per role
  const canCreate = user && (Object.keys(ROLE_AREA_MAP).includes(user.role) || Object.keys(ROLE_AREA_MAP).includes(user.secondaryRole || ""));
  const canAdvance = (budget) => {
    if (!user) return [];
    const s = budget.estado;
    const r = user.role;
    const r2 = user.secondaryRole || "";
    const hasRole = (role) => r === role || r2 === role;
    const isLider = Object.keys(ROLE_AREA_MAP).includes(r) || Object.keys(ROLE_AREA_MAP).includes(r2);
    const liderArea = ROLE_AREA_MAP[r] || ROLE_AREA_MAP[r2];
    const actions = [];
    if (s === "solicitado" && hasRole("Gerente General"))
      actions.push({ state: "en_preparacion", label: "Tomar presupuesto", color: "btn-primary" });
    if (s === "en_preparacion" && hasRole("Gerente General"))
      actions.push({ state: "enviado", label: "Marcar como enviado", color: "btn-primary" });
    if (s === "enviado" && isLider && liderArea === budget.area)
      actions.push({ state: "aceptado", label: "Cliente aceptó", color: "btn-success" });
    if (s === "aceptado" && hasRole("Administración"))
      actions.push({ state: "sena_cobrada", label: "Seña cobrada", color: "btn-warning" });
    if (s === "sena_cobrada" && hasRole("Gerente de Servicios"))
      actions.push({ state: "en_ejecucion", label: "Iniciar trabajo", color: "btn-danger" });
    if (s === "en_ejecucion" && isLider && liderArea === budget.area)
      actions.push({ state: "finalizado", label: "Marcar finalizado", color: "btn-success" });
    return actions;
  };

  // Export to CSV/Excel
  const handleExportExcel = () => {
    const headers = ["ID", "Cliente", "Área", "Descripción", "Estado", "Monto", "Fecha Creación", "Última Actualización", "Validez", "Solicitante", "Ítems"];
    const rows = presupuestos.map((p) => [
      p.id,
      `"${(p.cliente || "").replace(/"/g, '""')}"`,
      p.area,
      `"${(p.descripcion || "").replace(/"/g, '""')}"`,
      ESTADO_MAP[p.estado]?.label || p.estado,
      p.monto || 0,
      formatDateTime(p.createdAt),
      formatDateTime(p.updatedAt),
      formatDate(p.validez),
      p.solicitanteNombre || p.solicitante || "",
      `"${(p.items || []).map((it) => it.desc + ": $" + it.monto).join("; ")}"`,
    ]);
    const BOM = "\uFEFF";
    const csv = BOM + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `presupuestos_backup_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!user) {
    return (
      <>
        <style>{css}</style>
        <LoginPage onLogin={handleLogin} />
      </>
    );
  }

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* Sidebar */}
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-header">
            <div className="sidebar-logo">PresupuestOS</div>
            <div className="sidebar-subtitle">Gestión de Presupuestos</div>
          </div>
          <nav className="sidebar-nav">
            <button className={`nav-item ${view === "dashboard" ? "active" : ""}`} onClick={() => { setView("dashboard"); setSidebarOpen(false); }}>
              <Icons.Dashboard /> Dashboard
            </button>
            <button className={`nav-item ${view === "kanban" ? "active" : ""}`} onClick={() => { setView("kanban"); setSidebarOpen(false); }}>
              <Icons.Kanban /> Kanban
            </button>
            <button className={`nav-item ${view === "list" ? "active" : ""}`} onClick={() => { setView("list"); setSidebarOpen(false); }}>
              <Icons.List /> Lista
            </button>
            <div className="nav-divider" />
            <button className="nav-item" onClick={() => { setShowNotif(true); setSidebarOpen(false); }}>
              <Icons.Bell /> Notificaciones
              {unreadCount > 0 && <span style={{ background: "var(--danger)", color: "white", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{unreadCount}</span>}
            </button>
          </nav>
          <div className="sidebar-user">
            <div className="user-avatar">{user.displayName.split(" ").map(n => n[0]).join("").slice(0,2)}</div>
            <div className="user-info">
              <div className="user-name">{user.displayName}</div>
              <div className="user-role">{user.role}</div>
            </div>
            <button className="btn-ghost" onClick={() => setUser(null)} title="Cerrar sesión">
              <Icons.Logout />
            </button>
          </div>
        </aside>

        {/* Main */}
        <div className="main">
          <header className="topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
                <Icons.Menu />
              </button>
              <span className="topbar-title">
                {view === "dashboard" ? "Dashboard" : view === "kanban" ? "Tablero Kanban" : "Lista de Presupuestos"}
              </span>
            </div>
            <div className="topbar-actions">
              {staleAlerts.length > 0 && (
                <span style={{ fontSize: 12, color: "var(--danger)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                  ⚠️ {staleAlerts.length} sin movimiento
                </span>
              )}
              <button className="btn btn-sm btn-secondary" onClick={handleExportExcel} title="Descargar backup Excel">
                📥 Backup
              </button>
              <div className="bell-wrapper">
                <button className="btn-ghost" onClick={() => setShowNotif(true)}>
                  <Icons.Bell />
                </button>
                {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
              </div>
              {canCreate && (
                <button className="btn btn-primary" onClick={() => setShowNewForm(true)}>
                  <Icons.Plus /> Nuevo Presupuesto
                </button>
              )}
            </div>
          </header>

          <div className="content">
            {/* Filters */}
            {view !== "dashboard" && (
              <div className="filters-bar">
                <div className="search-wrapper">
                  <span className="search-icon"><Icons.Search /></span>
                  <input
                    className="search-input"
                    placeholder="Buscar por cliente, ID o descripción..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ paddingLeft: 36 }}
                  />
                </div>
                <button className={`filter-chip ${filterArea === "Todas" ? "active" : ""}`} onClick={() => setFilterArea("Todas")}>Todas</button>
                {AREAS.map((a) => (
                  <button key={a} className={`filter-chip ${filterArea === a ? "active" : ""}`} onClick={() => setFilterArea(a)}>{a}</button>
                ))}
              </div>
            )}

            {view === "dashboard" && <DashboardView presupuestos={presupuestos} onSelect={(p) => setSelectedBudget(p)} />}
            {view === "kanban" && <KanbanView presupuestos={filtered} onSelect={(p) => setSelectedBudget(p)} />}
            {view === "list" && <ListView presupuestos={filtered} onSelect={(p) => setSelectedBudget(p)} />}
          </div>
        </div>

        {/* Notification Panel */}
        <div className={`notif-panel ${showNotif ? "open" : ""}`}>
          <div className="notif-panel-header">
            <span style={{ fontWeight: 700 }}>Notificaciones</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setNotifications(n => n.map(x => ({...x, read: true})))}>Marcar todas leídas</button>
              <button className="modal-close" onClick={() => setShowNotif(false)}>×</button>
            </div>
          </div>
          <div className="notif-list">
            {notifications.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔔</div>
                <div className="empty-state-text">Sin notificaciones</div>
              </div>
            ) : notifications.map((n) => (
              <div key={n.id} className={`notif-item ${!n.read ? "unread" : ""}`} onClick={() => {
                setNotifications(prev => prev.map(x => x.id === n.id ? {...x, read: true} : x));
                if (n.budgetId) {
                  const b = presupuestos.find(p => p.id === n.budgetId);
                  if (b) setSelectedBudget(b);
                }
                setShowNotif(false);
              }}>
                <div className="notif-time">{formatDateTime(n.time)}</div>
                <div className="notif-text">{n.text}</div>
              </div>
            ))}
          </div>
        </div>
        {showNotif && <div style={{ position: "fixed", inset: 0, zIndex: 140 }} onClick={() => setShowNotif(false)} />}

        {/* New Budget Modal */}
        {showNewForm && (
          <NewBudgetModal
            user={user}
            onClose={() => setShowNewForm(false)}
            onCreate={handleCreate}
          />
        )}

        {/* Detail Modal */}
        {selectedBudget && (
          <DetailModal
            budget={presupuestos.find(p => p.id === selectedBudget.id) || selectedBudget}
            user={user}
            onClose={() => setSelectedBudget(null)}
            actions={canAdvance(presupuestos.find(p => p.id === selectedBudget.id) || selectedBudget)}
            onAction={(state) => handleChangeState(selectedBudget.id, state)}
            allUsers={DEMO_USERS}
          />
        )}
      </div>
    </>
  );
}

// ============================================================
// LOGIN PAGE
// ============================================================
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleDemoLogin = (u) => {
    onLogin(u);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (useDemoMode) {
      const found = DEMO_USERS.find((u) => u.email === email);
      if (found) {
        onLogin(found);
      } else {
        setError("Usuario no encontrado. Usá alguno de los usuarios de demostración.");
      }
    } else {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        let userData = null;
        try {
          const userDoc = await getDoc(doc(firestore, "usuarios", cred.user.uid));
          if (userDoc.exists()) {
            userData = userDoc.data();
          }
        } catch (e) { /* Firestore doc not found */ }
        onLogin({
          uid: cred.user.uid,
          email: cred.user.email,
          displayName: userData?.displayName || cred.user.email.split("@")[0],
          role: userData?.role || "Gerente General",
          secondaryRole: userData?.secondaryRole || "",
        });
      } catch (err) {
        setError("Email o contraseña incorrectos.");
      }
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">PresupuestOS</div>
        <div className="login-sub">Sistema de Gestión de Presupuestos</div>

        {useDemoMode && (
          <div className="demo-banner">
            <div className="demo-banner-title">🎮 Modo Demostración — Seleccioná un usuario</div>
            <div className="demo-users-grid">
              {DEMO_USERS.map((u) => (
                <button key={u.uid} className="demo-user-btn" onClick={() => handleDemoLogin(u)}>
                  <div className="demo-user-name">{u.displayName}</div>
                  <div className="demo-user-role">{u.role}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 12, marginBottom: 16 }}>
          — o ingresá con tu cuenta —
        </div>

        {error && <div style={{ background: "rgba(225,112,85,0.15)", color: "var(--danger)", padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" />
        </div>
        <div className="form-group">
          <label className="form-label">Contraseña</label>
          <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={handleSubmit}>
          Iniciar Sesión
        </button>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD VIEW
// ============================================================
function DashboardView({ presupuestos, onSelect }) {
  const totalMonto = presupuestos.reduce((s, p) => s + (p.monto || 0), 0);
  const activos = presupuestos.filter((p) => p.estado !== "finalizado").length;
  const finalizados = presupuestos.filter((p) => p.estado === "finalizado").length;
  const aceptados = presupuestos.filter((p) => ["aceptado", "sena_cobrada", "en_ejecucion", "finalizado"].includes(p.estado));
  const montoAceptado = aceptados.reduce((s, p) => s + (p.monto || 0), 0);

  const byEstado = ESTADOS.map((e) => ({
    ...e,
    count: presupuestos.filter((p) => p.estado === e.id).length,
  }));

  const byArea = AREAS.map((a) => ({
    area: a,
    count: presupuestos.filter((p) => p.area === a).length,
    monto: presupuestos.filter((p) => p.area === a).reduce((s, p) => s + (p.monto || 0), 0),
  }));

  const maxAreaCount = Math.max(...byArea.map((a) => a.count), 1);
  const maxEstadoCount = Math.max(...byEstado.map((e) => e.count), 1);

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card" style={{ borderTop: "3px solid var(--accent)" }}>
          <div className="stat-value">{presupuestos.length}</div>
          <div className="stat-label">Presupuestos Totales</div>
        </div>
        <div className="stat-card" style={{ borderTop: "3px solid var(--info)" }}>
          <div className="stat-value">{activos}</div>
          <div className="stat-label">En Proceso</div>
        </div>
        <div className="stat-card" style={{ borderTop: "3px solid var(--success)" }}>
          <div className="stat-value">{finalizados}</div>
          <div className="stat-label">Finalizados</div>
        </div>
        <div className="stat-card" style={{ borderTop: "3px solid var(--warning)" }}>
          <div className="stat-value">{formatMonto(totalMonto)}</div>
          <div className="stat-label">Monto Total</div>
        </div>
        <div className="stat-card" style={{ borderTop: "3px solid var(--success)" }}>
          <div className="stat-value">{formatMonto(montoAceptado)}</div>
          <div className="stat-label">Monto Aceptado</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <div className="chart-title">Presupuestos por Estado</div>
          <div className="bar-chart">
            {byEstado.map((e) => (
              <div key={e.id} className="bar-row">
                <div className="bar-label">{e.icon} {e.label}</div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(e.count / maxEstadoCount) * 100}%`, background: e.color }}>
                    <span className="bar-value">{e.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Presupuestos por Área</div>
          <div className="bar-chart">
            {byArea.map((a) => {
              const colors = { CIL: "#74B9FF", Consultoría: "#A29BFE", Agro: "#00B894", Marketing: "#FDCB6E" };
              return (
                <div key={a.area} className="bar-row">
                  <div className="bar-label">{a.area}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(a.count / maxAreaCount) * 100}%`, background: colors[a.area] }}>
                      <span className="bar-value">{a.count} — {formatMonto(a.monto)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Actividad Reciente</span>
        </div>
        <div className="card-body" style={{ maxHeight: 300, overflowY: "auto" }}>
          {presupuestos
            .flatMap((p) => p.historial.map((h) => ({ ...h, budgetId: p.id, cliente: p.cliente })))
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            .slice(0, 15)
            .map((h, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)", alignItems: "flex-start" }}>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", minWidth: 120, flexShrink: 0 }}>
                  {formatDateTime(h.fecha)}
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13 }}>
                    <strong>{h.usuario}</strong> — {h.accion}
                  </span>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{h.budgetId} · {h.cliente}</div>
                </div>
                {h.estadoNuevo && (
                  <span className="detail-badge" style={{ background: ESTADO_MAP[h.estadoNuevo]?.bg, color: ESTADO_MAP[h.estadoNuevo]?.color, fontSize: 11 }}>
                    {ESTADO_MAP[h.estadoNuevo]?.icon} {ESTADO_MAP[h.estadoNuevo]?.label}
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

// ============================================================
// KANBAN VIEW
// ============================================================
function KanbanView({ presupuestos, onSelect }) {
  return (
    <div className="kanban">
      {ESTADOS.map((estado) => {
        const items = presupuestos.filter((p) => p.estado === estado.id);
        return (
          <div key={estado.id} className="kanban-col">
            <div className="kanban-col-header">
              <div className="kanban-col-title" style={{ color: estado.color }}>
                <span>{estado.icon}</span>
                <span>{estado.label}</span>
              </div>
              <div className="kanban-col-badge" style={{ background: estado.bg, color: estado.color }}>
                {items.length}
              </div>
            </div>
            <div className="kanban-col-body">
              {items.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin presupuestos</div>
                </div>
              ) : items.map((p) => {
                const days = daysSince(p.updatedAt);
                const isStale = days >= DIAS_RECORDATORIO && p.estado !== "finalizado";
                return (
                  <div key={p.id} className={`kanban-card ${isStale ? "kanban-card-alert" : ""}`} onClick={() => onSelect(p)}>
                    <div className="kanban-card-top">
                      <span className="kanban-card-id">{p.id}</span>
                      <span className={`kanban-card-area ${areaClass(p.area)}`}>{p.area}</span>
                    </div>
                    <div className="kanban-card-cliente">{p.cliente}</div>
                    <div className="kanban-card-desc">{p.descripcion}</div>
                    <div className="kanban-card-footer">
                      <span className="kanban-card-monto">{formatMonto(p.monto)}</span>
                      <span className={`kanban-card-days ${isStale ? "alert" : ""}`}>
                        <Icons.Clock />
                        {days}d
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// LIST VIEW
// ============================================================
function ListView({ presupuestos, onSelect }) {
  return (
    <div className="card">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["ID", "Cliente", "Área", "Descripción", "Monto", "Estado", "Última act.", ""].map((h) => (
                <th key={h} style={{ padding: "12px 16px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {presupuestos.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No se encontraron presupuestos</td>
              </tr>
            ) : presupuestos.map((p) => {
              const est = ESTADO_MAP[p.estado];
              const days = daysSince(p.updatedAt);
              const isStale = days >= DIAS_RECORDATORIO && p.estado !== "finalizado";
              return (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "background 0.15s" }}
                  onClick={() => onSelect(p)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "12px 16px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{p.id}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>{p.cliente}</td>
                  <td style={{ padding: "12px 16px" }}><span className={`kanban-card-area ${areaClass(p.area)}`} style={{ fontSize: 11 }}>{p.area}</span></td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.descripcion}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{formatMonto(p.monto)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span className="detail-badge" style={{ background: est?.bg, color: est?.color, fontSize: 11 }}>{est?.icon} {est?.label}</span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: isStale ? "var(--danger)" : "var(--text-muted)", fontWeight: isStale ? 600 : 400 }}>
                    {days === 0 ? "Hoy" : `Hace ${days}d`}
                    {isStale && " ⚠️"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <button className="btn btn-ghost btn-sm"><Icons.ArrowRight /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// NEW BUDGET MODAL
// ============================================================
function NewBudgetModal({ user, onClose, onCreate }) {
  const defaultArea = ROLE_AREA_MAP[user.role] || "CIL";
  const [cliente, setCliente] = useState("");
  const [area, setArea] = useState(defaultArea);
  const [descripcion, setDescripcion] = useState("");
  const [validez, setValidez] = useState("");
  const [items, setItems] = useState([{ desc: "", monto: "" }]);

  const addItem = () => setItems([...items, { desc: "", monto: "" }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, field, val) => {
    const newItems = [...items];
    newItems[i] = { ...newItems[i], [field]: val };
    setItems(newItems);
  };

  const total = items.reduce((s, it) => s + (parseFloat(it.monto) || 0), 0);

  const handleSubmit = () => {
    if (!cliente.trim() || !descripcion.trim()) return;
    onCreate({
      cliente: cliente.trim(),
      area,
      descripcion: descripcion.trim(),
      monto: total,
      items: items.filter((it) => it.desc.trim()).map((it) => ({ desc: it.desc, monto: parseFloat(it.monto) || 0 })),
      validez: validez ? new Date(validez).toISOString() : new Date(Date.now() + 30 * 86400000).toISOString(),
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Nuevo Presupuesto</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Cliente *</label>
              <input className="form-input" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre del cliente" />
            </div>
            <div className="form-group">
              <label className="form-label">Área</label>
              <select className="form-select" value={area} onChange={(e) => setArea(e.target.value)}>
                {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Descripción del Trabajo *</label>
            <textarea className="form-textarea" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Describí el trabajo a presupuestar..." />
          </div>
          <div className="form-group">
            <label className="form-label">Fecha de Validez</label>
            <input className="form-input" type="date" value={validez} onChange={(e) => setValidez(e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Ítems del Presupuesto</label>
            {items.map((it, i) => (
              <div key={i} className="item-row">
                <input className="form-input" placeholder="Descripción del ítem" value={it.desc} onChange={(e) => updateItem(i, "desc", e.target.value)} />
                <input className="form-input" type="number" placeholder="Monto" value={it.monto} onChange={(e) => updateItem(i, "monto", e.target.value)} />
                {items.length > 1 && (
                  <button className="remove-item" onClick={() => removeItem(i)}><Icons.Trash /></button>
                )}
              </div>
            ))}
            <button className="add-item" onClick={addItem}>
              <Icons.Plus /> Agregar ítem
            </button>
            {total > 0 && (
              <div className="items-total">Total: {formatMonto(total)}</div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={!cliente.trim() || !descripcion.trim()}>
            Crear Solicitud
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DETAIL MODAL
// ============================================================
function DetailModal({ budget, user, onClose, actions, onAction, allUsers }) {
  const est = ESTADO_MAP[budget.estado];
  const solicitante = allUsers.find((u) => u.uid === budget.solicitante);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Detalle del Presupuesto</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {/* Header */}
          <div className="detail-header">
            <div>
              <div className="detail-id">{budget.id}</div>
              <div className="detail-cliente">{budget.cliente}</div>
              <div className="detail-meta">
                <span className={`detail-badge ${areaClass(budget.area)}`}>{budget.area}</span>
                <span className="detail-badge" style={{ background: est?.bg, color: est?.color }}>
                  {est?.icon} {est?.label}
                </span>
                {budget.validez && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Icons.Clock /> Válido hasta {formatDate(budget.validez)}
                  </span>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{formatMonto(budget.monto)}</div>
              {solicitante && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Solicitado por {solicitante.displayName}</div>}
            </div>
          </div>

          {/* Actions */}
          {actions.length > 0 && (
            <div className="action-group" style={{ marginBottom: 24 }}>
              {actions.map((a) => (
                <button key={a.state} className={`btn ${a.color}`} onClick={() => onAction(a.state)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}

          <div className="detail-sections">
            <div>
              {/* Description */}
              <div className="detail-section">
                <div className="detail-section-title">Descripción</div>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>{budget.descripcion}</p>
              </div>

              {/* Items */}
              {budget.items && budget.items.length > 0 && (
                <div className="detail-section">
                  <div className="detail-section-title">Detalle de Ítems</div>
                  <table className="items-table">
                    <thead>
                      <tr><th>Concepto</th><th style={{ textAlign: "right" }}>Monto</th></tr>
                    </thead>
                    <tbody>
                      {budget.items.map((it, i) => (
                        <tr key={i}><td>{it.desc}</td><td>{formatMonto(it.monto)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="items-total">Total: {formatMonto(budget.monto)}</div>
                </div>
              )}

              {/* Archivos */}
              {budget.archivos && budget.archivos.length > 0 && (
                <div className="detail-section">
                  <div className="detail-section-title">Archivos Adjuntos</div>
                  {budget.archivos.map((f, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: 8, marginBottom: 6 }}>
                      <Icons.File />
                      <span style={{ fontSize: 13, flex: 1 }}>{f.nombre}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDate(f.fecha)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Timeline */}
            <div>
              <div className="detail-section">
                <div className="detail-section-title">Historial de Cambios</div>
                <div className="timeline">
                  {[...budget.historial].reverse().map((h, i) => {
                    const est2 = ESTADO_MAP[h.estadoNuevo];
                    return (
                      <div key={i} className="timeline-item">
                        <div className="timeline-dot" style={{ borderColor: est2?.color || "var(--border)" }} />
                        <div className="timeline-date">{formatDateTime(h.fecha)}</div>
                        <div className="timeline-text">{h.accion}</div>
                        <div className="timeline-user">{h.usuario}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
