// app.js - Lógica interactiva del CRM de Seguridad para base_rpmkt

// 1. Inicializar Telegram WebApp
const tg = window.Telegram.WebApp;
try {
    tg.expand();
    tg.ready();
    if (tg.themeParams && Object.keys(tg.themeParams).length > 0) {
        document.body.classList.add('telegram');
    }
} catch (e) {
    console.warn("Telegram WebApp no inicializado (Ejecutándose en navegador)");
}

// Determinar la URL base de la API (soporte para despliegue en GitHub Pages u orígenes remotos)
let API_BASE_URL = '';
if (window.location.hostname === '7-hue.github.io') {
    API_BASE_URL = localStorage.getItem('api_backend_url') || '';
    if (!API_BASE_URL) {
        const inputUrl = prompt(
            "Se detectó ejecución desde GitHub Pages.\n\n" +
            "Por favor, ingresa la URL de tu backend local (Flask/ngrok) para conectar la base de datos:\n" +
            "(Ejemplo: https://tu-subdominio.ngrok-free.app)"
        );
        if (inputUrl) {
            API_BASE_URL = inputUrl.trim().replace(/\/$/, '');
            localStorage.setItem('api_backend_url', API_BASE_URL);
        }
    }
}


// 2. Elementos del DOM - Pestañas
const tabRegistrar = document.getElementById('tabRegistrar');
const tabVerListas = document.getElementById('tabVerListas');
const contentRegistrar = document.getElementById('contentRegistrar');
const contentVerListas = document.getElementById('contentVerListas');

// Elementos del DOM - Formulario (14 campos)
const crmForm = document.getElementById('crmForm');
const clienteInput = document.getElementById('cliente');
const telefonoInput = document.getElementById('telefono');
const distritoInput = document.getElementById('distrito');
const direccionInput = document.getElementById('direccion');
const estadoSelect = document.getElementById('estado');
const estadoSeguimientoSelect = document.getElementById('estado_seguimiento');
const accionContactoSelect = document.getElementById('accion_contacto');
const procedenciaInput = document.getElementById('procedencia');
const archivoOrigenInput = document.getElementById('archivo_origen');
const fechaInput = document.getElementById('fecha');
const horaInput = document.getElementById('hora');
const contactoObservacionInput = document.getElementById('contacto_observacion');
const observacionInput = document.getElementById('observacion');
const historialContactosInput = document.getElementById('historial_contactos');

const confettiContainer = document.getElementById('confetti');

// Elementos del DOM - Listado y Paginación
const clientsList = document.getElementById('clientsList');
const filtersContainer = document.getElementById('filtersContainer');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const pageInfo = document.getElementById('pageInfo');
const toastContainer = document.getElementById('toast-container');

// 3. Variables de Estado
let currentPage = 1;
let currentFilter = '';
let totalPages = 1;

// 4. Lógica de Pestañas
tabRegistrar.addEventListener('click', () => {
    switchTab('registrar');
});

tabVerListas.addEventListener('click', () => {
    switchTab('listas');
    currentPage = 1;
    fetchClients();
});

function switchTab(tab) {
    if (tab === 'registrar') {
        tabRegistrar.classList.add('active');
        tabVerListas.classList.remove('active');
        contentRegistrar.classList.add('active');
        contentVerListas.classList.remove('active');
    } else {
        tabRegistrar.classList.remove('active');
        tabVerListas.classList.add('active');
        contentRegistrar.classList.remove('active');
        contentVerListas.classList.add('active');
    }
}

// Escuchador para "Venta Cerrada 🎉"
estadoSelect.addEventListener('change', () => {
    if (estadoSelect.value === 'Cerrado') {
        triggerConfetti();
        showToast("¡Excelente! Cierre de venta de seguridad 🏆", "success");
        playHaptic('impact', 'medium');
    }
});

// Limpieza de errores de validación al escribir
clienteInput.addEventListener('input', () => {
    document.getElementById('group-cliente').classList.remove('error');
});
telefonoInput.addEventListener('input', () => {
    document.getElementById('group-telefono').classList.remove('error');
});

// 5. Validaciones
const valNombre = (val) => val.trim().length >= 3;
const valTelefono = (val) => {
    const clean = val.replace(/\s+/g, '').replace(/[\-\+]/g, '');
    return clean.length >= 7 && clean.length <= 15 && /^\d+$/.test(clean);
};

function validateField(inputElement, validationFn, groupSelector) {
    const formGroup = document.getElementById(groupSelector);
    const isValid = validationFn(inputElement.value);
    
    if (!isValid) {
        formGroup.classList.add('error');
    } else {
        formGroup.classList.remove('error');
    }
    return isValid;
}

// 6. Enviar Formulario al Servidor
crmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const isClienteValid = validateField(clienteInput, valNombre, 'group-cliente');
    const isTelefonoValid = validateField(telefonoInput, valTelefono, 'group-telefono');
    
    if (!isClienteValid || !isTelefonoValid) {
        showToast("Completa los campos requeridos.", "error");
        playHaptic('notification', 'error');
        
        // Sacudida visual en error
        const container = document.querySelector('.container');
        container.style.animation = 'none';
        setTimeout(() => {
            container.style.animation = 'shake 0.4s ease-in-out';
        }, 10);
        return;
    }
    
    // Armar el payload completo con los 14 campos
    const datosCRM = {
        cliente: clienteInput.value.trim(),
        telefono: telefonoInput.value.trim(),
        distrito: distritoInput.value.trim(),
        direccion: direccionInput.value.trim(),
        estado: estadoSelect.value,
        estado_seguimiento: estadoSeguimientoSelect.value,
        accion_contacto: accionContactoSelect.value,
        procedencia: procedenciaInput.value.trim(),
        archivo_origen: archivoOrigenInput.value.trim(),
        fecha: fechaInput.value,
        hora: horaInput.value,
        contacto_observacion: contactoObservacionInput.value.trim(),
        observacion: observacionInput.value.trim(),
        historial_contactos: historialContactosInput.value.trim()
    };
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/clientes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datosCRM)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast("Guardado en tabla base_rpmkt", "success");
            playHaptic('notification', 'success');
            if (datosCRM.estado === 'Cerrado') triggerConfetti();
            
            // Opcional: Notificar a Telegram
            try {
                if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.sendData) {
                    setTimeout(() => {
                        tg.sendData(JSON.stringify(datosCRM));
                    }, 1000);
                }
            } catch (err) {
                console.log("No se pudo enviar sendData:", err);
            }
            
            // Resetear
            crmForm.reset();
            
            // Mantener archivo origen por defecto
            document.getElementById('archivo_origen').value = 'BASE_RPMKT_2.xlsx';
            
        } else {
            showToast(result.error || "Error al registrar cliente.", "error");
            playHaptic('notification', 'error');
        }
        
    } catch (error) {
        console.error("Error de red:", error);
        showToast("Error de conexión con el backend", "error");
        playHaptic('notification', 'error');
        if (window.location.hostname === '7-hue.github.io') {
            localStorage.removeItem('api_backend_url');
        }
    }
});

// 7. Cargar Registros Paginados
async function fetchClients() {
    clientsList.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            <span class="material-icons" style="animation: spin 1s infinite linear; font-size: 24px;">sync</span>
            <p style="margin-top: 8px; font-size: 13px;">Consultando base_rpmkt...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/clientes?estado=${encodeURIComponent(currentFilter)}&page=${currentPage}`);
        const data = await response.json();
        
        if (response.ok) {
            renderClients(data.clientes);
            totalPages = data.pages;
            updatePaginationControls();
        } else {
            clientsList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--color-no-contesta);">Error al obtener datos del servidor.</div>`;
        }
    } catch (error) {
        console.error("Error al cargar clientes:", error);
        clientsList.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--color-no-contesta);">
                <p>Error de red con el backend.</p>
                <button onclick="localStorage.removeItem('api_backend_url'); location.reload();" style="margin-top: 8px; padding: 8px 14px; background: #ff453a; border: none; border-radius: 10px; color: #ffffff; cursor: pointer; font-family: var(--font-family); font-weight: 600; font-size: 12px;">
                    Restablecer URL de API
                </button>
            </div>
        `;
    }
}

// 8. Renderizar Tarjetas de Cliente con Detalles Adicionales
function renderClients(clientes) {
    clientsList.innerHTML = '';
    
    if (clientes.length === 0) {
        clientsList.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <span class="material-icons" style="font-size: 36px; opacity: 0.5;">people_outline</span>
                <p style="margin-top: 8px; font-size: 14px;">No hay prospectos en este estado.</p>
            </div>
        `;
        return;
    }
    
    clientes.forEach(client => {
        let badgeClass = 'interesado';
        if (client.estado === 'En Proceso') badgeClass = 'en-proceso';
        if (client.estado === 'No Contesta') badgeClass = 'no-contesta';
        if (client.estado === 'Llamar en Fecha') badgeClass = 'llamar-fecha';
        if (client.estado === 'Enviar Información') badgeClass = 'enviar-info';
        if (client.estado === 'Cerrado') badgeClass = 'cerrado';
        
        const cleanPhone = client.telefono.replace(/[^\d+]/g, '');
        
        // Mensaje de WhatsApp personalizado
        const baseMsg = `Hola ${client.cliente}, le saluda su asesor de seguridad. Quería dar seguimiento a su requerimiento de protección de instalaciones. ¿Cómo podemos ayudarle?`;
        const encodedMsg = encodeURIComponent(baseMsg);
        
        const card = document.createElement('div');
        card.className = 'client-card';
        
        // Construir detalles geográficos y de seguimiento
        const extraInfo = [];
        if (client.distrito) extraInfo.push(`📍 Distrito: ${escapeHTML(client.distrito)}`);
        if (client.estado_seguimiento) extraInfo.push(`📝 Seg: ${escapeHTML(client.estado_seguimiento)}`);
        if (client.accion_contacto) extraInfo.push(`⚡ Acc: ${escapeHTML(client.accion_contacto)}`);
        
        card.innerHTML = `
            <div class="client-header">
                <div>
                    <div class="client-name">${escapeHTML(client.cliente)}</div>
                    <div class="client-phone">${escapeHTML(client.telefono)}</div>
                </div>
                <span class="badge ${badgeClass}">${client.estado}</span>
            </div>
            
            ${extraInfo.length > 0 ? `
                <div style="font-size: 11px; color: var(--text-muted); display: flex; flex-direction: column; gap: 2px; margin-top: 2px;">
                    ${extraInfo.map(info => `<span>${info}</span>`).join('')}
                </div>
            ` : ''}
            
            ${client.observacion ? `<div class="client-obs">${escapeHTML(client.observacion)}</div>` : ''}
            
            <div class="client-actions">
                <a href="tel:${cleanPhone}" class="action-btn call" onclick="playHaptic('impact', 'light')">
                    <span class="material-icons">phone</span>
                    <span>Llamar</span>
                </a>
                <a href="https://wa.me/${cleanPhone}?text=${encodedMsg}" target="_blank" class="action-btn whatsapp" onclick="playHaptic('impact', 'light')">
                    <span class="material-icons">chat</span>
                    <span>WhatsApp</span>
                </a>
            </div>
        `;
        clientsList.appendChild(card);
    });
}

// 9. Controles de Paginación y Filtros
function updatePaginationControls() {
    pageInfo.textContent = `Pág. ${currentPage} de ${totalPages || 1}`;
    btnPrev.disabled = currentPage <= 1;
    btnNext.disabled = currentPage >= totalPages;
}

btnPrev.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        fetchClients();
        playHaptic('impact', 'light');
    }
});

btnNext.addEventListener('click', () => {
    if (currentPage < totalPages) {
        currentPage++;
        fetchClients();
        playHaptic('impact', 'light');
    }
});

filtersContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    currentFilter = btn.dataset.estado;
    currentPage = 1;
    fetchClients();
    playHaptic('impact', 'light');
});

// Helpers
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const iconName = type === 'success' ? 'check_circle' : 'error_outline';
    
    toast.innerHTML = `
        <span class="material-icons icon">${iconName}</span>
        <span>${message}</span>
    `;
    toastContainer.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 350);
    }, 3500);
}

function triggerConfetti() {
    const colors = ['#0a84ff', '#30d158', '#bf5af2', '#ff9f0a', '#ff453a', '#ffd60a'];
    const particleCount = 45;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';
        
        const left = Math.random() * 100;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const scale = Math.random() * 0.8 + 0.4;
        const duration = Math.random() * 1.2 + 0.8;
        const delay = Math.random() * 0.3;
        
        particle.style.left = `${left}%`;
        particle.style.backgroundColor = color;
        particle.style.transform = `scale(${scale})`;
        particle.style.animation = `confetti-fall ${duration}s ${delay}s forwards ease-out`;
        
        confettiContainer.appendChild(particle);
        setTimeout(() => {
            particle.remove();
        }, (duration + delay) * 1000);
    }
}

function playHaptic(type = 'notification', style = 'success') {
    try {
        if (tg.HapticFeedback) {
            if (type === 'notification') {
                tg.HapticFeedback.notificationOccurred(style);
            } else if (type === 'impact') {
                tg.HapticFeedback.impactOccurred(style);
            }
        }
    } catch (e) {
        console.log("HapticFeedback no disponible.");
    }
}
