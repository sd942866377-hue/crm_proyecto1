// app.js - Lógica interactiva del CRM Móvil de Seguridad

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

// 2. Elementos del DOM - Pestañas
const tabRegistrar = document.getElementById('tabRegistrar');
const tabVerListas = document.getElementById('tabVerListas');
const contentRegistrar = document.getElementById('contentRegistrar');
const contentVerListas = document.getElementById('contentVerListas');

// Elementos del DOM - Formulario
const crmForm = document.getElementById('crmForm');
const nombreInput = document.getElementById('nombre');
const telefonoInput = document.getElementById('telefono');
const estadoSelect = document.getElementById('estado');
const observacionInput = document.getElementById('observacion');
const confettiContainer = document.getElementById('confetti');

// Elementos del DOM - Listado de Clientes y Paginación
const clientsList = document.getElementById('clientsList');
const filtersContainer = document.getElementById('filtersContainer');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const pageInfo = document.getElementById('pageInfo');
const toastContainer = document.getElementById('toast-container');

// 3. Variables de Estado de la Pestaña "Ver Listas"
let currentPage = 1;
let currentFilter = '';
let totalPages = 1;

// 4. Lógica de Pestañas (Tabs)
tabRegistrar.addEventListener('click', () => {
    switchTab('registrar');
});

tabVerListas.addEventListener('click', () => {
    switchTab('listas');
    currentPage = 1;
    fetchClients(); // Cargar la lista automáticamente al abrir la pestaña
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

// 5. Gestión del Select (Floating Label)
function updateSelectLabel() {
    if (estadoSelect.value) {
        estadoSelect.classList.add('has-value');
    } else {
        estadoSelect.classList.remove('has-value');
    }
}
updateSelectLabel();
estadoSelect.addEventListener('change', () => {
    updateSelectLabel();
    if (estadoSelect.value === 'Cerrado') {
        triggerConfetti();
        showToast("¡Excelente! Cierre de venta de seguridad 🏆", "success");
        playHaptic('impact', 'medium');
    }
});

// Escuchas para limpiar los errores de validación al escribir
nombreInput.addEventListener('input', () => {
    document.getElementById('group-nombre').classList.remove('error');
});
telefonoInput.addEventListener('input', () => {
    document.getElementById('group-telefono').classList.remove('error');
});

// 6. Validaciones
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

// 7. Enviar Formulario de Cliente al Servidor
crmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const isNombreValid = validateField(nombreInput, valNombre, 'group-nombre');
    const isTelefonoValid = validateField(telefonoInput, valTelefono, 'group-telefono');
    
    if (!isNombreValid || !isTelefonoValid) {
        showToast("Completa los campos requeridos.", "error");
        playHaptic('notification', 'error');
        
        // Animación visual de sacudida
        const container = document.querySelector('.container');
        container.style.animation = 'none';
        setTimeout(() => {
            container.style.animation = 'shake 0.4s ease-in-out';
        }, 10);
        return;
    }
    
    const nombre = nombreInput.value.trim();
    const telefono = telefonoInput.value.trim();
    const estado = estadoSelect.value;
    const observacion = observacionInput.value.trim();
    
    const datosCRM = {
        nombre: nombre,
        telefono: telefono,
        estado: estado,
        observacion: observacion
    };
    
    try {
        // Enviar a la API del servidor Flask
        const response = await fetch('/api/clientes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datosCRM)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast("Registro guardado en SQLite", "success");
            playHaptic('notification', 'success');
            if (estado === 'Cerrado') triggerConfetti();
            
            // Opcional: enviar mediante WebApp de Telegram si está disponible
            try {
                if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.sendData) {
                    // Espera un momento para que el usuario visualice el Toast antes de interactuar con el bot
                    setTimeout(() => {
                        tg.sendData(JSON.stringify(datosCRM));
                    }, 1000);
                }
            } catch (err) {
                console.log("No se pudo enviar datos por sendData:", err);
            }
            
            // Resetear formulario
            crmForm.reset();
            setTimeout(() => {
                updateSelectLabel();
            }, 50);
            
        } else {
            showToast(result.error || "Error al guardar el cliente.", "error");
            playHaptic('notification', 'error');
        }
        
    } catch (error) {
        console.error("Error de red:", error);
        showToast("Error de conexión con el backend", "error");
        playHaptic('notification', 'error');
    }
});

// 8. Consultar Clientes con Filtros y Paginación
async function fetchClients() {
    clientsList.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-muted);">
            <span class="material-icons" style="animation: spin 1s infinite linear; font-size: 24px;">sync</span>
            <p style="margin-top: 8px; font-size: 13px;">Cargando clientes...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`/api/clientes?estado=${encodeURIComponent(currentFilter)}&page=${currentPage}`);
        const data = await response.json();
        
        if (response.ok) {
            renderClients(data.clientes);
            totalPages = data.pages;
            updatePaginationControls();
        } else {
            clientsList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--color-no-contesta);">Error al cargar los datos.</div>`;
        }
    } catch (error) {
        console.error("Error al cargar clientes:", error);
        clientsList.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--color-no-contesta);">Error de red con el servidor.</div>`;
    }
}

// 9. Renderizar Clientes y Enlaces de Acción Directa
function renderClients(clientes) {
    clientsList.innerHTML = '';
    
    if (clientes.length === 0) {
        clientsList.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <span class="material-icons" style="font-size: 36px; opacity: 0.5;">people_outline</span>
                <p style="margin-top: 8px; font-size: 14px;">No se encontraron clientes para este estado.</p>
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
        
        // Limpiar teléfono para links móviles
        const cleanPhone = client.telefono.replace(/[^\d+]/g, '');
        
        // Mensaje de seguimiento personalizado para asesores de seguridad
        const baseMsg = `Hola ${client.nombre}, le saluda su asesor de seguridad. Quería dar seguimiento a su requerimiento de protección de instalaciones. ¿Cómo podemos ayudarle?`;
        const encodedMsg = encodeURIComponent(baseMsg);
        
        const card = document.createElement('div');
        card.className = 'client-card';
        card.innerHTML = `
            <div class="client-header">
                <div>
                    <div class="client-name">${escapeHTML(client.nombre)}</div>
                    <div class="client-phone">${escapeHTML(client.telefono)}</div>
                </div>
                <span class="badge ${badgeClass}">${client.estado}</span>
            </div>
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

// 10. Controles de Paginación
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

// 11. Eventos de los Botones de Filtro
filtersContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    
    // Cambiar botón activo
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    currentFilter = btn.dataset.estado;
    currentPage = 1;
    fetchClients();
    playHaptic('impact', 'light');
});

// 12. Helper para Sanitizar HTML
function escapeHTML(str) {
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

// 13. Toasts y Confeti
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
